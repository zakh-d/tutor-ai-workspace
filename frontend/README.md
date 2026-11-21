# Tutor workspace frontend

React + TypeScript + Vite. Install with `npm ci`, run with `npm run dev`, build with `npm run build`, and validate transport tests with `npm test`. The Vite development proxy defaults to port 8000; set `VITE_BACKEND_URL=http://localhost:8001` when running the backend on another port. For public assignment development, set the backend `PUBLIC_BASE_URL` to the browser origin (for example `http://localhost:5173`) and `COOKIE_SECURE=false` for local HTTP only. Production serves `dist` from the backend through the same origin.

Build-time variables: `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM` (default `tutor`), and `VITE_KEYCLOAK_CLIENT_ID` (default `tutor-web`). Configure exact redirect and logout URLs for the app origin in Keycloak. Login uses authorization code with PKCE; access/refresh tokens remain in memory. Public `/a/:id` routes bypass Keycloak, exchange fragment capabilities, clear the fragment, and use the same-origin session cookie plus CSRF header.

The interface includes authenticated record management, structured homework/card editors, assignment publication/access/review, public questions/files/draft/submit/feedback, material versions/corrections, calendar connection/selection/queued operations, and activity recovery. Backend validation and optimistic concurrency remain authoritative. Pending provider jobs are shown as pending and polled for completion.

Advanced source citations and tags use JSON fields. Reference selectors currently load up to 100 records. The Overview shows a preview of planned lessons and open tasks, and labels truncated results. External Google OAuth requires operator credentials; the UI reports unavailable configuration instead of simulating a connection.
