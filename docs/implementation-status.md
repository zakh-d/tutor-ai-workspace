# Implementation status — 2026-11-21

Implementation is in progress; this is not a production-ready release claim. Two gpt-6.1-sol agents resumed backend/frontend work; the coordinator handles infrastructure and integration after this environment rejected a third child at its thread limit.

## Evidence so far

- Python imports and generated OpenAPI succeed (70 paths at this checkpoint).
- 35 Python tests pass against PostgreSQL/MinIO, including focused checks: RSA access-token boundaries, tutor client authority, Google pagination/error handling/idempotent create, ETag updates, timezone/DST validation. These use fixtures, not a live Google account.
- Frontend production build and seven frontend regression tests reported passed; browser inspection confirmed the actual sign-in page renders. Browser verified student answer entry for choice/multiple-choice/writing, draft saving, file upload, final submission and read-only submitted state. Full authenticated tutor browser workflow remains pending.
- Compose configuration validated; PostgreSQL, Keycloak and private MinIO started. Runtime schema grants checked (app usage/no creation; no Keycloak schema access).
- Alembic initial migration and repeat run succeeded. Disposable database restore succeeded with 10 application and 88 Keycloak tables.
- Keycloak code+PKCE exchange and audience claims exercised with temporary clients; combined application REST/MCP initialization, discovery, cross-audience rejection, tutor-client restriction, refresh and revocation all passed on the deployed stack.

## Current work

Backend integration tests, full deployed application/worker validation, public assignment flows, MCP parity and calendar recovery coverage. Worker/reconciliation hardening continues. Final per-scenario acceptance results will replace this checkpoint when the combined run completes.

## Latest implementation additions

- Worker heartbeat, two processing consumers, generation fencing and jittered retries.
- Bounded conversion files plus native Linux syscall filtering; packaged DOCX conversion verified inside the deployed image.
- Hourly workspace-scoped unreferenced-object reconciliation and technical job retention preserving calendar recovery and all domain history.
- Workspace/filter-bound search/history/calendar cursor pagination with bounded results and exact converter version metadata.
- MCP identifier/filter contract alignment and student session/closed-assignment UI regressions.
- Rebuilt app/worker containers, repeated PKCE/MCP smoke and PostgreSQL restore check passed.

## External prerequisites and limitations

The conversion filter denies network/process syscalls and enforces resource limits; it is not a complete filesystem namespace sandbox. Rich document fidelity is not established by simple text fixtures. Production-scale load testing and full object-store restore remain pending.

No Google OAuth credentials/test calendar supplied: live Google consent, synchronization and provider-side write/undo checks are blocked. A real external desktop agent OAuth compatibility check is not implied by the reference-client test. Git metadata is inaccessible/empty in this workspace surface; no commits or worktrees were created. Docker requires elevated access here. Candidate MinIO image was selected from an available official immutable cached digest after registry pull failures; see infra runbook.

Remaining release gates include full authenticated tutor browser review, real external desktop MCP client acceptance, live Google credentials/calendar checks, object-store disaster recovery, production load measurements and operator export/erasure procedure. Conversion fixtures do not establish fidelity for scans, equations or diagrams. Native syscall filtering is not a filesystem namespace sandbox.

## Sign-in fix — 2026-11-21

Canonical frontend login/init/logout redirect now includes the root trailing slash, matching Keycloak's exact registered callback (`https://app.localhost/`). Added auth initialization regression; frontend suite now eight tests, build passed. A real Keycloak authorization request with S256 PKCE returned the login form for the corrected redirect.
