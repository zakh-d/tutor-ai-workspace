# Phased implementation backlog

This is the implementation roadmap. Core application code now exists across P0–P5; see [implementation status](implementation-status.md) for executed checks and open acceptance gates. The rows describe intended deliverables, not a claim that every gate has passed. Complete each gate before declaring a phase done.

| Phase | Dependencies | Deliverables | Verification gate |
| --- | --- | --- | --- |
| P0 Foundation and authentication | Accepted specs | uv Python package/lock, React/Vite package/lock, Compose topology, migrations, single database/schema isolation, private MinIO, Keycloak setup, workspace derivation, scoped service context, FastAPI and FastMCP mount, one authenticated read tool, health/logging, CI. Pin dependency/images and record actual MCP client compatibility. | T01, T02, T14: login, audience/client boundaries, real MCP OAuth handshake/refresh, lifespan and restart smoke test; DB/schema/S3 isolation. |
| P1 Records and history | P0 | Students with timezones, weekly local schedules and independently movable generated lessons, tasks, workspace settings, website lists/forms, shared CRUD services, optimistic concurrency, durable idempotency, archive/restore, immutable revisions and supported undo. | T03, T04, T15, T17: retries/concurrent writes/undo conflicts; cross-workspace references blocked; usable core UI. |
| P2 Materials and jobs | P1 | Upload reservations and quotas, immutable objects/versions, PostgreSQL queue with fencing, isolated MarkItDown conversion, chunk search/read, correction/version preview, job errors/retry UI, cleanup reconciliation. | T05, T06, T07: representative text documents, failed extraction, oversized/hostile inputs, worker crash recovery and no duplicate artifact activation. |
| P3 Google Calendar | P2 | Google consent/configuration, encryption, selected calendar, initial/incremental polling, timetable, occurrence links, queued create/reschedule, provider conflict UI, compensating undo. | T08, T09: token expiry, 410 reset, paging, ETags, duplicate prevention, DST and external changes. |
| P4 Homework and submissions | P3 | Template/question editor, source validation, immutable assignment publication, secret-link sessions, public mobile page, autosave/files/finalization, attempts/reopen, scorer, grade proposals/tutor release, card editor/TSV. | T10, T11, T12, T13: link/answer-key isolation, stale drafts, upload limits, retained submissions, grading authority and export. |
| P5 Full MCP and release validation | P4 | Complete tool inventory, shared-schema parity checks, agent setup guide and examples, no tool-level auth bypass, bounded retrieval, retry/error contracts, end-to-end UX, operator backup/restore and erasure/export runbooks. | T01–T16: one pinned reference MCP client and one real external client; end-to-end tutor/agent/student workflow; restore drill and constraint audit. |

## Implementation conventions

Use pytest for service/integration tests with real PostgreSQL and MinIO in CI where semantics matter; deterministic converter fixtures without student data; provider HTTP fixtures for Google failures plus a dedicated test-calendar smoke run. Use Playwright for essential tutor/student workflows. Exercise both REST and MCP against shared fixtures rather than duplicating entire unit suites per adapter. Keycloak token verification and registration policy need integration tests, not only mocked claims.

Keep schema migrations incremental. The first release has no legacy application data migration; all later migrations must preserve immutable artifacts, audit history and published versions. An architectural change requires an ADR update or superseding ADR. Implementation should update the traceability matrix when requirements change.

## Rollout and operations gate

Deploy to a non-production environment with synthetic students first. Verify backups/restoration, known client compatibility, Google consent configuration, revocation and tenant boundaries. Then pilot with independent tutors and monitor conversion failure rate, calendar sync age, queue age and authorization errors. Production readiness includes a documented data export/erasure procedure, validated limits and disclosure of external-agent data access. These gates require no additional infrastructure services.

No exact throughput target is promised before measurement; test the pilot baseline of 10 concurrent tutor requests, 20 concurrent student saves and two conversion workers on the documented deployment hardware. Record latency/error rates and resource usage; a 2-second p95 for metadata reads/writes (excluding provider/file processing) is the initial acceptance target under that load. Record hardware and dataset size with results so the target is reproducible.

## Proposed k3s deployment work

The [deployment assessment](kubernetes-deployment-plan.md) scopes GHCR publishing and automatic build tags, shared MinIO/Keycloak integration, Flux migration ordering, persistent storage and restore gates. Implementation is pending; first record the superseding deployment/storage ADR, then update T14 for the accepted topology.

Container release implementation: [ADR-011](adr/011-container-release-pipeline.md) adds checked main-branch GHCR publication, immutable image/build tags and production frontend identity defaults. First GitHub/GHCR execution and homelab runtime changes remain pending; see the [release runbook](../infra/release/README.md).
