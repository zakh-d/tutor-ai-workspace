# UX review — 2026-11-21

Reviewed baseline `563d479` with a GPT-6.2 Sol UX designer, followed by a separate GPT-6.2 Sol implementation agent. Installed guidance: [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) and [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines). No Astra advisor was used.

## Findings and implementation brief

1. Replace first-page record tallies and the MCP promotional panel with an actionable Overview. Show real planned lessons and open tasks, independent loading/error/retry/empty states, and explicit previews rather than whole-workspace totals. Provide a direct Plan a lesson action and working record links. Lesson plans are not calendar appointments.
2. Group navigation by tutor workflow. Persist the selected section in the root URL query so refresh and Back/Forward work without changing Keycloak callbacks or public assignment paths. Mobile navigation must expose every destination and Sign out.
3. Add skip navigation, visible keyboard focus, readable text contrast, wrapping toolbars and suitable mobile targets. Use named dialogs with keyboard containment, Escape dismissal and focus return. Preserve failed form input.
4. Improve resource and student feedback: readable statuses/dates, distinguish filtered-empty from genuinely empty and failure, show copy feedback, label file upload, and communicate draft saving, final submission and read-only states. Keep cookie/CSRF and server authority intact.
5. Preserve Atelier's identity as a tutor's working planner. Use left-aligned content, restrained section rules and green primary actions. Suggested colors: canvas `#F4F6F2`, paper `#FFFFFF`, ink `#192D27`, secondary `#54635D`, rule `#D4DDD6`, action/focus `#285C48`. Use local Georgia headings and system UI text, 6–8px radii, a roughly 224px rail and 1200px content limit.

## Acceptance criteria

- No page overflow at 375, 768 and 1440px widths.
- Navigation, search and dialogs work by keyboard with visible focus; closing a dialog returns focus.
- Back, Forward and refresh retain the selected section.
- Delayed or failed overview requests never appear as empty results. Record and create actions open the right surface.
- Public draft, closed, submitted and error states remain explicit and preserve authorization.
- Materials list/search cursors remain tied to their endpoint and query. Archiving students must not silently revoke links.

## Scope and evidence limits

The designer reviewed source and product/REST contracts and confirmed the live app and readiness endpoint were reachable. The designer did not exercise browser layouts or authenticated workflows. Defer a calendar scheduler, backend changes, cross-workspace search, aggregate jobs, comprehensive record routing and replacement of all technical metadata editors.

Implementation and validation results are recorded separately after the developer handoff. Acceptance criteria above are targets, not claims of completed checks.

## Implementation and validation

Implemented in `f3eaf75` (workspace) and `bbd1c27` (student assignment). The Overview uses real filtered lesson/task requests with independent request states. Navigation uses root query parameters and preserves the Keycloak root callback. Native dialogs, responsive navigation, clearer list states, endpoint-bound Materials search pagination and public assignment progress are included. Technical payloads are collapsed where practical.

Executed checks for this pass:

- `uv run pytest`: 26 passed, 9 skipped, 3 dependency deprecation warnings. The nine opt-in PostgreSQL/calendar integration tests were not enabled in this invocation.
- `docker compose --env-file .env.example config --quiet`: passed. Without an environment file, configuration failed because `S3_SECRET_KEY` was unset.
- `CURL_CA_BUNDLE=/tmp/tutor-ux-local-ca.crt sh infra/smoke.sh`: passed health/readiness, OAuth discovery and unauthenticated REST rejection against the running stack. The initial attempt lacked local CA trust; verification passed after using the proxy's CA certificate.
- `npm run build --prefix frontend`, and later `VITE_KEYCLOAK_URL=https://auth.localhost npm run build --prefix frontend`: passed.
- `npm test --prefix frontend`: 12 tests passed across five files, including navigation, task ordering/due labels and auth initialization regressions.
- `git diff --check`: passed.
- `node /tmp/tutor-ux-browser.mjs`: the developer's temporary Chromium smoke harness passed real Keycloak authorization code/PKCE and REST, no horizontal overflow at 375/768/1440px, all 11 mobile destinations and sign-out visibility, editor/detail keyboard focus containment and return, search, Back/Forward and authenticated refresh. It checked real Overview data and ordering, isolated lesson-request failure/retry, public capability exchange and fragment removal, file upload, draft persistence across reload, submission/read-only, closed and unavailable assignment states. A request was deliberately aborted to exercise the failure state.

The Chromium harness served the freshly built HTML/assets at the existing app origin while application/API/auth requests used the running services. This validates the new frontend against the live backend without rebuilding or replacing the deployment. Temporary fixture records were seeded in disposable workspaces; the successful run removed its temporary Keycloak user. The harness is a local scratch script, not a committed reusable test suite. Screenshots were saved outside the repository in the session visualization directory; the coordinator visually inspected desktop Overview and mobile assignment captures. Real Google Calendar provider actions and the skipped opt-in backend suite were not revalidated by this UX pass.
