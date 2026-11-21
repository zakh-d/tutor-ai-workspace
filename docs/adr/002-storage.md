# ADR-002 — One PostgreSQL database and private object storage

Status: Accepted

Date: 2026-11-14

## Context

The system is limited to one database plus S3-compatible storage, while requiring transactions, search, job durability and Keycloak persistence.

## Decision

Use one PostgreSQL instance and one logical database, with app and keycloak schemas and separate least-privilege roles. Store relations, revisions, operation keys, job queue, capability sessions and text indexes in PostgreSQL. Use MinIO for immutable versioned file objects. All domain relationships include workspace ownership.

## Consequences

No Redis, vector database or separate search cluster is needed. Database and object writes cannot share a transaction, so staging/reconciliation is required. Database backups and retained object versions must be restored together. Schema separation must be verified with pinned Keycloak configuration.

## Alternatives and deferred work

NoSQL is rejected because relational integrity and transactional revision/job writes fit SQL. Separate Keycloak databases and Redis queues violate the selected one-database interpretation. Vector retrieval is deferred.

## Specifications and verification

[Architecture](../architecture.md), [model](../data-model.md), [materials](../materials-and-jobs.md). Validation: T01, T07, T14.
