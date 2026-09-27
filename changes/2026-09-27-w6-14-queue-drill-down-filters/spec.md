# Spec: queue drill-down filters (W6-14, #224)

Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) section 8.2, row W6-14, sections 11.2 and 13; W6-13's review "Deviations" (handoff: `laneStatus=pending` uses the dashboard's review-target rule). The plan wins over issue #224. Shape: `QueueDrilldownQuerySchema` (W6-01, unchanged).

## Contract

- `QueueQuerySchema` (served by `GET /api/queue`) gains the six optional keys of `QueueDrilldownQuerySchema`: `lane`, `laneStatus` (`pending|approved|sent_back`), `sla` (`due_soon|breached`), `findingLane`, `findingSeverity` (`high|medium|low`), `findingKind` (`defect|unavailable`). Unknown values and unknown keys stay 422 `invalid_input`. `riskTier` is still refused (W6-16).
- `QueueDrilldownQuerySchema` stays exported and unchanged; `QUEUE_DRILLDOWN_KEYS` lists its keys.

## Semantics (all inside the scoped `visible` sub-select)

`readQueue(db, actor, query, asOf)`. Every drill-down predicate is AND-ed with `caseScopeWhere(actor)` in the `visible` sub-select, so `total`, `items`, `statusCounts` and `filterOptions` all describe the drilled-down, in-scope population (plan 8.2: "before counts and pagination"). With no drill-down key, the response is exactly as before (the W6-13 invariant `statusCounts = dashboard byStatus` is unchanged).

Lane-level filters, where L is `lane` if given, otherwise any of the three lanes:

- **`laneStatus=approved` / `sent_back`**: the case has a current submitted version and the projection of L is that value (the dashboard's `approved` / `sentBack`).
- **`laneStatus=pending`**: the case is a review target (current submitted version, no successor draft, not Ready: the `openReviewTargets` set) and L's projection is `pending` (the dashboard's `pending`).
- **`sla=breached` / `due_soon`**: the case is a review target and L is pending with due date before `today` (breached) or, not breached, on or before the `DASHBOARD_DUE_SOON_WORKING_DAYS` horizon on the version's frozen calendar (due soon). Computed through the same helper the dashboard uses (`sla/lane-states.ts` `pendingLaneStates`), resolved to a case-ID set inside the read's snapshot. `today` is the Asia/Bangkok date of `asOf`, the application clock.
- **`lane` alone**: the case has a current submitted version (every submitted version is reviewed in all three lanes).
- `laneStatus` and `sla` together: both must hold for L (e.g. `laneStatus=approved&sla=breached` is empty).

Finding filters, one finding matching all given keys:

- The case's **current** version has a finding with the given `owning_lane` (`findingLane`), `severity` (`findingSeverity`) and `kind` (`findingKind`) whose latest disposition is none or `fixed_proposed` (the Ready rule's `undispositioned`, as the dashboard counts). Any subset of the three keys may be given. The stored `info` severity cannot be requested.
- Recheck (advisory) findings are excluded by W6-09 when the column exists (plan section 5).

Consistency (tested): for each dashboard lane row, the queue `total` for `lane=L&laneStatus=pending|approved|sent_back`, `lane=L&sla=breached|due_soon` equals the dashboard's `pending`, `approved`, `sentBack`, `breached`, `dueSoon` (one case has at most one version per lane, so case counts equal lane counts).

## Queue screen

- `parseQueueQuery` accepts the new keys (same fail-closed parsing: a duplicate, unknown or malformed value is the invalid-link notice, never a widened list). `queueParams` writes them. A URL round-trips.
- Applying the search/filter form keeps the drill-down keys (`applyQueueForm`); "Reset filters" clears everything.
- When a drill-down key is present, the screen shows a "Dashboard filters" list naming each (lane, lane state, SLA, finding lane, severity, kind) in th and en, and a "Clear dashboard filters" button that removes only those keys.
- `api.getQueue` sends the new keys.

## Not in this ticket

Dashboard screen and links (W6-15), `riskTier` (W6-16), recheck exclusion (W6-09), the in-memory API substitute (frozen for W6, plan 11.2: it rejects nothing new because no substitute journey sends a drill-down key), a migration.
