"""Materialize local weekly rules without rewriting concrete lesson timing."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .db import Record, now
from .errors import DomainError, require
from .service import audit, begin, create_record, expected, finish, get, serialize, snapshot, validated


def occurrence_start(day, local_start, zone):
    wall_time = datetime.combine(day, local_start)
    try:
        candidates = {
            wall_time.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
            for fold in (0, 1)
        }
        valid = {
            instant for instant in candidates
            if instant.astimezone(zone).replace(tzinfo=None) == wall_time
        }
    except OverflowError as exc:
        raise DomainError('validation_error', 'Occurrence time is outside the supported range.') from exc
    if len(valid) == 1:
        return valid.pop(), None
    return None, 'ambiguous_local_time' if valid else 'nonexistent_local_time'


def generate_schedule(db, wid, actor, schedule_id, key, revision, through_date):
    actor.permit('workspace:write')
    op, replay = begin(
        db, wid, actor, key, f'schedule-generate:{schedule_id}',
        {'through_date': through_date.isoformat()}, revision,
    )
    if replay:
        return replay

    # Serialize generation with edits and other generation requests for this schedule.
    schedule = get(db, wid, 'schedules', schedule_id, lock=True)
    expected(schedule, revision)
    require(not schedule.archived_at, 'invalid_state', 'Archived schedules cannot generate lessons.')
    rule = schedule.data
    student = get(db, wid, 'students', rule['student_id'], lock=True)
    require(not student.archived_at, 'invalid_state', 'Archived students cannot receive new lessons.')

    first = date.fromisoformat(rule['start_date'])
    require(through_date >= first, 'validation_error', 'Through date must be on or after the schedule start date.')
    last = min(through_date, date.fromisoformat(rule['end_date'])) if rule.get('end_date') else through_date
    extra = {'generated_lessons': [], 'skipped_occurrences': []}
    if rule.get('generated_through'):
        previous = date.fromisoformat(rule['generated_through'])
        if last <= previous:
            return finish(op, schedule, extra)
        first = max(first, previous + timedelta(days=1))
    interval_days = (last - first).days + 1
    require(interval_days <= 93, 'validation_error', 'Generate at most 93 calendar days at a time.')

    # Existing occurrences reserve their original dates even after a move or archive.
    occurrence_date = Record.data['occurrence_date'].astext
    existing = set(db.scalars(select(occurrence_date).where(
        Record.workspace_id == wid,
        Record.kind == 'lessons',
        Record.data['schedule_id'].astext == schedule.id,
        occurrence_date.between(first.isoformat(), last.isoformat()),
    )))
    zone = ZoneInfo(rule['timezone'])
    local_start = time.fromisoformat(rule['local_start'])
    duration = timedelta(minutes=rule['duration_minutes'])
    for offset in range(interval_days):
        day = first + timedelta(days=offset)
        original_date = day.isoformat()
        if day.weekday() not in rule['weekdays'] or original_date in existing:
            continue
        starts_at, reason = occurrence_start(day, local_start, zone)
        if reason:
            extra['skipped_occurrences'].append({'occurrence_date': original_date, 'reason': reason})
            continue
        try:
            ends_at = starts_at + duration
        except OverflowError as exc:
            raise DomainError('validation_error', 'Occurrence time is outside the supported range.') from exc
        payload = validated('lessons', {
            'student_id': student.id, 'title': rule['title'], 'starts_at': starts_at,
            'ends_at': ends_at, 'timezone': rule['timezone'],
        })
        lesson = create_record(db, wid, 'lessons', {
            **payload, 'schedule_id': schedule.id, 'occurrence_date': original_date,
        })
        audit(db, actor, op, lesson, None)
        extra['generated_lessons'].append(serialize(lesson))

    before = snapshot(schedule)
    schedule.data = {**rule, 'generated_through': last.isoformat()}
    schedule.revision += 1
    schedule.updated_at = now()
    audit(db, actor, op, schedule, before)
    return finish(op, schedule, extra)
