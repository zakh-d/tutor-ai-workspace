# ADR-003 — Keycloak identity and private tutor workspaces

Status: Accepted

Date: 2026-11-14

## Context

Tutors need secure website and remote agent login without implementing an identity product. Students must not need accounts.

## Decision

Keycloak owns tutor authentication. Map verified issuer/subject to one private workspace. Use PKCE and audience/scopes, pre-register supported MCP clients, and enforce workspace authorization in shared services. The first-party tutor client alone receives review authority. Secret assignment capabilities are separate from tutor identity.

## Consequences

All queries, files, jobs and history require ownership checks. Registration and MCP interoperability require a P0 integration gate. Keycloak resource indicators/client metadata features may be experimental; pin and record the supported configuration rather than promising universal client support. Do not weaken token validation to accommodate incompatible clients.

## Alternatives and deferred work

Custom passwords, shared MCP API keys and token passthrough are rejected. Dynamic client registration, team membership and student identities are deferred.

## Specifications and verification

[Security](../security.md), [MCP](../mcp.md). Official reference: [Keycloak MCP integration](https://www.keycloak.org/securing-apps/mcp-authz-server). Validation: T01, T02, T10, T12.
