# ADR-009 — Typed aggregates in PostgreSQL JSONB

Status: Accepted implementation decision

Date: 2026-11-21

## Context

The logical entities in the data model are implemented as typed domain aggregates rather than one physical SQL table per entity. Identity, revisions, operations, files, jobs and capability access/session records remain separate relational tables.

## Decision

Store mutable domain aggregate payloads in a PostgreSQL JSONB records table with workspace, kind, revision and timestamps in relational columns. Pydantic models validate payloads; shared services validate referenced entity kind, ownership and lifecycle. Immutable published content/attempts use dedicated aggregate kinds and restricted service operations. REST and MCP share the same services.

## Consequences

This satisfies the single-database constraint and supports transactional audit/queue writes, but cross-aggregate references in JSONB are not protected by composite foreign keys. Service-level tenant/reference validation and adversarial integration tests are therefore mandatory. PostgreSQL full-text operations work, but normalized indexes and search pagination remain performance work before larger deployments. The data-model document describes logical entities, not an assertion of one table per row.

## Alternatives

Normalized relational tables remain the preferred future migration where constraint enforcement or measured performance warrants it. Such a migration must preserve IDs, immutable versions, revisions and capability associations. Do not silently substitute SQLite or relax ownership validation.

## Verification

See [implementation status](../implementation-status.md), [data model](../data-model.md) and PostgreSQL workflow tests under tests/. Production-scale load and exhaustive concurrent-reference integrity testing remain outstanding.
