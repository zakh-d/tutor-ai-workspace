# Assignments, submissions and assessment

## Authoring and publication

Templates contain typed questions, private answer keys/rubrics and immutable material citations; see [content schemas](rest-api.md). Validate question IDs, options, points and source ownership before saving/publication. An agent may create, edit and publish without tutor confirmation. Publication atomically creates an immutable HomeworkVersion, an Assignment for one student and its first draft SubmissionAttempt. Repeated identical publication requests must not create duplicate assignments.

Only explicitly selected public attachments are available to students. Attachment IDs must be immutable artifacts owned by the tutor, within file limits, and deliberately included at publication. Citation metadata shown publicly consists of safe labels only; it never exposes private material download paths or hidden tutor notes.

Pinned questions, public attachments and answer keys cannot change after publication. Editing the template affects future assignments. To correct a published exercise, publish a replacement and optionally close/revoke the old assignment. Preserve the old content, submissions and grades. Due dates are informational; passing due marks submissions late but does not block them. Closing the assignment or expiring/revoking access blocks writes.

## Secret links and sessions

Generate 32 random bytes encoded as base64url; store SHA-256 of the token, never plaintext. Link format is `https://<app-host>/a/<assignment-id>#<token>` so the token does not enter normal HTTP request logs. The public page exchanges the fragment via POST, clears it from browser history, and stores no token in localStorage. The exchange creates a random opaque session cookie (`Secure`, `HttpOnly`, `SameSite=Strict`), whose hash, assignment/access ID and expiry are stored in PostgreSQL.

Default link expiry: 30 days after publication; tutor/agent may choose 1–180 days. Student session lifetime is at most 24 hours and never exceeds link expiry. Recheck access expiry/revocation on every request, including file downloads. Revocation invalidates all associated sessions immediately. Possession of the link grants access as the intended student; it does not verify their identity and a forwarded link can be used by others.

Raw links are returned once on creation/replacement and are not stored for later display. The tutor copies/shares the link immediately. On an idempotent replay after a lost response, return the existing assignment/access metadata with `link_unavailable: true`, never create a second assignment or store recoverable tokens. Caller may explicitly replace access to get a fresh link, revoking the old access and sessions. This deliberate exception to response replay preserves hash-only token storage. Do not log original secret-bearing responses.

Apply shared, PostgreSQL-backed rate limits: 30 exchanges/minute/IP and 60 draft writes/minute/session, configurable. Return 429 with Retry-After. No third-party page resources; exclude pages from indexing. Invalid, expired or revoked links show a generic unavailable page with instruction to contact the tutor.

## Public API

All routes are under `/public/v1`, independent of Keycloak. Exchange uses the link token; later calls use the capability cookie and CSRF token. No student identifier lookup or list endpoint exists. Assignment publication, access replacement/revocation, closure, reopening and grade release increment the assignment revision, so concurrent changes are checked consistently. Publication checks the template revision without editing its content and creates revision 1 on the new assignment.

| Route | Request and result |
| --- | --- |
| `POST /assignments/{id}/session` | `{token:string}` → sets session cookie, returns CSRF token and public assignment projection. Constant-time hash comparison. |
| `GET /assignment` | Current session's public instructions/questions/attachments, due/expiry, attempt revision/state, saved answers and released result if present. |
| `PATCH /attempt` | `{answers:[{question_id,value}]}` with If-Match and Idempotency-Key → saved revision. Reject unknown questions/options, wrong types and oversized text. |
| `POST /attempt/files` | Multipart question_id + file, with If-Match and key → file ID and new revision; enforce ownership, current draft and per-question limits. |
| `POST /attempt/files/{id}/remove` | With If-Match/key → detach from current draft only; retain originals if already referenced by a submitted attempt. |
| `POST /attempt/submit` | With If-Match/key → immutable final attempt; required answers must exist. No answers accepted in this request; save them first. |
| `GET /files/{id}` | Only pinned public attachments or the current assignment's own submitted/draft files, with live access check. |

Public DTOs are explicitly constructed; never serialize tutor models and merely remove a few fields. Exclude private keys/rubrics, private citations, student contacts, tutor notes, unreleased scores/proposals and all other assignments. Token exchange is idempotent in effect but may create a fresh bounded session; it is exempt from domain mutation keys. Store a maximum of 10 live sessions per access, expiring the oldest when necessary.

## Answer and attempt lifecycle

Single-choice value is one option UUID; multiple-choice is a unique UUID array; written response is a string; file question answers refer only to uploaded file IDs on the same attempt/question. Autosave uses expected revision. Concurrent browsers receiving a conflict must show the server draft and require reconciliation, never silently merge conflicting answers. Student drafts are editable until submission.

Drafts may retain empty or whitespace-only written responses. Finalization rejects required written responses containing only whitespace, consistently with the website; optional responses may remain blank and valid text is preserved verbatim. Finalization atomically validates required answers, freezes the attempt and calculates objective scores. Multiple-choice uses exact-set matching: full points for exact match, zero otherwise; single-choice requires exact match; no partial credit or negative points. Optional unanswered objective questions score zero. Written/file scores remain pending.

Tutor-only reopening creates a new draft attempt copied from the last submitted attempt, retaining references to immutable file objects. A subsequent submission creates a new final attempt and requires a new grade release. Agent tools cannot reopen. All prior submissions and releases remain visible to the tutor. Token expiry does not delete records.

## Grade proposal and release

Agents may propose bounded points and feedback for a submitted attempt, never for mutable drafts. Proposals identify that exact attempt; later attempts make prior proposals ineligible for current release. Tutor edits/accepts a proposal or grades manually. The server fills objective scores from the deterministic scorer and requires all questions assessed before release. An all-objective test still requires tutor release in MVP.

A release requires the first-party tutor client and tutor:review authority, plus current assignment/proposal/attempt revisions. Publishing creates an immutable GradeRelease, updates the assignment revision, and exposes only public feedback and scores. Correcting a release creates another tutor-authorized release, retaining the previous one. Agents cannot use undo to publish/revert a release. Raw answer keys/rubrics remain private even after release; tutor-written feedback may explain answers intentionally.

## Retention

Retain teaching content, revision history, immutable submissions, grades and referenced objects for the lifetime of the workspace in MVP. Archival is not erasure. Permanent deletion is not an agent or routine website feature. Before a production deployment, the operator must document an authenticated manual data-erasure/export procedure including references, objects and the 30-day backup expiry; the implementation backlog includes this operational gate.
