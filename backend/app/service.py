import base64, hashlib, json, secrets, hmac
from datetime import timedelta
from uuid import UUID
from sqlalchemy import select, func, text
from sqlalchemy.dialects.postgresql import insert
from pydantic import ValidationError
from .db import Workspace, Record, Operation, Revision, Blob, Access, Job, now, uid
from .errors import DomainError, require
from .schemas import SCHEMAS

def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),default=str)
def serialize(r):
    return dict(r.data,id=r.id,revision=r.revision,created_at=r.created_at.isoformat(),updated_at=r.updated_at.isoformat(),archived_at=r.archived_at.isoformat() if r.archived_at else None)
def snapshot(r): return {'data':r.data,'archived_at':r.archived_at.isoformat() if r.archived_at else None}
def workspace(db,actor):
    stmt=insert(Workspace).values(id=uid(),issuer=actor.issuer,subject=actor.subject,name='My workspace',timezone='UTC',revision=1).on_conflict_do_nothing(index_elements=['issuer','subject'])
    db.execute(stmt)
    return db.scalar(select(Workspace).where(Workspace.issuer==actor.issuer,Workspace.subject==actor.subject))
def get(db,wid,kind,rid,lock=False):
    try: rid=str(UUID(str(rid)))
    except ValueError: raise DomainError('not_found','Record not found.')
    stmt=select(Record).where(Record.workspace_id==wid,Record.kind==kind,Record.id==rid)
    if lock: stmt=stmt.with_for_update()
    r=db.scalar(stmt)
    require(r is not None,'not_found','Record not found.')
    return r

def expected(r,revision):
    require(revision is not None,'precondition_required','If-Match is required.')
    if r.revision!=revision: raise DomainError('revision_conflict','The record has changed.',{'current_revision':r.revision})

def begin(db,wid,actor,key,action,payload,revision=None):
    require(key is not None,'precondition_required','Idempotency-Key is required.')
    try: key=str(UUID(str(key)))
    except ValueError: raise DomainError('validation_error','Idempotency-Key must be a UUID.')
    # Serializes identical keys, including concurrent first use, without a uniqueness exception.
    lock=int.from_bytes(hashlib.sha256(f'{wid}:{actor.client_id}:{key}'.encode()).digest()[:8],signed=True)
    db.execute(text('SELECT pg_advisory_xact_lock(:key)'),{'key':lock})
    rh=digest(canonical([action,payload,revision]))
    op=db.scalar(select(Operation).where(Operation.workspace_id==wid,Operation.client_id==actor.client_id,Operation.key==key))
    if op:
        require(op.request_hash==rh,'idempotency_conflict','Key already used with a different request.')
        return op,op.result
    op=Operation(id=uid(),workspace_id=wid,client_id=actor.client_id,key=key,request_hash=rh,result={})
    db.add(op); db.flush()
    return op,None

def audit(db,actor,op,r,before,undo_of=None):
    db.flush()
    db.add(Revision(id=uid(),workspace_id=r.workspace_id,entity_id=r.id,entity_type=r.kind,revision=r.revision,before=before,after=snapshot(r),actor=actor.subject,client_id=actor.client_id,operation_id=op.id,undo_of=undo_of))
def finish(op,r,extra=None):
    result={'data':serialize(r),'operation_id':op.id,'revision':r.revision}
    if extra: result['data'].update(extra)
    # Secret links deliberately excluded from retained idempotency responses.
    stored=json.loads(canonical(result))
    if stored['data'].pop('access_link',None): stored['data']['link_unavailable']=True
    op.result=stored
    return result

def validate_refs(db,wid,kind,data):
    for field,k in [('student_id','students'),('lesson_id','lessons')]:
        if data.get(field):
            r=get(db,wid,k,data[field]); require(not r.archived_at,'invalid_state','Archived records cannot receive new work.')
    if data.get('lesson_id') and data.get('student_id'):
        require(get(db,wid,'lessons',data['lesson_id']).data['student_id']==data['student_id'],'validation_error','Lesson and student do not agree.')
    for field,k in [('material_ids','materials'),('student_ids','students'),('lesson_ids','lessons')]:
        for rid in data.get(field,[]):
            r=get(db,wid,k,rid); require(not r.archived_at,'invalid_state','Archived records cannot receive new links.')
    refs=list(data.get('source_refs',[]))
    for q in data.get('questions',[]): refs+=q.get('source_refs',[])
    for ref in refs:
        get(db,wid,'materials',ref['material_id'])
        version=get(db,wid,'material-versions',ref['material_version_id'])
        artifact=get(db,wid,'artifacts',ref['artifact_id'])
        require(version.data['material_id']==ref['material_id'] and artifact.data['version_id']==version.id,'validation_error','Citation does not match its material version.')
        require(0<=ref['chunk_start']<=ref['chunk_end']<len(artifact.data['chunks']),'validation_error','Citation range does not exist.')

def validated(kind,data):
    try: return SCHEMAS[kind].model_validate(data).model_dump(mode='json')
    except ValidationError as e: raise DomainError('validation_error','Invalid resource.',{'fields':[{'loc':list(x['loc']),'message':x['msg']} for x in e.errors()]})

def mutate(db,wid,actor,kind,key,body,rid=None,revision=None,action='save'):
    actor.permit('workspace:write')
    op,replay=begin(db,wid,actor,key,f'{kind}:{rid}:{action}',body,revision)
    if replay: return replay
    before=None
    if rid:
        r=get(db,wid,kind,rid,True); expected(r,revision); before=snapshot(r)
        data=dict(r.data)
        if action=='save':
            # Reject caller attempts to modify server-generated material state.
            base={k:v for k,v in data.items() if k in SCHEMAS[kind].model_fields}
            data={**validated(kind,{**base,**body}),**{k:v for k,v in data.items() if k not in SCHEMAS[kind].model_fields}}
        elif action=='archive': r.archived_at=now()
        elif action=='restore': r.archived_at=None
        r.revision+=1; r.updated_at=now()
    else:
        data=validated(kind,body)
        r=Record(id=uid(),workspace_id=wid,kind=kind,data=data,revision=1,created_at=now(),updated_at=now()); db.add(r)
    validate_refs(db,wid,kind,data); r.data=data
    audit(db,actor,op,r,before)
    return finish(op,r)

def page_query(db,stmt,model,scope,limit=25,cursor=None,descending=False):
    """Stable keyset paging, with cursors bound to workspace and query filters."""
    from datetime import datetime
    import binascii
    require(1<=limit<=100,'validation_error','Limit must be between 1 and 100.')
    context=digest(canonical(scope))
    if cursor:
        require(len(cursor)<=2000,'validation_error','Invalid cursor.')
        try:
            page=json.loads(base64.b64decode(cursor+'='*(-len(cursor)%4),altchars=b'-_',validate=True))
            require(isinstance(page,list) and len(page)==3 and page[0]==context,'validation_error','Cursor belongs to another query.')
            stamp=datetime.fromisoformat(page[1]);last=str(UUID(page[2]))
            require(stamp.tzinfo is not None,'validation_error','Invalid cursor.')
        except (ValueError,TypeError,IndexError,binascii.Error):raise DomainError('validation_error','Invalid cursor.')
        if descending:stmt=stmt.where((model.created_at<stamp)|((model.created_at==stamp)&(model.id<last)))
        else:stmt=stmt.where((model.created_at>stamp)|((model.created_at==stamp)&(model.id>last)))
    order=(model.created_at.desc(),model.id.desc()) if descending else (model.created_at,model.id)
    rows=list(db.scalars(stmt.order_by(*order).limit(limit+1)))
    more=len(rows)>limit;rows=rows[:limit]
    nxt=base64.urlsafe_b64encode(canonical([context,rows[-1].created_at.isoformat(),rows[-1].id]).encode()).decode().rstrip('=') if more else None
    return rows,nxt

def list_records(db,wid,kind,limit=25,cursor=None,**filters):
    require(1<=limit<=100,'validation_error','Limit must be between 1 and 100.')
    filters={k:v for k,v in filters.items() if v is not None}
    stmt=select(Record).where(Record.workspace_id==wid,Record.kind==kind)
    archived=filters.pop('archived',False)
    stmt=stmt.where(Record.archived_at.is_not(None) if archived else Record.archived_at.is_(None))
    for k,v in filters.items():
        if k=='due_before': stmt=stmt.where(Record.data['due_at'].astext.cast(__import__('sqlalchemy').DateTime(timezone=True))<str(v))
        elif k=='student_id' and kind=='materials': stmt=stmt.where(Record.data['student_ids'].contains([str(v)]))
        elif k in ('student_id','status','assignment_id'): stmt=stmt.where(Record.data[k].astext==str(v))
        elif k in ('lesson_id',): stmt=stmt.where((Record.data[k].astext==str(v)) | Record.data['lesson_ids'].contains([str(v)]))
        else: raise DomainError('validation_error','Unsupported filter.')
    context=digest(canonical([wid,kind,archived,filters]))
    if cursor:
        try:
            page=json.loads(base64.urlsafe_b64decode(cursor+'='*(-len(cursor)%4)))
            require(page[0]==context,'validation_error','Cursor belongs to another query.')
            from datetime import datetime
            stamp=datetime.fromisoformat(page[1]); last=str(UUID(page[2]))
            stmt=stmt.where((Record.created_at>stamp)|((Record.created_at==stamp)&(Record.id>last)))
        except (ValueError,TypeError,IndexError): raise DomainError('validation_error','Invalid cursor.')
    rows=list(db.scalars(stmt.order_by(Record.created_at,Record.id).limit(limit+1)))
    more=len(rows)>limit; rows=rows[:limit]
    nxt=base64.urlsafe_b64encode(canonical([context,rows[-1].created_at.isoformat(),rows[-1].id]).encode()).decode().rstrip('=') if more else None
    return {'items':[serialize(r) for r in rows],'next_cursor':nxt}

def create_record(db,wid,kind,data):
    r=Record(id=uid(),workspace_id=wid,kind=kind,data=data,revision=1,created_at=now(),updated_at=now()); db.add(r); db.flush(); return r

def access_link(db,assignment,expires_at=None):
    from .config import settings
    expiry=expires_at or now()+timedelta(days=30)
    require(now()+timedelta(days=1)<=expiry<=now()+timedelta(days=180),'validation_error','Link expiry must be 1–180 days away.')
    token=secrets.token_urlsafe(32)
    db.add(Access(id=uid(),workspace_id=assignment.workspace_id,assignment_id=assignment.id,token_hash=digest(token),expires_at=expiry))
    return settings().public_base_url.rstrip('/')+'/a/'+assignment.id+'#'+token

def publish(db,wid,actor,tid,key,revision,body):
    actor.permit('assignments:publish')
    op,replay=begin(db,wid,actor,key,f'publish:{tid}',body,revision)
    if replay: return replay
    template=get(db,wid,'homework-templates',tid,True); expected(template,revision)
    require(not template.archived_at,'invalid_state','Archived template cannot be published.')
    require(bool(template.data['questions']),'validation_error','An assignment needs at least one question.')
    validate_refs(db,wid,'assignments',body)
    for aid in body['public_attachment_ids']:
        blob=db.scalar(select(Blob).where(Blob.id==aid,Blob.workspace_id==wid))
        require(blob is not None and blob.purpose in ('original','extracted'),'not_found','Attachment not found.')
    version=create_record(db,wid,'homework-versions',{'template_id':tid,'template_revision':template.revision,'content':template.data})
    assignment=create_record(db,wid,'assignments',{'student_id':body['student_id'],'lesson_id':body.get('lesson_id'),'due_at':body.get('due_at'),'status':'open','homework_version_id':version.id,'public_attachment_ids':body['public_attachment_ids']})
    attempt=create_record(db,wid,'submissions',{'assignment_id':assignment.id,'attempt_number':1,'status':'draft','answers':[],'objective_result':{},'files':[]})
    assignment.data={**assignment.data,'active_attempt_id':attempt.id}
    expiry=body.get('expires_at')
    if expiry:
        from datetime import datetime
        expiry=datetime.fromisoformat(expiry)
    link=access_link(db,assignment,expiry)
    audit(db,actor,op,assignment,None)
    return finish(op,assignment,{'access_link':link})

def content_for(db,assignment): return get(db,assignment.workspace_id,'homework-versions',assignment.data['homework_version_id']).data['content']
def validate_answers(content,answers,files,required=False):
    questions={q['id']:q for q in content['questions']}; seen=set(); result={}
    for answer in answers:
        qid=str(answer['question_id']); value=answer['value']
        require(qid in questions and qid not in seen,'validation_error','Unknown or duplicate question.')
        seen.add(qid); q=questions[qid]; opts={x['id'] for x in q.get('options') or []}
        if q['type']=='single_choice': require(isinstance(value,str) and value in opts,'validation_error','Invalid selected option.')
        elif q['type']=='multiple_choice': require(isinstance(value,list) and all(isinstance(v,str) for v in value) and len(value)==len(set(value)) and set(value)<=opts,'validation_error','Invalid selected options.')
        elif q['type']=='written_response': require(isinstance(value,str) and len(value)<=q['max_chars'],'validation_error','Invalid written response.')
        else: require(isinstance(value,list) and len(value)<=q['max_files'] and all(v in files and files[v]['question_id']==qid for v in value),'validation_error','Invalid file answer.')
        result[qid]=value
    for q in questions.values():
        value=result.get(q['id'])
        if required and q['required']: require(value is not None and value!='' and value!=[],'validation_error','A required answer is missing.')
    return result

def score(content,answers):
    result={}; values={str(x['question_id']):x['value'] for x in answers}
    for q in content['questions']:
        v=values.get(q['id'])
        if q['type']=='single_choice': result[q['id']]=q['points'] if v==q['correct_option_id'] else 0
        elif q['type']=='multiple_choice': result[q['id']]=q['points'] if set(v or [])==set(q['correct_option_ids']) else 0
    return result

def validate_assessment(content,assessment,objective,complete=False):
    questions={q['id']:q for q in content['questions']}; seen=set()
    for item in assessment['items']:
        qid=item['question_id']; require(qid in questions and qid not in seen,'validation_error','Unknown or duplicate assessment question.'); seen.add(qid)
        require(0<=item['awarded_points']<=questions[qid]['points'],'validation_error','Points exceed question bounds.')
        if qid in objective: require(item['awarded_points']==objective[qid],'validation_error','Objective scores must match deterministic scoring.')
    if complete: require(seen==set(questions),'validation_error','Release must assess every question.')
