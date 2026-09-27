# Review: desk dashboard API (W6-13, #215)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 8.1, 11 (row W6-13), 11.2, 12 and 13 (the plan wins over issue #215). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)" (Q14 due-soon horizon of 2 working days, from W6-01). D07-D10 stay open. Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Route** `server/src/dashboard/routes.ts`: `GET /api/dashboard`, `config.auth` action `dashboard.view`, target `none`; a querystring schema with no property and `additionalProperties: false`, so an unknown key is 422 `invalid_input`. Registered in `app.ts` beside the queue route (same `dbAndClock()`, so `asOf` is the application clock).
- **Repository** `server/src/dashboard/repository.ts` `readDashboard(db, actor, asOf)`: one `repeatable read`, read-only transaction; every query joins `case` and applies `caseScopeWhere(actor)`.
  - `cases`: `caseStatusSql` over the same joins as `readQueue`, grouped through a sub-select.
  - `lanes`: approved and sent back from the projection on cases with a current submitted version; pending, due soon and breached from `openReviewTargets(tx, scope)` with `dueDatesFor` and the new `workingDaysAfter` horizon, one memo per read.
  - `findings`: undispositioned (`latestDisposition` / `undispositioned` from `findings/repository.ts`) defects on current versions by lane and severity (`high|medium|low` only, non-zero rows in `LANES` then severity order); unavailable findings per lane split on `qc_run.unavailable_reason = 'desk_paused'`; `advisory: 0`.
  - `qc`: run rows of in-scope cases in `(asOf - 30 days, asOf]`; `rechecks30d: 0`.
  - `risk: { available: false }`.
  - `activity`: `activityWeekStarts(today)` (eight Mondays, oldest first) and three grouped queries on `date_trunc('week', … AT TIME ZONE 'Asia/Bangkok')` over `[first Monday 00:00 Bangkok, asOf]`.
  - A header comment names the counts W6-09 extends (W6 plan section 5).
- **SLA** `sla/breach.ts`: `openReviewTargets(exec, scope?)` and `listSlaBreaches(exec, asOf, scope?)` take an optional predicate over `case`; unscoped calls are unchanged. `sla/due-dates.ts`: the frozen sla/calendar lookup is factored into `frozenSlaCalendar` (same memo, same `FrozenSlaUnavailable`), and `workingDaysAfter(exec, version, asOf, workingDays, memo)` returns the horizon date.
- **Performance harness**: `tests/performance/profiles.ts` `READS.dashboard = '/api/dashboard'` and `READ_BUDGETS_MS` (500 ms for the dashboard, 300 ms for the rest, as before); `surface-measure.ts` uses the per-read budget; `run.ts` `selectedReads` adds the Admin and DPO dashboard reads (stable assertions: `cases`, `risk`; the Admin total equals the 1,000 manifest rows). The `read` helper takes an optional `kind` so two reads may share one route.
- **Docs**: `docs/engineering/performance-targets.md` section 2 gains the dashboard row (dated 2026-09-27, W6-13). No other spec amendment is assigned to W6-13 (W6 plan section 17); W0-02 7.10 already records the shape (W6-01).
- **Tests**:
  - new `tests/integration/w6-13-dashboard.test.ts` (6 tests, real Postgres through the authenticated handlers):
    1. 401 without a session, 422 on `?lane=dpo`, 200 with a schema-valid body for all eight fixture identities; `asOf`/`today` from the app clock; `advisory` and `rechecks30d` are 0; `risk.available` false;
    2. scope and the consistency invariant for **every fixture identity** after a mixed journey (one case in each status): `cases.byStatus` equals `readQueue(...).statusCounts`, `total` equals the queue total, summed `breached` equals the in-scope `listSlaBreaches` rows, and the in-process read equals the HTTP answer; exact Admin and CM-SPOC lanes and findings; owner-b and a grantless actor get all zeros; moving a case out of the SPOC's business unit removes it from every count;
    3. SLA boundaries on the frozen calendar (DPO 3 days, others 5, Songkran 13-15 April): Songkran pushes the horizon so DPO is due soon on Friday 10 April; three working days out is not due soon; due today is due soon; due exactly two working days out is due soon; the day after due is breached and not due soon; an approved lane leaves every SLA count; a send-back ends pending for all lanes; each step checks the breach invariant;
    4. findings: `fixed_proposed` still open, `fixed_confirmed`, `waived` and `not_applicable` closed, `info` not counted, unavailable findings per lane, and a superseded version's findings dropped after resubmission; out-of-scope findings invisible to the CM SPOC;
    5. QC runs: exactly 30 days back excluded, 30 days minus 1 ms included, a run after `asOf` excluded, NULL-reason unavailable counted, scope per identity;
    6. activity: eight Monday weeks, a resubmission at Monday 00:30 Bangkok (still Sunday in UTC) counted in the Monday week, send-back and Ready weeks, per-scope counts, and the window moving forward.
  - new unit test `server/src/dashboard/repository.test.ts`: `activityWeekStarts` (Monday/Sunday of one week, month and year boundaries).
  - Mutation check (run by hand, not committed): each of these edits made the integration test fail, then was reverted: dropping the scope from the QC query (2 failures), `dueOn <= today` for breached, dropping `undispositioned`, `dueOn < horizon`, `AT TIME ZONE 'UTC'`, counting undecided lanes on non-target versions.
  - No existing test changed.
- **Board**: CLAIM on Lane A.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the W6-01 shape and the plan's contracts.

- **`pending` counts only lanes on a version that is still the review target** (the `openReviewTargets` set: current, no successor draft, not Ready). The projection keeps `pending` on the undecided lanes of a version another lane sent back, but nobody is waiting on them, and counting them would make `pending` disagree with `dueSoon`/`breached`, which the plan defines on that set. `approved` and `sentBack` are the projection on every current submitted version. **Handoff to W6-14**: the `laneStatus=pending` queue filter should use the same rule so a dashboard link lands on the same count.
- **`activity.submitted` counts every submission; `resubmitted` is the subset with `version_number > 1`** (as `pausedRuns30d` is a subset of `unavailableRuns30d`). `sentBack` counts `lane_decision` send-back rows, as the plan says. Every window ends at `asOf`.
- **The QC window is `(asOf - 30 days, asOf]`** on `requested_at`.
- **`paused` is already wired to `unavailable_reason = 'desk_paused'`.** The value cannot be stored until W6-09 adds it to `qc_run_unavailable_reason_check`, so this ticket proves only that other reasons (and NULL) count as outage; W6-09 and W6-17 prove the paused path.
- **The stored `info` severity is never counted** (the shape's `Severity` has no `info`, W0-07 3.3).
- **No query parameter is accepted**; an unknown key is 422, so the dashboard never silently ignores a filter (W6-14 filters belong to the queue).
- **`workingDaysAfter` lives in `sla/due-dates.ts`**, a file the row does not list, so the horizon reuses the frozen-calendar memo and fails closed exactly like the due dates. A version without its frozen `sla`/`calendar` fails the read (500), as `listSlaBreaches` does.
- **Performance sample.** The plan names `npm run perf:run` with a `dashboard` profile. The `dashboard` read is added to that harness for the W6-EXIT run, but the harness needs its dedicated two-server rig (container on 54370, parent-authorized final head), which would collide with the other lanes running on this machine. The sample recorded here is a lane sample instead: a temporary in-process test (not committed) seeded the W3-06 `seed-recipe` population through the real API into this lane's database (995 cases plus the 5 fixtures = 1,000: 200 draft, 500 in review, 150 sent back of which 50 resubmitted, 150 Ready through real approvals; synthetic runs and findings on 250 in-review versions), then read `GET /api/dashboard` through `app.inject`, 30 warm-up and 200 measured reads per identity. It measures the handler and database, not an HTTP socket.

## Performance sample (lane, 2026-09-28)

Apple M5 Max, 128 GiB, Node v24.21.0, PostgreSQL 16.15 (docker, project `rai-admin`), NODE_ENV=test, in-process `app.inject`, sequential. Target p95 < 500 ms at 1,000 cases (W6 plan 8.1).

| Identity | Cases in scope | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| fx-user-admin | 1,000 | 24.8 | 30.9 | 38.5 |
| fx-user-dpo | 1,000 | 25.0 | 30.5 | 39.5 |
| fx-user-spoc-cm | 665 | 22.8 | 28.3 | 35.0 |
| fx-user-owner-cm | 503 | 21.9 | 27.1 | 35.3 |

Advisory only; acceptance is W6-EXIT's `perf:run` measurement.

## Gate

Run from `/tmp/rai-w6-13-dashboard-api-advisory-and/rai-web` after `set -a; . ./.env; set +a`, one suite at a time, against this lane's Postgres (`POSTGRES_PORT=55384 docker compose -p rai-admin up -d --wait`; `.env` from `.env.example` with 54320 → 55384, `PORT=8831`, `PUBLIC_BASE_URL=http://127.0.0.1:8831`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8832`, `SUBSTITUTE_PORT=8833`, `SUBSTITUTE_WEB_PORT=5194`, `OBS_MIGRATION_ADMIN_URL` on 55384; not committed). Logs in `/tmp/rai-w6-13-dashboard-api-advisory-and-logs/`.

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 881 tests, 881 pass |
| `npm run test:integration` | first run 406/410: the four `w7-01-backup` tests failed with `pg_tools_container_not_found` because this lane's `.env` still named `RAI_PG_TOOLS=docker-compose:rai-dev` (the `.env.example` project) while the lane's Postgres runs as compose project `rai-admin`. Lane environment only; `.env` corrected to `docker-compose:rai-admin`, then rerun: **410 tests, 410 pass** (includes the 6 new `w6-13-dashboard` tests) |
| `npm run build && npm run check:substitute-absent` | exit 0 and exit 0 |
| `npm run test:browser:server` | 205 passed (8.0 min) |
| `npm run test:browser:substitute` | 48 passed (29.3 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0 |
| `git diff --check HEAD` (all changes staged) | exit 0 |

Also run alone: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w6-13-dashboard.test.ts` → 6 pass; before the repository existed it failed with `ERR_MODULE_NOT_FOUND` (tests written first).

## What this does not claim

No UI (W6-15), no drill-down filter (W6-14), no recheck counts (W6-09), no risk tiers (W6-16). The lane sample is not the W3-06 rig's measurement. Nothing here claims an owner approved anything.
