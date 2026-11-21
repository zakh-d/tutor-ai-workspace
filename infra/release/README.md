# GitHub container releases

Create the GitHub repository, set its default branch to `main`, add its remote and push the code. `.github/workflows/checks.yml` runs checks for branch pushes/PRs and publishes only after checks pass for a push to `main`. No personal registry token is required: the publish job uses `GITHUB_TOKEN` with `packages: write` and `contents: write`. Repository/org policies and tag rules must permit these operations.

The image name is derived from the actual repository, lowercased: `ghcr.io/<owner>/<repo>:sha-<full commit>`. After verifying the pushed digest, CI creates annotated source tag `build-<full commit>` containing the digest. The job summary contains the exact image reference to put into the homelab manifests. There is no latest tag or automatic cluster deployment. Tag pushes do not trigger this workflow.

## Optional GitHub Actions repository variables

| Variable | Default | Purpose |
| --- | --- | --- |
| VITE_KEYCLOAK_URL | https://auth.zahk.tech | Public identity URL compiled into the frontend |
| VITE_KEYCLOAK_REALM | tutor | Realm to create on shared Keycloak |
| VITE_KEYCLOAK_CLIENT_ID | tutor-web | Public PKCE browser client |
| IMAGE_PLATFORMS | linux/amd64 | Docker build target; confirm cluster architecture |

Defaults are ready for the inspected homelab Keycloak host. These variables are public build settings, never secrets. Final app hostname is not baked into the frontend: login callbacks derive from its current origin. Register that exact origin, root trailing slash, `/auth/callback` and logout callback in Keycloak. Configure public backend URLs, issuer, audiences, database, bucket and secrets at runtime in homelab.

The default GitHub runner supports amd64 builds. ARM64 requires a suitable builder/emulation; this workflow does not install privileged emulation automatically. Changing build settings requires a new commit: reruns reuse the already-published commit image. Do not delete/retarget existing build tags or overwrite SHA image tags.

GHCR packages may initially be private. After the first publication either explicitly make the package public or provision a package-read image pull secret in each consuming Kubernetes namespace. If publishing to an existing package, grant this repository Actions access to it. This workflow does not change package visibility.

## Failure recovery and checks

Registry/auth/network failures fail the job. If the image was published but Git tag creation failed, fix permissions/rules then rerun: CI reuses the image and creates the tag. If the Git tag exists, its commit and digest must agree with the registry. A missing/replaced image with an existing tag fails instead of rebuilding silently. Review a conflict rather than force-pushing a tag.

The release script requires Python 3, Git, authenticated Docker and a bootstrapped buildx builder; GitHub's Ubuntu runner supplies the tools. It validates checkout against GITHUB_SHA before publishing, and serializes release jobs. Old checks may finish after newer ones; immutable commit names prevent older builds overwriting newer release identities. Select the desired digest explicitly in homelab.

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
