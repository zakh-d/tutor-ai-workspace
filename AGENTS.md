# Implementation coordination
Read README.md and relevant docs before implementation. Python/uv, FastAPI/FastMCP, PostgreSQL only, MinIO, Keycloak and React are required. No mocked auth in production and no SQLite fallback. Never claim an unexecuted check passed.

Ownership: backend agent owns backend/ and tests/ plus pyproject.toml/uv.lock (delegated single writer); frontend agent owns frontend/ including npm manifests; infrastructure agent owns infra/, compose.yaml, Dockerfiles and .env.example. Coordinator owns root docs and integration edits after notifying owners. No concurrent edits outside your ownership. No agents spawn additional agents.

Shared contract: backend module app.main:app, backend/app package; /api/v1 and /public/v1; /mcp; /health/live and /health/ready. Frontend Vite TypeScript, production dist. Env DATABASE_URL (postgresql+psycopg), KEYCLOAK_ISSUER, API_AUDIENCE=tutor-api, MCP_AUDIENCE, S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET. Main domain transport contracts in docs/rest-api.md and docs/mcp.md. Backend owns migrations. Frontend reads OpenAPI/contracts and never invents successful server responses. Coordinate changes by messaging the parent.

Validation: uv run pytest; frontend npm run build and its tests; docker compose config then live integration when Docker available. Report exact commands/results and missing prerequisites. Keep changes limited and testable; no destructive repository operations.

## Working process

1. Read `README.md`, the relevant specifications in `docs/`, and applicable nested agent instructions before editing. Inspect the working tree and preserve unrelated user changes.
2. Keep work scoped to the request. Assign each delegated work stream a single writer using the ownership boundaries above; notify owners before integration edits. Delegation is optional, and sub-agents must not spawn other agents.
3. When delegating, explicitly select the smallest available model capable of the assigned work. Give it a bounded task, file ownership, contracts, and validation commands. Escalate to a larger model only when complexity or demonstrated failure requires it, and record the reason in the handoff. The coordinator reviews the result and integrates it.
4. Record every major decision in Markdown under `docs/` in the same change as its implementation. Include context, alternatives, rationale, consequences, and validation impact. Architectural decisions use the next numbered `docs/adr/` record and update its index; supersede existing decisions rather than silently rewriting them. Update affected contracts, backlog, and requirement traceability together. Chat messages are not the durable decision record.
5. Use the deterministic gates below before declaring completion. Record exact commands, results, failures, skips, and missing prerequisites; never describe a skipped or unexecuted gate as passed.
6. Review the final diff, then commit the completed changes with a concise message describing the result. Stage explicit task-owned paths only; exclude secrets, generated artifacts, and unrelated changes. Do not amend or rewrite history unless requested. If checks fail or prerequisites block them, fix what is possible and report the remaining limitation with any checkpoint commit. If Git writes are unavailable, report the blocker instead of claiming a commit. Do not push unless requested.

## Deterministic control gates

Use the existing CI workflow in `.github/workflows/checks.yml` as the baseline. Run gates applicable to the changed behavior; documentation-only changes require diff and Markdown link checks, not application test runs. Before release, run the full application and live integration gates.

| Gate | Required checks |
| --- | --- |
| Diff and documentation quality | Run `git diff --check`; inspect the complete diff and verify changed Markdown links resolve. Ensure major decisions and changed contracts are documented. |
| Reproducible dependencies | Use `uv sync --frozen` and `npm ci --prefix frontend` when installing dependencies. Commit corresponding lockfile changes for intentional dependency updates. |
| Code quality | Run configured lint, format-check, and static-analysis commands for affected code; `npm run build --prefix frontend` includes TypeScript checking. When adding a quality tool, pin it and add its non-mutating check to CI. Do not claim lint coverage where no linter is configured. |
| Unit and regression tests | Run `uv run pytest` and `npm test --prefix frontend` for affected application layers. Add deterministic regression coverage for changed behavior and bug fixes; do not weaken assertions or introduce arbitrary sleeps to obtain a pass. |
| PostgreSQL integration | Use an isolated PostgreSQL test database via `DATABASE_URL` with `postgresql+psycopg`, run `PYTHONPATH=backend uv run python -m app.migrate`, then `uv run pytest`. No SQLite substitution. A unit-only run does not establish integration coverage. |
| Build and deployment configuration | Run `npm run build --prefix frontend` and `docker compose --env-file .env.example config --quiet` for affected frontend or deployment changes. |
| Live integration | Follow `infra/README.md` for an isolated stack and run `sh infra/smoke.sh`; use its identity, OAuth/MCP, and restore checks when relevant. Use real Keycloak, PostgreSQL, and MinIO for their boundaries. Record external Google/client prerequisites separately; fixtures cannot prove live provider compatibility. |

For new or changed behavior, add or extend deterministic gates at the appropriate level (code quality, unit, and integration) and wire repeatable automated checks into CI. Use fixed fixtures, controlled clocks/randomness where relevant, bounded timeouts, and isolated test state. Tests must return a nonzero exit status on failure; do not suppress failures, silently skip required coverage, or rely solely on manual/agent review. Keep external-provider acceptance checks explicit when credentials prevent CI execution. Record coverage and remaining gates in `docs/implementation-status.md` and map acceptance changes to `docs/validation.md`.
