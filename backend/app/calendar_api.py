"""Google connection routes and durable calendar job handler."""
import json
import secrets
from datetime import timedelta
from urllib.parse import urlencode
from uuid import UUID
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, AwareDatetime
from sqlalchemy import select,func,DateTime
from .api import context, headers
from .config import settings
from .db import Record, Job, Session, now, uid
from .service import get, create_record, begin, expected, digest, serialize, audit, snapshot, page_query
from .auth import Actor
from .db import Operation
from .errors import require, DomainError
from .google_provider import GoogleCalendar, GoogleError, exchange_token

router=APIRouter(prefix='/api/v1/calendar')
def cipher():
    require(bool(settings().credential_encryption_key),'invalid_state','Configure credential encryption before connecting Google.')
    return Fernet(settings().credential_encryption_key.encode())
def connection(db,wid):
    return db.scalar(select(Record).where(Record.workspace_id==wid,Record.kind=='calendar-connection').with_for_update())
def safe(r):
    return {'id':r.id,'revision':r.revision,**{k:v for k,v in r.data.items() if k not in ('credentials','oauth_state','state_expires')}} if r else {'status':'disconnected','revision':0}
def provider(r):
    cfg=settings(); tokens=json.loads(cipher().decrypt(r.data['credentials'].encode()))
    if tokens.get('refresh_token'):
        fresh=exchange_token(cfg.google_client_id,cfg.google_client_secret,refresh_token=tokens['refresh_token'])
        tokens.update(fresh)
        r.data={**r.data,'credentials':cipher().encrypt(json.dumps(tokens).encode()).decode()}
    return GoogleCalendar(tokens['access_token'])

@router.get('/connection')
def status(ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:read');return {'data':safe(connection(db,w.id))}
@router.post('/connection/authorize')
def authorize(request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:write');cfg=settings();require(bool(cfg.google_client_id and cfg.google_client_secret),'invalid_state','Google OAuth is not configured.');cipher()
    key,rev=headers(request);op,replay=begin(db,w.id,a,key,'google-authorize',{},rev)
    if replay:return replay
    r=connection(db,w.id)
    if not r:r=create_record(db,w.id,'calendar-connection',{'status':'disconnected'})
    state=secrets.token_urlsafe(32)
    r.data={**r.data,'oauth_state':digest(state),'state_expires':(now()+timedelta(minutes=10)).isoformat()}
    url='https://accounts.google.com/o/oauth2/v2/auth?'+urlencode({'client_id':cfg.google_client_id,'redirect_uri':cfg.google_redirect_uri,'response_type':'code','scope':'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events','access_type':'offline','prompt':'consent','state':state})
    op.result={'data':{'authorization_url':url}};return op.result
@router.get('/connection/callback')
def callback(state:str,code:str):
    from datetime import datetime
    cfg=settings()
    with Session.begin() as db:
        r=db.scalar(select(Record).where(Record.kind=='calendar-connection',Record.data['oauth_state'].astext==digest(state)).with_for_update())
        require(r is not None,'forbidden','Invalid OAuth state.')
        require(datetime.fromisoformat(r.data['state_expires'])>now(),'forbidden','Expired OAuth state.')
        tokens=exchange_token(cfg.google_client_id,cfg.google_client_secret,code=code,redirect_uri=cfg.google_redirect_uri)
        r.data={'status':'select_calendar','credentials':cipher().encrypt(json.dumps(tokens).encode()).decode()};r.revision+=1
    return RedirectResponse(cfg.public_base_url)
@router.get('/calendars')
def calendars(ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:read');r=connection(db,w.id);require(r and r.data.get('credentials'),'invalid_state','Connect Google first.')
    p=provider(r)
    try:return {'items':[x for x in p.calendars() if x.get('accessRole') in ('owner','writer')],'next_cursor':None}
    finally:p.close()
class Selection(BaseModel):
    model_config=ConfigDict(extra='forbid')
    calendar_id:str
@router.put('/connection')
def select_calendar(body:Selection,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:write');key,rev=headers(request);op,replay=begin(db,w.id,a,key,'calendar-select',body.model_dump(),rev)
    if replay:return replay
    r=connection(db,w.id);require(r is not None,'invalid_state','Connect Google first.');expected(r,rev)
    require(not r.data.get('calendar_id') or r.data['calendar_id']==body.calendar_id,'invalid_state','Disconnect before switching calendars.')
    p=provider(r)
    try:require(any(x['id']==body.calendar_id and x.get('accessRole') in ('owner','writer') for x in p.calendars()),'forbidden','Calendar is not writable.')
    finally:p.close()
    r.data={**r.data,'calendar_id':body.calendar_id,'status':'connected'};r.revision+=1
    op.result={'data':safe(r),'revision':r.revision,'operation_id':op.id};return op.result
@router.post('/connection/disconnect')
def disconnect(request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:write');key,rev=headers(request);op,replay=begin(db,w.id,a,key,'calendar-disconnect',{},rev)
    if replay:return replay
    r=connection(db,w.id);require(r is not None,'not_found','No connection.');expected(r,rev)
    r.data={'status':'disconnected'};r.revision+=1
    op.result={'data':safe(r),'revision':r.revision};return op.result

def enqueue(db,w,a,key,rev,action,payload):
    op,replay=begin(db,w.id,a,key,'calendar:'+action,payload,rev)
    if replay:return replay
    r=connection(db,w.id);require(r and r.data.get('status')=='connected','invalid_state','Select a connected calendar.')
    payload={**payload,'actor_subject':a.subject,'actor_client':a.client_id,'connection_id':r.id,'calendar_id':r.data['calendar_id'],'connection_revision':r.revision,'action':action}
    if action=='sync':
        pending=db.scalar(select(Job).where(Job.workspace_id==w.id,Job.type=='calendar',Job.state.in_(['queued','running','retry_wait']),Job.payload['action'].astext=='sync',Job.payload['connection_id'].astext==r.id))
        if pending:
            op.result={'operation_id':pending.operation_id,'job_id':pending.id,'status':'pending'};return op.result
    job=Job(id=uid(),workspace_id=w.id,type='calendar',payload=payload,operation_id=op.id);db.add(job)
    op.result={'operation_id':op.id,'job_id':job.id,'status':'pending'};return op.result
@router.post('/sync',status_code=202)
def sync(request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:write');key,rev=headers(request);return enqueue(db,w,a,key,rev,'sync',{})
@router.get('/events')
def events(start:AwareDatetime,end:AwareDatetime,limit:int=25,cursor:str|None=None,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:read');require(timedelta(0)<end-start<=timedelta(days=93),'validation_error','Range must be between 0 and 93 days.')
    from datetime import datetime, timezone
    require(1<=limit<=100,'validation_error','Limit must be between 1 and 100.')
    conn=connection(db,w.id)
    if conn and conn.data.get('status')=='connected':
        p=provider(conn)
        try:
            for item in p.occurrences(conn.data['calendar_id'],start,end):
                if not item.get('recurringEventId'):continue
                existing=db.scalar(select(Record).where(Record.workspace_id==w.id,Record.kind=='calendar-events',Record.data['provider_id'].astext==item['id'],Record.data['calendar_id'].astext==conn.data['calendar_id']))
                data={'provider_id':item['id'],'calendar_id':conn.data['calendar_id'],'etag':item.get('etag'),'title':item.get('summary',''),'start':item.get('start',{}),'end':item.get('end',{}),'recurring_event_id':item['recurringEventId'],'deleted':item.get('status')=='cancelled','attendees':bool(item.get('attendees'))}
                if existing:
                    if any(existing.data.get(k)!=v for k,v in data.items()):existing.data={**existing.data,**data};existing.revision+=1
                else:create_record(db,w.id,'calendar-events',data)
        finally:p.close()
    event_start=func.coalesce(Record.data['start']['dateTime'].astext,Record.data['start']['date'].astext).cast(DateTime(timezone=True))
    event_end=func.coalesce(Record.data['end']['dateTime'].astext,Record.data['end']['date'].astext).cast(DateTime(timezone=True))
    stmt=select(Record).where(Record.workspace_id==w.id,Record.kind=='calendar-events',func.coalesce(Record.data['deleted'].astext,'false')!='true',Record.data['recurrence'].astext.is_(None),event_end>=start,event_start<=end)
    rows,nxt=page_query(db,stmt,Record,[w.id,'calendar-events',start.isoformat(),end.isoformat()],limit,cursor)
    return {'items':[serialize(r) for r in rows],'next_cursor':nxt}
class EventCreate(BaseModel):
    model_config=ConfigDict(extra='forbid')
    lesson_id:UUID
    expected_lesson_revision:int
    title:str
    start:AwareDatetime
    end:AwareDatetime
    timezone:str
class EventMove(BaseModel):
    model_config=ConfigDict(extra='forbid')
    expected_etag:str
    start:AwareDatetime
    end:AwareDatetime
    timezone:str

def timing(body):
    from zoneinfo import ZoneInfo
    try:ZoneInfo(body.timezone)
    except Exception:raise DomainError('validation_error','Unknown timezone.')
    require(body.end>body.start,'validation_error','End must follow start.')
    for value in (body.start,body.end):
        local=value.astimezone(ZoneInfo(body.timezone))
        require(local.utcoffset()==value.utcoffset() and local.replace(tzinfo=None)==value.replace(tzinfo=None),'validation_error','Time offset must agree with the selected timezone, including daylight saving.')
    return {'start':{'dateTime':body.start.isoformat(),'timeZone':body.timezone},'end':{'dateTime':body.end.isoformat(),'timeZone':body.timezone}}
@router.post('/events',status_code=202)
def create_event(body:EventCreate,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:write');key,rev=headers(request)
    lesson=get(db,w.id,'lessons',str(body.lesson_id),True);expected(lesson,body.expected_lesson_revision)
    require(not lesson.archived_at and not lesson.data.get('calendar_event_id'),'invalid_state','Lesson is archived or already scheduled.')
    return enqueue(db,w,a,key,rev,'create',{'lesson_id':lesson.id,'event':{'summary':body.title,**timing(body)}})
@router.patch('/events/{event_id}',status_code=202)
def move_event(event_id:UUID,body:EventMove,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:write');key,rev=headers(request);r=get(db,w.id,'calendar-events',str(event_id),True);expected(r,rev)
    require(not r.data.get('recurrence'),'invalid_state','Edit recurrence series in Google Calendar.')
    return enqueue(db,w,a,key,rev,'move',{'record_id':r.id,'provider_id':r.data['provider_id'],'etag':body.expected_etag,**timing(body)})

def handle_job(db,job):
    r=get(db,job.workspace_id,'calendar-connection',job.payload['connection_id'],True)
    require(r.revision==job.payload['connection_revision'] and r.data.get('status')=='connected','invalid_state','Connection changed while operation was queued.')
    p=None;cid=job.payload['calendar_id'];action=job.payload['action']
    actor=Actor('system',job.payload.get('actor_subject','calendar-sync'),job.payload.get('actor_client','scheduler'),frozenset())
    op=db.get(Operation,job.operation_id)
    try:
        p=provider(r)
        if action=='sync':
            try:items,cursor=p.sync(cid,r.data.get('sync_token'))
            except GoogleError as exc:
                if exc.status!=410:raise
                items,cursor=p.sync(cid)
            r.data={**r.data,'sync_token':cursor,'last_sync_at':now().isoformat()}
        elif action=='create':items=[p.create(cid,job.operation_id,job.payload['event'])]
        elif action=='move':items=[p.reschedule(cid,job.payload['provider_id'],job.payload['etag'],job.payload['start'],job.payload['end'])]
        elif action=='undo':
            current=p.get(cid,job.payload['provider_id'])
            require(current.get('etag')==job.payload['etag'] and not current.get('attendees'),'external_conflict','Calendar changed since this operation.')
            previous=job.payload['before']
            if previous:
                items=[p.reschedule(cid,job.payload['provider_id'],job.payload['etag'],previous['start'],previous['end'])]
            else:
                p.delete(cid,job.payload['provider_id'],job.payload['etag'])
                items=[{**current,'status':'cancelled'}]
        else:raise DomainError('invalid_state','Unknown calendar operation.')
        for item in items:
            local=db.scalar(select(Record).where(Record.workspace_id==job.workspace_id,Record.kind=='calendar-events',Record.data['provider_id'].astext==item['id'],Record.data['calendar_id'].astext==cid))
            data={'provider_id':item['id'],'calendar_id':cid,'etag':item.get('etag'),'title':item.get('summary',''),'start':item.get('start',{}),'end':item.get('end',{}),'deleted':item.get('status')=='cancelled','attendees':bool(item.get('attendees')),'recurrence':item.get('recurrence'),'recurring_event_id':item.get('recurringEventId')}
            before=snapshot(local) if local else None
            if local:local.data={**local.data,**data};local.revision+=1
            else:local=create_record(db,job.workspace_id,'calendar-events',data)
            if op:audit(db,actor,op,local,before,job.payload.get('undo_of'))
            if data['deleted']:
                linked=db.scalars(select(Record).where(Record.workspace_id==job.workspace_id,Record.kind=='lessons',Record.data['calendar_event_id'].astext==local.id).with_for_update()).all()
                for lesson in linked:
                    old=snapshot(lesson)
                    lesson.data={k:v for k,v in lesson.data.items() if k!='calendar_event_id'}
                    lesson.revision+=1
                    if op:audit(db,actor,op,lesson,old)
            if action=='create':
                lesson=get(db,job.workspace_id,'lessons',job.payload['lesson_id'],True)
                before_lesson=snapshot(lesson)
                require(not lesson.data.get('calendar_event_id') or lesson.data['calendar_event_id']==local.id,'external_conflict','Lesson already linked to another event.')
                lesson.data={**lesson.data,'calendar_event_id':local.id};lesson.revision+=1
                if op:audit(db,actor,op,lesson,before_lesson)
    except GoogleError as exc:
        raise DomainError(exc.code,'Google Calendar operation failed.',retryable=exc.retryable) from None
    finally:
        if p:p.close()

class Link(BaseModel):
    model_config=ConfigDict(extra='forbid')
    lesson_id:UUID
    expected_lesson_revision:int

def link_change(event_id,body,request,ctx,unlink=False):
    from .service import audit,snapshot,finish
    db,w,a=ctx;a.permit('calendar:write');key,rev=headers(request)
    op,replay=begin(db,w.id,a,key,f'calendar-link:{event_id}:{unlink}',body.model_dump(mode='json'),rev)
    if replay:return replay
    event=get(db,w.id,'calendar-events',str(event_id),True);expected(event,rev)
    lesson=get(db,w.id,'lessons',str(body.lesson_id),True);expected(lesson,body.expected_lesson_revision)
    before=snapshot(lesson)
    if unlink:
        require(lesson.data.get('calendar_event_id')==event.id,'invalid_state','Lesson is not linked to this event.')
        lesson.data={k:v for k,v in lesson.data.items() if k!='calendar_event_id'}
    else:
        require(not lesson.data.get('calendar_event_id'),'invalid_state','Lesson already linked.')
        existing=db.scalar(select(Record).where(Record.workspace_id==w.id,Record.kind=='lessons',Record.data['calendar_event_id'].astext==event.id))
        require(existing is None,'invalid_state','Event already linked.')
        lesson.data={**lesson.data,'calendar_event_id':event.id}
    lesson.revision+=1;audit(db,a,op,lesson,before);return finish(op,lesson)
@router.post('/events/{event_id}/link')
def link(event_id:UUID,body:Link,request:Request,ctx=Depends(context)):return link_change(event_id,body,request,ctx)
@router.post('/events/{event_id}/unlink')
def unlink(event_id:UUID,body:Link,request:Request,ctx=Depends(context)):return link_change(event_id,body,request,ctx,True)
@router.get('/operations/{operation_id}')
def operation(operation_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('calendar:read')
    job=db.scalar(select(Job).where(Job.workspace_id==w.id,Job.operation_id==str(operation_id),Job.type=='calendar'))
    require(job is not None,'not_found','Operation not found.')
    return {'data':{'operation_id':str(operation_id),'job_id':job.id,'status':job.state,'error':job.error}}

def schedule_syncs(db):
    """Called by the worker; connection row locks deduplicate periodic sync."""
    from datetime import datetime
    from .db import Workspace
    from .auth import Actor
    rows=db.scalars(select(Record).where(Record.kind=='calendar-connection',Record.data['status'].astext=='connected').with_for_update(skip_locked=True)).all()
    for r in rows:
        last=r.data.get('last_sync_at')
        if last and now()-datetime.fromisoformat(last)<timedelta(minutes=5):continue
        pending=db.scalar(select(Job.id).where(Job.workspace_id==r.workspace_id,Job.type=='calendar',Job.state.in_(['queued','running','retry_wait']),Job.payload['action'].astext=='sync'))
        if pending:continue
        w=db.get(Workspace,r.workspace_id)
        enqueue(db,w,Actor('system','scheduler','scheduler',frozenset()),uid(),None,'sync',{})

def undo_calendar(db,w,a,op,target,current_revision):
    """Queue guarded compensation; never locally pretend Google was restored."""
    a.permit('calendar:write')
    event=get(db,w.id,'calendar-events',target.entity_id,True)
    expected(event,current_revision);expected(event,target.revision)
    require(target.client_id!='scheduler','undo_not_supported','Provider synchronization cannot be undone.')
    r=connection(db,w.id);require(r and r.data.get('status')=='connected' and r.data['calendar_id']==event.data['calendar_id'],'invalid_state','Original calendar is not connected.')
    before=target.before['data'] if target.before else None
    payload={'action':'undo','connection_id':r.id,'calendar_id':r.data['calendar_id'],'connection_revision':r.revision,'record_id':event.id,'provider_id':event.data['provider_id'],'etag':event.data['etag'],'before':before,'undo_of':target.id,'actor_subject':a.subject,'actor_client':a.client_id}
    job=Job(id=uid(),workspace_id=w.id,type='calendar',payload=payload,operation_id=op.id);db.add(job)
    op.result={'operation_id':op.id,'job_id':job.id,'status':'pending'};return op.result
