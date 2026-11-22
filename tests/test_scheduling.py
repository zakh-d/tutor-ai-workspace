"""Local schedule validation and PostgreSQL transport regressions."""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timezone
from pathlib import Path
from threading import Barrier
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import text

from app.auth import Actor, authenticate
from app.config import settings
from app.db import Session, engine
from app.main import app
from app.mcp import mcp
from app.schemas import GenerateSchedule, Lesson, Schedule, Student
from app.scheduling import occurrence_start
from app.service import create_record
from test_postgres_workflow import client, headers


postgres = pytest.mark.skipif(
    not (os.environ.get('SCHEDULING_INTEGRATION') or os.environ.get('RUN_INTEGRATION')),
    reason='Set SCHEDULING_INTEGRATION=1 with migrated PostgreSQL',
)


def rule(student_id, **overrides):
    return {
        'student_id': student_id,
        'title': 'Weekly tutoring',
        'weekdays': [0, 4],
        'local_start': '18:00',
        'timezone': 'Europe/Warsaw',
        'duration_minutes': 50,
        'start_date': '2027-01-04',
        **overrides,
    }


def response(result, status=200):
    assert result.status_code == status, result.text
    return result.json()


@pytest.mark.parametrize('changes', [
    {'weekdays': []}, {'weekdays': [1, 1]}, {'weekdays': [7]}, {'weekdays': [True]},
    {'local_start': '24:00'}, {'local_start': '6:00'}, {'duration_minutes': 0},
    {'duration_minutes': 1441}, {'timezone': 'Europe/Unknown'}, {'start_date': 1800000000},
    {'start_date': '2027-02-30'}, {'end_date': '2027-01-03'},
])
def test_strict_weekly_rule(changes):
    with pytest.raises(ValidationError):
        Schedule(**rule(uuid4(), **changes))


def test_local_timing_requires_aware_chronological_instants_and_an_iana_zone():
    for invalid in ('', '/etc/localtime', 'localtime', 'right/Europe/Warsaw'):
        with pytest.raises(ValidationError):
            Student(display_name='Tutor student', timezone=invalid)
    assert Student(display_name='Tutor student').timezone is None
    with pytest.raises(ValidationError):
        GenerateSchedule(through_date='2027-01-04T00:00:00Z')
    base = {'student_id': uuid4(), 'title': 'One-off'}
    timing = {'starts_at': '2027-10-31T02:15:00+02:00', 'ends_at': '2027-10-31T02:00:00+01:00',
              'timezone': 'Europe/Warsaw'}
    lesson = Lesson(**base, **timing)
    assert lesson.starts_at == datetime(2027, 10, 31, 0, 15, tzinfo=timezone.utc)
    assert lesson.ends_at == datetime(2027, 10, 31, 1, tzinfo=timezone.utc)
    for change in ({'starts_at': '2027-10-31T02:15:00'}, {'ends_at': None},
                   {'ends_at': '2027-10-31T02:00:00+02:00'}, {'timezone': None}):
        with pytest.raises(ValidationError):
            Lesson(**base, **(timing | change))


@pytest.mark.parametrize(('day', 'expected'), [
    (date(2027, 3, 21), (datetime(2027, 3, 21, 1, 30, tzinfo=timezone.utc), None)),
    (date(2027, 3, 28), (None, 'nonexistent_local_time')),
    (date(2027, 4, 4), (datetime(2027, 4, 4, 0, 30, tzinfo=timezone.utc), None)),
    (date(2027, 10, 31), (None, 'ambiguous_local_time')),
])
def test_weekly_wall_time_across_daylight_saving(day, expected):
    assert occurrence_start(day, time(2, 30), ZoneInfo('Europe/Warsaw')) == expected


def test_schedule_mcp_and_openapi_share_the_route_schema():
    async def inspect_tools():
        tools = await mcp.get_tools()
        create = tools['schedules_create'].parameters
        assert {'student_id', 'weekdays', 'timezone', 'local_start', 'duration_minutes', 'start_date',
                'idempotency_key'} <= set(create['required'])
        assert 'expected_revision' not in create['properties']
        assert set(tools['schedules_generate'].parameters['required']) == {
            'schedule_id', 'through_date', 'idempotency_key', 'expected_revision',
        }
        assert {'schedules_list', 'schedules_get', 'schedules_update', 'schedules_archive',
                'schedules_restore', 'calendar_event_get'} <= tools.keys()
        assert 'schedule_id' in tools['lessons_list'].parameters['properties']

    asyncio.run(inspect_tools())
    contract = app.openapi()
    assert contract['components']['schemas']['GenerateSchedule']['properties']['through_date']['format'] == 'date'
    assert '/api/v1/schedules/{schedule_id}/generate' in contract['paths']


@postgres
def test_timezone_migration_preserves_legacy_preferences():
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'backend' / 'alembic'))
    migration = ScriptDirectory.from_config(config).get_revision('0002_workspace_timezone').module
    with engine.begin() as connection:
        connection.execute(text('CREATE TEMP TABLE workspaces (timezone text, revision integer) ON COMMIT DROP'))
        connection.execute(text("INSERT INTO workspaces VALUES ('UTC', 1), ('UTC', 2), ('Europe/Warsaw', 1)"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        rows = connection.execute(text(
            'SELECT timezone, revision, timezone_configured FROM workspaces ORDER BY timezone, revision',
        )).all()
        assert set(rows) == {('UTC', 1, False), ('UTC', 2, True), ('Europe/Warsaw', 1, True)}


@postgres
def test_workspace_timezone_distinguishes_default_from_saved_utc(client):
    http, _ = client
    path = '/api/v1/workspace'
    initial = response(http.get(path))['data']
    assert (initial['revision'], initial['timezone'], initial['timezone_configured']) == (1, 'UTC', False)

    renamed = response(http.patch(path, headers=headers(1), json={'name': 'Renamed'}))['data']
    assert (renamed['revision'], renamed['timezone_configured']) == (2, False)
    assert http.patch(path, headers=headers(2), json={'timezone': 'Invalid/Timezone'}).status_code == 422

    save_headers = headers(2)
    saved = response(http.patch(path, headers=save_headers, json={'timezone': 'UTC'}))
    assert (saved['revision'], saved['data']['timezone'], saved['data']['timezone_configured']) == (3, 'UTC', True)
    assert response(http.patch(path, headers=save_headers, json={'timezone': 'UTC'})) == saved
    assert http.patch(path, headers=headers(2), json={'timezone': 'Asia/Tokyo'}).status_code == 409

    persisted = response(http.get(path))['data']
    assert (persisted['timezone'], persisted['timezone_configured'], persisted['name']) == ('UTC', True, 'Renamed')


@postgres
def test_generation_creates_once_and_keeps_moved_and_cancelled_lessons(client):
    http, actor = client
    student = response(http.post('/api/v1/students', headers=headers(), json={
        'display_name': 'Schedule student', 'timezone': 'Asia/Tokyo',
    }), 201)['data']
    other_student = response(http.post('/api/v1/students', headers=headers(), json={
        'display_name': 'Other student',
    }), 201)['data']
    schedule = response(http.post('/api/v1/schedules', headers=headers(), json=rule(student['id'])), 201)['data']
    schedule_path = '/api/v1/schedules/' + schedule['id']
    lesson_filter = {'schedule_id': schedule['id']}
    assert response(http.get('/api/v1/lessons', params=lesson_filter))['items'] == []
    assert schedule['generated_through'] is None
    assert response(http.get('/api/v1/schedules', params={'student_id': student['id']}))['items'] == [schedule]
    payload = {'through_date': '2027-01-08'}
    assert http.post(schedule_path + '/generate', headers=headers(), json=payload).status_code == 428
    assert http.post(schedule_path + '/generate', headers=headers(2), json=payload).status_code == 409
    assert http.post(schedule_path + '/generate', headers=headers(1), json={'through_date': '2027-04-07'}).status_code == 422

    key = headers(1)
    generated = response(http.post(schedule_path + '/generate', headers=key, json=payload))
    assert generated['revision'] == 2
    lesson_a, lesson_b = generated['data']['generated_lessons']
    assert [(lesson['occurrence_date'], lesson['starts_at']) for lesson in (lesson_a, lesson_b)] == [
        ('2027-01-04', '2027-01-04T17:00:00Z'), ('2027-01-08', '2027-01-08T17:00:00Z'),
    ]
    assert all(lesson['schedule_id'] == schedule['id'] for lesson in (lesson_a, lesson_b))
    assert response(http.post(schedule_path + '/generate', headers=key, json=payload)) == generated
    assert http.post(schedule_path + '/generate', headers=key, json={'through_date': '2027-01-09'}).status_code == 409
    replay_window = response(http.post(schedule_path + '/generate', headers=headers(2), json=payload))
    assert replay_window['revision'] == 2 and replay_window['data']['generated_lessons'] == []
    history = response(http.get('/api/v1/history', params={'operation_id': generated['operation_id']}))['items']
    assert {entry['entity_id'] for entry in history} == {schedule['id'], lesson_a['id'], lesson_b['id']}
    generation_revision = next(entry['id'] for entry in history if entry['entity_id'] == schedule['id'])
    undo = response(http.post('/api/v1/history/undo', headers=headers(), json={
        'target_revision_id': generation_revision, 'expected_current_revision': 2,
    }), 409)
    assert undo['error']['code'] == 'undo_not_supported'

    moved = response(http.patch('/api/v1/lessons/' + lesson_a['id'], headers=headers(1), json={
        'starts_at': '2027-01-05T21:30:00+01:00', 'ends_at': '2027-01-05T22:20:00+01:00',
        'plan': 'Keep lesson content',
    }))['data']
    assert moved['starts_at'] == '2027-01-05T20:30:00Z' and moved['occurrence_date'] == '2027-01-04'
    assert http.patch('/api/v1/lessons/' + lesson_a['id'], headers=headers(2), json={
        'occurrence_date': '2027-01-05',
    }).status_code == 422
    assert http.patch('/api/v1/lessons/' + lesson_a['id'], headers=headers(2), json={
        'student_id': other_student['id'],
    }).status_code == 409
    assert http.patch(schedule_path, headers=headers(2), json={'student_id': other_student['id']}).status_code == 409
    assert http.patch(schedule_path, headers=headers(2), json={'generated_through': '2026-12-31'}).status_code == 422
    cancelled = response(http.patch('/api/v1/lessons/' + lesson_b['id'], headers=headers(1), json={
        'status': 'cancelled',
    }))['data']

    changed = response(http.patch(schedule_path, headers=headers(2), json={
        'local_start': '19:00', 'end_date': '2027-01-11',
    }))
    assert changed['data']['generated_through'] == '2027-01-08'
    extra = response(http.post(schedule_path + '/generate', headers=headers(3), json={'through_date': '2027-01-30'}))
    assert extra['data']['generated_through'] == '2027-01-11'
    next_lesson, = extra['data']['generated_lessons']
    assert next_lesson['starts_at'] == '2027-01-11T18:00:00Z'
    assert response(http.get('/api/v1/lessons', params=lesson_filter))['items'] == [moved, cancelled, next_lesson]

    # An archived occurrence also reserves its original date permanently.
    response(http.post('/api/v1/lessons/' + lesson_a['id'] + '/archive', headers=headers(2)))
    repeated = response(http.post(schedule_path + '/generate', headers=headers(4), json={'through_date': '2027-01-11'}))
    assert repeated['data']['generated_lessons'] == []
    assert len(response(http.get('/api/v1/lessons', params={**lesson_filter, 'archived': 'true'}))['items']) == 1
    archived = response(http.post(schedule_path + '/archive', headers=headers(4)))['data']
    assert http.post(schedule_path + '/generate', headers=headers(archived['revision']), json=payload).status_code == 409

    other = Actor(actor.issuer, 'other-owner', actor.client_id, actor.scopes)
    app.dependency_overrides[authenticate] = lambda: other
    assert http.get(schedule_path).status_code == 404
    assert http.post(schedule_path + '/generate', headers=headers(4), json=payload).status_code == 404
    assert http.post('/api/v1/schedules', headers=headers(), json=rule(student['id'])).status_code == 404
    assert response(http.get('/api/v1/lessons', params=lesson_filter))['items'] == []


@postgres
def test_generation_serializes_concurrent_calls_and_reports_dst_skips(client):
    http, _ = client
    student = response(http.post('/api/v1/students', json={'display_name': 'DST'}, headers=headers()), 201)['data']
    schedule = response(http.post('/api/v1/schedules', headers=headers(), json=rule(
        student['id'], weekdays=[6], local_start='02:30', start_date='2027-03-21',
    )), 201)['data']
    schedule_path = '/api/v1/schedules/' + schedule['id']
    barrier = Barrier(2, timeout=10)

    def request_generation():
        barrier.wait()
        return http.post(schedule_path + '/generate', headers=headers(1), json={'through_date': '2027-04-04'})

    with ThreadPoolExecutor(max_workers=2) as pool:
        tasks = [pool.submit(request_generation) for _ in range(2)]
        results = [task.result(timeout=15) for task in tasks]
    assert sorted(result.status_code for result in results) == [200, 409]
    data = next(result.json()['data'] for result in results if result.status_code == 200)
    assert data['generated_through'] == '2027-04-04'
    assert data['skipped_occurrences'] == [{'occurrence_date': '2027-03-28', 'reason': 'nonexistent_local_time'}]
    assert [lesson['starts_at'] for lesson in data['generated_lessons']] == [
        '2027-03-21T01:30:00Z', '2027-04-04T00:30:00Z',
    ]
    assert response(http.get('/api/v1/lessons', params={'schedule_id': schedule['id']}))['items'] == data['generated_lessons']

    response(http.post(schedule_path + '/archive', headers=headers(2)))
    assert http.post(schedule_path + '/generate', headers=headers(3), json={'through_date': '2027-04-05'}).status_code == 409
    restored = response(http.post(schedule_path + '/restore', headers=headers(3)))
    assert restored['data']['generated_through'] == '2027-04-04'
    response(http.post('/api/v1/students/' + student['id'] + '/archive', headers=headers(1)))
    assert http.post(schedule_path + '/generate', headers=headers(4), json={'through_date': '2027-04-05'}).status_code == 409
    response(http.post(schedule_path + '/archive', headers=headers(4)))


@postgres
def test_provider_timing_for_linked_lessons_and_read_permissions(client):
    http, actor = client
    workspace_id = response(http.get('/api/v1/workspace'))['data']['id']
    student = response(http.post('/api/v1/students', json={'display_name': 'Linked'}, headers=headers()), 201)['data']
    lesson = response(http.post('/api/v1/lessons', headers=headers(), json={
        'student_id': student['id'], 'title': 'Lesson content',
    }), 201)['data']
    start = {'dateTime': '2027-04-02T16:00:00+02:00', 'timeZone': 'Europe/Warsaw'}
    end = {'dateTime': '2027-04-02T16:50:00+02:00', 'timeZone': 'Europe/Warsaw'}
    with Session.begin() as db:
        event_id = create_record(db, workspace_id, 'calendar-events', {
            'provider_id': 'cached-event', 'title': 'Provider timing', 'start': start, 'end': end,
        }).id
    event_path = '/api/v1/calendar/events/' + event_id
    lesson_path = '/api/v1/lessons/' + lesson['id']
    response(http.post(event_path + '/link', headers=headers(1), json={
        'lesson_id': lesson['id'], 'expected_lesson_revision': 1,
    }))
    event = response(http.get(event_path))['data']
    assert (event['lesson_id'], event['student_id']) == (lesson['id'], student['id'])
    items = response(http.get('/api/v1/calendar/events', params={
        'start': '2027-04-01T00:00:00Z', 'end': '2027-04-03T00:00:00Z',
    }))['items']
    assert items == [event]
    detail = response(http.get(lesson_path))['data']
    assert detail['calendar_start'] == start and detail['calendar_end'] == end
    assert response(http.get('/api/v1/lessons'))['items'] == [detail]
    assert http.patch(lesson_path, headers=headers(2), json={
        'starts_at': '2027-04-02T17:00:00+02:00', 'ends_at': '2027-04-02T17:50:00+02:00',
        'timezone': 'Europe/Warsaw',
    }).status_code == 409
    assert response(http.patch(lesson_path, headers=headers(2), json={'notes': 'Allowed'}))['data']['notes'] == 'Allowed'

    lesson_reader = Actor(actor.issuer, actor.subject, actor.client_id, frozenset({'workspace:read'}))
    app.dependency_overrides[authenticate] = lambda: lesson_reader
    assert 'calendar_start' not in response(http.get(lesson_path))['data']
    assert http.get(event_path).status_code == 403
    calendar_reader = Actor(actor.issuer, actor.subject, actor.client_id, frozenset({'calendar:read'}))
    app.dependency_overrides[authenticate] = lambda: calendar_reader
    assert 'student_id' not in response(http.get(event_path))['data']


@postgres
def test_public_assignment_has_only_resolved_zone_names_from_the_profiles(client):
    http, _ = client
    response(http.patch('/api/v1/workspace', headers=headers(1), json={'timezone': 'America/New_York'}))
    student = response(http.post('/api/v1/students', headers=headers(), json={
        'display_name': 'Private name', 'notes': 'Private tutor notes',
    }), 201)['data']
    template = response(http.post('/api/v1/homework-templates', headers=headers(), json={
        'title': 'Exercise', 'instructions': 'Write an answer', 'questions': [{
            'id': str(uuid4()), 'type': 'written_response', 'prompt': 'Why?', 'points': 1,
            'rubric': 'Private rubric',
        }],
    }), 201)['data']
    assignment = response(http.post('/api/v1/homework-templates/' + template['id'] + '/publish', headers=headers(1), json={
        'student_id': student['id'], 'due_at': '2027-01-05T02:00:00Z',
    }), 201)['data']
    public = response(http.post('/public/v1/assignments/' + assignment['id'] + '/session',
                                headers={'Origin': settings().public_base_url},
                                json={'token': assignment['access_link'].split('#')[1]}))['assignment']
    assert public['teacher_timezone'] == public['student_timezone'] == 'America/New_York'
    assert public['due_at'] == '2027-01-05T02:00:00Z'
    assert {'student_id', 'student', 'notes'} .isdisjoint(public)
    assert all('rubric' not in question for question in public['questions'])
    response(http.patch('/api/v1/students/' + student['id'], headers=headers(1), json={'timezone': 'Asia/Tokyo'}))
    if settings().cookie_secure:
        http.cookies.set('tutor_assignment', http.cookies.get('tutor_assignment'))
    public = response(http.get('/public/v1/assignment'))
    assert (public['teacher_timezone'], public['student_timezone']) == ('America/New_York', 'Asia/Tokyo')
