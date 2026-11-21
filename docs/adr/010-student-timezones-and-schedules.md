# ADR-010 — Student timezones and local recurring lesson schedules

Status: Accepted; partially supersedes ADR-007's Google-only scheduling boundary.

Date: 2026-11-21

## Context

Tutors and students often live in different timezones. A weekly agreement such as Monday and Friday at 18:00 must retain its intended local clock time across daylight saving changes, while allowing one lesson to move or be cancelled without changing the agreement. Requiring Google consent for this basic workflow prevents independent use.

## Decision

Students have an optional validated IANA timezone, with the workspace timezone as the fallback for existing profiles. Tutor-facing student-related instants show separately labelled teacher and student dates/times, including timezone names. Input previews use the same conversion and include dates when the two locations fall on different days.

Store local recurring schedules as workspace-scoped, revisioned JSONB aggregates using the existing shared REST/MCP service. Each schedule belongs to one student and records weekdays, local start time, IANA timezone, duration, inclusive start date and optional inclusive end date. The chosen schedule timezone is explicit: changing a student's profile timezone does not silently move an existing agreement.

An explicit generation action materializes at most 93 calendar days per request into concrete planned lessons. A monotonic generated-through date and stable schedule/date provenance prevent regeneration of moved, cancelled or archived occurrences. Generation and its watermark commit in one transaction under the schedule revision lock. Rule edits affect only dates not generated yet; materialized lessons retain their own timing and history. Archiving a schedule stops generation and preserves lessons. There is no background infinite expansion or implicit Google event creation.

Recurrence uses local wall time. A daylight saving gap or overlap is skipped and reported by date rather than silently choosing an instant. Tutors can add an explicit-offset one-off lesson for such a date. Concrete lesson durations represent elapsed minutes. Individual local lessons can be rescheduled or cancelled through ordinary revision-checked updates. Google-linked lessons continue to use provider operations and ETag conflict checks; local timing writes cannot bypass Google authority.

## Alternatives

Google-managed series remain available for existing integrations, but require external consent and do not cover standalone scheduling. Storing repeating UTC instants would shift local weekly start times at daylight saving transitions. Virtual occurrences with exception overlays complicate existing lesson materials, history and links; concrete bounded lessons reuse those workflows.

## Consequences and validation

Tutors explicitly generate another bounded batch when needed. Editing a recurring agreement does not retroactively move already generated lessons. There are no invitations, notifications or automatic provider writes. Existing records need no physical migration because additions use optional typed JSONB fields.

T17 covers timezone validation, different dates, daylight saving, weekday generation, replay/overlapping requests, revision/isolation boundaries, and preservation of moved/cancelled lessons. Existing CI runs deterministic frontend tests and backend tests; a PostgreSQL scheduling gate exercises persisted behavior. Live Google acceptance remains separate from native schedules. See [calendar](../calendar.md), [REST](../rest-api.md), [MCP](../mcp.md), and [validation](../validation.md).
