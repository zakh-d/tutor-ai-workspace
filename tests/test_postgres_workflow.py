"""Opt-in real PostgreSQL/MinIO integration, no SQLite fallback."""
import os
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.auth import Actor,authenticate
from app.config import settings
from app.db import Session,Access,Record
from app.service import digest

pytestmark=pytest.mark.skipif(not os.environ.get('RUN_INTEGRATION'),reason='Set RUN_INTEGRATION=1 with PostgreSQL and MinIO to execute live integration.')
SCOPES=frozenset('workspace:read workspace:write assignments:publish grading:propose history:read history:undo tutor:review calendar:read calendar:write'.split())
@pytest.fixture
def client(live_client):
    actor=Actor('test:'+str(uuid4()),str(uuid4()),settings().tutor_client_id,SCOPES)
    app.dependency_overrides[authenticate]=lambda:actor
    yield live_client,actor
    app.dependency_overrides.clear()
def headers(rev=None,key=None):
    result={'Idempotency-Key':key or str(uuid4())}
    if rev:result['If-Match']=f'"{rev}"'
    return result

def test_homework_submit_review_and_isolation(client):
    c,actor=client
    key=str(uuid4());h=headers(key=key)
    student=c.post('/api/v1/students',json={'display_name':'Integration'},headers=h)
    assert student.status_code==201,student.text
    sid=student.json()['data']['id']
    assert c.post('/api/v1/students',json={'display_name':'Integration'},headers=h).json()==student.json()
    assert c.post('/api/v1/students',json={'display_name':'Other'},headers=h).status_code==409
    assert c.patch('/api/v1/students/'+sid,json={'notes':'stale'},headers=headers(7)).status_code==409
    qid,a,b=[str(uuid4()) for _ in range(3)]
    content={'title':'Pinned exercise','instructions':'Choose A','questions':[{'id':qid,'type':'single_choice','prompt':'A?','points':3,'options':[{'id':a,'text':'A'},{'id':b,'text':'B'}],'correct_option_id':a}]}
    template=c.post('/api/v1/homework-templates',json=content,headers=headers());assert template.status_code==201,template.text
    tid=template.json()['data']['id'];h=headers(1)
    published=c.post(f'/api/v1/homework-templates/{tid}/publish',json={'student_id':sid},headers=h);assert published.status_code==201,published.text
    data=published.json()['data'];aid=data['id'];token=data['access_link'].split('#')[1]
    replay=c.post(f'/api/v1/homework-templates/{tid}/publish',json={'student_id':sid},headers=h).json()
    assert replay['data']['link_unavailable'] and 'access_link' not in replay['data']
    origin={'Origin':settings().public_base_url}
    exchange=c.post(f'/public/v1/assignments/{aid}/session',json={'token':token},headers=origin);assert exchange.status_code==200,exchange.text
    assert 'correct_option' not in exchange.text and 'rubric' not in exchange.text
    csrf=exchange.json()['csrf_token'];ph={**origin,'X-CSRF-Token':csrf}
    if settings().cookie_secure:
        cookie=c.cookies.get('tutor_assignment');c.cookies.set('tutor_assignment',cookie)
    saved=c.patch('/public/v1/attempt',json={'answers':[{'question_id':qid,'value':a}]},headers={**ph,**headers(1)});assert saved.status_code==200,saved.text
    submitted=c.post('/public/v1/attempt/submit',headers={**ph,**headers(2)});assert submitted.status_code==200,submitted.text
    subid=submitted.json()['data']['id']
    assert 'objective_result' not in submitted.text
    assessment={'items':[{'question_id':qid,'awarded_points':3,'feedback':'Correct'}],'overall_feedback':'Good'}
    proposal=c.post(f'/api/v1/submissions/{subid}/grade-proposals',json={**assessment,'expected_submission_revision':3},headers=headers());assert proposal.status_code==201,proposal.text
    released=c.post(f'/api/v1/submissions/{subid}/release-grade',json={'proposal_id':proposal.json()['data']['id'],'expected_proposal_revision':1,'expected_submission_revision':3,'expected_assignment_revision':1},headers=headers(1));assert released.status_code==200,released.text
    assert c.get('/public/v1/assignment').json()['released_result']==assessment
    other=Actor(actor.issuer,'other-'+str(uuid4()),actor.client_id,SCOPES);app.dependency_overrides[authenticate]=lambda:other
    assert c.get('/api/v1/students/'+sid).status_code==404
    assert c.get('/api/v1/assignments/'+aid).status_code==404
    assert c.get('/api/v1/search',params={'q':'secret','types':'calendar-connection'}).status_code==422


def test_material_upload_real_storage_worker(client):
    from app.worker import run_once
    c,_=client
    material=c.post('/api/v1/materials',json={'title':'Real original'},headers=headers());assert material.status_code==201,material.text
    mid=material.json()['data']['id'];raw=b'# Grammar\n\nThe past tense is useful.'
    uploaded=c.post(f'/api/v1/materials/{mid}/versions',files={'file':('notes.md',raw,'text/markdown')},headers=headers(1));assert uploaded.status_code==202,uploaded.text
    jid=uploaded.json()['job_id']
    for _ in range(20):
        run_once()
        job=c.get('/api/v1/jobs/'+jid).json()['data']
        if job['state'] in ('succeeded','failed'):break
    assert job['state']=='succeeded',job
    m=c.get('/api/v1/materials/'+mid).json()['data'];artifact=m['active_artifact_id']
    result=c.get(f'/api/v1/materials/{mid}/chunks',params={'artifact_id':artifact}).json()['data']
    assert 'past tense' in str(result['chunks'])
    assert c.get(f'/api/v1/materials/{mid}/original').content==raw

def test_history_undo_and_archive_constraints(client):
    c,_=client
    student=c.post('/api/v1/students',json={'display_name':'Undo Me'},headers=headers()).json()['data'];sid=student['id']
    changed=c.patch('/api/v1/students/'+sid,json={'notes':'new'},headers=headers(1));assert changed.status_code==200
    history=c.get('/api/v1/history',params={'entity_id':sid}).json()['items'];target=history[0]['id']
    undone=c.post('/api/v1/history/undo',json={'target_revision_id':target,'expected_current_revision':2},headers=headers());assert undone.status_code==200,undone.text
    assert undone.json()['data']['notes'] is None and undone.json()['revision']==3
    assert c.post('/api/v1/history/undo',json={'target_revision_id':target,'expected_current_revision':3},headers=headers()).status_code==409
    archived=c.post('/api/v1/students/'+sid+'/archive',headers=headers(3));assert archived.status_code==200
    task=c.post('/api/v1/tasks',json={'title':'Must fail','student_id':sid},headers=headers());assert task.status_code==409

def test_publication_undo_revokes_sessions_without_deleting_attempt(client):
    c,_=client
    student=c.post('/api/v1/students',json={'display_name':'Undo assignment'},headers=headers()).json()['data']
    qid,a,b=[str(uuid4()) for _ in range(3)]
    body={'title':'Undo exercise','instructions':'Read','questions':[{'id':qid,'type':'single_choice','prompt':'A?','points':1,'correct_option_id':a,'options':[{'id':a,'text':'A'},{'id':b,'text':'B'}]}]}
    template=c.post('/api/v1/homework-templates',json=body,headers=headers()).json()['data']
    assignment=c.post('/api/v1/homework-templates/'+template['id']+'/publish',json={'student_id':student['id']},headers=headers(1)).json()['data'];aid=assignment['id']
    token=assignment['access_link'].split('#')[1];origin={'Origin':settings().public_base_url}
    assert c.post('/public/v1/assignments/'+aid+'/session',json={'token':token},headers=origin).status_code==200
    changed=c.patch('/api/v1/assignments/'+aid,json={'due_at':'2026-12-01T12:00:00Z','status':'closed'},headers=headers(1))
    assert changed.status_code==200,changed.text
    change_revision=c.get('/api/v1/history',params={'entity_id':aid}).json()['items'][0]
    restored=c.post('/api/v1/history/undo',json={'target_revision_id':change_revision['id'],'expected_current_revision':2},headers=headers())
    assert restored.status_code==200,restored.text
    assert restored.json()['data']['status']=='open' and restored.json()['data']['due_at'] is None
    assert c.get('/public/v1/assignment').status_code==200
    # Undo publication requires that publication still be the aggregate's current revision.
    fresh=c.post('/api/v1/homework-templates/'+template['id']+'/publish',json={'student_id':student['id']},headers=headers(1)).json()['data']
    aid=fresh['id'];token=fresh['access_link'].split('#')[1]
    assert c.post('/public/v1/assignments/'+aid+'/session',json={'token':token},headers=origin).status_code==200
    revision=c.get('/api/v1/history',params={'entity_id':aid}).json()['items'][0]
    result=c.post('/api/v1/history/undo',json={'target_revision_id':revision['id'],'expected_current_revision':1},headers=headers());assert result.status_code==200,result.text
    assert result.json()['data']['status']=='closed'
    assert c.get('/public/v1/assignment').status_code==404
    assert c.post('/public/v1/assignments/'+aid+'/session',json={'token':token},headers=origin).status_code==404
    assert len(c.get('/api/v1/assignments/'+aid+'/submissions').json()['items'])==1

def test_worker_stale_failure_cannot_overwrite_new_lease(client,monkeypatch):
    from datetime import timedelta
    from app.db import Job,now,uid
    from app import worker
    c,actor=client
    workspace_id=c.get('/api/v1/workspace').json()['data']['id']
    jid=uid()
    with Session.begin() as db:
        db.add(Job(id=jid,workspace_id=workspace_id,type='convert_material',payload={},operation_id=uid(),state='running',attempts=1,generation=1,lease_until=now()+timedelta(seconds=180)))
    monkeypatch.setattr(worker,'claim',lambda:(jid,1))
    def replaced_job(*args):
        with Session.begin() as db:
            job=db.get(Job,jid);job.generation=2;job.state='succeeded';job.lease_until=None
        raise RuntimeError('stale worker failure')
    monkeypatch.setattr(worker,'process',replaced_job)
    assert worker.run_once()
    with Session() as db:
        job=db.get(Job,jid)
        assert job.generation==2 and job.state=='succeeded' and job.error is None

def test_object_reconciliation_retains_references_and_recent_uploads(client,monkeypatch):
    from datetime import timedelta
    from app import worker
    from app.storage import client as storage_client
    from app.db import Blob,now
    c,_=client
    material=c.post('/api/v1/materials',json={'title':'Retained original'},headers=headers()).json()['data']
    uploaded=c.post('/api/v1/materials/'+material['id']+'/versions',files={'file':('retained.txt',b'Retain all historical originals','text/plain')},headers=headers(1))
    assert uploaded.status_code==202,uploaded.text
    wid=c.get('/api/v1/workspace').json()['data']['id']
    s3=storage_client();bucket=settings().s3_bucket;orphan=wid+'/'+str(uuid4())
    s3.put_object(Bucket=bucket,Key=orphan,Body=b'interrupted upload')
    with Session() as db:original=db.scalar(select(Blob).where(Blob.workspace_id==wid)).object_key
    with Session.begin() as db:worker.reconcile_objects(db,wid)
    assert s3.get_object(Bucket=bucket,Key=orphan)['Body'].read()==b'interrupted upload'
    # Advance only the cleanup clock; MinIO supplies real object timestamps.
    future=now()+timedelta(hours=25)
    monkeypatch.setattr(worker,'now',lambda:future)
    with Session.begin() as db:worker.reconcile_objects(db,wid)
    assert s3.get_object(Bucket=bucket,Key=original)['Body'].read()==b'Retain all historical originals'
    from botocore.exceptions import ClientError
    with pytest.raises(ClientError) as exc:s3.head_object(Bucket=bucket,Key=orphan)
    assert exc.value.response['ResponseMetadata']['HTTPStatusCode']==404

def test_maintenance_scheduling_and_technical_retention(client):
    from datetime import timedelta
    from app.worker import schedule_maintenance
    from app.db import Job,Operation,now,uid
    c,_=client;wid=c.get('/api/v1/workspace').json()['data']['id']
    old=now()-timedelta(days=31);failed,success,calendar=[uid() for _ in range(3)]
    with Session.begin() as db:
        for jid,kind,state in [(failed,'extract_submission_file','failed'),(success,'convert_material','succeeded'),(calendar,'calendar','failed')]:
            db.add(Job(id=jid,workspace_id=wid,type=kind,payload={'resource':'retained-until-compaction'},operation_id=uid(),state=state,available_at=old))
    with Session.begin() as db:schedule_maintenance(db)
    with Session.begin() as db:schedule_maintenance(db)
    with Session() as db:
        assert db.get(Job,failed) is None
        assert db.get(Job,success).payload=={}
        assert db.get(Job,calendar).payload=={'resource':'retained-until-compaction'}
        jobs=list(db.scalars(select(Job).where(Job.workspace_id==wid,Job.type=='reconcile_objects')))
        assert len(jobs)==1 and jobs[0].state=='queued'

def test_search_history_and_calendar_stable_cursor_isolation(client):
    from app.db import Record,now,uid
    c,actor=client
    ids=[]
    for i in range(3):
        result=c.post('/api/v1/tasks',json={'title':'Paginationneedle '+str(i)},headers=headers())
        assert result.status_code==201,result.text
        ids.append(result.json()['data']['id'])
    def collect(path,params):
        items=[];cursor=None
        for _ in range(5):
            response=c.get(path,params={**params,'limit':1,**({'cursor':cursor} if cursor else {})})
            assert response.status_code==200,response.text
            page=response.json();items.extend(page['items']);cursor=page['next_cursor']
            if cursor is None:break
        assert cursor is None
        return items
    search=collect('/api/v1/search',{'q':'Paginationneedle','types':'tasks'})
    assert {r['id'] for r in search}==set(ids) and len(search)==3
    first=c.get('/api/v1/search',params={'q':'Paginationneedle','types':'tasks','limit':1}).json()
    cursor=first['next_cursor'];assert cursor
    assert c.get('/api/v1/search',params={'q':'Different','types':'tasks','cursor':cursor}).status_code==422
    history=collect('/api/v1/history',{'entity_type':'tasks'})
    assert {r['entity_id'] for r in history}==set(ids) and len(history)==3
    history_cursor=c.get('/api/v1/history',params={'entity_type':'tasks','limit':1}).json()['next_cursor']
    assert c.get('/api/v1/history',params={'entity_type':'students','cursor':history_cursor}).status_code==422
    wid=c.get('/api/v1/workspace').json()['data']['id'];event_ids=[]
    with Session.begin() as db:
        for i in range(3):
            eid=uid();event_ids.append(eid)
            db.add(Record(id=eid,workspace_id=wid,kind='calendar-events',created_at=now(),updated_at=now(),data={'title':'Event '+str(i),'start':{'dateTime':'2026-12-01T12:00:00Z'},'end':{'dateTime':'2026-12-01T13:00:00Z'}}))
    range_={'start':'2026-12-01T00:00:00Z','end':'2026-12-02T00:00:00Z'}
    calendar=collect('/api/v1/calendar/events',range_)
    assert {r['id'] for r in calendar}==set(event_ids) and len(calendar)==3
    cal_cursor=c.get('/api/v1/calendar/events',params={**range_,'limit':1}).json()['next_cursor']
    assert c.get('/api/v1/calendar/events',params={**range_,'end':'2026-12-03T00:00:00Z','cursor':cal_cursor}).status_code==422
    other=Actor(actor.issuer,'other-'+str(uuid4()),actor.client_id,SCOPES);app.dependency_overrides[authenticate]=lambda:other
    assert c.get('/api/v1/search',params={'q':'Paginationneedle','types':'tasks','cursor':cursor}).status_code==422
    assert c.get('/api/v1/history',params={'entity_type':'tasks','cursor':history_cursor}).status_code==422
    assert c.get('/api/v1/calendar/events',params={**range_,'cursor':cal_cursor}).status_code==422
