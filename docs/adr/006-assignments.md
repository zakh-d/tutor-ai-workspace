# ADR-006 — Immutable assignments and secret-link student access

Status: Accepted

Date: 2026-11-14

## Context

Students need to submit quizzes, writing and files without a portal, while tutors need reliable historical assessment evidence.

## Decision

Publish an immutable homework version for one student. Use random expiring/revocable secret links stored only as hashes, exchanged for assignment-scoped sessions. Preserve final attempts; reopening creates a new draft attempt. Score objective questions deterministically, withhold results until tutor release, and require tutor authority for all grade publication.

## Consequences

Anyone holding a valid link can act as the student; identity verification is absent by design. A lost one-time link response requires explicit replacement. Editing templates does not change assigned work. File storage, concurrency and public DTO filtering are part of the assessment boundary.

## Alternatives and deferred work

Student accounts/PINs, anonymous assignment directories, mutable published questions and automatic AI grade release are rejected for MVP. Advanced testing/anti-cheating features are deferred.

## Specifications and verification

[Assignments](../assignments.md), [security](../security.md), [model](../data-model.md). Validation: T06, T10, T11, T12.
