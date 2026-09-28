# Plan: dashboard UI (W6-15, #232)

Recorded before code. Branch `codex/w6-15-dashboard-ui`, lane admin, database `rai-admin` on 55384.

1. Board CLAIM on Lane B (done before code).
2. Tests first (watch them fail):
   - `web/src/routes.test.ts`: `ROUTES.dashboard` is `/dashboard`.
   - `web/src/screens/dashboard/dashboard.view-model.test.ts`: `countCell` (0 is text, a count with a query is a link whose query parses back through `parseQueueQuery` to the same drill-down), the per-tile queries (status, lane state, SLA, finding defect by severity, unavailable), `barPercent`, `isEmptyDashboard`.
   - `tests/browser/w6-15-dashboard.spec.ts`: per-role tiles equal the API numbers, drill-down to the filtered queue, empty state, th/en, keyboard, axe, no sideways scroll.
3. Implement: `routes.ts`, `router.tsx`, `app-shell.tsx` (first nav link), `api/client.ts` (`getDashboard` with schema check), `screens/dashboard/{dashboard-screen.tsx,dashboard.view-model.ts,dashboard.css}`, locales th/en (`dashboard.*` block).
4. Docs: DEVLOG, CHANGELOG, W0-02 section 7 (dashboard read) left unchanged unless the screen needs a contract change (it does not).
5. Full gate (plan section 12), review.md, commit, push, verify remote head, PR "Refs #232".
