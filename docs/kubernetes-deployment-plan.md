# k3s deployment preparation

Assessment date: 2026-11-21. This is a proposed implementation plan, not an executed deployment or an accepted replacement for ADR-001/002. Local source reviewed: `/home/zakh/repos/zakh-d/homelab`. No homelab files or cluster resources were changed.

## Observed configuration

| Area | Evidence and implication |
| --- | --- |
| GitOps | `clusters/homeserver/flux-system/gotk-sync.yaml` tracks `zakh-d/homelab`, branch `main`. `clusters/homeserver/apps.yaml` reconciles `./apps` with pruning and readiness waiting. Add workloads to this repository so Flux owns desired state. |
| Routing | Traefik serves public host ingresses on entrypoint `web`; Cloudflare Tunnel runs with a token secret. Tunnel hostname/origin routing is managed outside these manifests and must be inspected separately. Local `.home` hosts use `websecure` and certificates from `local-ca-issuer`. |
| Shared identity | `apps/keycloak/deployment.yaml` runs Keycloak 26.6.0, public hostname `https://auth.zahk.tech`, private service `keycloak.keycloak.svc.cluster.local:8080`. Public ingress exposes `/realms` and `/resources`, keeping administration on `keycloak.home`. |
| Existing database | Keycloak owns PostgreSQL 16, database `keycloak`, a 5Gi `local-path` PVC. It is not configured as a shared application database. Do not reuse its administrative credentials for the app. |
| Shared object storage | No MinIO resources found in the homelab repository. This does not establish absence from the live cluster. |
| Secrets | Existing workloads reference manually supplied Kubernetes Secrets. No configured SOPS decryption workflow was found. Generated Flux CRDs mentioning SOPS are not an enabled secrets workflow. |
| Image automation | Flux includes standard controllers; no image reflector/automation controller Deployments were found. RBAC references to their names do not establish installation. |
| App image | Root Dockerfile packages React and Python together; app, worker and migrations can use one digest. Vite Keycloak settings are build arguments, currently defaulting to local auth. |
| CI | `.github/workflows/checks.yml` runs tests, PostgreSQL migrations, frontend build and Compose validation on pushes/PRs. It does not publish images or create Git tags. |
| Local access | `kubectl config current-context` returned `minikube`. No k3s API calls were made. `git remote -v` returned no app remotes; confirm GitHub repository before enabling publishing. |

## Proposed target and architectural decision

Use existing Flux, Traefik and Keycloak. Add shared MinIO if live inspection confirms it is absent. Give this app a private bucket and a bucket-scoped service account; never use shared MinIO root credentials as application credentials. Keep the S3 API internal unless a proven browser flow requires otherwise.

Use a dedicated app PostgreSQL database and isolated migration/runtime roles. Prefer an app-owned PostgreSQL workload initially rather than coupling app operations to Keycloak's StatefulSet. The alternative is a new app database and roles on an explicitly managed shared PostgreSQL service. Either topology separates app persistence from the existing Keycloak database and therefore changes the original single-instance/single-logical-database rule in [ADR-002](adr/002-storage.md). Before runtime implementation, record the next ADR superseding the deployment portions of [ADR-001](adr/001-monolith.md) and storage portions of ADR-002, and update architecture/security/T14 together. Keycloak remains the identity authority; the app never reads its tables.

This separation avoids migrating the working identity service merely to deploy a new app. The consequence is separate database backup lifecycles, with application database/object/key recovery still coordinated. Retain Compose for development and integration testing.

## Release pipeline in the app repository

Implemented by [ADR-011](adr/011-container-release-pipeline.md) and [ADR-012](adr/012-semantic-release-tags.md); see the [release runbook](../infra/release/README.md). The numbered assessment below describes intent; the implementation publishes matching semantic image/Git tags plus an immutable SHA image tag, with no mutable main alias. GitHub publishing remains unexecuted until repository creation.

1. Confirm GitHub remote, package visibility, protected-branch/tag rules and node CPU architectures. Proposed image name: `ghcr.io/zakh-d/ai-tutor-workspace-codex`, subject to the actual repository name.
2. Extend CI so publishing runs only for `push` to `main`, after all existing checks succeed for that exact commit. PRs run checks without registry/tag write permissions. Pin new actions to reviewed commit SHAs.
3. Build the existing Dockerfile with `VITE_KEYCLOAK_URL=https://auth.zahk.tech`, `VITE_KEYCLOAK_REALM=tutor`, and `VITE_KEYCLOAK_CLIENT_ID=tutor-web`. Include only required node platforms; verify multi-architecture dependency builds before claiming support. Changing these values requires another build until runtime frontend configuration exists.
4. Authenticate to GHCR with `GITHUB_TOKEN` and job-scoped `packages: write`; allow `contents: write` only where required for Git tags. Publish an immutable full-commit tag `sha-<40-character commit>`, record the returned digest, and retain it alongside the semantic release image tag. Deploy by digest.
5. Automatically allocate matching semantic image/Git tags, starting at `v0.1.0`, with subsequent major/minor/patch bumps from commit messages as specified in ADR-012. Publish and verify the semantic image before creating its annotated Git tag. Reruns reuse the existing source version and never force-update release tags. Serialize publication; keep tag pushes excluded from publishing triggers.
6. Record source commit, image digest and build URL together. Public GHCR simplifies cluster pulls; private images require a namespace-local pull secret with package-read access. GitHub's publishing token is not a persistent cluster pull credential.

Publishing is not deployment. Initially update the digest in homelab through a reviewed Git commit/PR. For automatic deployment later, either install Flux image automation controllers plus image policies and narrowly scoped Git write credentials, or have a GitHub App open homelab digest-update PRs. The app repository's `GITHUB_TOKEN` does not automatically authorize writes to the separate homelab repository. Do not put cluster-admin kubeconfig into app CI.

References: [GitHub GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images), [Flux optional image controllers](https://fluxcd.io/flux/installation/configuration/optional-components/).

## Homelab implementation work

| Work | Concrete deliverable |
| --- | --- |
| Live inventory | With an explicitly selected k3s context, inspect nodes/architectures, Flux health, storage classes/free capacity, existing MinIO/services, PVCs and backup destinations. Do not use the current minikube context for deployment. |
| Shared MinIO | If absent, add a shared namespace, pinned verified image, persistent storage, ClusterIP service, probes, resource requests/limits and backup procedure. A single local-path volume is node-bound storage, not high availability. Provision private `tutor-materials` bucket and least-privilege app credentials through an explicit bootstrap procedure; retain root credentials separately. |
| Keycloak realm | Create `tutor` through the authenticated Admin API/console using the existing realm template, rendered for the final public app URL. Existing deployment starts without `--import-realm` and has no import mount. Do not replace its existing realms or restart a shared server merely to import one realm. Render `${APP_URL}` before API import; startup environment substitution is not an Admin API rendering mechanism. |
| Identity contracts | Preserve public code + S256 PKCE `tutor-web`, exact root/callback/logout origins, `tutor-api` audience, basic/profile/email subject mappings and exclusive tutor review scope. Register external MCP clients separately using `infra/register-mcp-client.py` and exact callbacks/resource. Test against homelab Keycloak 26.6.0; local evidence covers 26.2.5 only. |
| App database | Add persistent PostgreSQL with app schema and separate migrator/runtime roles. Adapt `infra/postgres/init.sh` to app-only initialization rather than creating a second Keycloak identity store. Verify DML/default grants and prevent runtime DDL. Initialization scripts only run on empty storage. |
| App workloads | Add `apps/tutor/` Kustomize resources: namespace, config, secret references, API Deployment/Service, worker Deployment and migration Job. Both processes and Job use the identical image digest. Start with one API and one worker until concurrency/load gates pass. Set resources, non-root security settings and writable scratch storage needed by conversion. |
| Migration ordering | Do not rely on manifest order or a readiness probe. Separate database, release migration and runtime Flux Kustomizations with `dependsOn` and Job health checks. Give each migration Job a release-specific name; account for immutable Job templates and reconciliation. Gate runtime rollout on successful migration. Quiesce workers for incompatible upgrades and back up first; a generic init container in every replica is insufficient release orchestration. |
| Secrets | Supply DATABASE_URL separately for runtime and migration; S3 credentials; persistent credential-encryption key; optional Google credentials. Use existing manual Secret provisioning initially or implement SOPS/age explicitly. Never commit plaintext values; Kubernetes base64 encoding is not encryption. |
| Traffic | Choose public hostname, e.g. `tutor.zahk.tech` (proposal only), add Traefik ingress and Cloudflare hostname/origin route, confirm DNS/TLS. Route `/` to the API which serves the SPA, including `/api/v1`, `/public/v1`, `/mcp` and OAuth discovery. Preserve MCP streaming and verify tunnel timeouts and upload limits against supported materials. |
| Health/security | Startup/liveness use `/health/live`; API readiness uses `/health/ready`. Check Keycloak discovery separately. Add an appropriate worker heartbeat check. Restrict DB/S3/admin exposure; scope trusted proxy forwarding to the actual ingress path rather than blindly carrying Dockerfile's wildcard trust to arbitrary network clients. Review Traefik's current trusted `10.42.0.0/24` against actual tunnel pod placement. |
| Recovery | Back up app PostgreSQL, private bucket and encryption key, off-node with retention; verify coordinated restore and referenced-object completeness. Monitor worker heartbeat, queue age, failures, PVC capacity and dependency availability. A digest rollback does not undo a database migration. |

Proposed runtime values (the hostname must be finalized before image build and realm creation):

```text
PUBLIC_BASE_URL=https://tutor.zahk.tech
CORS_ORIGINS=https://tutor.zahk.tech
KEYCLOAK_ISSUER=https://auth.zahk.tech/realms/tutor
KEYCLOAK_JWKS_URL=http://keycloak.keycloak.svc.cluster.local:8080/realms/tutor/protocol/openid-connect/certs
API_AUDIENCE=tutor-api
MCP_AUDIENCE=https://tutor.zahk.tech/mcp
TUTOR_CLIENT_ID=tutor-web
S3_ENDPOINT=http://minio.<shared-namespace>.svc.cluster.local:9000
S3_BUCKET=tutor-materials
GOOGLE_REDIRECT_URI=https://tutor.zahk.tech/api/v1/calendar/connection/callback
```

Keep `COOKIE_SECURE=true`. DATABASE_URL must use `postgresql+psycopg`; migration and runtime URLs must differ by role. Internal JWKS routing must not change the validated public issuer. Persist the encryption key across redeployments. Google consent configuration needs the final callback when enabled.

Realm import reference: [Keycloak import/export](https://www.keycloak.org/server/importExport).

## Execution order and acceptance

1. Confirm target context, app GitHub repository, app hostname, architectures, storage/backup capacity and package visibility.
2. Accept/document Kubernetes and separate identity persistence topology; implement image CI with deterministic tag rerun/failure checks.
3. Provision shared MinIO if needed, app PostgreSQL, secrets, bucket and realm in homelab.
4. Render/validate Kustomize, then run server-side dry-run against k3s. Validate migration dependency failure blocks runtime rollout. Add repeatable manifest validation to CI alongside existing checks.
5. Publish a tested image, select its digest in homelab, run migrations, roll out API/worker through Flux and verify health.
6. Run PostgreSQL migration/tests, frontend tests/build, Compose config and [live smoke checks](../infra/README.md). Adapt the Compose-specific scripts for the Kubernetes topology; do not claim they directly validate k3s unchanged. Test real shared-Keycloak login/logout, PKCE/MCP audience separation, streaming/refresh/revocation, real MinIO upload/conversion/private download, student links, restart persistence and coordinated restore. Keep Google/external-client acceptance explicit when credentials/client access are missing.

Assessment validation: repository/configuration inspection only. No images were published, tags created, realm imported, MinIO provisioned, CI dispatched or Kubernetes resources applied. Live cluster capacity, installed services, external tunnel routing and provider compatibility remain unverified.
