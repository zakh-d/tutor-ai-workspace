# Revision history and recovery

## Audit and concurrency

Every successful tutor/agent domain mutation writes an immutable Revision in the same transaction as the affected aggregate. Record before/after state, revision number, verified actor subject, actor category (tutor/agent/system), OAuth client ID, operation ID and UTC timestamp. Failed attempts record a sanitized operation outcome but do not fabricate a successful domain revision. Provider synchronization records system provenance and changes provider projections only.

Retain domain revisions and idempotency records for the lifetime of the workspace. Keep credentials, access/session tokens, token hashes and sensitive transport headers out of before/after payloads. Revision views remain workspace-authorized and may contain private teaching content. Referenced immutable objects are retained; restoring content cannot point to a purged blob.

Use optimistic concurrency. A mutation atomically compares expected_revision, increments it and inserts its revision and required jobs. A transaction that fails rolls back all local side effects. The idempotency request hash includes action, resource, expected revision and body; identical retries return original outcome references. Generic undo targets one aggregate revision, not an unbounded multi-record rollback.

## Supported recovery

| Change | Recovery semantics |
| --- | --- |
| Student/lesson/task/template/card edit | Restore the target revision's before state as a new revision after current-state validation. |
| Create record | Undo archives it if doing so passes reference/link checks; never hard-deletes. |
| Archive record | Restore archived_at and prior content after checking references. |
| Material metadata/link/correction | Restore prior metadata/link or active artifact reference; keep all original and derived objects. |
| Assignment publication | Close assignment and revoke all access in one local transaction; preserve pinned content, attempts and grades. |
| Assignment due/status change | Restore the previous due/status under current-state checks; never restore a revoked/expired token. |
| Access revoke/replace | Not generically undoable. Explicit replacement produces new access after checking authority. |
| Grade proposal | Restore draft assessment only; cannot release it. |
| Grade release, reopen, student submission | No generic undo. Tutor correction/new attempt is explicit and preserves prior evidence. |
| Calendar write | Compensating provider job guarded by resulting ETag; see calendar specification. |
| Calendar link/unlink | Restore local lesson linkage under both aggregate revision checks. |
| Credential change, job status, sync cursor | Not user-undoable. Use disconnect/reconnect, job retry or resync operations. |

`history_undo(target_revision_id, expected_current_revision, idempotency_key)` verifies original-action permission plus history:undo, loads the target and confirms the aggregate is still at that target's after revision. If later edits exist, return revision_conflict; the agent must inspect them rather than erase them. Undo itself becomes the new head revision and references undo_of. Reversing an undo follows the same rule.

Current invariants still apply: an archived student cannot receive new work, cross-workspace links are forbidden, and immutable published content cannot be replaced by restoring a template. Linked aggregate changes require all expected revisions. Failure makes no partial local change. Bulk undo is deferred; an operation may list several affected revisions for separate inspection and supported recovery.

Calendar compensation is not a local transaction with Google. Its state is pending until confirmed, and conflicts/failures are visible. Do not claim local restoration means an external event was restored. Previously shared/downloaded content, invitations created outside this app, and information seen by a student cannot be recalled.

## User experience

Activity lists show who changed what, when, and whether external work is pending. Detail shows a readable diff and available recovery action. Preview supported before state and any caveat before executing undo in the website. Agents may execute supported undo autonomously and receive the new revision or a precise conflict. If the change is excluded, return `undo_not_supported` with the appropriate explicit recovery route, never silently approximate it.
