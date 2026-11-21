# Parallel implementation status

Started 2026-11-14. Coordinator integrates three gpt-6.1-sol workers with disjoint ownership defined in ../AGENTS.md.

## Shared contracts
Backend app.main:app under backend/app; FastAPI routes /api/v1, /public/v1, /mcp and /health/{live,ready}. Frontend uses Vite and builds frontend/dist. PostgreSQL and private S3 only; Keycloak identity. Domain schemas follow rest-api.md. Backend owns all migrations and uv manifests; frontend owns npm manifests; infrastructure owns deployment definitions.

## Work streams
- Backend: runnable services, authentication, domain operations, REST/MCP, jobs and tests.
- Frontend: tutor and public assignment workflows, typed API integration, build/tests.
- Infrastructure: Compose, Keycloak/schema setup, containers, fixtures and deployment checks.
- Coordinator: integration, review, combined checks, requirement status.

## Environment observations
uv, Node, npm and Docker CLI installed. Git metadata is an empty protected directory and git status fails; no commits/worktrees available in this surface. Docker daemon access initially denied. Continue shared-workspace implementation with strict file ownership; live service checks remain unverified until access works.

## Completion rule
Map implementation and evidence to T01–T16. Fixture tests do not count as real Google or external MCP-client verification. No production-readiness claim until integration gates pass.

Docker access was verified with elevated execution (server 29.3.0); infrastructure worker will attempt live integration. Git remains unavailable; no history/commit claims will be made.

## Resumed 2026-11-21

Backend and frontend work continued with two gpt-6.1-sol agents; the environment rejected a third child at its thread limit, so the coordinator handled infrastructure checks. Baseline live suite passed 25 tests; subsequent backend regression coverage passed 28. Frontend build and four HTTP tests passed. Browser verified all four question types, draft saving, text-file attachment and final read-only submission. Live Keycloak/MCP PKCE/audience/review/refresh/revocation smoke rerun passed. See implementation-status.md for current gates and limitations.
