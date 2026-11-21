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

## k3s preparation assessment — 2026-11-21

Added a [source-based deployment plan](kubernetes-deployment-plan.md) after inspecting the app and local homelab repositories. Shared Keycloak is configured; no MinIO manifests or image automation controller Deployments were found. Current kubectl context is `minikube`, so the k3s cluster was not queried. App `git remote -v` returned no remote. Publishing, automatic Git tags, Kubernetes manifests, shared realm/bucket provisioning and live acceptance are not implemented by this documentation change. Application tests/build and live integration were not run because runtime code/configuration was unchanged.

Documentation gates: `git diff --check` exited 0; reviewed the complete tracked diff and new plan via `git diff --no-index -- /dev/null docs/kubernetes-deployment-plan.md` (exit 1 denotes the expected added-file diff); Python relative-link verification across the five changed Markdown files passed all 86 relative links. No application or deployment gate is claimed.

## Container release pipeline — 2026-11-21

Implemented [ADR-011](adr/011-container-release-pipeline.md): checks on branch pushes/PRs, GHCR publication only after successful main-push checks, lowercased repository-derived image names, immutable full-commit image tags and annotated Git tags containing the image digest. Publication uses scoped GITHUB_TOKEN permissions and serialized jobs; completed reruns verify existing source/digest, partial image-only publication can resume. Production frontend defaults target shared Keycloak; Docker Compose still supplies local auth build arguments. Local dotenv files are excluded from the build context. Homelab runtime resources are unchanged.

Executed validation:

- `python -m unittest discover -s infra/release -p 'test_*.py' -v`: exit 0, 13 tests. Includes a real temporary Git repository/bare remote verifying annotated tag push and safe rerun; registry/build failure ordering uses controlled command responses.
- `npm test --prefix frontend`: exit 0, 25 tests across seven files.
- `npm run build --prefix frontend`: exit 0, TypeScript and production Vite build; compiled assets contain `https://auth.zahk.tech`.
- `docker compose --env-file .env.example config --quiet`: exit 0.
- `docker build --build-arg VITE_KEYCLOAK_URL=https://auth.zahk.tech --build-arg VITE_KEYCLOAK_REALM=tutor --build-arg VITE_KEYCLOAK_CLIENT_ID=tutor-web -t tutor-workspace-app:release-check .`: exit 0 on amd64. Existing frozen dependency layers were cached; no dependency or lockfile changes. Docker requires elevated daemon access in this environment; initial unprivileged `docker info` failed with permission denied.
- `docker run --rm --entrypoint python tutor-workspace-app:release-check -c 'from pathlib import Path; assets=list(Path("/app/frontend/dist/assets").glob("*.js")); assert assets; assert any("https://auth.zahk.tech" in p.read_text() for p in assets); import app.main; print("Production identity bundle and app import: PASS")'`: exit 0. Production identity URL and backend import passed; dependency deprecation warnings remain.
- `docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 -color`: exit 0; same pinned non-mutating gate added to CI.
- `docker buildx imagetools inspect --format '{{json .Manifest}}' docker.io/library/python:3.12.10-slim-bookworm` plus Python JSON digest assertion: exit 0. An initial direct digest template returned human-readable output on the installed buildx; changed the helper to parse the verified structured manifest format and added regression coverage.
- Workflow YAML parsed using existing `.venv/bin/python`/PyYAML; exit 0. Initial system-Python parsing failed because PyYAML is not installed there. No dependency was added for this optional inspection.

Actual GitHub Actions execution, authenticated GHCR publishing and GitHub bot tag permissions require the repository the user will create. ARM64 image builds, live shared-Keycloak login, k3s deployment, worker/database/S3 integration and `sh infra/smoke.sh` were not run for this packaging change. Backend runtime code was unchanged, so backend pytest/PostgreSQL gates were not rerun locally; CI retains both existing gates. Do not treat these local packaging checks as deployment readiness.

Final documentation gates: `git diff --check` exited 0; all 112 relative links across ten changed Markdown files resolved. Reviewed the tracked diff and all added release/configuration/ADR files.
