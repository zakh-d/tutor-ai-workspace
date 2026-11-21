import secrets,hmac,time
from datetime import timedelta
from uuid import UUID
from fastapi import APIRouter, Request, Response, Depends
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from .db import Session, Access, StudentSession, RateBucket, Workspace, now
from .auth import Actor
from .config import settings
from .errors import require,DomainError
from .service import *
from .schemas import Exchange, Answers
from .api import headers
router=APIRouter(prefix='/public/v1')

def rate(db,key,maximum):
    window=int(time.time())//60
    stmt=insert(RateBucket).values(key=digest(key),window=window,count=1).on_conflict_do_update(index_elements=['key','window'],set_={'count':RateBucket.count+1}).returning(RateBucket.count)
    # Rate-limit failures must survive the request transaction rollback.
    with Session.begin() as rate_db:count=rate_db.scalar(stmt)
    require(count<=maximum,'rate_limited','Too many requests; try again in one minute.')

def projection(db,access,assignment):
    content=content_for(db,assignment);attempt=get(db,assignment.workspace_id,'submissions',assignment.data['active_attempt_id'])
    teacher_timezone=db.get(Workspace,assignment.workspace_id).timezone
    student=get(db,assignment.workspace_id,'students',assignment.data['student_id'])
    student_timezone=student.data.get('timezone') or teacher_timezone
    questions=[]
    for q in content['questions']:
        public={k:q[k] for k in ('id','type','prompt','points','required')}
        if q['type'] in ('single_choice','multiple_choice'):public['options']=q['options']
        elif q['type']=='written_response':public['max_chars']=q['max_chars']
        else:public.update(allowed_types=q['allowed_types'],max_files=q['max_files'])
        questions.append(public)
    released=None
    if assignment.data.get('release_id'):
        release=get(db,assignment.workspace_id,'grade-releases',assignment.data['release_id'])
        if release.data['submission_id']==attempt.id:released=release.data['assessment']
    attachments=[]
    for bid in assignment.data['public_attachment_ids']:
        blob=db.scalar(select(Blob).where(Blob.workspace_id==assignment.workspace_id,Blob.id==bid))
        if blob:attachments.append({'id':blob.id,'filename':blob.filename,'size':blob.size,'media_type':blob.media_type})
    return {'id':assignment.id,'revision':assignment.revision,'title':content['title'],'instructions':content['instructions'],'questions':questions,'attachments':attachments,'due_at':assignment.data.get('due_at'),'student_timezone':student_timezone,'teacher_timezone':teacher_timezone,'expires_at':access.expires_at.isoformat(),'status':assignment.data['status'],'attempt':{k:v for k,v in serialize(attempt).items() if k in ('id','revision','status','answers','files')},'released_result':released}

def session_context(request:Request):
    with Session() as db:
        token=request.cookies.get('tutor_assignment','')
        session=db.scalar(select(StudentSession).where(StudentSession.token_hash==digest(token)))
        require(session is not None and session.expires_at>now(),'not_found','Assignment unavailable. Contact your tutor.')
        access=db.scalar(select(Access).where(Access.id==session.access_id,Access.workspace_id==session.workspace_id))
        require(access is not None and not access.revoked_at and access.expires_at>now(),'not_found','Assignment unavailable. Contact your tutor.')
        assignment=get(db,session.workspace_id,'assignments',access.assignment_id,request.method!='GET')
        if request.method!='GET':
            origin=request.headers.get('origin');require(origin==settings().public_base_url.rstrip('/'),'forbidden','Origin is not allowed.')
            require(hmac.compare_digest(session.csrf_hash,digest(request.headers.get('x-csrf-token',''))),'forbidden','CSRF token is required.')
            rate(db,'write:'+session.id,60)
        try:
            yield db,session,access,assignment
            db.commit()
        except BaseException:db.rollback();raise

@router.post('/assignments/{assignment_id}/session')
def exchange(assignment_id:UUID,body:Exchange,request:Request,response:Response):
    require(request.headers.get('origin')==settings().public_base_url.rstrip('/'),'forbidden','Origin is not allowed.')
    with Session.begin() as db:
        rate(db,'exchange:'+(request.client.host if request.client else 'unknown'),30)
        access=db.scalar(select(Access).where(Access.assignment_id==str(assignment_id),Access.token_hash==digest(body.token)).with_for_update())
        require(access is not None and not access.revoked_at and access.expires_at>now(),'not_found','Assignment unavailable. Contact your tutor.')
        require(hmac.compare_digest(access.token_hash,digest(body.token)),'not_found','Assignment unavailable.')
        live=list(db.scalars(select(StudentSession).where(StudentSession.access_id==access.id,StudentSession.expires_at>now()).order_by(StudentSession.created_at)))
        for old in live[:-9]:old.expires_at=now()
        token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32);expiry=min(now()+timedelta(hours=24),access.expires_at)
        db.add(StudentSession(id=uid(),workspace_id=access.workspace_id,access_id=access.id,token_hash=digest(token),csrf_hash=digest(csrf),expires_at=expiry))
        response.set_cookie('tutor_assignment',token,max_age=int((expiry-now()).total_seconds()),secure=settings().cookie_secure,httponly=True,samesite='strict',path='/public/v1')
        assignment=get(db,access.workspace_id,'assignments',str(assignment_id))
        return {'csrf_token':csrf,'assignment':projection(db,access,assignment)}
@router.get('/assignment')
def assignment(ctx=Depends(session_context)):
    db,session,access,assignment=ctx;return projection(db,access,assignment)

def public_mutate(request,ctx,answers=None,submit=False):
    db,session,access,assignment=ctx
    require(assignment.data['status']=='open','invalid_state','Assignment is closed.')
    key,rev=headers(request);actor=Actor('capability',session.id,'assignment:'+session.id,frozenset())
    op,replay=begin(db,assignment.workspace_id,actor,key,'submit' if submit else 'save-answers',answers or {},rev)
    if replay:return replay
    attempt=get(db,assignment.workspace_id,'submissions',assignment.data['active_attempt_id'],True);expected(attempt,rev);require(attempt.data['status']=='draft','invalid_state','This attempt is already submitted.')
    content=content_for(db,assignment);data=dict(attempt.data);files={f['id']:f for f in data['files']}
    if answers is not None:validate_answers(content,answers,files);data['answers']=answers
    if submit:
        validate_answers(content,data['answers'],files,True);data['status']='submitted';data['submitted_at']=now().isoformat();data['objective_result']=score(content,data['answers'])
        for f in data['files']:
            if f['media_type'] not in ('image/png','image/jpeg'):
                job=Job(id=uid(),workspace_id=assignment.workspace_id,type='extract_submission_file',payload={'submission_id':attempt.id,'blob_id':f['id']},operation_id=op.id);db.add(job)
    attempt.data=data;attempt.revision+=1;attempt.updated_at=now()
    # Public writes intentionally return only the safe projection, never objective answers/scores.
    db.flush();result={'data':projection(db,access,assignment)['attempt'],'revision':attempt.revision,'operation_id':op.id};op.result=result;return result
@router.patch('/attempt')
def save(body:Answers,request:Request,ctx=Depends(session_context)):return public_mutate(request,ctx,body.model_dump(mode='json')['answers'])
@router.post('/attempt/submit')
def submit(request:Request,ctx=Depends(session_context)):return public_mutate(request,ctx,submit=True)
