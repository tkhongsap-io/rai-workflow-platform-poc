# Review: dashboard UI (W6-15, #232)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 8.1, 8.2, 9 and 13, row W6-15 (the plan wins over issue #232); W6-14's review "Deviations" handoff (defect links add `findingKind=defect`; W6-15 decides the count-of-1 rule). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". D07-D10 stay open. Synthetic data only; no network call, no model, no deploy. No migration, no server change.

## Change

- **Route and navigation**: `ROUTES.dashboard = '/dashboard'` (`routes.ts`), under `RequireSession` (`router.tsx`); "Dashboard" (`dashboard.title`) is the first `NavLink` of the primary navigation for every signed-in user (`app-shell.tsx`). Root redirect and brand link unchanged.
- **Client** `api/client.ts`: `API_PATHS.dashboard`, `api.getDashboard()` checks the body against `DashboardResponseSchema` (`InvalidResponseError` otherwise, as `getDeskHealth`).
- **Screen** `web/src/screens/dashboard/`:
  - `dashboard-screen.tsx`: heading, description, "as of" instant, Refresh/Retry, loading status, `ErrorNotice`, `dashboard.invalid_response`; the empty state (`dashboard.empty` + body + link to the queue) when `cases.total` is 0, with no tile; otherwise six tiles, each a `<section>` with an `h2` and one `<table>` with `<caption>` and `<th scope>` cells inside a keyboard-focusable `role="region"` that scrolls on a narrow screen: status (+ total), lanes and SLA (pending, approved, sent back, due soon, past due), open findings (high/medium/low defects, QC unavailable, of which paused; advisory line), QC 30 days, risk (`available: false` → one sentence; `available: true` → tiers as stored plus not assessed), activity (8 weeks). Bars are `aria-hidden` spans (status and weekly submissions). Past due carries the word in its header plus colour.
  - `dashboard.view-model.ts` (pure): `countCell`, `queueLink` (built with the queue's `queueParams`), `statusQuery`, `laneStateQuery`, `laneSlaQuery`, `defectQuery` (always `findingKind=defect`), `unavailableQuery`, `findingCount`, `unavailableTotal`, `barPercent`, `isEmptyDashboard`.
  - `dashboard.css`: one column below 64rem, three above with lanes, findings and activity spanning two.
  - Link accessible names start with the visible number (`dashboard.link_label`: count, row, column), so label-in-name holds.
- **Locales**: 45 `dashboard.*` keys in one contiguous block in th and en; lane, status, projection and severity names reuse existing keys.
- **Tests**:
  - `web/src/screens/dashboard/dashboard.view-model.test.ts` (5 tests): 0 is text, a count with a query is a link; every cell's URL parses back through the queue's `parseQueueQuery` to the intended drill-down (defects carry `findingKind=defect`, unavailable has no severity); finding lookups; bar width; empty rule.
  - `web/src/routes.test.ts`: `ROUTES.dashboard` and its sign-in return path.
  - `tests/browser/w6-15-dashboard.spec.ts` (4 tests × 1440/834/390, real server): owner (after submitting RAI-2000-0001 and the missing-slot RAI-2000-0003) — nav order, every tile number equals `GET /api/dashboard` for the same session in th and en, captions, bar `aria-hidden`, 0 plain text, axe th and en, no sideways scroll, drill-down from DPO pending (2 cards), status draft, and an open defect cell (URL `findingLane…&findingSeverity…&findingKind=defect`, card count equals the queue API's total for that filter); BU SPOC (2 cases), DPO reviewer and Admin (5) each equal their own API numbers and queue total, axe; empty state for `fx-user-owner-cm-2` in th and en with axe; keyboard only: Tab to the Dashboard link, Enter, focus on main, Tab to a count link with a visible ring, Enter opens the drill-down, focus on main.
  - Red first: the unit files failed (`ERR_MODULE_NOT_FOUND` for the view model; `ROUTES.dashboard` undefined) before the code. The browser spec was written before the screen but first run after it; to show it bites, a mutation (a 0 rendered as a link) was run on desktop-1440 and failed the owner test (`toHaveCount` on the 0 cell), then reverted.

## Deviations

Choices under Ta's delegation of 2026-09-27 where the plan is silent or cannot be met as written; each keeps the W6-01 shapes and plan contracts.

- **"To the case when the count is 1" (plan 8.2) is not implemented**: a count of 1 links to the filtered queue like any other count. `DashboardResponse` carries no case IDs, and resolving one would cost an extra queue read per such cell; the queue then lists the single case with its "Open" link. Finding counts count findings, not cases (W6-14 review), so "1" there would not always mean one case anyway. Recorded for W6-16 or later tuning.
- **Numbers the queue cannot list stay text**, although plan 8.2 says every number is a link: QC run counts (runs, not cases), weekly activity (no date filter on the queue), "of which paused" (no pause filter; `findingKind=unavailable` lists outage and pause together, so the linked "QC unavailable" cell is their sum), the advisory line (W6-09) and risk tiers (the `riskTier` filter is W6-16's). A link must never open a list that does not match its number.
- **Risk tile when `available: false`** shows one sentence instead of an empty table; the other five tiles are tables.
- **Status total** links to the unfiltered queue (`/queue`), whose total equals `cases.total` (W6-13 invariant).
- **Files outside the row's list**: `web/src/api/client.ts` (`getDashboard`), `web/src/routes.test.ts`. The in-memory API substitute is unchanged (frozen for W6, plan 11.2); no substitute journey opens `/dashboard`.
- **Root redirect** stays `/cases` and the brand link stays the queue, so no existing journey changes; the dashboard is reached from the first navigation link.

## Gate

Run from `/tmp/rai-w6-15-dashboard-ui/rai-web` after `set -a; . ./.env; set +a`, one suite at a time, against this lane's Postgres (`POSTGRES_PORT=55384 docker compose -p rai-admin up -d --wait`; `.env` from `.env.example` with 54320 → 55384, `PORT=8831`, `PUBLIC_BASE_URL=http://127.0.0.1:8831`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8832`, `SUBSTITUTE_PORT=8833`, `SUBSTITUTE_WEB_PORT=5194`, `OBS_MIGRATION_ADMIN_URL` on 55384, `RAI_PG_TOOLS=docker-compose:rai-admin`; not committed). Logs in `/tmp/rai-w6-15-dashboard-ui-logs/`. Hard-coded ports (8787 in some integration tests, 8789/5175 in `w1-int-substitute-absent`, 54370 in the performance launcher test) did not collide in this run; no retry was needed.

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1072 tests, 1072 pass (includes the 5 new view-model tests and the route test) |
| `npm run test:integration` | 474 tests, 474 pass |
| `npm run build && npm run check:substitute-absent` | exit 0 |
| `npm run test:browser:server` | 229 passed (8.9 min), including 12 `w6-15-dashboard` runs (4 tests × 3 widths) |
| `npm run test:browser:substitute` | 48 passed (29.4 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0 |
| `git diff --check` (new files intent-to-add) | exit 0 |
| mutation: a 0 rendered as a link, `w6-15-dashboard` on desktop-1440 | 1 failed (owner test), 3 passed; reverted |

## What this does not claim

No risk tiers or `riskTier` links (W6-16), no advisory counts (W6-09), no Admin screens (W6-05 to W6-07). The dashboard counts desk records only; it is not monitoring and nothing here claims an owner approved anything.
