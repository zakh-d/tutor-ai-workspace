from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, Request, Response, UploadFile, File, Form
from sqlalchemy import select, update
from .db import Session, Workspace, Record, Revision, Access, Job, now
from .auth import authenticate
from .errors import require, DomainError
from . import schemas as S
from .service import *

router=APIRouter(prefix='/api/v1')
def context(actor=Depends(authenticate)):
    with Session() as db:
        try:
            w=workspace(db,actor)
            yield db,w,actor
            db.commit()
        except BaseException:
            db.rollback(); raise

def headers(request):
    key=request.headers.get('idempotency-key'); raw=request.headers.get('if-match')
    revision=None
    if raw is not None:
        try:
            require(raw.startswith('"') and raw.endswith('"'),'validation_error','If-Match must be a quoted revision.')
            revision=int(raw[1:-1]); require(revision>=1)
        except ValueError: raise DomainError('validation_error','Invalid If-Match revision.')
    return key,revision

@router.get('/workspace')
def workspace_get(ctx=Depends(context)):
    db,w,a=ctx; a.permit('workspace:read')
    return {'data':{'id':w.id,'name':w.name,'timezone':w.timezone,'revision':w.revision,'contract_version':'1','capabilities':{'calendar':True,'grading_release':a.client_id==__import__('app.config',fromlist=['settings']).settings().tutor_client_id},'limits':{'tutor_upload_bytes':25*1024**2,'student_upload_bytes':10*1024**2,'chunk_count':20}}}
@router.patch('/workspace')
def workspace_patch(body:S.WorkspacePatch,request:Request,ctx=Depends(context)):
    db,w,a=ctx; a.permit('workspace:write'); key,rev=headers(request)
    op,replay=begin(db,w.id,a,key,'workspace',body.model_dump(mode='json',exclude_unset=True),rev)
    if replay:return replay
    w=db.scalar(select(Workspace).where(Workspace.id==w.id).with_for_update()); expected(w,rev)
    if body.timezone:
        try: ZoneInfo(body.timezone)
        except ZoneInfoNotFoundError: raise DomainError('validation_error','Unknown timezone.')
        w.timezone=body.timezone
    if body.name:w.name=body.name
    w.revision+=1
    result={'data':{'id':w.id,'name':w.name,'timezone':w.timezone,'revision':w.revision},'revision':w.revision,'operation_id':op.id};op.result=result;return result

def register_crud(kind,schema):
    def collection(request:Request,cursor:str|None=None,limit:int=25,ctx=Depends(context)):
        db,w,a=ctx; a.permit('workspace:read')
        filters={k:v for k,v in request.query_params.items() if k not in ('cursor','limit')}
        if 'archived' in filters: filters['archived']=filters['archived'].lower()=='true'
        return list_records(db,w.id,kind,limit,cursor,**filters)
    def detail(record_id:UUID,ctx=Depends(context)):
        db,w,a=ctx;a.permit('workspace:read');return {'data':serialize(get(db,w.id,kind,str(record_id)))}
    def create(body:schema,request:Request,ctx=Depends(context)):
        db,w,a=ctx;key,_=headers(request); return mutate(db,w.id,a,kind,key,body.model_dump(mode='json'))
    def patch(record_id:UUID,body:dict,request:Request,ctx=Depends(context)):
        db,w,a=ctx;key,rev=headers(request);return mutate(db,w.id,a,kind,key,body,str(record_id),rev)
    def archive(record_id:UUID,request:Request,ctx=Depends(context)):
        db,w,a=ctx;key,rev=headers(request);return mutate(db,w.id,a,kind,key,{},str(record_id),rev,'archive')
    def restore(record_id:UUID,request:Request,ctx=Depends(context)):
        db,w,a=ctx;key,rev=headers(request);return mutate(db,w.id,a,kind,key,{},str(record_id),rev,'restore')
    for fn,method,path in [(collection,'GET',''),(create,'POST',''),(detail,'GET','/{record_id}'),(patch,'PATCH','/{record_id}'),(archive,'POST','/{record_id}/archive'),(restore,'POST','/{record_id}/restore')]:
        router.add_api_route('/'+kind+path,fn,methods=[method],name=kind+'_'+fn.__name__,status_code=201 if fn==create else 200)
for kind,schema in S.SCHEMAS.items(): register_crud(kind,schema)

@router.get('/assignments')
def assignment_list(cursor:str|None=None,limit:int=25,student_id:UUID|None=None,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');return list_records(db,w.id,'assignments',limit,cursor,student_id=student_id)
@router.get('/assignments/{assignment_id}')
def assignment_get(assignment_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');r=get(db,w.id,'assignments',str(assignment_id));return {'data':{**serialize(r),'content':content_for(db,r)}}
@router.post('/homework-templates/{template_id}/publish',status_code=201)
def assignment_publish(template_id:UUID,body:S.Publish,request:Request,ctx=Depends(context)):
    db,w,a=ctx;key,rev=headers(request);return publish(db,w.id,a,str(template_id),key,rev,body.model_dump(mode='json'))
@router.patch('/assignments/{assignment_id}')
def assignment_patch(assignment_id:UUID,body:S.AssignmentPatch,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('assignments:publish');key,rev=headers(request);payload=body.model_dump(mode='json',exclude_unset=True)
    op,replay=begin(db,w.id,a,key,f'assignment:{assignment_id}',payload,rev)
    if replay:return replay
    r=get(db,w.id,'assignments',str(assignment_id),True);expected(r,rev);before=snapshot(r)
    require(payload.get('status','open') is not None);r.data={**r.data,**payload};r.revision+=1;r.updated_at=now();audit(db,a,op,r,before);return finish(op,r)

def change_access(aid,request,ctx,replace,body=None):
    db,w,a=ctx;a.permit('assignments:publish');key,rev=headers(request)
    payload=body.model_dump(mode='json') if body else {}
    op,replay=begin(db,w.id,a,key,f'access:{aid}:{replace}',payload,rev)
    if replay:return replay
    r=get(db,w.id,'assignments',str(aid),True);expected(r,rev);before=snapshot(r)
    db.execute(update(Access).where(Access.workspace_id==w.id,Access.assignment_id==r.id,Access.revoked_at.is_(None)).values(revoked_at=now()))
    extra={}
    if replace:extra['access_link']=access_link(db,r,body.expires_at)
    r.revision+=1;r.updated_at=now();audit(db,a,op,r,before);return finish(op,r,extra)
@router.post('/assignments/{assignment_id}/replace-access')
def replace_access(assignment_id:UUID,body:S.ReplaceAccess,request:Request,ctx=Depends(context)):return change_access(assignment_id,request,ctx,True,body)
@router.post('/assignments/{assignment_id}/revoke-access')
def revoke_access(assignment_id:UUID,request:Request,ctx=Depends(context)):return change_access(assignment_id,request,ctx,False)
@router.get('/assignments/{assignment_id}/submissions')
def submissions_list(assignment_id:UUID,limit:int=25,cursor:str|None=None,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');get(db,w.id,'assignments',str(assignment_id));return list_records(db,w.id,'submissions',limit,cursor,assignment_id=assignment_id)
@router.get('/submissions/{submission_id}')
def submission_get(submission_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');sub=get(db,w.id,'submissions',str(submission_id));ass=get(db,w.id,'assignments',sub.data['assignment_id']);return {'data':{**serialize(sub),'questions':content_for(db,ass)['questions']}}
@router.post('/submissions/{submission_id}/grade-proposals',status_code=201)
def propose(submission_id:UUID,body:S.Proposal,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('grading:propose');key,_=headers(request);payload=body.model_dump(mode='json')
    op,replay=begin(db,w.id,a,key,f'propose:{submission_id}',payload)
    if replay:return replay
    sub=get(db,w.id,'submissions',str(submission_id),True);expected(sub,body.expected_submission_revision);require(sub.data['status']=='submitted','invalid_state','Attempt is not submitted.')
    assignment=get(db,w.id,'assignments',sub.data['assignment_id']);assessment=body.model_dump(mode='json',exclude={'expected_submission_revision'})
    validate_assessment(content_for(db,assignment),assessment,sub.data['objective_result'])
    r=create_record(db,w.id,'grade-proposals',{'submission_id':sub.id,'source_revision':sub.revision,'assessment':assessment,'status':'draft','provenance':a.client_id})
    audit(db,a,op,r,None);return finish(op,r)
@router.get('/submissions/{submission_id}/grade-proposals')
def proposals(submission_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');get(db,w.id,'submissions',str(submission_id));rows=db.scalars(select(Record).where(Record.workspace_id==w.id,Record.kind=='grade-proposals',Record.data['submission_id'].astext==str(submission_id)));return {'items':[serialize(r) for r in rows],'next_cursor':None}
@router.get('/grade-proposals/{proposal_id}')
def proposal_get(proposal_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');return {'data':serialize(get(db,w.id,'grade-proposals',str(proposal_id)))}
@router.patch('/grade-proposals/{proposal_id}')
def proposal_patch(proposal_id:UUID,body:S.Assessment,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('grading:propose');key,rev=headers(request);payload=body.model_dump(mode='json');op,replay=begin(db,w.id,a,key,f'proposal:{proposal_id}',payload,rev)
    if replay:return replay
    r=get(db,w.id,'grade-proposals',str(proposal_id),True);expected(r,rev);before=snapshot(r);sub=get(db,w.id,'submissions',r.data['submission_id']);ass=get(db,w.id,'assignments',sub.data['assignment_id']);validate_assessment(content_for(db,ass),payload,sub.data['objective_result']);r.data={**r.data,'assessment':payload};r.revision+=1;r.updated_at=now();audit(db,a,op,r,before);return finish(op,r)
@router.post('/submissions/{submission_id}/release-grade')
def release(submission_id:UUID,body:S.Release,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.tutor();key,rev=headers(request);op,replay=begin(db,w.id,a,key,f'release:{submission_id}',body.model_dump(mode='json'),rev)
    if replay:return replay
    sub=get(db,w.id,'submissions',str(submission_id));expected(sub,body.expected_submission_revision)
    ass=get(db,w.id,'assignments',sub.data['assignment_id'],True);expected(ass,rev);expected(ass,body.expected_assignment_revision)
    require(sub.data['status']=='submitted' and ass.data['active_attempt_id']==sub.id,'invalid_state','Only the active submitted attempt can be released.')
    prop=get(db,w.id,'grade-proposals',str(body.proposal_id),True);expected(prop,body.expected_proposal_revision);require(prop.data['submission_id']==sub.id and prop.data['source_revision']==sub.revision,'invalid_state','Proposal belongs to another attempt.')
    assessment=body.assessment.model_dump(mode='json') if body.assessment else prop.data['assessment'];validate_assessment(content_for(db,ass),assessment,sub.data['objective_result'],True)
    r=create_record(db,w.id,'grade-releases',{'submission_id':sub.id,'assessment':assessment,'total_points':sum(i['awarded_points'] for i in assessment['items']),'released_by':a.subject,'released_at':now().isoformat()})
    before=snapshot(ass);ass.data={**ass.data,'release_id':r.id};ass.revision+=1;ass.updated_at=now();audit(db,a,op,ass,before);return finish(op,ass,{'release':serialize(r)})
@router.post('/assignments/{assignment_id}/reopen')
def reopen(assignment_id:UUID,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.tutor();key,rev=headers(request);op,replay=begin(db,w.id,a,key,f'reopen:{assignment_id}',{},rev)
    if replay:return replay
    ass=get(db,w.id,'assignments',str(assignment_id),True);expected(ass,rev);sub=get(db,w.id,'submissions',ass.data['active_attempt_id']);require(sub.data['status']=='submitted','invalid_state','Attempt is not submitted.')
    attempt=create_record(db,w.id,'submissions',{**sub.data,'attempt_number':sub.data['attempt_number']+1,'status':'draft','objective_result':{},'submitted_at':None})
    before=snapshot(ass);ass.data={**ass.data,'active_attempt_id':attempt.id,'status':'open','release_id':None};ass.revision+=1;ass.updated_at=now();audit(db,a,op,ass,before);return finish(op,ass)

@router.get('/history')
def history(entity_type:str|None=None,entity_id:UUID|None=None,operation_id:UUID|None=None,limit:int=25,cursor:str|None=None,ctx=Depends(context)):
    db,w,a=ctx;a.permit('history:read');require(1<=limit<=100)
    stmt=select(Revision).where(Revision.workspace_id==w.id)
    for key,value in [('entity_type',entity_type),('entity_id',entity_id),('operation_id',operation_id)]:
        if value:stmt=stmt.where(getattr(Revision,key)==str(value))
    rows,nxt=page_query(db,stmt,Revision,[w.id,'history',entity_type,entity_id,operation_id],limit,cursor,descending=True)
    return {'items':[revision_json(r) for r in rows],'next_cursor':nxt}
def revision_json(r):return {k:getattr(r,k) for k in ('id','entity_id','entity_type','revision','before','after','actor','client_id','operation_id','undo_of','created_at')}
@router.get('/history/{revision_id}')
def history_get(revision_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('history:read');r=db.scalar(select(Revision).where(Revision.workspace_id==w.id,Revision.id==str(revision_id)));require(r is not None,'not_found','Revision not found.');return {'data':revision_json(r)}
@router.post('/history/undo')
def undo(body:S.Undo,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('history:undo');key,_=headers(request);op,replay=begin(db,w.id,a,key,'undo',body.model_dump(mode='json'))
    if replay:return replay
    target=db.scalar(select(Revision).where(Revision.workspace_id==w.id,Revision.id==str(body.target_revision_id)));require(target is not None,'not_found','Revision not found.')
    if target.entity_type=='calendar-events':
        from .calendar_api import undo_calendar
        return undo_calendar(db,w,a,op,target,body.expected_current_revision)
    if target.entity_type=='assignments':
        a.permit('assignments:publish')
        r=get(db,w.id,'assignments',target.entity_id,True);expected(r,body.expected_current_revision);expected(r,target.revision);before=snapshot(r)
        if target.before is None:
            r.data={**r.data,'status':'closed'}
            db.execute(update(Access).where(Access.workspace_id==w.id,Access.assignment_id==r.id,Access.revoked_at.is_(None)).values(revoked_at=now()))
        else:
            old=target.before['data'];new=target.after['data'];changed={k for k in set(old)|set(new) if old.get(k)!=new.get(k)}
            require(bool(changed) and changed<={'due_at','status'},'undo_not_supported','Use the explicit recovery action for access, review or attempt changes.')
            r.data={**r.data,**{k:old.get(k) for k in changed}}
        r.revision+=1;r.updated_at=now();audit(db,a,op,r,before,target.id);return finish(op,r)
    require(target.entity_type in S.SCHEMAS or target.entity_type=='grade-proposals','undo_not_supported','Use the explicit recovery action for this change.')
    a.permit('grading:propose' if target.entity_type=='grade-proposals' else 'workspace:write')
    r=get(db,w.id,target.entity_type,target.entity_id,True);expected(r,body.expected_current_revision);expected(r,target.revision);before=snapshot(r)
    if target.before:
        data=target.before['data']
        if r.kind=='lessons' and data.get('calendar_event_id')!=r.data.get('calendar_event_id'):
            a.permit('calendar:write')
            require(not data.get('calendar_event_id'),'undo_not_supported','Relink through the calendar action with both current revisions.')
        validate_refs(db,w.id,r.kind,data);r.data=data;r.archived_at=datetime.fromisoformat(target.before['archived_at']) if target.before['archived_at'] else None
    else:r.archived_at=now()
    r.revision+=1;r.updated_at=now();audit(db,a,op,r,before,target.id);return finish(op,r)
@router.get('/flashcard-sets/{record_id}/export')
def export(record_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');r=get(db,w.id,'flashcard-sets',str(record_id));clean=lambda s:s.replace('\t',' ').replace('\r',' ').replace('\n',' ')
    return Response('\n'.join(clean(c['term'])+'\t'+clean(c['definition']) for c in r.data['cards']),media_type='text/tab-separated-values; charset=utf-8',headers={'Content-Disposition':'attachment; filename="flashcards.tsv"'})
@router.get('/search')
def search(q:str,types:str|None=None,limit:int=25,cursor:str|None=None,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');require(0<len(q)<=500 and 1<=limit<=100)
    kinds=types.split(',') if types else list(S.SCHEMAS)
    require(set(kinds)<=set(S.SCHEMAS),'validation_error','Unsupported searchable type.')
    # PostgreSQL full-text search over bounded domain content, never submission files.
    stmt=select(Record).where(Record.workspace_id==w.id,Record.kind.in_(kinds),Record.archived_at.is_(None),func.to_tsvector('simple',Record.data.cast(__import__('sqlalchemy').Text)).op('@@')(func.plainto_tsquery('simple',q)))
    rows,nxt=page_query(db,stmt,Record,[w.id,'search',q,sorted(set(kinds))],limit,cursor)
    return {'items':[{**serialize(r),'entity_type':r.kind,'excerpt':str(r.data.get('description') or r.data.get('notes') or r.data.get('title') or '')[:300]} for r in rows],'next_cursor':nxt}
@router.get('/jobs/{job_id}')
def job_get(job_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');j=db.scalar(select(Job).where(Job.workspace_id==w.id,Job.id==str(job_id)));require(j is not None,'not_found','Job not found.');return {'data':{'id':j.id,'type':j.type,'state':j.state,'status':j.state,'attempts':j.attempts,'error':j.error,'retry_allowed':j.state=='failed'}}
@router.post('/jobs/{job_id}/retry')
def job_retry(job_id:UUID,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:write');key,_=headers(request);op,replay=begin(db,w.id,a,key,f'job-retry:{job_id}',{})
    if replay:return replay
    j=db.scalar(select(Job).where(Job.workspace_id==w.id,Job.id==str(job_id)).with_for_update());require(j is not None,'not_found','Job not found.');require(j.state=='failed' and j.type in ('convert_material','extract_submission_file','sync_calendar'),'invalid_state','Job cannot be retried.');j.state='queued';j.attempts=0;j.available_at=now();j.error=None;j.operation_id=op.id
    result={'operation_id':op.id,'job_id':j.id,'status':'pending'};op.result=result;return result
