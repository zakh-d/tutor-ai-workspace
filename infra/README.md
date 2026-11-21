# Deployment and operator runbook

Copy `.env.example` to `.env`, replace all passwords with distinct URL-safe values, generate the encryption key using the command shown there, and set the app/auth hostnames and HTTPS URLs consistently. Passwords enter Compose environment variables; keep `.env` private and out of version control. A single PostgreSQL database contains isolated `app` and `keycloak` schemas. Only Caddy exposes host ports.

Run from the repository root:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs migrate app worker keycloak
sh infra/smoke.sh
```

For local `*.localhost`, Caddy issues certificates with its internal CA. Install the root certificate from the `caddy-data` volume into the browser/OS trust store before login. Do not disable TLS verification in application code. For public DNS names, Caddy obtains public certificates automatically; ports 80 and 443 must reach the host. The auth issuer always uses the public URL; signature keys are fetched on the private network with `KEYCLOAK_JWKS_URL`.

The build uses frozen uv/npm lockfiles and packages the Vite output inside the app image. App and worker use the same image; `migrate` completes before either starts. The migration role owns app tables and grants runtime DML through default privileges. Schema initialization scripts run only on an empty PostgreSQL volume. Changing a password in `.env` does not update an existing database role or existing MinIO data automatically; rotate through the corresponding administrative interface.

## Identity setup

Open the Keycloak administration console on the auth hostname with the bootstrap admin credentials. In realm `tutor`, create a tutor user and set a non-temporary password or send a required password action. No test account, password grant, or automatic public registration is enabled. The `tutor-web` public client uses authorization code plus S256 PKCE, exact callbacks at the app origin `/` and `/auth/callback`, REST audience `tutor-api`, and tutor review scope. Keep review scope exclusive to this client.

External MCP clients must be registered per deployment with their documented exact callback URL. Generate and inspect an import file:

```sh
python infra/register-mcp-client.py --client-id my-agent \
  --redirect-uri http://localhost:9876/callback \
  --resource https://app.example.com/mcp > /tmp/mcp-client.json
```

Import it through Clients → Import client in the realm console. Request the least optional scopes needed. The generator never grants `tutor:review` or REST audience. Do not add wildcard callbacks or enable dynamic registration. No external MCP client/version has yet passed OAuth resource-parameter, refresh and revocation testing; generated registration is deployment configuration, not a compatibility claim. Initial realm import is skipped when the realm already exists; edit existing clients explicitly on upgrades.

## Backups, recovery and upgrades

Take a daily consistent PostgreSQL dump and retain 30 days, copy the entire private MinIO data volume with a storage-consistent snapshot, and back up encryption keys separately. Store backups outside the host with restrictive permissions. Example database export (contains private data):

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres pg_dump -U postgres -d tutor -Fc > backups/tutor.dump
```

Before restoring, stop app/worker, restore into a fresh isolated deployment, restore corresponding object data and keys, then verify every referenced object version and application health before switching traffic. Never run `docker compose down -v` against a deployment whose data must survive. Backup restoration and object completeness have not yet been exercised here.

Before schema upgrades, stop workers, back up data, build the new image, run `docker compose run --rm migrate`, then restart app/worker. PostgreSQL and MinIO are persistent named volumes. Inspect worker failures with `docker compose logs worker`; application jobs hold durable queue state. Check `/health/ready` for DB/S3 readiness separately from Keycloak discovery and Google authorization. Real Google credentials and consent are required for calendar testing.

Pinned image versions are recorded in Compose/Dockerfile. They are candidate versions until the live checks below pass; upgrade security review and compatibility testing remain operator responsibilities. Official Keycloak references: [containers](https://www.keycloak.org/server/containers), [reverse proxy](https://www.keycloak.org/server/reverseproxy).

## Validation evidence

`docker compose --env-file .env.example config --quiet` passes. Live validation results and any remaining prerequisites are recorded in the coordinator's implementation status. `infra/fixtures/material.txt` is a small real UTF-8 conversion/upload fixture; it does not replace PDF/DOCX/PPTX or external provider coverage.

### Executed local infrastructure checks

- `docker compose --env-file .env.example config --quiet`: exit 0.
- `docker compose --env-file .env.example up -d postgres keycloak`: PostgreSQL 17.4 healthy; Keycloak 26.2.5 created its schema and imported `tutor`. Local admin CLI authentication succeeded.
- `docker compose --env-file .env.example up -d minio bucket-init`: MinIO healthy; bucket initializer reported created bucket and private access. Docker Hub/Quay tagged MinIO pulls were denied in this environment, so the Compose image uses an available, verified official immutable digest (MinIO RELEASE.2025-07-23T15-54-02Z), including its bundled `mc` binary.
- Runtime grants queried with PostgreSQL: `app_runtime` has app schema USAGE but no CREATE; it has neither USAGE nor CREATE on keycloak. Migration and runtime roles differ.
- Keycloak client scopes were queried using `kcadm.sh`. Initial custom realm scopes omitted builtin profile/email; explicit mappers were added to the import and successfully created/assigned in the running realm. Tutor client PKCE and exact callback configuration remains in `infra/keycloak/tutor-realm.json`.
- `python infra/register-mcp-client.py --client-id smoke-client --redirect-uri http://localhost:9876/callback --resource https://app.localhost/mcp` produced valid JSON. This only validates registration generation, not a real client OAuth session.

Host integration tests can opt into `docker compose --env-file .env.example -f compose.yaml -f infra/compose.test.yaml up -d postgres minio keycloak`. This binds PostgreSQL 55432, MinIO 59000 and Keycloak 58080 to **127.0.0.1 only**. Omit the override for deployments. Use `COMPOSE_ENV_FILE=.env.example sh infra/check-identity.sh` for an operator identity/schema inspection. Use `COMPOSE_ENV_FILE=.env.example sh infra/restore-smoke.sh` to dump the live database and restore into a disposable network-isolated PostgreSQL container. The script deletes only its own temporary restore container/files; deployment volumes remain intact.

- Alembic initial migration was applied against the live PostgreSQL app schema twice successfully. `app.alembic_version` reported `0001_initial`; all ten app tables had runtime DML privileges. The migration contains frozen DDL, takes a PostgreSQL advisory lock, and uses the migration role rather than the app runtime role.
- `COMPOSE_ENV_FILE=.env.example sh infra/restore-smoke.sh` passed after application migration: the isolated restore contained 10 app tables and 88 Keycloak tables. Referenced object completeness and a coordinated application-data restore are not yet verified.

### Real OAuth and MCP transport smoke

`infra/oauth-smoke.py` uses HTTPX 0.28.1 as a remote HTTP test client against Keycloak 26.2.5 and FastMCP 2.14.7. It creates a random temporary user and two exact-redirect, public PKCE clients; `finally` deletes those Keycloak identities. A smoke workspace may remain in application audit data. It uses authorization code + S256 (never password grants for tutor/MCP clients), checks the public issuer and MCP audience, passes the resource indicator, tests REST/MCP audience separation and tutor-client review authority, initializes Streamable HTTP, lists tools, refreshes the grant, revokes its refresh token and verifies subsequent refresh fails. An access JWT already issued remains valid until expiry; refresh revocation is not instantaneous JWT invalidation.

Run against the loopback-only test override, supplying the Keycloak administrator password through your environment (do not paste real secrets into a committed script):

```sh
uv run python infra/oauth-smoke.py
```

Defaults: app `http://127.0.0.1:58000`, Keycloak `http://127.0.0.1:58080`, issuer `https://auth.localhost/realms/tutor`, resource `https://app.localhost/mcp`, tutor client `tutor-web`, callback `https://app.localhost/`, requested scopes `openid workspace:read` (plus tutor review for authority checks). The script's private loopback connection override sends secure Keycloak session cookies over the local test listener; deployed browser login still uses public TLS. This verifies the configured transport/auth profile, not compatibility with every third-party agent or experimental resource audience selection. Stable explicit audience mappings are used; no experimental Keycloak features are enabled.

A full live run against mounted `/mcp/` passed all of the above. The root `/mcp` initially returned 405 due to the SPA route; backend added an explicit 307 to the mounted transport, followed by a deployment rebuild. The custom realm now defines `basic` with the required subject mapper; omitting it caused legitimate access tokens without `sub` and strict backend rejection. `basic`, profile and email are included in the registration generator.

TLS was verified using Caddy's generated local CA, without `-k`: app `/health/ready`, auth realm discovery issuer, and `/a/example` student SPA fallback all passed. Public certificate trust installation remains a host/browser operator step.

## MCP Inspector and client-registration scope errors

`Allowed Client Scopes ... Not permitted to use specified clientScope` means Inspector attempted dynamic registration. This deployment uses pre-registered clients. Local logs showed the `basic` default scope rejected by the registration allowlist (only `offline_access` allowed). Use a dedicated client instead of changing that policy.

The local `mcp-inspector` public client is configured with S256 PKCE, MCP audience `https://app.localhost/mcp`, default `workspace:read`, optional MCP action scopes, and consent. It has no tutor review scope or REST audience. Exact callbacks registered locally: `http://localhost:6274/oauth/callback`, `http://127.0.0.1:6274/oauth/callback`, debug `http://localhost:6274/oauth/callback/debug`, and CLI `http://127.0.0.1:6276/oauth/callback`. For another Inspector origin/port, register its exact displayed callback; do not add wildcards.

In Inspector choose Streamable HTTP and server URL `https://app.localhost/mcp`; clear old OAuth state, then set OAuth Client ID `mcp-inspector`, leave Client Secret empty, and start with scopes `openid workspace:read`. Disable automatic offline/refresh-token requests for initial testing if the Inspector version offers that setting. The default web callback follows the Inspector address-bar origin. Login using a tutor user in realm `tutor`, not the master-realm administrator.

This client was registered through the live Keycloak admin API. End-to-end connection from the user's Inspector UI still needs verification. Reference: [official Inspector OAuth configuration](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md).

## Registry builds and Kubernetes

See [container releases](release/README.md) for checked main-branch GHCR images and automatic Git tags. Shared Keycloak production settings are passed explicitly during CI builds; Compose retains local defaults. Kubernetes uses the homelab Traefik ingress in place of the Compose Caddy service. Runtime provisioning remains described in the [k3s plan](../docs/kubernetes-deployment-plan.md).
