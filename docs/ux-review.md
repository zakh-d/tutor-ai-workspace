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
