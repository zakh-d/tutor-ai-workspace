# REST API contract

## Common types and behavior

Base path `/api/v1`; JSON UTF-8. `Id = UUID`, `Instant = RFC3339 timestamp with offset`, `Revision = positive integer`. Date-only calendar values are distinct from instants. Objects expose `id`, `revision`, timestamps and `archived_at` where applicable. Request schemas reject unknown fields. Markdown renders through a safe renderer with raw HTML disabled.

Lists accept `cursor?: string`, `limit?: integer` (default 25, maximum 100), declared filters and stable sorting by `(created_at,id)`. Return `{items: [...], next_cursor: string|null}`. Cursors are opaque and bound to workspace/filter context. Full-text search accepts `q` up to 500 characters and type filters. Material reads use chunk indexes rather than returning entire libraries.

All authenticated state-changing requests require `Idempotency-Key: UUID`. Updates/actions on an existing mutable aggregate also require `If-Match: "<revision>"`; creation does not. MCP equivalents are explicit fields. Missing preconditions return 428; mismatch returns 409. The same key, client and identical canonical payload replay the stored outcome; a different payload returns `idempotency_conflict`. Keys retain outcome references for the life of the workspace. Secret-bearing responses are the exception described in [assignments](assignments.md). OAuth callbacks use single-use state/code validation instead of mutation headers. Calendar sync enqueue and creation of a proposal/job use idempotency keys but do not require an aggregate If-Match; proposal creation explicitly checks expected_submission_revision. Credential disconnect and calendar selection use the connection revision.

Success: 200 read/update/action; 201 create; 202 asynchronous operation with `{operation_id, job_id, status}`. Changes return `{data, operation_id, revision}`. Failures use `{error: {code, message, retryable, details}, request_id}` without stack traces or sensitive values. Additional recovery codes are undo_not_supported (409), no_extractable_text/text_unavailable (422) and link_unavailable (a successful replay flag, not an HTTP error). Codes map to HTTP: unauthenticated 401; forbidden 403; not_found 404; revision_conflict/idempotency_conflict/invalid_state/external_conflict 409; precondition_required 428; validation_error 422; payload_too_large 413; rate_limited 429; provider_unavailable 503. Retry-After accompanies transient throttling. A timeout is not proof of failure; replay with the same key.

## Resource routes

Paths below are relative to `/api/v1`; braces denote UUIDs. `GET collection`, `POST collection`, `GET /{id}`, `PATCH /{id}`, `POST /{id}/archive` and `POST /{id}/restore` are the standard lifecycle routes where marked CRUD. Archive/restore increments revision; DELETE is not exposed.

| Route family | Inputs and operations |
| --- | --- |
| `/workspace` | GET settings; PATCH name/timezone. Owner identity is immutable. |
| `/students` | CRUD; display_name (1–200 chars), contact?, subject?, level?, goals?, notes?, timezone? (validated IANA, null/omitted uses workspace). Filters: archived. |
| `/lessons` | CRUD; student_id, title, plan?, notes?, status, material_ids[], starts_at?/ends_at? (offset-aware pair), timezone? (required for timed lessons). Read-only schedule_id/occurrence_date provenance. Filters: student_id/status/schedule_id/archived. Calendar linkage uses the calendar routes. |
| `/schedules` | CRUD; student_id, title, weekdays[] (unique 0 Monday–6 Sunday), local_start (HH:MM), timezone (IANA), duration_minutes (integer 1–1440), start_date, end_date? (inclusive dates). Filters: student_id/archived. Server-owned generated_through. POST `/{id}/generate` with `{through_date: date}` and current If-Match. |
| `/tasks` | CRUD; title, description?, due_at?, status, student_id?, lesson_id?. Filters: student_id/status/due_before/archived. |
| `/materials` | CRUD metadata; title, description?, tags[], student_ids[], lesson_ids[]. GET `/{id}/versions`; POST `/{id}/versions` multipart upload; GET `/{id}/chunks?artifact_id=&start=&count=`; GET `/{id}/original?version_id=`; POST `/{id}/markdown-corrections` with source_artifact_id and Markdown; POST `/{id}/retry-conversion` with version_id. |
| `/search` | GET q/types/cursor/limit; returns record metadata, safe excerpt and material artifact/chunk references. |
| `/homework-templates` | CRUD using HomeworkContent below; GET `/{id}/versions`; POST `/{id}/publish` with student_id, lesson_id?, due_at?, expires_at? and public_attachment_ids[]. Creates assignment and access link. |
| `/assignments` | GET list/detail; PATCH due_at/status; POST `/{id}/revoke-access`; POST `/{id}/replace-access`; GET `/{id}/submissions`; POST `/{id}/reopen` (tutor-only). No edits to pinned content. |
| `/submissions/{id}` | GET answers/file metadata/objective result; GET `/files/{file_id}` authorized download; POST `/grade-proposals`; GET `/grade-proposals`. |
| `/grade-proposals/{id}` | GET/PATCH draft per-question assessment; immutable attempt reference. |
| `/submissions/{id}/release-grade` | POST tutor-only, proposal_id + expected_proposal_revision, expected_submission_revision, expected_assignment_revision and optional edited assessment. Creates immutable release; If-Match refers to current assignment revision. |
| `/flashcard-sets` | CRUD title/cards/source_refs/lesson_id?; GET `/{id}/export` as TSV. |
| `/calendar/connection` | GET status; POST `/authorize` returns Google consent URL; GET `/callback` verifies state and exchanges code; PUT selected calendar_id after consent; POST `/disconnect`. Credentials never returned. |
| `/calendar/calendars` | GET selectable calendars and access roles after consent. |
| `/calendar/events` | GET bounded start/end range, maximum 93 days; POST lesson_id/title/start/end/timezone; PATCH `/{id}` reschedule with expected_etag; POST `/{id}/link` lesson_id; POST `/{id}/unlink`. |
| `/calendar/sync` | POST schedules deduplicated sync; GET `/calendar/operations/{id}` shows operation result. |
| `/jobs/{id}` | GET state, progress and sanitized error; POST `/retry` only for allowed failed job types. |
| `/history` | GET filters entity_type/entity_id/operation_id; GET `/{revision_id}` before/after; POST `/undo` target_revision_id + expected_current_revision. |

Lesson linking/unlinking also requires `expected_lesson_revision` and updates the lesson atomically with its calendar link. Local calendar-event writes increment local revision only when applied/observed; accepting a pending command does not pretend Google has changed. Job and operation polling require read authority, not a new mutation.

## Content schemas

`HomeworkContent = {title: string, instructions: string, questions: Question[], source_refs: SourceRef[]}`. Maximum 100 questions; each has a stable UUID `id`, `type`, `prompt`, `points` (integer 0–100), `required` (boolean, default true), and optional `source_refs`. Question types:

- `single_choice`: options `[{id: UUID, text: string}]`, 2–10 entries; private `correct_option_id` must match an option.
- `multiple_choice`: same options; private `correct_option_ids` is a nonempty unique subset.
- `written_response`: private rubric string, public `max_chars` (default/max 10,000).
- `file_upload`: private rubric string; public allowed_types and max_files constrained by platform limits.

`SourceRef = {material_id: Id, material_version_id: Id, artifact_id: Id, chunk_start: integer, chunk_end: integer}`. Ranges must exist and belong to that material/version/workspace. Reject unresolved or cross-workspace citations. Citation metadata does not grant students access to private source files.

`Assessment = {items: [{question_id: Id, awarded_points: integer, feedback: string}], overall_feedback: string}`. Points must be within question bounds; include each question exactly once for release. Objective awarded points must match the deterministic scorer in MVP. Draft proposals may omit questions; release may not.

`FlashcardContent = {title: string, cards: [{term: string, definition: string}], source_refs: SourceRef[], lesson_id?: Id}`. Maximum 500 cards and 2,000 characters per side. Export UTF-8, one tab between fields and newline between cards; replace embedded tabs/newlines with spaces, reject empty fields. No direct Quizlet API integration.

## Example

```http
PATCH /api/v1/tasks/11111111-1111-4111-8111-111111111111
If-Match: "3"
Idempotency-Key: 22222222-2222-4222-8222-222222222222
Content-Type: application/json

{"status":"done"}
```

```json
{"data":{"id":"11111111-1111-4111-8111-111111111111","status":"done"},"revision":4,"operation_id":"33333333-3333-4333-8333-333333333333"}
```

Public routes and capability request shapes are specified separately in [assignments](assignments.md). Generated OpenAPI must conform to these schemas; REST and MCP schema parity is a release gate.

## Native schedule generation

Generation returns the standard mutation envelope; `data` contains the updated schedule plus `generated_lessons[]` and `skipped_occurrences[]` (`occurrence_date`, `reason`: `nonexistent_local_time` or `ambiguous_local_time`). Scan from start_date or the day after generated_through, at most 93 calendar days per call, clamped by end_date. Persist lessons and watermark atomically; retries replay and overlapping calls never reset moved/cancelled/archived lessons. Rule edits affect only ungenerated dates. Schedule timezone is independent of later student timezone edits. Standard lesson updates move/cancel a local occurrence; linked provider timing must use calendar operations. See [ADR-010](adr/010-student-timezones-and-schedules.md).

Calendar event reads expose safe `lesson_id`/`student_id` associations when linked; `GET /calendar/events/{id}` reads a cached occurrence outside the current timetable range. The public assignment projection includes resolved `teacher_timezone` and `student_timezone` solely for deadline display.
