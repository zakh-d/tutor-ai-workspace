# Acceptance scenarios and traceability

**Status:** this is the acceptance specification. [Implementation status](implementation-status.md) records executed tests and remaining gates; scenarios below must not all be assumed passed because a subset is covered.

## Scenarios

| ID | Scenario and expected result |
| --- | --- |
| T01 | Two tutors with overlapping names/data attempt cross-workspace REST/MCP IDs, foreign references, pagination cursors, search, object downloads, history and job reads. All are denied or not_found; workers never process resources under the wrong workspace. Keycloak/app schema roles cannot read each other's tables. |
| T02 | Valid tutor and MCP login; wrong issuer/audience/expired token; agent request to tutor-only routes; token refresh; unknown client/redirect. Correct profile works; others fail without fallback. FastMCP mount survives startup/shutdown and metadata discovery; record versions for reference and external clients. |
| T03 | Create/update retries with same key yield one change; different payload/key reuse conflicts. Missing expected revision is rejected. Concurrent edits permit exactly one winner; stale client rereads rather than overwrites. |
| T04 | Restore last edit and archive, undo create, retained material version, publication undo after student submission, excluded undo target, newer-change conflict. New audit revisions retain originals/submissions; revoked links stay revoked; grades cannot be released through undo. |
| T05 | Text PDF/PPTX/DOCX/MD/TXT fixtures convert with original checksums retained; scans/diagrams produce warning/failure rather than fabricated text. Invalid/encrypted files fail visibly. Corrections/reuploads create new artifacts; old citations still resolve. |
| T06 | Oversized/spoofed/macro-enabled input, decompression bomb, converter timeout, concurrent quota reservation, cross-workspace file IDs, private bucket probes and session expiry during download. Reject safely; no arbitrary network fetch or executable rendering. |
| T07 | Worker dies before/after external object write; lease expires; stale worker resumes; duplicate job/retry arrives; S3 temporarily fails. Fencing/idempotency produce one active result, visible failure/recovery and cleanup of only unreferenced staging objects. |
| T08 | Google initial multi-page sync, incremental changes/deletions, token expiry, reauthorization, 410 full-reset, rate limits and disconnect during work. Preserve lesson content and show current pending/error/last-sync state. |
| T09 | Event create response lost then retried; provider success before DB failure; ETag race; calendar undo after external edit; recurring occurrence, all-day display, DST ambiguity/nonexistent time, attendee-bearing event. No duplicate event or silent overwrite; reject unsafe/unsupported edits and preserve series. |
| T10 | Publish, lose response/replay, replace/revoke/expire link, forward link, cross-assignment file request, invalid token/session and cache/referrer inspection. Exactly one pinned assignment; explicit replacement for lost token; access restricted to that assignment, no keys/private notes or token leaks. Forwarded valid link works as disclosed. |
| T11 | Concurrent autosave conflict, wrong question/option, upload too many files, duplicate submit, late submit, closed assignment, reopen and resubmit after template edit. Verify the public API returns 422 for whitespace-only required written responses and retains the draft revision, then accepts a corrected answer. Reject whitespace-only required written responses on finalization while permitting incomplete drafts and optional blank answers; preserve nonblank text verbatim. Retain old immutable attempt; current draft uses pinned content; one final attempt per opening. |
| T12 | Exact single/multiple-choice scoring including unanswered optional questions; agent proposes written/file grades; agent calls release/reopen REST or undo; tutor releases partial/stale/current proposal and corrects release. Only complete current tutor-authorized releases appear publicly; prior results retained. |
| T13 | Flashcards with tabs/newlines, Unicode, blank fields and invalid references. Export deterministic UTF-8 TSV with two fields per line and no hidden source data; import manually using Quizlet's supported delimiter flow. |
| T14 | Compose boots using one logical PostgreSQL database and separate schemas plus MinIO; migrations, readiness, restart, backup restore, private ports and redacted logs work. No Redis, second database, hosted LLM, or custom identity store. Restored object references resolve. |
| T15 | Tutor creates student, lesson and task; links materials, filters due tasks, archives/restores and navigates keyboard/mobile forms with recoverable error. Progress shows linked lessons/submissions/released results; no inaccessible student portal implied. |
| T16 | Tutor creates student and uploads lesson → agent retrieves bounded cited context → authors/publishes homework → student submits quiz/writing/file → agent proposes grade → tutor releases → student views feedback → tutor asks agent to fix an edit through history. Verify provenance, immutable content and authority at every step. |
| T17 | Verify browser-default teacher timezone persists only while unset; configured UTC and non-UTC choices survive reload/browser changes. Settings permits saving an unchanged timezone when configuration is unset, including UTC; an already configured unchanged preference disables Save. Verify Settings, searchable mobile timezone selection, red required asterisks and invalid outlines with textual errors. Overview loads all lesson pages, sorts across students by start instant, and filters Today/Tomorrow by teacher-local calendar date across DST; All includes unscheduled plans last. Sort/filter before limiting the overview to five visible lessons; resolve student profiles only for visible lesson/task rows, and render nonempty panels with or without an explicit limit. Concise 24-hour teacher/student displays retain different dates and timezone details. Set/clear student IANA timezone; reject invalid zones; show teacher/student times across date boundaries and DST in scheduling/deadline flows. Generate Monday/Friday local lessons across DST, replay/overlap safely, reject stale revisions/cross-workspace references, move/cancel/archive one occurrence and regenerate without duplicates or resets. Rule edits affect ungenerated dates only; schedule archival stops generation; DST gaps/overlaps report skipped dates. Google-linked timing cannot be changed locally. |

## Requirement coverage

Each row names the governing spec, architectural decision, implementation phase and acceptance scenarios. Product feature IDs are defined in [product](product.md).

| Requirement | Specification | Decision | Backlog phase | Scenarios |
| --- | --- | --- | --- | --- |
| F01 Students and progress | [Product](product.md), [model](data-model.md) | [ADR-002](adr/002-storage.md), [ADR-003](adr/003-identity.md) | P1, P4 | T01, T15, T16 |
| F12 Student timezones and native recurring schedules | [Calendar](calendar.md), [REST](rest-api.md), [model](data-model.md) | [ADR-010](adr/010-student-timezones-and-schedules.md), [ADR-013](adr/013-scheduling-usability.md) | P1, P3 | T01, T03, T09, T15, T17 |
| F02 Lessons and links | [Product](product.md), [model](data-model.md) | [ADR-001](adr/001-monolith.md), [ADR-007](adr/007-calendar.md), [ADR-013](adr/013-scheduling-usability.md) | P1, P3 | T09, T15, T16, T17 |
| F03 Materials/conversion/search | [Materials](materials-and-jobs.md) | [ADR-002](adr/002-storage.md), [ADR-004](adr/004-processing.md) | P2 | T05, T06, T07 |
| F04 Google timetable/two-way sync | [Calendar](calendar.md) | [ADR-007](adr/007-calendar.md) | P3 | T08, T09 |
| F05 Tutor tasks | [Product](product.md), [REST](rest-api.md) | [ADR-001](adr/001-monolith.md), [ADR-005](adr/005-history.md) | P1 | T03, T15 |
| F06 AI-authored reusable homework | [Assignments](assignments.md), [MCP](mcp.md) | [ADR-006](adr/006-assignments.md), [ADR-008](adr/008-agent-boundary.md) | P4, P5 | T10, T16 |
| F07 Link access/files/no portal | [Assignments](assignments.md), [security](security.md) | [ADR-006](adr/006-assignments.md) | P4 | T06, T10, T11 |
| F08 Scoring/proposals/tutor release | [Assignments](assignments.md), [security](security.md) | [ADR-006](adr/006-assignments.md), [ADR-008](adr/008-agent-boundary.md) | P4, P5 | T12, T16 |
| F09 Quizlet export | [REST](rest-api.md), [MCP](mcp.md) | [ADR-008](adr/008-agent-boundary.md) | P4, P5 | T13 |
| F10 Version history and agent undo | [History](history.md) | [ADR-005](adr/005-history.md) | P1, P3, P4 | T03, T04, T09 |
| F11 Autonomous scoped MCP | [MCP](mcp.md), [security](security.md) | [ADR-003](adr/003-identity.md), [ADR-008](adr/008-agent-boundary.md) | P0, P5 | T01, T02, T12, T16 |
| Python/uv/FastAPI/FastMCP/React | [Architecture](architecture.md) | [ADR-001](adr/001-monolith.md) | P0 | T02, T14 |
| Keycloak; no custom identity | [Security](security.md) | [ADR-003](adr/003-identity.md) | P0 | T01, T02 |
| Single DB plus S3; simple monolith | [Architecture](architecture.md) | [ADR-001](adr/001-monolith.md), [ADR-002](adr/002-storage.md) | P0, P2 | T07, T14 |
| Durable background jobs | [Materials](materials-and-jobs.md) | [ADR-004](adr/004-processing.md) | P2 | T07 |
| No server-side LLM | [Product](product.md), [MCP](mcp.md) | [ADR-008](adr/008-agent-boundary.md) | P0–P5 | T14, T16 |
| Private workspaces/English/timezones | [Product](product.md), [security](security.md), [calendar](calendar.md) | [ADR-003](adr/003-identity.md), [ADR-007](adr/007-calendar.md) | P0, P1, P3 | T01, T09, T15 |
| All requirements/decisions in Markdown | [README](../README.md), this matrix | [ADR index](adr/README.md) | Documentation, maintained P0–P5 | Documentation link/coverage review |

## Documentation review checklist

Verify all relative links resolve; every F01–F12 feature has a row; every ADR and phase is linked; test IDs are unique; accepted/deferred choices are distinguished; interfaces agree on actor authority, mutation preconditions and state transitions. Read through T16 against the contracts, especially lost secret-link responses and grading/undo boundaries. Do not describe these planned scenarios as executed application tests.

## Repeatable scheduling gates

CI runs `SCHEDULING_INTEGRATION=1 uv run pytest -q tests/test_scheduling.py` against its migrated PostgreSQL service, in addition to the full unit suite and frontend tests/build. This gate does not require MinIO or Google. Feature-specific tests exercise recurrence, daylight saving boundaries, mutation preconditions and independent occurrence changes; frontend tests exercise conversion and labelled displays. Live provider acceptance remains T08/T09 and requires Google credentials.

## Proposed Kubernetes acceptance

The [k3s plan](kubernetes-deployment-plan.md) identifies additional release checks for image/tag repeatability, manifest validation, migration failure ordering, shared realm/bucket isolation, ingress/MCP transport and coordinated restore. These checks are pending and do not supersede T14 until the topology ADR is accepted. Repository inspection does not establish live cluster readiness.

Container packaging/release (P0/P5, T02/T14): [ADR-011](adr/011-container-release-pipeline.md) and [release checks](../infra/release/README.md) add deterministic CI regression gates for source identity, build failure ordering, registry failures, reruns and digest/tag disagreement. Frontend tests cover deployment identity and exact same-origin callback. Actual GitHub/GHCR publication, homelab shared realm and deployed MCP remain separate acceptance gates.

Semantic releases (P0/P5, T14): [ADR-012](adr/012-semantic-release-tags.md) defines first release and major/minor/patch selection. The existing CI unittest gate now verifies numeric version ordering, commit-message precedence, stable-tag filtering, semantic image conflicts, retries and real Git v0.1.0 → v0.2.0 publication. Authenticated GHCR semantic image copying remains unexecuted until the first repository push.

CI PostgreSQL bootstrap regression (P0, T14): before migration the workflow prepares the disposable app schema and role search path using `infra/ci-database.py prepare`. It applies migrations twice and runs `infra/ci-database.py verify`, which fails on missing app tables, misplaced public tables, incorrect role search path or invalid migration version state. The existing PostgreSQL scheduling tests then exercise the resulting runtime configuration. This gate does not establish production least-privilege role isolation or live MinIO/Keycloak compatibility.
