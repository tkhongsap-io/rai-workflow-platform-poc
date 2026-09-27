# Plan: desk dashboard API (W6-13, #215)

Recorded before code. Branch `codex/w6-13-dashboard-api-advisory-and`, lane admin, database `rai-admin` on 55384.

1. Board CLAIM on Lane A (done before code).
2. Tests first (watch them fail):
   - `tests/integration/w6-13-dashboard.test.ts` (real Postgres, fixture app):
     - 401 without a session, 422 on an unknown query key, 200 and `DashboardResponseSchema` for every fixture identity;
     - scope per fixture identity: case totals match the queue, an out-of-scope case's findings, runs, lanes and activity never counted (owner-b sees all zeros);
     - consistency invariant for every fixture identity after a mixed journey (submitted, sent back, resubmitted, Ready, awaiting disposition): `byStatus` = queue `statusCounts`; summed `breached` = in-scope `listSlaBreaches`;
     - SLA boundaries: due today and due in two working days are due soon; three working days is neither; due yesterday is breached; a holiday on the frozen calendar shifts the horizon; a sent-back version's undecided lane is not pending;
     - findings by lane and severity with dispositions (`fixed_proposed` still open, `fixed_confirmed`/`waived` closed), `info` never counted, unavailable findings split outage/paused, only current versions;
     - QC run counts over 30 days with the boundary; `advisory` and `rechecks30d` are `0`; `risk.available` false;
     - activity: eight Monday weeks, oldest first, the submissions, resubmissions, send-backs and Ready in the right week.
   - `sla` unit-level: covered through the integration test; the scoped `listSlaBreaches` equals the unscoped one filtered by scope.
3. Implement: `sla/due-dates.ts` `workingDaysAfter`; `sla/breach.ts` scope parameter; `dashboard/repository.ts` `readDashboard`; `dashboard/routes.ts` `registerDashboardRoutes`; `app.ts` registration beside the queue.
4. Performance: `READS.dashboard`, `READ_BUDGETS_MS`, `run.ts` selected reads (Admin, DPO); a lane sample at 1,000 synthetic cases; `performance-targets.md` row.
5. Records: review.md with commands and results; DEVLOG top entry; CHANGELOG line.
6. Full gate (plan section 12), commit, push, verify remote head, open PR "Refs #215".
