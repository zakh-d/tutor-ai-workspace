# MCP contract and agent workflows

## Connection and design

Remote endpoint: `https://<app-host>/mcp`, Streamable HTTP, Keycloak authorization as defined in [security](security.md). Tools expose domain operations, not arbitrary SQL, filesystem access, shell commands or network fetches. All tools use the same service schemas as [REST](rest-api.md). Tools return structured content; potentially large text is bounded. Tool descriptions identify read-only, mutation and external-effect behavior. Annotations help clients but are not security controls.

At connection, `workspace_get` reports workspace name/timezone and read-only `timezone_configured` preference provenance, capability flags, configured limits and contract version `1`. Do not include credentials or imply the agent has tools it was not granted. Every call derives workspace and client identity from the token.

## Types and shared fields

`Id`, `Revision`, `Instant`, `HomeworkContent`, `Assessment`, `SourceRef` and `FlashcardContent` are defined in [REST](rest-api.md). List input `Page = {cursor?: string, limit?: integer=25}` has maximum limit 100. Mutation input includes `idempotency_key: UUID`; updates/actions additionally include `expected_revision: Revision`. Creation omits expected_revision. Sync enqueue does not need an aggregate revision; grade-proposal creation uses expected_submission_revision. Publication uses the template revision; access/assignment actions use assignment revision; conversion retry uses the material revision; calendar writes use the local event revision plus ETag. Undo uses expected_current_revision instead of expected_revision. All identifiers are explicit; tools never select a student by ambiguous display name.

Read outputs are `{data: ...}` or `{items: [...], next_cursor: string|null}`. Mutation outputs are `{data, revision, operation_id}`; asynchronous outputs include `{operation_id, job_id, status:"pending"}`. Domain failures return MCP tool results with `isError: true` and structured `{error:{code,message,retryable,details},request_id}` using REST error codes. Protocol errors remain protocol errors; missing/expired authentication is handled at transport level.

## Tool inventory

For families below, each named operation is a separate tool. No unrestricted generic method-dispatch tool is exposed.

| Tools | Typed arguments beyond shared fields | Permission |
| --- | --- | --- |
| `workspace_get` | none | workspace:read |
| `workspace_search` | q:string, types?:enum[], Page | workspace:read |
| `students_list`, `students_get` | Page + archived?; or student_id:Id | workspace:read |
| `students_create`, `students_update`, `students_archive`, `students_restore` | Student fields from REST; update/archive/restore require student_id | workspace:write |
| `lessons_list`, `lessons_get` | Page + student_id?/status?/schedule_id?; or lesson_id | workspace:read |
| `lessons_create`, `lessons_update`, `lessons_archive`, `lessons_restore` | Lesson fields; existing lesson_id | workspace:write |
| `schedules_list`, `schedules_get` | Page + student_id?/archived?; or schedule_id | workspace:read |
| `schedules_create`, `schedules_update`, `schedules_archive`, `schedules_restore` | Schedule fields from REST; existing schedule_id and expected_revision for mutations | workspace:write |
| `schedules_generate` | schedule_id, through_date, expected_revision; shared idempotency_key | workspace:write |
| `tasks_list`, `tasks_get` | Page + student_id?/status?/due_before?; or task_id | workspace:read |
| `tasks_create`, `tasks_update`, `tasks_archive`, `tasks_restore` | Task fields; existing task_id | workspace:write |
| `materials_list`, `materials_get` | Page + student_id?/lesson_id?; or material_id | workspace:read |
| `materials_read_chunks` | material_id, artifact_id, start:int=0, count:int=5 (max 20) | workspace:read |
| `materials_create`, `materials_update`, `materials_archive`, `materials_restore` | Metadata from REST; existing material_id | workspace:write |
| `materials_write_markdown` | material_id, source_artifact_id, markdown:string (max 200,000 chars) | workspace:write |
| `materials_retry_conversion` | material_id, material_version_id | workspace:write |
| `homework_list`, `homework_get` | Page; or template_id | workspace:read |
| `homework_create`, `homework_update`, `homework_archive`, `homework_restore` | HomeworkContent; existing template_id | workspace:write |
| `assignments_publish` | template_id, student_id, lesson_id?, due_at?, expires_at?, public_attachment_ids:Id[] | assignments:publish |
| `assignments_list`, `assignments_get` | Page + student_id?; or assignment_id | workspace:read |
| `assignments_update` | assignment_id, due_at?, status?:open/closed | assignments:publish |
| `assignments_revoke_access`, `assignments_replace_access` | assignment_id, expires_at? (replacement only) | assignments:publish |
| `submissions_list`, `submissions_get` | assignment_id + Page; or submission_id | workspace:read |
| `submission_files_read_text` | submission_id, file_id, start:int=0, count:int=5 | workspace:read |
| `grading_propose` | submission_id, expected_submission_revision, Assessment | grading:propose |
| `grading_update_proposal` | proposal_id, Assessment | grading:propose |
| `flashcards_list`, `flashcards_get`, `flashcards_export` | Page; or flashcard_set_id | workspace:read |
| `flashcards_create`, `flashcards_update`, `flashcards_archive`, `flashcards_restore` | FlashcardContent; existing flashcard_set_id | workspace:write |
| `calendar_event_get` | event_id | calendar:read |
| `calendar_status`, `calendar_events_list` | none; or start:Instant,end:Instant + Page | calendar:read |
| `calendar_create_event` | lesson_id, expected_lesson_revision, title,start,end,timezone | calendar:write |
| `calendar_reschedule_event` | event_id, expected_etag:string, start,end,timezone | calendar:write |
| `calendar_link_event`, `calendar_unlink_event` | event_id, lesson_id, expected_lesson_revision | calendar:write |
| `calendar_sync` | none | calendar:write |
| `calendar_operation_get` | operation_id | calendar:read |
| `jobs_get` | job_id | workspace:read |
| `history_list`, `history_get` | entity_type?/entity_id?/operation_id? + Page; or revision_id | history:read |
| `history_undo` | target_revision_id, expected_current_revision | history:undo plus original action permission |

Event list requires range <=93 days. `materials_read_chunks` returns at most 40,000 characters, `artifact_id`, chunk ordinals, warnings and next_start. `submission_files_read_text` uses the same bounds and already-queued background extraction for PDF/DOCX/TXT; PNG/JPEG return `text_unavailable` with file metadata, never fabricated text. If extraction is pending, return its job ID rather than enqueueing work in a read tool. Original file download remains available through authorized REST; binary upload through MCP is deferred. Agent-authored Markdown operates on an existing material artifact; new original uploads use the website/REST.

`jobs_get` may report only jobs in the current workspace and redacts credential-bearing payloads. MCP cannot initiate Google account consent, release grades, reopen student submissions, permanently delete data, change ownership, or bypass archive/link invariants. Missing an MCP tool must not create an alternate unrestricted REST authorization path.

## Examples

```json
{"tool":"materials_read_chunks","arguments":{"material_id":"11111111-1111-4111-8111-111111111111","artifact_id":"22222222-2222-4222-8222-222222222222","start":0,"count":1}}
```

```json
{"data":{"artifact_id":"22222222-2222-4222-8222-222222222222","chunks":[{"ordinal":0,"heading":"Past tense","text":"Lesson content..."}],"warnings":[],"next_start":null}}
```

```json
{"error":{"code":"revision_conflict","message":"The task changed after it was read.","retryable":false,"details":{"current_revision":5}},"request_id":"req-example"}
```

For a conflict, reread, compare and submit an intentional new mutation with a new key. Do not blindly overwrite using the latest revision. For network failures or retryable provider responses, repeat the identical request/key or poll the returned operation; never create duplicate work under fresh keys.

## Agent workflows

**Generate homework:** find student by query, select ID, read goals and recent lessons, retrieve bounded material chunks, create structured questions with valid source refs, and publish to that student. Publication returns a link once; tutor shares it manually. No server tool performs inference.

**Suggest assessment:** read the immutable submission and available extracted attachment text; write an assessment proposal citing the attempt. Report unprocessed image content as unassessed. The tutor reviews and releases through the website.

**Repair:** inspect history for the operation and current revision, then call undo. Explain any conflict. Calendar undo returns a compensating operation to poll. Assignment publication undo closes/revokes access but preserves submissions.

**Flashcards:** retrieve source chunks, write a card set, export TSV and return it to the tutor. Exports are deterministic; generation remains external.

MCP acceptance requires one pinned reference client and at least one real external client passing [validation](validation.md). Record versions and limitations during implementation rather than asserting interoperability now.

Native schedules and optional student/lesson timezone fields use the [REST contract](rest-api.md). Generate concrete bounded lessons before preparing them; move/cancel one lesson with `lessons_update`, preserving schedule provenance. Inspect skipped DST dates and never claim they were scheduled. Google-linked timing continues through calendar operations.
