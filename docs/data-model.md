# Data model and state transitions

## Common conventions

Identifiers are UUIDs. Every application-owned record has a non-null `workspace_id`; workspace-scoped foreign keys include it, preventing cross-workspace references. Mutable domain aggregates have integer `revision`, UTC `created_at`/`updated_at`, and nullable `archived_at`. Expected revision checks and revision increments occur in the same transaction. Immutable artifacts, versions, attempts and audit entries cannot be edited through normal CRUD.

A workspace is uniquely owned by `(issuer, subject)` from a verified Keycloak token, with display name and IANA timezone. Workspace creation on first tutor login is idempotent. There is no application password, user directory or student identity account. Authorization never accepts a workspace ID from the caller as proof of ownership.

## Entities

| Entity | Fields and relationships |
| --- | --- |
| Workspace | Owner issuer/subject, name, timezone; one per tutor. |
| Student | Display name, optional contact JSON (email/phone), subject, level, goals, private notes and optional IANA timezone (workspace fallback). |
| Lesson | Student ID, title, plan Markdown, private notes Markdown, planned/completed/cancelled status; optional local starts_at/ends_at/timezone, immutable schedule_id/occurrence_date provenance, optional unique calendar event link. |
| Schedule | Student ID, title, weekdays (0 Monday–6 Sunday), local_start, IANA timezone, duration_minutes, inclusive start_date/end_date, server-owned generated_through; revisioned and archivable. |
| Task | Title, description, due_at, todo/in_progress/done status, nullable student_id/lesson_id; if both supplied they must agree. |
| Material | Title, description, tags, active material-version ID; student/lesson join tables allow reuse. |
| MaterialVersion | Material ID, immutable original object ID, format, conversion state, extracted-artifact ID, warnings, converter version; replacement upload creates a new version. |
| Artifact | Immutable object key, checksum, size, verified MIME, purpose and optional source version. Human correction creates a new extracted artifact. |
| MaterialChunk | Artifact ID, ordinal, heading, bounded text and full-text index; stable citations use artifact ID plus ordinal. |
| HomeworkTemplate | Title, instructions, editable question set and source refs; version snapshots made on publication. |
| HomeworkVersion | Immutable template revision snapshot including private answer keys and rubrics; separate public projection excludes them. |
| Assignment | Student ID, homework-version ID, nullable lesson ID, due_at, open/closed status, active attempt ID; published content is immutable. |
| AssignmentAccess | Assignment ID, token hash, expires_at, revoked_at; separate lifecycle from content revisions. |
| AssignmentSession | Assignment/access ID, opaque session-token hash, CSRF binding, expires_at; no student identity account. |
| UploadReservation | Workspace, optional attempt/question, reserved bytes, staged object key, pending/completed/expired status and expiry. |
| RateLimitBucket | Hashed IP/session key, action category, window and count; short-lived PostgreSQL data, no secondary store. |
| SubmissionAttempt | Assignment ID, attempt number, draft/submitted state, answer payload, submitted_at and revision; submitted attempts immutable. |
| SubmissionFile | Attempt ID, question ID, artifact ID; uploads accepted only for the current draft and pinned file question. |
| GradeProposal | Submitted attempt ID, source revision, per-question points/comments, tutor/agent provenance, draft/superseded status. |
| GradeRelease | Immutable submitted-attempt assessment, per-question scores/feedback and total, releasing tutor identity; new release supersedes the previous release. |
| FlashcardSet | Title, ordered term/definition pairs, source refs, optional lesson ID. |
| CalendarConnection | Workspace, provider account identifier, calendar ID, encrypted credentials, sync cursor, connected/reauth_required/disconnected status. |
| CalendarEvent | Calendar ID + provider event ID unique per workspace, ETag, recurrence identity, Google payload projection, sync state and deletion marker. |
| CalendarOperation | Operation ID, event link, desired change, before projection, expected ETag, pending/running/succeeded/conflict/failed status. |
| Revision | Aggregate type/ID, revision number, before/after JSON, actor subject/category, client ID, operation ID, timestamp, undo_of pointer. No credential/token content. |
| Operation | Actor/client/workspace, idempotency key + request hash, outcome/resource references, status. |
| Job | Type, workspace, operation ID, bounded payload of IDs, state, attempts, available_at, lease owner/expiry and sanitized error. |

Linking existing material to lessons/students is part of the owning aggregate revision. All source references must resolve to the same workspace; they name immutable artifacts/chunks, not mutable titles alone. Published homework includes public attachments explicitly selected for that assignment, never all linked lesson materials.

## State and relationship rules

- Archive is an attribute, not a destructive cascade. Referenced records and retained object versions remain available to authorized history readers. Archived parents cannot receive new children; existing submissions remain accessible.
- Material conversion: `queued → running → ready | ready_with_warnings | failed`; retry of a failed conversion returns to queued and keeps failure history. Empty extraction is failed, not ready.
- Jobs: `queued → running → succeeded`; retryable errors go to `retry_wait → running`; exhausted/permanent errors go to `failed`. Lease expiry allows reclaim without changing logical job identity.
- Publishing creates an assignment and pins an immutable homework version. Template edits never change it. Correcting assigned questions requires a new assignment/link and optional closure of the old one.
- Assignment closed prevents draft edits/submissions but permits reading released results while access is valid. Reopening a submitted assignment creates a new draft attempt copied from the last submission. The old attempt and grade release remain historical.
- Only the current attempt's released grade is shown as current feedback. Starting a new attempt hides old feedback from the default student view until a new release; tutors retain all history.
- Calendar connection disconnection preserves local lesson content and last sync data, but disables provider writes. Google deletion marks the event missing/cancelled and unlinks timing without deleting a lesson.

## Constraints and indexes

Unique indexes cover owner issuer/subject, workspace/provider event identity, workspace/aggregate/revision, assignment/attempt number, token hash and workspace/client/idempotency key. Index workspace with student/lesson associations, due dates, archive state and job eligibility. Claim jobs with row locks; use composite foreign keys and mandatory repository workspace filters, tested across every interface. A PostgreSQL row-level-security layer is deferred; correctness must not depend on UI filtering.

[Assignments](assignments.md), [history](history.md), and [calendar](calendar.md) define the authoritative transition semantics.

## Physical implementation note

The current backend uses typed JSONB aggregates for most logical entities and relational tables for workspaces, revisions, operations, blobs, jobs and capability records. JSONB relationships use shared service validation rather than SQL foreign keys. [ADR-009](adr/009-aggregate-persistence.md) records this implementation decision and its integrity/performance consequences; the entity table above remains the logical contract.
