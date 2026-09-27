# Plan: queue drill-down filters (W6-14, #224)

Recorded before code. Branch `codex/w6-14-queue-drill-down-filters`, lane admin, database `rai-admin` on 55384.

1. Board CLAIM on Lane A (done before code).
2. Tests first (watch them fail):
   - `tests/integration/w6-14-queue-drilldown.test.ts` (real Postgres, fixture app, over HTTP `GET /api/queue` and in-process `readQueue`):
     - every key accepted with valid values, 422 on bad values and on `riskTier`;
     - lane state filters on a mixed journey, and the dashboard consistency (`total` = dashboard lane count) for every fixture identity;
     - SLA due soon / breached across lanes and per lane on the frozen calendar at a fixed clock;
     - finding filters: current version only, undispositioned (`fixed_proposed` open; `waived` closed), lane, severity, kind combined;
     - scope: an out-of-scope case matching a filter never appears in `items`, `total`, `statusCounts` or `filterOptions` (CM SPOC, owner-b, grantless actor); counts and options describe the filtered population; pagination after filtering.
   - `shared/src/schemas/queue.test.ts`: the served schema accepts the drill-down keys (the W6-01 "not accepted before W6-14" test is replaced, as that test itself anticipated) and still refuses `riskTier`.
   - `web/src/screens/queue/view-model.test.ts`: URL round-trip with drill-down keys, malformed drill-down values refused, Apply keeps drill-down, clear removes only drill-down, labels.
3. Implement: `sla/lane-states.ts` (shared pending-lane SLA state; dashboard `laneCounts` switched to it), `queue/repository.ts`, `queue/routes.ts` (clock), `app.ts` unchanged if `dbAndClock()` already carries `now`; `shared/src/schemas/queue.ts`; `web/src/api/client.ts`; `web/src/screens/queue/{view-model.ts,queue-screen.tsx}`; locales th/en.
4. Docs: W0-02 7.10 dated note (W6-14 joined the keys); DEVLOG; CHANGELOG.
5. Full gate (plan section 12), review.md, commit, push, verify remote head, PR "Refs #224".
