# Google Calendar integration

## Native weekly schedules

[ADR-010](adr/010-student-timezones-and-schedules.md) extends the Google-only scheduling boundary: a tutor can save a weekly student agreement and explicitly generate up to 93 days of local lessons without connecting Google. Recurrence is anchored to its chosen IANA timezone, not a fixed UTC offset. Generated lessons can be moved or cancelled individually; regeneration never resets them. Schedule edits affect only ungenerated dates and archival preserves lessons. DST gaps/overlaps are skipped with visible dates/reasons; create an explicit-offset one-off when required. Teacher and student dates/times are labelled separately throughout student-related time flows.

Google remains authoritative for linked provider events; native schedules do not automatically create provider series or events.

## Connection and ownership

Tutor connects Google separately from Keycloak login using server-side authorization-code exchange, CSRF state and exact callback URI. Request calendar-list read access and event access needed for the selected writable calendar; document the Google consent scopes in deployment setup. Encrypt refresh/access credentials in PostgreSQL, never expose them to MCP or history. One selected writable calendar per workspace. Calendar selection and account consent happen in the website.

Google is authoritative for timing, timezone, title and cancellation of provider events. Lessons own plan, notes, material links and student association; imported events do not automatically become lessons. A selected event/recurrence occurrence may link to at most one lesson, and a lesson to at most one event. Calendar event changes never rewrite lesson notes.

## Read synchronization

Initial full sync stores event identity, ETag, recurrence identity, start/end/timezone, title and cancellation state. Follow all pages and only commit the new sync token once the complete change batch is persisted. Then poll every 5 minutes with jitter; a manual refresh queues the same deduplicated sync. Google errors and last-success time remain visible. Push/webhook infrastructure is deferred.

Use a stable provider-compatible sync query (no rolling time bounds with sync tokens), preserving its parameters across pagination. Retain recurring master/exception information and obtain expanded occurrences for bounded timetable requests; cache occurrence identities for linking. Full sync and incremental sync never hard-delete lessons. A provider 410 resets the calendar cache through a new sync generation, preserving local lesson associations until reconciliation confirms missing events. Do not display a partially refreshed cache as fully synchronized.

Calendar lists return at most a 93-day interval. Display date-only all-day events without converting them to midnight UTC. Create/reschedule only timed events in MVP. Store IANA timezone plus offset-aware start/end instants; validate end > start. Reject nonexistent local DST times and require an explicit offset for ambiguous times.

## Write and conflict handling

Create/reschedule linked events via durable CalendarOperation and job records. Require current local revision and expected provider ETag for edits. Read/check Google state and use conditional update (`If-Match`) to prevent racing writes. A 412 or changed event becomes external_conflict; sync latest state, show both intended/current values and require a new intentional operation. Never silently overwrite or force-retry with a new ETag.

Choose a deterministic valid Google event ID from the operation UUID on create. A retry that encounters an existing ID fetches and verifies the matching operation marker before treating it as success. Google success followed by database failure is reconciled by ID/marker; no duplicate event is created. Pending/unknown outcomes remain visible until resolved. Schedule changes become confirmed only after provider success and local persistence.

Create events without attendees and do not send invitations. Reject rescheduling an existing event with attendees in MVP to avoid unintended communications; the tutor edits it in Google and sync imports the result. Do not add conferencing or send automatic notifications. Existing meetings can be viewed/linked. Recurring series rules remain Google-managed; only individual occurrences without attendees may be rescheduled using the provider occurrence ID. Do not patch the recurring master through an occurrence tool.

Disconnect revokes/deletes stored provider credentials, cancels queued writes and preserves lesson data. Check connection generation immediately before each external write; an in-flight provider request may still complete, and its result must be recorded transparently. Switching selected calendars requires explicit disconnection/reconnection, leaving prior links marked disconnected.

## Undo

Successful calendar operations retain safe before/after projections and resulting ETag. Reversal creates a new operation; check the current Google ETag still matches the original operation's result. Undo of create cancels/deletes that event only after the same conflict check. Undo of reschedule restores prior timing; undo of a purely local link only restores linkage. Any new provider changes block compensation. Sent or already observed effects cannot be recalled.

## Official references

[Incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [event creation](https://developers.google.com/workspace/calendar/api/guides/create-events), and [conditional modification](https://developers.google.com/workspace/calendar/api/guides/version-resources) define provider behavior. The polling cadence, attendee restriction, command queue and conflict UI are project decisions.
