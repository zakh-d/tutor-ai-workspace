# ADR-011 — Checked main-branch container releases

Status: Accepted. Extends ADR-001 packaging; Kubernetes runtime and separate database topology remain proposed.

Date: 2026-11-21

## Context

The app will be pushed to a new GitHub repository and deployed by the existing homelab Flux installation. It needs a registry image and source tag for each checked main-branch commit. Frontend identity configuration is compiled into the bundled SPA.

## Decision

Keep one image for API/static frontend, worker and migrations. On branch pushes and pull requests run the existing application gates plus release regression checks. Only a successful push to `main` may publish to the lowercased `ghcr.io/<owner>/<repository>` using the repository's GitHub token. Scope package and Git write permissions to that job. Branch-only push filters prevent created Git tags from triggering another release.

Publish `sha-<full source commit>` and record the verified registry digest in annotated Git tag `build-<full source commit>`. Reuse an existing image after partial failure; completed retries verify the tag's source and digest and never force-update it. Serialize release jobs without cancelling running publication. Do not maintain a mutable `main`/`latest` alias, avoiding out-of-order jobs moving a deployment selector backwards. Flux deployment selects an explicit digest in homelab; no cluster credentials or cross-repository write token are needed here.

Default to linux/amd64; repository variable IMAGE_PLATFORMS can select supported native/available builder platforms. Additional architectures require appropriate builders/emulation and successful validation. Set public Keycloak build values through repository variables, defaulting to the shared homelab host. Production npm builds use the same defaults in frontend/.env.production; Compose's explicit Docker build arguments retain local auth. Exclude local dotenv files from the image build context. Never put credentials in VITE variables.

## Alternatives

Semantic version automation needs a release policy not supplied by the project. Full source hashes give deterministic unique build versions without dependencies or changelog inference. A mutable latest tag cannot identify the tested source reliably. Runtime frontend configuration would allow promotion across identity environments but adds an application configuration endpoint/bootstrap contract; keep the existing build-time contract for this first rollout.

## Consequences and validation

An identity build-setting change needs a new commit/build. Existing commit tags are immutable and retries reuse their original configuration. The registry and Git operations cannot be atomic; retry resumes after image publication, while conflicting tags/digests fail. GitHub rules must allow the bot to create build tags. Initial package visibility and cluster pull credentials are operator setup.

Release regression checks cover publication failure, retries, checkout mismatch, source/digest consistency and registry failures. Frontend tests cover production identity configuration and exact same-origin callbacks. Run the frontend production build and image build; GitHub authentication/publishing requires the future repository and is not established by command mocks. See the [release runbook](../../infra/release/README.md), [backlog](../backlog.md) and [validation](../validation.md).
