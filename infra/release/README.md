# GitHub container releases

Create the GitHub repository, set its default branch to `main`, add its remote and push the code. `.github/workflows/checks.yml` runs checks for branch pushes/PRs and publishes only after checks pass for a push to `main`. No personal registry token is required: the publish job uses `GITHUB_TOKEN` with `packages: write` and `contents: write`. Repository/org policies and tag rules must permit these operations.

The image name is derived from the actual repository, lowercased: `ghcr.io/<owner>/<repo>:v0.1.0`. After verifying the pushed digest, CI creates matching annotated source tag `v0.1.0` containing the digest. The job summary contains the exact image reference to put into the homelab manifests. There is no latest tag or automatic cluster deployment. Tag pushes do not trigger this workflow.

## Semantic version policy

First release: `v0.1.0`. Subsequent releases inspect all commits since the highest numeric stable Git release:

- `feat:` or `feat(scope):` increments minor, e.g. `v0.1.0` → `v0.2.0`.
- `type!:`, `type(scope)!:`, or a `BREAKING CHANGE:`/`BREAKING-CHANGE:` footer increments major, e.g. `v0.2.0` → `v1.0.0`.
- All other changes increment patch, e.g. `v0.1.0` → `v0.1.1`.

Breaking changes take precedence over features; lower components reset. Use these markers in the final squash commit when squash-merging. The same rules apply before 1.0. Only stable `vMAJOR.MINOR.PATCH` tags participate; old `build-*` and prerelease tags are ignored. Package manifest versions do not control releases. An additional `sha-<full commit>` image tag retains source identity and lets retries reuse the build. Both image tags must resolve to the digest recorded in the Git tag. No mutable major/minor aliases are published.

If a job fails after publishing the semantic image but before pushing its Git tag, rerun that commit before publishing another commit: conflicting version/digest assignments fail safely. Existing releases are verified on reruns without allocating another version.

## Optional GitHub Actions repository variables

| Variable | Default | Purpose |
| --- | --- | --- |
| VITE_KEYCLOAK_URL | https://auth.zahk.tech | Public identity URL compiled into the frontend |
| VITE_KEYCLOAK_REALM | tutor | Realm to create on shared Keycloak |
| VITE_KEYCLOAK_CLIENT_ID | tutor-web | Public PKCE browser client |
| IMAGE_PLATFORMS | linux/amd64 | Docker build target; confirm cluster architecture |

Defaults are ready for the inspected homelab Keycloak host. These variables are public build settings, never secrets. Final app hostname is not baked into the frontend: login callbacks derive from its current origin. Register that exact origin, root trailing slash, `/auth/callback` and logout callback in Keycloak. Configure public backend URLs, issuer, audiences, database, bucket and secrets at runtime in homelab.

The default GitHub runner supports amd64 builds. ARM64 requires a suitable builder/emulation; this workflow does not install privileged emulation automatically. Changing build settings requires a new commit: reruns reuse the already-published commit image. Do not delete/retarget existing release tags or overwrite semantic/SHA image tags.

GHCR packages may initially be private. After the first publication either explicitly make the package public or provision a package-read image pull secret in each consuming Kubernetes namespace. If publishing to an existing package, grant this repository Actions access to it. This workflow does not change package visibility.

## Failure recovery and checks

Registry/auth/network failures fail the job. If the image was published but Git tag creation failed, fix permissions/rules then rerun: CI reuses the image and creates the tag. If the Git tag exists, its commit and digest must agree with the registry. A missing/replaced image with an existing tag fails instead of rebuilding silently. Review a conflict rather than force-pushing a tag.

The release script requires Python 3, Git, authenticated Docker and a bootstrapped buildx builder; GitHub's Ubuntu runner supplies the tools. It validates checkout against GITHUB_SHA before publishing, and serializes release jobs. Old checks may finish after newer ones; new untagged commits must descend from the latest semantic release; out-of-order jobs fail. Select the desired digest explicitly in homelab.

Local validation:

```sh
python -m unittest discover -s infra/release -p 'test_*.py' -v
npm test --prefix frontend
npm run build --prefix frontend
docker compose --env-file .env.example config --quiet
docker build --build-arg VITE_KEYCLOAK_URL=https://auth.zahk.tech \
  --build-arg VITE_KEYCLOAK_REALM=tutor \
  --build-arg VITE_KEYCLOAK_CLIENT_ID=tutor-web \
  -t tutor-workspace-app:release-check .
```

CI also runs actionlint 1.7.7, pinned by container digest, as a non-mutating workflow syntax/shell check. CI runs the regression tests alongside the existing PostgreSQL migration/backend tests, frontend tests/build and Compose validation. Mocked release commands test failure ordering and retry logic, not actual GitHub/GHCR compatibility. First-push publishing is a remaining acceptance gate. See the [deployment plan](../../docs/kubernetes-deployment-plan.md) for realm, MinIO, PostgreSQL, ingress, migrations and restore work owned by homelab. Traefik replaces Caddy in Kubernetes; the image serves HTTP on port 8000 and contains no Caddy server.

## Isolated CI database

GitHub's PostgreSQL service starts with an empty database. Before migrations, CI runs `uv run python infra/ci-database.py prepare` to create the `app` schema owned by its test role and set that role's default search path. CI runs `uv run python -m app.migrate` twice, then `uv run python infra/ci-database.py verify`. Verification fails if expected tables are missing from `app`, application tables appear in `public`, the runtime search path is wrong, or migration version state is missing/ambiguous.

This helper is for the disposable CI database only. Production continues to use the separate migrator/runtime roles and grants in `infra/postgres/init.sh`. Creating schemas inside the application's migration runner would blur that provisioning boundary, so the fix stays in CI setup. The regression gate uses real PostgreSQL and does not require MinIO or Keycloak; their live acceptance checks remain separate.
