# Implementation coordination
Read README.md and relevant docs before implementation. Python/uv, FastAPI/FastMCP, PostgreSQL only, MinIO, Keycloak and React are required. No mocked auth in production and no SQLite fallback. Never claim an unexecuted check passed.

Ownership: backend agent owns backend/ and tests/ plus pyproject.toml/uv.lock (delegated single writer); frontend agent owns frontend/ including npm manifests; infrastructure agent owns infra/, compose.yaml, Dockerfiles and .env.example. Coordinator owns root docs and integration edits after notifying owners. No concurrent edits outside your ownership. No agents spawn additional agents.

Shared contract: backend module app.main:app, backend/app package; /api/v1 and /public/v1; /mcp; /health/live and /health/ready. Frontend Vite TypeScript, production dist. Env DATABASE_URL (postgresql+psycopg), KEYCLOAK_ISSUER, API_AUDIENCE=tutor-api, MCP_AUDIENCE, S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET. Main domain transport contracts in docs/rest-api.md and docs/mcp.md. Backend owns migrations. Frontend reads OpenAPI/contracts and never invents successful server responses. Coordinate changes by messaging the parent.

Validation: uv run pytest; frontend npm run build and its tests; docker compose config then live integration when Docker available. Report exact commands/results and missing prerequisites. Keep changes limited and testable; no destructive repository operations.
