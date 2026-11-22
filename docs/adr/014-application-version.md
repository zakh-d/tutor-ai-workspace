# ADR-014 — Application release visibility

Status: Accepted. Date: 2026-11-22.

## Context and decision

Operators need to identify the running release without consulting registry tags. The existing publisher calculates the semantic release tag before building; pass that exact `vMAJOR.MINOR.PATCH` as Docker `APP_VERSION` to both stages. The frontend captures it as `VITE_APP_VERSION` and displays an accessible badge in the workspace sidebar. The runtime retains it as `APP_VERSION`; Python settings expose it through unauthenticated `GET /api/v1/version` and OpenAPI metadata. Local builds default to `dev` rather than implying a release.

## Alternatives and consequences

Package versions are independent of releases and would be misleading. Fetching the API version for the badge would identify the current server rather than the loaded frontend bundle. Embedding the version independently makes stale frontend bundles distinguishable. Runtime overrides affect only the backend; rebuilding is required to change the badge. The endpoint discloses only the version, requires no database or identity provider, and retains the application's no-store response policy. Existing immutable release retry behavior is unchanged.

## Validation impact

The existing CI release unittest, pytest, Vitest and production build gates cover the build argument, public endpoint, development fallback and badge. A versioned image build and HTTP check verify the Docker stage boundary when Docker is available. No schema, auth, dependency or release allocation changes are required.
