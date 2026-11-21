# ADR-001 — Modular monolith and shared interfaces

Status: Accepted

Date: 2026-11-14

## Context

The MVP needs a website and remote agent access without complex infrastructure or divergent business rules.

## Decision

Use Python with uv, FastAPI with mounted FastMCP, and React/TypeScript/Vite. Both interfaces call shared domain services. Run a worker from the same application package. Docker Compose hosts the application, worker, PostgreSQL, MinIO, Keycloak and Caddy; frontend assets are served by the app.

## Consequences

One deployment and codebase reduce operational overhead. Separate worker processes isolate expensive conversion. Lifespan and route mounting must be tested; workers must not depend on web-process memory. This is a modular monolith, not independent microservices.

## Alternatives and deferred work

Microservices, Kubernetes, separate frontend hosting and serverless orchestration are deferred. A single synchronous web process is rejected for conversion work.

## Specifications and verification

[Architecture](../architecture.md), [REST](../rest-api.md), [backlog P0](../backlog.md). Validation: T02, T14, T15.
