"""Durable PostgreSQL queue with expiring leases and fencing generations."""
import os,sys,time,subprocess,tempfile,threading,random
from importlib.metadata import version as package_version
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from sqlalchemy import select,or_,and_,delete
from .db import Session,Job,Blob,Workspace,now,uid
from .service import get
from .storage import client,write_artifact,chunks
from .config import settings
from .errors import DomainError

def claim():
    with Session.begin() as db:
        job=db.scalar(select(Job).where(or_(and_(Job.state.in_(['queued','retry_wait']),Job.available_at<=now()),and_(Job.state=='running',Job.lease_until<now()))).order_by(Job.available_at,Job.id).with_for_update(skip_locked=True).limit(1))
        if not job:return None
        job.state='running';job.attempts+=1;job.generation+=1;job.lease_until=now()+timedelta(seconds=180)
        return job.id,job.generation

def extract(raw,filename):
    ext=Path(filename).suffix.lower()
    if ext in ('.md','.txt'):
        try:text=raw.decode('utf-8').replace('\r\n','\n')
        except UnicodeDecodeError:raise DomainError('validation_error','Text must be valid UTF-8.')
        if len(text.encode('utf-8'))>5*1024**2:raise DomainError('payload_too_large','Extracted output is too large.')
        return text
    with tempfile.TemporaryDirectory(prefix='tutor-extract-') as tmp:
        source=Path(tmp)/('source'+ext);source.write_bytes(raw)
        # Conversion uses bounded files, resource limits and a fail-closed native syscall filter.
        with open(Path(tmp)/'output','w+b') as output, open(Path(tmp)/'errors','w+b') as errors:
            result=subprocess.run([sys.executable,str(Path(__file__).with_name('conversion.py')),str(source)],stdout=output,stderr=errors,timeout=120,env={'PATH':os.environ.get('PATH',''),'HOME':tmp,'TMPDIR':tmp,'OPENBLAS_NUM_THREADS':'1'})
            if result.returncode:raise DomainError('validation_error','Document could not be converted. Check that it is valid and not encrypted.')
            output.seek(0);raw_output=output.read(5*1024**2+1)
            if len(raw_output)>5*1024**2:raise DomainError('payload_too_large','Extracted output is too large.')
            return raw_output.decode('utf-8')

def reconcile_objects(db,workspace_id):
    """Delete only aged objects absent from all retained blob metadata.

    Upload and artifact creation hold the same workspace lock until metadata commits,
    so an in-flight upload cannot be mistaken for an orphan. Every Blob is retained,
    including prior artifacts and detached/submitted student files.
    """
    db.scalar(select(Workspace).where(Workspace.id==workspace_id).with_for_update())
    s3=client();bucket=settings().s3_bucket;cutoff=now()-timedelta(hours=24)
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix=workspace_id+'/'):
        for obj in page.get('Contents',[]):
            if obj['LastModified']>=cutoff:continue
            referenced=db.scalar(select(Blob.id).where(Blob.workspace_id==workspace_id,Blob.object_key==obj['Key']))
            if referenced is None:s3.delete_object(Bucket=bucket,Key=obj['Key'])

def schedule_maintenance(db):
    # Workspace row locks serialize multiple schedulers and object uploads.
    for wid in db.scalars(select(Workspace.id).with_for_update(skip_locked=True)):
        recent=db.scalar(select(Job.id).where(Job.workspace_id==wid,Job.type=='reconcile_objects',or_(Job.state.in_(['queued','running','retry_wait']),Job.available_at>now()-timedelta(hours=1))).limit(1))
        if recent is None:db.add(Job(id=uid(),workspace_id=wid,type='reconcile_objects',payload={},operation_id=uid()))
    # Domain records, operation replay results, revisions and all calendar jobs remain.
    # Calendar jobs may carry unresolved provider outcomes and are never compacted here.
    technical=Job.type.in_(['convert_material','extract_submission_file','reconcile_objects'])
    db.execute(delete(Job).where(technical,Job.state=='failed',Job.available_at<now()-timedelta(days=30)))
    for job in db.scalars(select(Job).where(technical,Job.state=='succeeded',Job.available_at<now()-timedelta(days=7)).with_for_update(skip_locked=True)):
        job.payload={};job.error=None

def process(job_id,generation):
    # Download/conversion happens outside the transaction; fencing is checked before persistence.
    with Session() as db:
        job=db.get(Job,job_id);payload=dict(job.payload);wid=job.workspace_id;kind=job.type
        if kind=='convert_material':
            version=get(db,wid,'material-versions',payload['version_id']);blob=db.scalar(select(Blob).where(Blob.id==version.data['original_blob_id'],Blob.workspace_id==wid))
        elif kind=='extract_submission_file':blob=db.scalar(select(Blob).where(Blob.id==payload['blob_id'],Blob.workspace_id==wid))
        else:blob=None
        if kind in ('convert_material','extract_submission_file') and blob is None:raise DomainError('not_found','Original file metadata is missing.')
        if blob:object_key,filename=blob.object_key,blob.filename
    markdown=None
    if blob:
        raw=client().get_object(Bucket=settings().s3_bucket,Key=object_key)['Body'].read(25*1024**2+1)
        markdown=extract(raw,filename)
        if not markdown.strip():raise DomainError('no_extractable_text','No extractable text was found.')
    with Session.begin() as db:
        job=db.scalar(select(Job).where(Job.id==job_id).with_for_update())
        if job.generation!=generation or job.state!='running' or job.lease_until<now():return
        if kind=='convert_material':
            version=get(db,wid,'material-versions',payload['version_id'],True);artifact=write_artifact(db,wid,payload['material_id'],version.id,markdown)
            warnings=['Images and document layout may not be preserved.'] if version.data['format'] not in ('.md','.txt') else []
            artifact.data={**artifact.data,'warnings':warnings}
            version.data={**version.data,'conversion_state':'ready_with_warnings' if warnings else 'ready','artifact_id':artifact.id,'warnings':warnings,'converter_version':package_version('markitdown')}
            material=get(db,wid,'materials',payload['material_id'],True)
            if material.data.get('active_version_id')==version.id:material.data={**material.data,'active_artifact_id':artifact.id}
        elif kind=='extract_submission_file':
            blob=db.scalar(select(Blob).where(Blob.id==payload['blob_id'],Blob.workspace_id==wid));blob.metadata_json={**blob.metadata_json,'chunks':chunks(markdown),'extraction_state':'ready'}
        elif kind=='reconcile_objects':reconcile_objects(db,wid)
        elif kind=='calendar':
            from .calendar_api import handle_job
            handle_job(db,job)
        else:raise DomainError('invalid_state','Unknown job type.')
        job.state='succeeded';job.lease_until=None;job.error=None;job.available_at=now()

def heartbeat(job_id,generation,stop):
    while not stop.wait(30):
        with Session.begin() as db:
            job=db.scalar(select(Job).where(Job.id==job_id).with_for_update())
            if not job or job.generation!=generation or job.state!='running' or job.lease_until<now():return
            job.lease_until=now()+timedelta(seconds=180)

def run_once():
    claimed=claim()
    if not claimed:return False
    jid,generation=claimed
    stop=threading.Event();pulse=threading.Thread(target=heartbeat,args=(jid,generation,stop),daemon=True);pulse.start()
    try:process(jid,generation)
    except Exception as exc:
        code=exc.code if isinstance(exc,DomainError) else 'provider_unavailable'
        retryable=exc.retryable if isinstance(exc,DomainError) else True
        with Session.begin() as db:
            job=db.scalar(select(Job).where(Job.id==jid).with_for_update())
            if job.generation!=generation or job.state!='running' or job.lease_until<now():return True
            job.error={'code':code,'message':'Processing failed. Retry if the service becomes available.','retryable':retryable}
            job.state='retry_wait' if retryable and job.attempts<5 else 'failed';job.lease_until=None
            job.available_at=now()+timedelta(seconds=min(900,5*2**(job.attempts-1)+random.uniform(0,1)))
            if job.type=='convert_material':
                version=get(db,job.workspace_id,'material-versions',job.payload['version_id']);version.data={**version.data,'conversion_state':'queued' if job.state=='retry_wait' else 'failed','error':job.error}
    finally:
        stop.set();pulse.join(timeout=1)
    return True

def worker_loop():
    while True:
        if not run_once():time.sleep(1)

def main():
    pool=ThreadPoolExecutor(max_workers=2)
    for _ in range(2):pool.submit(worker_loop)
    last_sync=0
    while True:
        if time.monotonic()-last_sync>60:
            from .calendar_api import schedule_syncs
            with Session.begin() as db:
                schedule_syncs(db);schedule_maintenance(db)
            last_sync=time.monotonic()
        time.sleep(1)
if __name__=='__main__':main()
