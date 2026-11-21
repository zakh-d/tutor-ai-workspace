# Product requirements

## Audience and boundaries

Independent tutors each own one private workspace, even when many tutors share a deployment. Keycloak manages their identities. Students are tutor-managed records, not users. English is the initial UI language. Store instants in UTC and retain IANA timezones for display and scheduling; never assume the deployment host timezone.

The website must support the full non-generative workflow without an agent. AI generation occurs in the tutor's chosen external agent: the platform supplies context and accepts validated structured content. No embedded chat, model billing, or server-side inference is required.

## MVP capabilities

| ID | Capability and observable behavior |
| --- | --- |
| F01 | Students: create/edit/archive a profile with display name, optional contact details, goals, level/subject, and private tutor notes. Show linked lessons, assignments, and released results as progress history. |
| F02 | Lessons: title, student, plan, private notes, status (planned/completed/cancelled), linked materials and optional calendar occurrence. A lesson may exist before it is scheduled. |
| F03 | Materials: upload PDF/PPTX/DOCX/Markdown/text, retain originals and versions, view processing status/warnings, search extracted text, correct extracted Markdown, reuse across students and lessons. |
| F04 | Calendar: connect one writable Google calendar, view timetable, link existing events, create events, reschedule linked events, refresh, and surface conflicts/disconnection. Google owns event timing. |
| F05 | Tasks: title, description, optional due instant, todo/in_progress/done status, optional student and lesson links. Filter by status/student/due date. |
| F06 | Homework: tutor or agent authors reusable versioned templates with single-choice, multiple-choice, written-response and file-upload questions, points, private keys/rubrics and source references. |
| F07 | Assignment access: publish a template snapshot to one student; copy its secret link; set due date and expiry; revoke or replace the link. Student reads, saves drafts, attaches permitted files, and submits once until reopened. |
| F08 | Assessment: objective scoring is deterministic; tutor reviews written/file responses. Agent may propose grading, but only tutor can release grades and feedback. Released results appear on the same assignment page. |
| F09 | Flashcards: tutor/agent creates and edits term–definition sets, optionally linked to lesson/materials, and downloads Quizlet-importable TSV. |
| F10 | Recovery: show human/agent provenance, compare revisions, restore supported local changes, and report conflicts or irreversible external effects. |
| F11 | MCP: authorized external agents discover/read bounded context and perform scoped mutations, publication, calendar changes and undo; never release grades. |

## Main journeys

1. **Prepare a lesson:** sign in, add a student and goals, upload a deck, observe conversion, inspect warnings, create a lesson and attach material, then link or create a Google event.
2. **Delegate homework:** connect an MCP client; ask it for exercises for a student from selected lessons. Agent retrieves scoped context, cites material versions, writes a template, publishes an assignment and returns its unique link. Tutor shares it manually.
3. **Complete homework:** student opens the link on mobile, sees only assigned content, saves answers, uploads files, and finalizes. After finalization answers are read-only until tutor authorizes reopening.
4. **Review work:** objective scores are calculated but withheld from public view until release. Agent drafts written/file grading; tutor edits or accepts and releases. Student reopens the link to read released results.
5. **Repair agent work:** tutor asks agent what changed; agent inspects operation/revision history and restores a previous version. A newer edit produces a conflict; reversing calendar work requires a provider-version check.
6. **Plan the week:** tutor reviews lessons and open tasks in the website, adjusts a linked event or asks the agent to reschedule it, and sees synchronization outcome.

## Website surfaces

Dashboard (upcoming lessons, overdue/open tasks, jobs needing attention); students and student detail; lessons and lesson detail; material library and conversion preview; timetable and connection settings; task list; homework editor and assignment/submission detail; flashcard editor/export; activity/history; MCP connection instructions. Public assignment pages must be usable on mobile, keyboard-accessible, and expose clear draft/submitting/submitted/error states.

Forms preserve input on recoverable failures. Pending calendar and conversion operations are visibly pending rather than falsely successful. Linking archived records to new work is rejected; historical views retain existing links. Student archival does not delete submissions or silently revoke assignments: warn about active links and offer explicit revocation.

## Deferred

Teams/shared workspaces, Microsoft/Teams integration, payments, student accounts, email/SMS invitations, automated reminders, server-side LLMs, OCR, image/diagram reasoning, mathematical layout fidelity, semantic/vector search, recurrence series editing, group lessons, student file OCR, advanced gradebooks and analytics. The MVP progress view is an activity/result history, not an inferred mastery model.

Acceptance scenarios and requirement coverage are in [validation](validation.md); rollout ordering is in the [backlog](backlog.md).
