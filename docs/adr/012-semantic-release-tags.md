# ADR-012 — Automatic semantic release tags

Status: Accepted; supersedes ADR-011's Git release tag and version allocation policy.

Date: 2026-11-21

## Context

The user requests semantic versions for automatic main-branch releases. Commit hashes remain useful for recovering partially completed registry operations but are not the primary release version.

## Decision

Publish matching image and annotated Git tags `vMAJOR.MINOR.PATCH`. Start at `v0.1.0`. For subsequent releases inspect all commit messages since the highest numeric stable release: Conventional Commit breaking markers (`type!:`, `type(scope)!:`, `BREAKING CHANGE:` or `BREAKING-CHANGE:`) increment major, `feat:`/`feat(scope):` increment minor, and all other changes increment patch. Major takes precedence over minor; reset lower components. This policy also applies before 1.0. No prerelease or build-metadata versions are allocated. Ignore legacy build tags and prerelease tags when selecting a base; reject leading-zero numeric components.

Keep `sha-<full commit>` as an additional immutable image reference for build reuse. Copy the verified source digest to the semantic image tag and verify it before creating the Git tag. Never overwrite a semantic image with another digest. Reuse an existing semantic Git tag for the same source commit on retries, verifying its annotation and both image tags. Multiple semantic tags on the same source are ambiguous and fail. Existing released commits may be verified again; new releases must descend from the latest release, so late older jobs cannot allocate a version after newer code.

Use the existing serialized publisher, permissions and branch-only trigger. Git and registry publication are separate transactions: if publication fails after assigning a semantic image but before pushing its Git tag, rerun that failed commit before releasing another commit. A different commit attempting to claim that version fails rather than overwriting the orphaned image. Release version is independent of Python/npm package metadata; those internal package versions are not used as release selectors.

## Alternatives and consequences

Explicit version files require manual release edits. A release service or additional versioning dependency is unnecessary for this bounded policy. Unstructured commit messages default to patch; maintainers must use the documented markers for features and incompatible changes, including squash-merge commit messages. Immutable digest deployment remains recommended. Major/minor mutable aliases and latest remain absent.

## Validation

The existing CI release unittest gate covers numeric ordering, first release, bump precedence, prerelease exclusion, out-of-order rejection, image conflicts and retries. A temporary real Git remote exercises annotated v0.1.0 publication, retry and v0.2.0 after a feature commit. GHCR copying/permissions remain a first-push acceptance gate. See the [runbook](../../infra/release/README.md) and [validation](../validation.md).
