# Review: queue drill-down filters (W6-14, #224)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) section 8.2, row W6-14, sections 11.2, 12 and 13 (the plan wins over issue #224); W6-13's review "Deviations" handoff (`laneStatus=pending` on the review-target set). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". D07-D10 stay open. Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Contract** `shared/src/schemas/queue.ts`: `QueueQuerySchema` spreads `QueueDrilldownQuerySchema.properties` (W6-01 shape unchanged), so `GET /api/queue` accepts `lane`, `laneStatus`, `sla`, `findingLane`, `findingSeverity`, `findingKind` and still refuses unknown values and `riskTier` (422 `invalid_input`). New `QUEUE_DRILLDOWN_KEYS`. `QueueResponse` doc comments say counts and options describe the drilled-down population.
- **Repository** `server/src/queue/repository.ts`: `readQueue(db, actor, query, asOf = new Date())`; `drilldownPredicates` builds the predicates and they are AND-ed with `caseScopeWhere(actor)` in the `visible` sub-select, so `total`, `items`, `statusCounts` and `filterOptions` all come after the drill-down and inside scope (A06):
  - `laneStatus=pending`: open review target (current submitted version, no successor draft, not Ready) and the lane projection `pending`; `approved`/`sent_back`: current submitted version and the projection value. Without `lane`, any lane.
  - `lane` alone: a current submitted version.
  - `sla`: case IDs from `pendingLaneStates(tx, asOf, scope)` with the requested state (and lane, if given), resolved in the same read-only snapshot; empty set is `false`.
  - finding keys: `EXISTS` one `qc_finding` on `case.current_version_id` that is `undispositioned` (the Ready rule, via `latestDisposition`) and matches each given key. A comment marks where W6-09 adds `qc_run.recheck = false`.
- **Shared SLA state** new `server/src/sla/lane-states.ts` `pendingLaneStates(exec, asOf, scope?, memo?)`: the pending lanes of `openReviewTargets` with `breached` (due before today), `due_soon` (within `DASHBOARD_DUE_SOON_WORKING_DAYS` on the frozen calendar) or `on_track`. `dashboard/repository.ts` `laneCounts` now uses it (same rule, moved, not changed; the six W6-13 tests pass unchanged).
- **Route** `queue/routes.ts`: passes the application clock (`deps.now()`; `app.ts` already hands it `dbAndClock()`).
- **SPA**: `api.getQueue` sends the six keys. `screens/queue/view-model.ts`: `drilldownOf`, `withoutDrilldown` (page resets to 1), `applyQueueForm` (form Apply keeps the drill-down), `drilldownLabels` (one label per key in `QUEUE_DRILLDOWN_KEYS` order). `queue-screen.tsx`: a "Dashboard filters" section (`data-testid="queue-drilldown"`, heading plus list plus "Clear dashboard filters" button) when a key is present; Apply keeps it; Reset clears everything. `queue.css`: `.queue-drilldown`. Locales: ten `queue.drill.*` keys in th and en.
- **Docs**: W0-02 7.10 dated W6-14 amendment (2026-09-28). DEVLOG, CHANGELOG, board CLAIM on Lane A.
- **Tests**:
  - new `tests/integration/w6-14-queue-drilldown.test.ts` (5 tests, real Postgres, HTTP through the authenticated handlers):
    1. every key accepted; 422 `invalid_input` on `lane=hr`, `laneStatus=ready`, `sla=overdue`, `findingSeverity=info`, `findingKind=advisory`, `findingLane=` and `riskTier=high`;
    2. lane state on a mixed journey (one case per status): pending/approved/sent back per lane and across lanes, a sent-back version's undecided lane not pending, `lane` alone excludes the draft, `statusCounts` and `filterOptions` describe the drilled population, the base `status` filter narrows inside it, pagination after filtering; **for every fixture identity and every lane, the queue `total` of `laneStatus=pending|approved|sent_back` and `sla=breached|due_soon` equals the dashboard's `pending`, `approved`, `sentBack`, `breached`, `dueSoon`**;
    3. SLA on the frozen calendar (DPO 3 days, others 5, Songkran): due soon across lanes and per lane, breached per lane, an approved lane leaves the list, `laneStatus` + `sla` both required, a send-back removes the case, the in-process read honours `asOf`;
    4. findings: current version only (a superseded v1 finding drops), `fixed_proposed` open, `waived` and `fixed_confirmed` closed, `info` never matches a severity, one finding must match all keys, combination with lane-state keys;
    5. scope: for six drill-downs the CM SPOC only ever sees CM cases, `statusCounts` sum to `total`, options stay inside scope; owner-b and a grantless actor get 0 and empty options; moving a case out of the SPOC's unit removes it.
  - `shared/src/schemas/queue.test.ts`: the W6-01 test "the served queue query does not accept a drill-down filter before W6-14 applies it" is **replaced** by "the served queue query accepts every drill-down key … and still refuses riskTier". Justification: the plan changes the behaviour here (section 8.2; W6-01's own comment said W6-14 would add them in the PR that applies them). The refusals it proved for unknown values and `riskTier` are kept.
  - `web/src/screens/queue/view-model.test.ts`: 4 new tests (URL round-trip with all keys, malformed or repeated keys invalid, Apply keeps and clear drops the drill-down, labels in key order with the horizon).
  - Red first: before the code, the integration file failed with 422 `validation.unknown_field` on every drill-down request and the unit files failed to import `QUEUE_DRILLDOWN_KEYS` / `applyQueueForm`.
  - Mutation check (by hand, reverted): `laneStatus=pending` on any submitted version; dropping `undispositioned`; ignoring `lane` for `sla`; not correlating findings to the current version. Each made the integration test fail.

## Deviations

Choices under Ta's delegation of 2026-09-27 where the plan is silent; each keeps W6-01's shape and the plan's contracts.

- **Counts and options follow the drill-down.** Plan 8.2 says the filters apply inside `visible` "before counts and pagination", so `statusCounts` and `filterOptions` describe the drilled-down, in-scope population. The base filters (search, status, owner, group) still apply after counts as before. With no drill-down key nothing changes, so the W6-13 invariant (`byStatus = statusCounts`) holds.
- **`lane` alone** means "has a current submitted version" (every version is reviewed in all three lanes), so the key is never accepted and ignored. `laneStatus` or `sla` without `lane` applies to any lane (the plan says so for `sla`; the same rule is used for `laneStatus`).
- **Finding keys match one finding with all given keys**; `findingSeverity` without `findingKind` matches either kind (QC-unavailable findings carry a severity too). The W6-15 links for the dashboard's defect counts should add `findingKind=defect`. The filter lists cases, while the dashboard's finding numbers count findings: a case with two open DPO high defects is one row under a "2". W6-15 decides how to link that number (plan 8.2: "to the case when the count is 1").
- **Shared helper outside the row's file list**: `server/src/sla/lane-states.ts` plus the `dashboard/repository.ts` change, so a dashboard number and its list cannot drift. Also outside the list, because the feature needs them: `queue/routes.ts` (clock), `web/src/api/client.ts` (sends the keys), `queue.css`, locales (D12 th/en labels), W0-02 7.10 note.
- **`readQueue`'s `asOf` defaults to `new Date()`** for in-process callers (tests, W6-13's invariant); the HTTP route always passes the application clock.
- **Browser coverage** of the drill-down is W6-15's ("Dashboard per role with drill-down", plan section 13); here the URL round-trip is proved in the view-model unit tests and the existing queue browser specs pass unchanged.
- **In-memory API substitute** unchanged (frozen for W6, plan 11.2); no substitute journey sends a drill-down key.

## Gate

Run from `/tmp/rai-w6-14-queue-drill-down-filters/rai-web` after `set -a; . ./.env; set +a`, one suite at a time, against this lane's Postgres (`POSTGRES_PORT=55384 docker compose -p rai-admin up -d --wait`; `.env` from `.env.example` with 54320 → 55384, `PORT=8831`, `PUBLIC_BASE_URL=http://127.0.0.1:8831`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8832`, `SUBSTITUTE_PORT=8833`, `SUBSTITUTE_WEB_PORT=5194`, `OBS_MIGRATION_ADMIN_URL` on 55384, `RAI_PG_TOOLS=docker-compose:rai-admin`; not committed). Logs in `/tmp/rai-w6-14-queue-drill-down-filters-logs/`. Hard-coded ports noted (8787 in some integration tests, 8789/5175 in `w1-int-substitute-absent`, 54370 in the performance launcher test); none collided in this run.

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1023 tests, 1023 pass |
| `npm run test:integration` | 442 tests, 442 pass (includes the 5 new `w6-14-queue-drilldown` tests) |
| `npm run build && npm run check:substitute-absent` | exit 0 and exit 0 |
| `npm run test:browser:server` | 205 passed (8.3 min) |
| `npm run test:browser:substitute` | 48 passed (29.5 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0 |
| `git diff --check HEAD` (all changes staged) | exit 0 |

## What this does not claim

No dashboard screen or links (W6-15), no `riskTier` (W6-16), no recheck exclusion (W6-09). Nothing here claims an owner approved anything.
