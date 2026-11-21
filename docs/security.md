# Identity, authorization and isolation

## Tutor authentication

Keycloak owns login, account lifecycle, passwords, recovery and OAuth consent. The React public client uses authorization code with PKCE, exact redirect URIs, and in-memory tokens (no long-lived tokens in localStorage). REST validates access-token issuer, signature/JWKS, expiry, audience and scopes. A valid identity maps to one workspace; unknown or cross-workspace resource IDs produce not_found. Browser code never gets database or provider secrets.

REST audience is `tutor-api`; MCP audience is the canonical HTTPS MCP resource URL. Configure corresponding Keycloak clients/audience mappings. Validate the audience appropriate to the receiving interface; do not accept ID tokens or a token intended only for another service. Application authorization belongs to domain services, not Keycloak table queries.

## Remote MCP connection

Expose protected-resource metadata for `/mcp`, advertised in the unauthenticated `WWW-Authenticate` challenge, naming the configured Keycloak issuer and scopes. Publish both the resource-specific well-known path and a root discovery alias. The client discovers Keycloak authorization metadata, performs authorization code + PKCE, and sends a bearer token for this MCP resource. Enforce issuer, audience, signature, expiry and scope on every call.

Baseline: deployment-operator pre-registration of tested MCP clients with exact redirect URIs and no wildcard redirects. Clients must support remote Streamable HTTP, OAuth/PKCE and configured client IDs. Dynamic client registration and Client ID Metadata Documents are deferred; clients that require them exclusively are unsupported initially. No shared API keys or unverified token passthrough fallback.

[Keycloak's MCP guide](https://www.keycloak.org/securing-apps/mcp-authz-server) currently identifies resource indicators and client metadata documents as experimental. Prefer stable audience mappings for pre-registered clients; phase P0 must verify resource-parameter handling against the pinned Keycloak/FastMCP/client combination. Enable a documented experimental feature only if required by that tested combination, recording configuration and upgrade risk in ADR-003. Unsupported combinations must fail visibly, not skip audience checks.

Setup instructions delivered in implementation must name tested client/version, server URL, client ID, redirect URI, requested scopes, and successful refresh/revocation behavior. “Any MCP-compatible agent” means compatibility with this supported transport/authentication profile, not universal client support.

## Permission matrix

| Action | Tutor website client | MCP client | Assignment capability |
| --- | --- | --- | --- |
| Read workspace/materials/submissions | Yes | `workspace:read` | Only pinned public assignment data |
| Mutate records, templates, cards | Yes | `workspace:write` | No |
| Publish assignment/manage access | Yes | `assignments:publish` | No |
| Read/write selected calendar | Yes | `calendar:read` / `calendar:write` | No |
| Create grade proposal | Yes | `grading:propose` | No |
| Release/correct a grade | Yes, tutor client only | Never | No |
| Reopen submission | Yes, tutor client only | Never | No |
| Inspect/undo supported changes | Yes | `history:read` / `history:undo` | No |
| Save/submit answers and upload | No impersonation flow | No | Current draft only |

The REST release/reopen endpoints require an access token issued to the configured first-party tutor client plus `tutor:review`. MCP clients cannot obtain that scope through registration policies and are rejected even if a forged tool argument claims human approval. This enforces client authority, not proof that a human physically clicked a button. Grade release and reopen are absent from MCP tools and generic undo.

Scopes restrict capabilities; they never override ownership. The connection UI explains that external agents receive student data and uploaded material when requested. Treat retrieved text and student submissions as untrusted content, not instructions, and return them as clearly identified data. Neither tools nor converters execute supplied code or fetch arbitrary remote URLs.

## Student capability and files

[Assignment access](assignments.md) defines secret-link sessions and expiry. Student sessions cannot call tutor endpoints and never become Keycloak users. Same-origin cookies require CSRF protection and origin validation on mutations. Deny cross-origin public API requests; use CSP, escaped/sanitized Markdown, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and no third-party analytics on assignment pages.

Validate file extension, detected media type and allowed size; reject executables, archives and macro-enabled Office formats. Student files allow PDF, DOCX, TXT, PNG and JPEG only. Download documents as attachments with nosniff; do not render active documents inline. Converters run without network access, with time/memory/output limits. Antivirus integration is deferred; allowed types do not imply files are harmless.

Application-authorized streaming downloads recheck workspace/capability and expiry on every request. Do not expose long-lived S3 URLs. S3 key prefixes are organization aids, not an authorization mechanism. Encrypt Google tokens at rest using a deployment secret held outside the database. Do not place secrets or access tokens in revision snapshots, job errors or logs.
