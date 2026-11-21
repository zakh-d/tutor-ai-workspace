# AI tutor workspace

A private workspace for independent tutors to organize students, teaching materials, lessons, tasks, and homework. Tutors work through a React website or delegate work to an external AI agent over MCP. Students receive individual assignment links and never need an account.

**Status: implementation in progress.** Backend, frontend and Docker Compose infrastructure are being implemented against the accepted specifications. See [implementation status](docs/implementation-status.md) for executed checks and remaining gaps, and [deployment instructions](infra/README.md) for setup. Architecture decisions were recorded on 2026-11-14.

## Start here

1. [Product requirements and journeys](docs/product.md)
2. [Architecture and deployment](docs/architecture.md)
3. [Data model and lifecycle rules](docs/data-model.md)
4. [REST contract](docs/rest-api.md) and [MCP contract and agent workflows](docs/mcp.md)
5. [Identity, authorization, and isolation](docs/security.md)
6. [Material ingestion and jobs](docs/materials-and-jobs.md)
7. [Google Calendar integration](docs/calendar.md)
8. [Assignments, submissions, and grading](docs/assignments.md)
9. [Revision history and recovery](docs/history.md)
10. [Architecture decision records](docs/adr/README.md)
11. [Implementation backlog](docs/backlog.md)
12. [Acceptance tests and requirement traceability](docs/validation.md)

See the [k3s deployment preparation assessment](docs/kubernetes-deployment-plan.md) for the proposed homelab rollout and remaining prerequisites.

## Accepted technology choices

Python with uv, FastAPI with mounted FastMCP, React/TypeScript/Vite, Keycloak, one PostgreSQL database, and private MinIO object storage. A worker runs the same application code and uses PostgreSQL for its queue. Docker Compose is the deployment model. There is no server-side LLM, Redis, separate search database, student portal, or custom identity system.

## Reading conventions

“Must” describes an MVP acceptance requirement; defaults are implementation decisions, not existing behavior. Deferred capabilities are not required for MVP. REST and MCP use shared domain services; exceptions for tutor-only actions are explicit. Agent operations are autonomous except publication of grading proposals. Every feature maps to an ADR, backlog phase, and acceptance scenario in the traceability table.

Changes to scope must update the relevant specification, ADR if architectural, backlog, and traceability row together. Implementation must pin tested dependency/container versions and commit lockfiles; this documentation does not claim that untested latest versions interoperate.

## Container releases

Push to `main` to run checks and publish the combined application image to `ghcr.io/<owner>/<repository>` with automatic commit-based image and Git tags. Production frontend builds default to shared homelab Keycloak. See the [release setup and variables](infra/release/README.md); Kubernetes runtime deployment remains in the homelab repository.
