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

## Semantic release tags — 2026-11-21

Implemented [ADR-012](adr/012-semantic-release-tags.md), superseding ADR-011's version policy. Image/Git releases now use matching `vMAJOR.MINOR.PATCH`, starting at v0.1.0. Subsequent commit messages select major for breaking markers, minor for feat, patch otherwise. SHA image tags remain for traceability/retry. Semantic image digest is verified before Git publication; conflicting tags and out-of-order new releases fail. Existing CI unittest gate covers the new behavior. No backend/frontend runtime or dependencies changed.

Executed checks:

- `python -m unittest discover -s infra/release -p 'test_*.py' -v`: exit 0, 20 tests, including real temporary Git annotated-tag publication/retry and v0.1.0 → v0.2.0. An initial run failed because an old build-failure assertion counted read-only `git tag --list` as mutation; corrected it to distinguish `git tag -a` and retained failure assertions.
- `docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 -color`: exit 0.
- `docker buildx imagetools create --help`: exit 0; confirms `--prefer-index=false` support for copying the source manifest without changing its media type. Actual authenticated semantic image copy remains unexecuted until GitHub/GHCR setup exists.

No application pytest, frontend tests/build, PostgreSQL, image rebuild or live integration gates were rerun for this release-helper-only change. Those existing CI gates remain unchanged. No dependency install was needed. Actual GitHub tag permissions, registry publication/copy and deployment remain separate acceptance gates.

Final review: `git diff --check` exited 0 and all 117 relative Markdown links in changed documentation resolved. Complete diff and new ADR reviewed.

## First GitHub run: CI database bootstrap fix — 2026-11-21

Inspected [failed run 44911155138](https://github.com/zakh-d/tutor-ai-workspace/actions/runs/44911155138) through the connected GitHub plugin. Job 136867060056 failed at `uv run python -m app.migrate`: `psycopg.errors.InvalidSchemaName: schema "app" does not exist`. Public API exposed the failed step but unauthenticated log download returned HTTP 403; the connected account provided the full log. Publishing was skipped, so this run provides no GHCR acceptance evidence.

The workflow previously started an empty PostgreSQL database without the schema/role defaults provided by Compose initialization. Added a CI-only bootstrap helper that creates `app` and sets the test role's search path. Production migration/runtime separation remains unchanged. CI now applies migrations twice and verifies table placement, schema resolution and one migration version record before tests. See the [release runbook](../infra/release/README.md) for the provisioning rationale and commands. No new architecture decision or dependencies are introduced.

Executed checks using `python /tmp/tutor-check-ci.py` (temporary local launcher, exit 0):

- Started an isolated `postgres:17.4-bookworm` container with the same database/user as CI and a random loopback-only port. Confirmed the unmodified `PYTHONPATH=backend uv run python -m app.migrate` failed with the same missing-schema error. This was an expected negative reproduction, not a passing migration.
- `PYTHONPATH=backend uv run python infra/ci-database.py prepare`: exit 0 twice, demonstrating repeatable initialization.
- `PYTHONPATH=backend uv run python -m app.migrate`: exit 0 twice after bootstrap.
- `PYTHONPATH=backend uv run python infra/ci-database.py verify`: exit 0; all 10 expected application/version tables in app, none in public, correct runtime schema and version state.
- `uv run pytest -q`: exit 0, 44 passed / 13 skipped. Skips are existing opt-in integration coverage, not completed live tests.
- `SCHEDULING_INTEGRATION=1 uv run pytest -q tests/test_scheduling.py`: exit 0, 22 passed using the migrated isolated PostgreSQL database. Both test commands emitted three existing dependency deprecation warnings.

The launcher supplied the isolated `postgresql+psycopg` DATABASE_URL, PYTHONPATH=backend and UV_CACHE_DIR=/tmp/tutor-uv-cache, then removed only its temporary container. It did not touch existing application databases/volumes. Docker/network access required elevated execution.

`docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9 -color` and `docker compose --env-file .env.example config --quiet`: both exit 0. No frontend/runtime image change was made, so frontend tests/build and image rebuild were not repeated. Live smoke, Google, shared Keycloak, MinIO restore and real registry publication remain unexecuted for this fix. A new GitHub run requires pushing the fix; no push was performed.

Final diff reviewed; `git diff --check` exited 0 and all 72 relative links in changed Markdown files resolved.

## Scheduling usability — 2026-11-22

Implemented [ADR-013](adr/013-scheduling-usability.md), extending F02/F12 and T15/T17. The overview reads all planned lesson pages before sorting by actual start instant across students and filtering Today/Tomorrow in teacher time. All retains unscheduled plans last. Settings exposes teacher timezone; a browser initializes an unset preference through the normal authenticated PATCH. The migration preserves legacy non-UTC or previously revised preferences, including UTC, while distinguishing new explicit UTC choices. Times use 24-hour notation and concise teacher/student labels; timezone selection uses search plus a native select rather than datalist suggestions. Required/invalid form fields receive visible markers and errors.

Backend checks (isolated PostgreSQL 17.4, `DATABASE_URL=postgresql+psycopg://tutor:test-only@127.0.0.1:55439/tutor`, `PYTHONPATH=backend`, `UV_CACHE_DIR=/tmp/tutor-ux-uv-cache`):

- `uv run python infra/ci-database.py prepare`: exit 0.
- `uv run python -m app.migrate` twice: exit 0; head `0002_workspace_timezone`.
- `uv run python infra/ci-database.py verify`: exit 0.
- `SCHEDULING_INTEGRATION=1 uv run pytest`: exit 0, 50 passed / 9 skipped, three dependency deprecation warnings. Skips require `RUN_INTEGRATION` and are not completed full-stack coverage. Regression cases cover real migration of legacy values, initial preference state, explicit UTC persistence, invalid timezone rejection, idempotency replay and stale revisions.
- `UV_CACHE_DIR=/tmp/tutor-ux-uv-cache uv run pytest` without integration opt-ins: exit 0, 44 passed / 15 skipped, three dependency warnings.

Deployment checks:

- `docker compose --env-file .env.example config --quiet`: exit 0.
- `sh infra/smoke.sh`: exit 60 because the host did not trust the local Caddy CA. After copying the stack's public root certificate to `/tmp`, `CURL_CA_BUNDLE=/tmp/tutor-ux-caddy-root.crt sh infra/smoke.sh`: exit 0. This verifies existing-stack health, identity discovery and unauthenticated rejection, not deployment of this branch.

No production deployment or image rebuild was performed. Full-stack tests requiring `RUN_INTEGRATION`, real mobile-device interaction, live Google changes, OAuth/client compatibility and restore checks were not rerun for this change. Existing CI runs the extended backend/scheduling and frontend regression suites and build. No lint/static-analysis tool is configured beyond TypeScript compilation.

Frontend and review gates:

- `npm test --prefix frontend`: exit 0, 36 tests across eight files. Coverage includes full lesson pagination, chronological/date filters across DST, compact 24-hour rendering, canonical native timezone choices, required timing markup, workspace initialization/conflict/retry, and required-answer validation while allowing draft saves.
- `npm run build --prefix frontend`: exit 0; TypeScript and Vite production build, 1,579 modules transformed.
- A temporary bundled component fixture in installed Chromium Headless Shell at 390×844 passed search/committed timezone separation, canonical Warsaw selection, Enter focus without submission, DST-gap invalid outline and blocked submission with focus, required asterisks, and correction to 18:30 followed by successful submission. This was a one-off browser check, not a new CI gate; fixture removed. Initial Vite listening/ordinary Chromium sandbox attempts were blocked or timed out; the standalone headless-shell alternative passed. Physical mobile hardware was not exercised.
- UX agent reviewed the changed controls; developer review fixed implicit Enter submission, browser timezone alias normalization and invalid-field keyboard focus visibility. Existing Vitest/pytest commands wire deterministic regression coverage into CI without new dependencies.

## Application release visibility — 2026-11-22

[ADR-014](adr/014-application-version.md) propagates the existing CI semantic tag through Docker `APP_VERSION`, Vite's sidebar badge and Python's public version endpoint/OpenAPI metadata. This change starts from PR #1's head (`29db6fd`); its PR targets that branch to keep the diff version-only until #1 merges, then must target `main`.

Executed checks:

- `UV_CACHE_DIR=/tmp/tutor-version-uv uv run --frozen pytest -q` outside the sandbox: 46 passed, 15 skipped (PostgreSQL/provider integration flags absent), three dependency deprecation warnings. Initial default-cache run failed on the read-only uv cache; sandboxed TestClient runs stalled, so the completed run used approved execution outside the sandbox.
- `python -m unittest discover -s infra/release -p 'test_*.py' -q`: 20 passed, including the semantic version build argument assertion.
- `npm test --prefix frontend`: 38 passed. `VITE_APP_VERSION=v1.2.3 npm run build --prefix frontend`: passed TypeScript and Vite. The generated JavaScript contains `v1.2.3`.
- `docker compose --env-file .env.example config --quiet`: exit 0.
- `docker build --build-arg APP_VERSION=v1.2.3 -t tutor-version-check .`: exit 0; frozen production uv and npm dependency installation succeeded.
- `docker run --rm --network none tutor-version-check python -c ...`: exit 0. The assertion script checked the image environment and bundled JavaScript, started Uvicorn, made unauthenticated HTTP requests to `/api/v1/version` and `/openapi.json`, and asserted both report `v1.2.3`. Startup polling was bounded to 100 attempts with one-second request timeouts; the process was terminated afterward.
- `git diff --check`: passed. Relative Markdown link check across the six changed contract/decision/runbook documents: 95 resolved.

No database schema or provider behavior changed. PostgreSQL integration, full identity/OAuth/provider/restore smoke, authenticated GHCR publication and visual browser inspection were not rerun. No configured Python lint/static-analysis gate exists; no lint coverage is claimed. Existing CI gates execute the new deterministic tests without extra dependencies.
