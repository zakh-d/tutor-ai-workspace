# ADR-007 — Google-authoritative timetable with guarded writes

Status: Accepted

Date: 2026-11-14

## Context

Tutors already use external calendars. The MVP needs two-way scheduling without building a calendar service or silently overwriting external edits.

## Decision

Integrate one selected Google calendar per tutor through separate OAuth consent. Google owns event timing; local lessons own teaching data. Poll incremental sync plus manual refresh. Queue writes and use ETags, stable create IDs and operation reconciliation. Manage recurrence series in Google; allow scoped individual occurrence handling. No invitations or automatic messaging.

## Consequences

The UI is eventually consistent and must show sync age and pending/conflict states. Undo may fail after an external change. Attendee-bearing events can be viewed/linked but are not rescheduled by this MVP. OAuth credentials require encryption and reauthorization handling.

## Alternatives and deferred work

Microsoft/Teams, webhook infrastructure, recurrence series editing and local-first schedule conflict merging are deferred. Google integration does not imply a student notification feature.

## Specifications and verification

[Calendar](../calendar.md). Official reference: [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync). Validation: T08, T09.
