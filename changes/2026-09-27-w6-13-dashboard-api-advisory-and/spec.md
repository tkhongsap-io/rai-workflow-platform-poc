# Spec: desk dashboard API (W6-13, #215)

Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) section 8.1, row W6-13, section 11.2, section 12 ("Dashboard performance") and section 13. The plan wins over issue #215. Shape: `DashboardResponseSchema` (W6-01, unchanged here).

## Route

- `GET /api/dashboard`, action `dashboard.view`, target `none` (every signed-in role; W0-05 rows from W6-01). No query parameters: an unknown query key is 422 `invalid_input`. No session is 401 before anything else.
- The answer validates against `DashboardResponseSchema`. `asOf` is the application clock at the read; `today` is its Asia/Bangkok date.
- `server/src/dashboard/repository.ts` `readDashboard(db, actor, asOf)` computes it inside **one** `repeatable read`, `read only` transaction. Every query joins `case` and applies `caseScopeWhere(actor)`; nothing outside the actor's scope is ever counted (A06).

## Counting rules

- **`cases`**: the in-scope cases grouped by the derived status (`caseStatusSql`, as the queue does). `total` is their count. Invariant (tested per fixture identity): `byStatus` equals `readQueue(db, actor, {}).statusCounts` and `total` equals the queue's unfiltered `total`.
- **`lanes`** (always the three lanes, in `LANES` order), over in-scope cases whose `current_version_id` is set (a current submitted version):
  - `approved` / `sentBack`: the lane projection (`rai_status`, `privacy_status`, `security_status`) is `approved` / `sent_back`;
  - `pending`: the lane projection is `pending` **and** the version is still the review target, the `sla/breach.ts` `openReviewTargets` set (no successor draft, not Ready). A lane left undecided on a version another lane sent back is not awaiting anyone, so it is not pending here;
  - `breached`: a pending lane whose due date (`dueDatesFor`, the version's frozen `sla` and `calendar`) is before `today`, exactly as `listSlaBreaches`. Invariant (tested per fixture identity): the sum over lanes equals the number of `listSlaBreaches(db, asOf)` rows whose case is in scope;
  - `dueSoon`: a pending lane that is not breached and whose due date is on or before the date `DASHBOARD_DUE_SOON_WORKING_DAYS` (2) working days after `today`, walked with the version's frozen calendar (`dueOn(asOf, 2, holidays)`). Due today counts as due soon.
- **`findings.open`**: `kind = 'defect'` findings on each in-scope case's current version whose latest disposition is none or `fixed_proposed` (the Ready rule's `undispositioned`), grouped by `owning_lane` and `severity`; only `high`, `medium` and `low` (the W0-07 `Severity`; the stored `info` value is never a defect severity and is not counted). Only non-zero rows, ordered by `LANES` then high, medium, low.
- **`findings.unavailableOpen`**: `kind = 'unavailable'` undispositioned findings on current versions, per owning lane (all three lanes present); `paused` when the finding's run has `unavailable_reason = 'desk_paused'` (written from W6-09/W6-17), otherwise `outage`.
- **`findings.advisory`**: `0` (W6-09 wires it).
- **`qc`**: `qc_run` rows on any version of an in-scope case with `requested_at` in `(asOf - 30 days, asOf]`: `runs30d` all, `unavailableRuns30d` `status = 'unavailable'`, `pausedRuns30d` `unavailable_reason = 'desk_paused'` (a subset). `rechecks30d`: `0` (W6-09). Under `QC_MODE=content` each part's row counts.
- **`risk`**: `{ available: false }` (W6-16).
- **`activity`**: exactly eight entries, oldest first, one per Asia/Bangkok week starting Monday, the last being the week holding `today`. Over in-scope cases, with the instant in `[first Monday 00:00 Bangkok, asOf]`:
  - `submitted`: `pack_version.submitted_at` in the week (every submission, first or later);
  - `resubmitted`: the subset with `version_number > 1`;
  - `sentBack`: `lane_decision` rows with `decision = 'send_back'` decided in the week (one per lane decision);
  - `ready`: `pack_version.ready_at` in the week.

## SLA scope parameter

`sla/breach.ts` `openReviewTargets(exec, scope?)` and `listSlaBreaches(exec, asOf, scope?)` take an optional SQL predicate over `case` (the dashboard passes `caseScopeWhere(actor)`). Without it both behave exactly as before (the W3-03 digest and W3-05 tests unchanged). `sla/due-dates.ts` gains `workingDaysAfter(exec, version, asOf, workingDays, memo)`, the date `workingDays` working days after the Bangkok date of `asOf` under the version's frozen calendar, reusing the same memo and failing closed like `dueDatesFor`.

## Performance

W6 plan section 8.1: p95 < 500 ms at 1,000 cases. `tests/performance/profiles.ts` `READS` gains `dashboard: '/api/dashboard'` with its own 500 ms advisory budget (`READ_BUDGETS_MS`), measured by the existing `measure` step on the queue server (1,000 cases) as the Admin and DPO reads. A lane sample at 1,000 synthetic cases is recorded in [review](review.md); `docs/engineering/performance-targets.md` section 2 gains the dashboard row (dated W6-13 amendment). A miss is a finding, not a gate failure.

## Not in this ticket

UI (W6-15), queue drill-down filters (W6-14), recheck predicate and counts (W6-09), risk tiers (W6-16), a log event (`request.completed` covers the read, section 10), the in-memory API substitute (frozen for W6, section 11.2), any migration.
