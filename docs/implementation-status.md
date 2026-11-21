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

## Student timezones and recurring schedules — 2026-11-21

Implemented [ADR-010](adr/010-student-timezones-and-schedules.md), F12/T17. Student profiles accept validated IANA zones; absent zones follow the configured teacher workspace timezone. The UI labels teacher/student times in lessons, tasks, assignments, public deadlines and linked Google events, with DST-aware input previews and explicit overlap choices. Student detail manages weekly agreements and generates concrete lessons in batches of up to 93 days. Each occurrence can move or be cancelled independently. Changes to rules apply only to ungenerated dates; Google-linked timing remains provider-controlled. Schedules and occurrence provenance use existing JSONB persistence, so no new SQL migration is needed.

Executed gates for this change:

- `UV_CACHE_DIR=/tmp/tutor-uv-cache uv sync --frozen`: exit 0, 120 packages audited; no dependency changes. Initial plain `uv sync --frozen` failed because the default cache is read-only; writable cache resolved it. Frontend dependencies were already installed; no install or lockfile change was needed.
- Created isolated PostgreSQL database `tutor_schedule_check` with its own `app` schema. `PYTHONPATH=backend uv run python -m app.migrate`, launched with the isolated `postgresql+psycopg` URL and writable uv cache: exit 0. Initial attempts failed due sandbox network access, missing system-Python dotenv, and looking for credentials in `.env`; the successful launcher read Compose configuration privately using project Python dependencies.
- `UV_CACHE_DIR=/tmp/tutor-uv-cache uv run python /tmp/tutor-schedule-check.py -q`: exit 0, **57 passed**, none skipped, three dependency deprecation warnings. This temporary launcher invoked `uv run pytest -q` with `RUN_INTEGRATION=1`, `SCHEDULING_INTEGRATION=1`, the isolated database URL, loopback MinIO endpoint and Compose bucket/credentials. `COOKIE_SECURE=false` was used only for the HTTP TestClient. The first full attempt had 32 passes/3 failures from the wrong default bucket and secure HTTP test cookies; correcting that environment produced 57 passes. The final rerun also passed 57, including moved/cancelled/archived occurrence reservation and archived schedule rejection. Authentication substitutions remain test-only; production authentication was not changed.
- `COOKIE_SECURE=true UV_CACHE_DIR=/tmp/tutor-uv-cache uv run python /tmp/tutor-schedule-check.py -q tests/test_scheduling.py`: exit 0, **22 passed** with the production-default secure cookie setting, confirming the standalone PostgreSQL scheduling gate.
- `npm test --prefix frontend`: exit 0, **24 passed in seven files**. Includes DST gap/overlap, fractional offsets, date-boundary teacher/student display, bounded generation and existing regressions.
- `npm run build --prefix frontend`: exit 0; TypeScript check and Vite production build passed.
- `docker compose --env-file .env.example config --quiet`: exit 0.
- Python imports, OpenAPI generation (76 paths), and seven scheduling MCP tool registrations succeeded. CI now additionally runs `SCHEDULING_INTEGRATION=1 uv run pytest -q tests/test_scheduling.py` using its migrated PostgreSQL service without requiring MinIO.
- `git diff --check` and relative-link verification for all changed Markdown files: exit 0. No Python/frontend lint or formatter is configured, so no separate lint coverage is claimed.

Remaining acceptance: no new live browser session, rebuilt deployment, `sh infra/smoke.sh`, live Google consent/provider session, or real external MCP-client acceptance was executed for this change. PostgreSQL/MinIO tests establish those service boundaries; Google fixtures and MCP schema checks do not establish live provider/client compatibility. Existing running deployment has not been replaced. No automatic invitations, notifications, infinite recurring expansion, or Google series writes were added.
