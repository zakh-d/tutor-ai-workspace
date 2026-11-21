# ADR-005 — Optimistic concurrency, revisions and compensating undo

Status: Accepted

Date: 2026-11-14

## Context

Agents should act autonomously, but tutors need to understand and reverse harmful changes without losing student evidence or overwriting newer edits.

## Decision

Require expected revisions and durable idempotency keys. Write before/after audit revisions transactionally. Restore supported changes as new revisions only when the target remains the current head. Archive instead of deleting. Preserve immutable submissions, published content and referenced files. Calendar undo uses guarded compensation.

## Consequences

History is not full event sourcing or arbitrary time travel. Some actions require explicit correction instead of generic undo. Tokens/credentials are excluded from snapshots; revoked capabilities never revive implicitly. Retained versions consume quota and require a future explicit erasure workflow.

## Alternatives and deferred work

Unconditional last-write-wins, destructive rollback and database restore as user undo are rejected. Bulk operation rollback and event-sourced reconstruction are deferred.

## Specifications and verification

[History](../history.md), [calendar](../calendar.md), [assignments](../assignments.md). Validation: T03, T04, T09, T11.
