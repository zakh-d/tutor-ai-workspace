"""PostgreSQL calendar queue integration with an explicit fake Google transport."""
import os
import pytest
from sqlalchemy import select
from app.db import Session,Record,Workspace,Job
from app.service import create_record
from app.calendar_api import handle_job,schedule_syncs
from test_postgres_workflow import client,headers

pytestmark=pytest.mark.skipif(not os.environ.get('RUN_INTEGRATION'),reason='Requires migrated PostgreSQL')

def test_calendar_queue_sync_and_guarded_undo(client,monkeypatch):
    from app import calendar_api
    c,actor=client
    c.get('/api/v1/workspace')
    with Session.begin() as db:
        w=db.scalar(select(Workspace).where(Workspace.issuer==actor.issuer,Workspace.subject==actor.subject))
        wid=w.id
        create_record(db,wid,'calendar-connection',{'status':'connected','calendar_id':'test','credentials':'unused'})
    class FakeGoogle:
        def close(self):pass
        def occurrences(self,cid,start,end):return []
        def sync(self,cid,cursor=None):return [],'next'
        def create(self,cid,op,event):return {'id':'provider-event','etag':'v1',**event}
        def get(self,cid,eid):return {'id':eid,'etag':'v1'}
        def delete(self,cid,eid,etag):assert etag=='v1'
    monkeypatch.setattr(calendar_api,'provider',lambda r:FakeGoogle())
    with Session.begin() as db:
        schedule_syncs(db);schedule_syncs(db)
        jobs=db.scalars(select(Job).where(Job.workspace_id==wid,Job.type=='calendar')).all()
        assert len(jobs)==1
        handle_job(db,jobs[0]);jobs[0].state='succeeded'
    s=c.post('/api/v1/students',json={'display_name':'Calendar fixture'},headers=headers()).json()['data']
    l=c.post('/api/v1/lessons',json={'student_id':s['id'],'title':'Lesson'},headers=headers()).json()['data']
    result=c.post('/api/v1/calendar/events',headers=headers(),json={'lesson_id':l['id'],'expected_lesson_revision':1,'title':'Lesson','start':'2026-11-20T10:00:00+01:00','end':'2026-11-20T11:00:00+01:00','timezone':'Europe/Warsaw'})
    assert result.status_code==202,result.text
    with Session.begin() as db:
        job=db.get(Job,result.json()['job_id']);handle_job(db,job);job.state='succeeded'
    events=c.get('/api/v1/calendar/events',params={'start':'2026-11-20T00:00:00Z','end':'2026-11-21T00:00:00Z'}).json()['items']
    assert len(events)==1
    event=events[0]
    history=c.get('/api/v1/history',params={'entity_id':event['id']}).json()['items']
    undo=c.post('/api/v1/history/undo',headers=headers(),json={'target_revision_id':history[0]['id'],'expected_current_revision':1})
    assert undo.status_code==200,undo.text
    with Session.begin() as db:
        job=db.get(Job,undo.json()['job_id']);handle_job(db,job);job.state='succeeded'
    assert c.get('/api/v1/calendar/events',params={'start':'2026-11-20T00:00:00Z','end':'2026-11-21T00:00:00Z'}).json()['items']==[]
