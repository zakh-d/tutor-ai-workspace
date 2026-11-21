"""Private object storage, bounded validation and immutable derived artifacts."""
import hashlib, io, zipfile, re
from pathlib import Path
from uuid import UUID
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import UploadFile,File,Form,Request,Depends,Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select,func
from .db import Blob,Job,Record,now,uid
from .config import settings
from .errors import require,DomainError
from .service import *
from .api import router,context,headers
from .public import router as public_router,session_context,projection
from .auth import Actor

TYPES={'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','txt':'text/plain','md':'text/markdown','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg'}
def client():
    c=settings();return boto3.client('s3',endpoint_url=c.s3_endpoint,aws_access_key_id=c.s3_access_key,aws_secret_access_key=c.s3_secret_key,region_name='us-east-1')
def detect(filename,raw,student=False):
    ext=Path(filename).suffix.lower().lstrip('.')
    allowed={'pdf','docx','txt','png','jpg','jpeg'} if student else {'pdf','docx','pptx','txt','md'}
    require(ext in allowed,'validation_error','Unsupported file extension.')
    require(raw,'validation_error','Empty uploads are not allowed.')
    if ext=='pdf':require(raw.startswith(b'%PDF-'),'validation_error','Invalid PDF signature.')
    elif ext=='png':require(raw.startswith(b'\x89PNG\r\n\x1a\n'),'validation_error','Invalid PNG signature.')
    elif ext in ('jpg','jpeg'):require(raw.startswith(b'\xff\xd8\xff'),'validation_error','Invalid JPEG signature.')
    elif ext in ('docx','pptx'):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                require(sum(i.file_size for i in z.infolist())<=100*1024**2,'payload_too_large','Expanded Office file is too large.')
                names=set(z.namelist());require('[Content_Types].xml' in names and ('word/document.xml' if ext=='docx' else 'ppt/presentation.xml') in names,'validation_error','Invalid Office document.')
                require(not any('vbaProject' in n or '..' in Path(n).parts for n in names),'validation_error','Macro or unsafe Office files are not allowed.')
        except zipfile.BadZipFile:raise DomainError('validation_error','Malformed Office document.')
    else:
        try:raw.decode('utf-8')
        except UnicodeDecodeError:raise DomainError('validation_error','Text files must be UTF-8.')
        require(b'\x00' not in raw,'validation_error','Binary content in text file.')
    return TYPES[ext]
def read_upload(upload,maximum):
    raw=upload.file.read(maximum+1)
    require(len(raw)<=maximum,'payload_too_large','File exceeds the upload limit.');return raw

def put_blob(db,wid,record_id,filename,raw,mime,purpose,metadata=None):
    # Workspace row lock serializes quota accounting and upload reservations.
    db.scalar(select(Workspace).where(Workspace.id==wid).with_for_update())
    used=db.scalar(select(func.coalesce(func.sum(Blob.size),0)).where(Blob.workspace_id==wid))
    require(used+len(raw)<=settings().workspace_quota_bytes,'payload_too_large','Workspace storage quota exceeded.')
    bid=uid();key=f'{wid}/{bid}'
    try:client().put_object(Bucket=settings().s3_bucket,Key=key,Body=raw,ContentType=mime)
    except (BotoCoreError,ClientError):raise DomainError('provider_unavailable','Object storage is unavailable.',retryable=True)
    blob=Blob(id=bid,workspace_id=wid,record_id=record_id,object_key=key,filename=Path(filename).name[:240],media_type=mime,size=len(raw),checksum=hashlib.sha256(raw).hexdigest(),purpose=purpose,metadata_json=metadata or {})
    db.add(blob);db.flush();return blob

def chunks(markdown):
    result=[];heading='';buffer=''
    def flush():
        nonlocal buffer
        if buffer.strip():result.append({'ordinal':len(result),'heading':heading,'text':buffer.strip()})
        buffer=''
    for p in re.split(r'\n\s*\n',markdown.replace('\r\n','\n')):
        if p.startswith('#'):flush();heading=p.split('\n')[0].lstrip('# ').strip()
        for offset in range(0,len(p),2000):
            piece=p[offset:offset+2000]
            if len(buffer)+len(piece)+2>2000:flush()
            buffer+=('\n\n' if buffer else '')+piece
    flush();return result

def write_artifact(db,wid,material_id,version_id,markdown):
    require(markdown.strip(),'no_extractable_text','No extractable text was found.')
    require(len(markdown.encode())<=5*1024**2,'payload_too_large','Extracted content exceeds the output limit.')
    artifact=create_record(db,wid,'artifacts',{'material_id':material_id,'version_id':version_id,'chunks':chunks(markdown),'warnings':[]})
    blob=put_blob(db,wid,artifact.id,'extracted.md',markdown.encode(),'text/markdown','extracted')
    artifact.data={**artifact.data,'blob_id':blob.id};return artifact

@router.post('/materials/{material_id}/versions',status_code=202)
def upload_version(material_id:UUID,request:Request,file:UploadFile=File(...),ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:write');raw=read_upload(file,25*1024**2);mime=detect(file.filename or '',raw);key,rev=headers(request)
    op,replay=begin(db,w.id,a,key,f'upload:{material_id}',{'filename':file.filename,'checksum':hashlib.sha256(raw).hexdigest()},rev)
    if replay:return replay
    material=get(db,w.id,'materials',str(material_id),True);expected(material,rev);require(not material.archived_at,'invalid_state','Archived material cannot receive uploads.')
    before=snapshot(material);version=create_record(db,w.id,'material-versions',{'material_id':material.id,'format':Path(file.filename).suffix.lower(),'conversion_state':'queued','warnings':[]})
    blob=put_blob(db,w.id,version.id,file.filename,raw,mime,'original');version.data={**version.data,'original_blob_id':blob.id}
    job=Job(id=uid(),workspace_id=w.id,type='convert_material',payload={'material_id':material.id,'version_id':version.id},operation_id=op.id);db.add(job)
    material.data={**material.data,'active_version_id':version.id};material.revision+=1;material.updated_at=now();audit(db,a,op,material,before)
    result=finish(op,material);result.update(job_id=job.id,status='pending');op.result=result;return result
@router.get('/materials/{material_id}/versions')
def versions(material_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');get(db,w.id,'materials',str(material_id));rows=db.scalars(select(Record).where(Record.workspace_id==w.id,Record.kind=='material-versions',Record.data['material_id'].astext==str(material_id)).order_by(Record.created_at));return {'items':[serialize(r) for r in rows],'next_cursor':None}
@router.get('/materials/{material_id}/chunks')
def read_chunks(material_id:UUID,artifact_id:UUID,start:int=0,count:int=5,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');get(db,w.id,'materials',str(material_id));r=get(db,w.id,'artifacts',str(artifact_id));require(r.data['material_id']==str(material_id),'not_found','Artifact not found.');require(start>=0 and 1<=count<=20)
    rows=r.data['chunks'][start:start+count];return {'data':{'artifact_id':r.id,'chunks':rows,'warnings':r.data['warnings'],'next_start':start+count if start+count<len(r.data['chunks']) else None}}
@router.post('/materials/{material_id}/markdown-corrections')
def correct(material_id:UUID,body:__import__('app.schemas',fromlist=['Markdown']).Markdown,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:write');key,rev=headers(request);op,replay=begin(db,w.id,a,key,f'correct:{material_id}',body.model_dump(mode='json'),rev)
    if replay:return replay
    r=get(db,w.id,'materials',str(material_id),True);expected(r,rev);source=get(db,w.id,'artifacts',str(body.source_artifact_id));require(source.data['material_id']==r.id,'not_found','Artifact not found.');before=snapshot(r)
    artifact=write_artifact(db,w.id,r.id,source.data['version_id'],body.markdown);r.data={**r.data,'active_artifact_id':artifact.id};r.revision+=1;r.updated_at=now();audit(db,a,op,r,before);return finish(op,r)
def download(blob):
    try:obj=client().get_object(Bucket=settings().s3_bucket,Key=blob.object_key)
    except (BotoCoreError,ClientError):raise DomainError('provider_unavailable','Object storage is unavailable.',retryable=True)
    filename=blob.filename.replace('"','').replace('\r','').replace('\n','')
    return StreamingResponse(obj['Body'].iter_chunks(65536),media_type=blob.media_type,headers={'Content-Disposition':f"attachment; filename*=UTF-8''{__import__('urllib.parse',fromlist=['quote']).quote(filename)}",'Content-Length':str(blob.size),'X-Content-Type-Options':'nosniff'})
@router.get('/materials/{material_id}/original')
def original(material_id:UUID,version_id:UUID|None=None,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');r=get(db,w.id,'materials',str(material_id));v=get(db,w.id,'material-versions',str(version_id or r.data.get('active_version_id')));require(v.data['material_id']==r.id,'not_found','Version not found.');blob=db.scalar(select(Blob).where(Blob.workspace_id==w.id,Blob.id==v.data['original_blob_id']));return download(blob)

@public_router.post('/attempt/files')
def student_upload(request:Request,question_id:UUID=Form(...),file:UploadFile=File(...),ctx=Depends(session_context)):
    db,session,access,assignment=ctx;require(assignment.data['status']=='open','invalid_state','Assignment is closed.')
    raw=read_upload(file,10*1024**2);mime=detect(file.filename or '',raw,True);key,rev=headers(request);actor=Actor('capability',session.id,'assignment:'+session.id,frozenset())
    op,replay=begin(db,assignment.workspace_id,actor,key,'upload-file',{'question_id':str(question_id),'checksum':hashlib.sha256(raw).hexdigest()},rev)
    if replay:return replay
    attempt=get(db,assignment.workspace_id,'submissions',assignment.data['active_attempt_id'],True);expected(attempt,rev);require(attempt.data['status']=='draft','invalid_state','Attempt already submitted.')
    q=next((q for q in content_for(db,assignment)['questions'] if q['id']==str(question_id)),None);require(q and q['type']=='file_upload','validation_error','Invalid upload question.')
    ext=Path(file.filename).suffix.lower().lstrip('.');require(ext in q['allowed_types'],'validation_error','File type is not allowed for this question.')
    files=attempt.data['files'];require(sum(f['size'] for f in files)+len(raw)<=50*1024**2,'payload_too_large','Attempt file quota exceeded.');require(sum(f['question_id']==str(question_id) for f in files)<q['max_files'],'validation_error','Question file limit exceeded.')
    blob=put_blob(db,assignment.workspace_id,attempt.id,file.filename,raw,mime,'submission',{'question_id':str(question_id)})
    f={'id':blob.id,'question_id':str(question_id),'filename':blob.filename,'media_type':mime,'size':len(raw)};attempt.data={**attempt.data,'files':files+[f]};attempt.revision+=1;attempt.updated_at=now();result={'data':f,'revision':attempt.revision,'operation_id':op.id};op.result=result;return result
@public_router.post('/attempt/files/{file_id}/remove')
def remove_file(file_id:UUID,request:Request,ctx=Depends(session_context)):
    db,session,access,assignment=ctx;require(assignment.data['status']=='open','invalid_state','Assignment is closed.');key,rev=headers(request);actor=Actor('capability',session.id,'assignment:'+session.id,frozenset());op,replay=begin(db,assignment.workspace_id,actor,key,'remove-file',{'file_id':str(file_id)},rev)
    if replay:return replay
    attempt=get(db,assignment.workspace_id,'submissions',assignment.data['active_attempt_id'],True);expected(attempt,rev);require(attempt.data['status']=='draft','invalid_state','Attempt already submitted.');require(any(f['id']==str(file_id) for f in attempt.data['files']),'not_found','File not found.')
    answers=[{**a,'value':[v for v in a['value'] if v!=str(file_id)]} if isinstance(a['value'],list) else a for a in attempt.data['answers']]
    attempt.data={**attempt.data,'files':[f for f in attempt.data['files'] if f['id']!=str(file_id)],'answers':answers};attempt.revision+=1;attempt.updated_at=now();result={'data':projection(db,access,assignment)['attempt'],'revision':attempt.revision,'operation_id':op.id};op.result=result;return result
@public_router.get('/files/{file_id}')
def public_download(file_id:UUID,ctx=Depends(session_context)):
    db,session,access,assignment=ctx;attempts=db.scalars(select(Record).where(Record.workspace_id==assignment.workspace_id,Record.kind=='submissions',Record.data['assignment_id'].astext==assignment.id));allowed=set(assignment.data['public_attachment_ids'])
    for attempt in attempts:allowed.update(f['id'] for f in attempt.data['files'])
    require(str(file_id) in allowed,'not_found','File not found.');blob=db.scalar(select(Blob).where(Blob.workspace_id==assignment.workspace_id,Blob.id==str(file_id)));require(blob is not None,'not_found','File not found.');return download(blob)
@router.get('/submissions/{submission_id}/files/{file_id}')
def submission_download(submission_id:UUID,file_id:UUID,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:read');sub=get(db,w.id,'submissions',str(submission_id));require(any(f['id']==str(file_id) for f in sub.data['files']),'not_found','File not found.');blob=db.scalar(select(Blob).where(Blob.workspace_id==w.id,Blob.id==str(file_id)));return download(blob)

@router.post('/materials/{material_id}/retry-conversion',status_code=202)
def retry_conversion(material_id:UUID,body:__import__('app.schemas',fromlist=['RetryConversion']).RetryConversion,request:Request,ctx=Depends(context)):
    db,w,a=ctx;a.permit('workspace:write');key,rev=headers(request);op,replay=begin(db,w.id,a,key,f'retry-conversion:{material_id}',body.model_dump(mode='json'),rev)
    if replay:return replay
    material=get(db,w.id,'materials',str(material_id),True);expected(material,rev);version=get(db,w.id,'material-versions',str(body.version_id),True);require(version.data['material_id']==material.id,'not_found','Version not found.');require(version.data['conversion_state']=='failed','invalid_state','Only failed conversions can be retried.')
    version.data={**version.data,'conversion_state':'queued'};job=Job(id=uid(),workspace_id=w.id,type='convert_material',payload={'material_id':material.id,'version_id':version.id},operation_id=op.id);db.add(job)
    before=snapshot(material);material.revision+=1;material.updated_at=now();audit(db,a,op,material,before)
    result={'operation_id':op.id,'job_id':job.id,'status':'pending'};op.result=result;return result

def submission_file_text(submission_id:UUID,file_id:UUID,start:int=0,count:int=5,ctx=None):
    db,w,a=ctx;a.permit('workspace:read');sub=get(db,w.id,'submissions',str(submission_id));require(any(f['id']==str(file_id) for f in sub.data['files']),'not_found','File not found.');require(start>=0 and 1<=count<=20)
    blob=db.scalar(select(Blob).where(Blob.workspace_id==w.id,Blob.id==str(file_id)));require(blob is not None,'not_found','File not found.')
    if blob.media_type.startswith('image/'):raise DomainError('text_unavailable','Image interpretation is not available.',{'file_id':blob.id,'media_type':blob.media_type})
    if 'chunks' not in blob.metadata_json:
        job=db.scalar(select(Job).where(Job.workspace_id==w.id,Job.type=='extract_submission_file',Job.payload['blob_id'].astext==blob.id).order_by(Job.available_at.desc()))
        return {'data':{'file_id':blob.id,'status':job.state if job else 'not_queued','job_id':job.id if job else None,'chunks':[]}}
    rows=blob.metadata_json['chunks'];return {'data':{'file_id':blob.id,'chunks':rows[start:start+count],'next_start':start+count if start+count<len(rows) else None,'warnings':[]}}
