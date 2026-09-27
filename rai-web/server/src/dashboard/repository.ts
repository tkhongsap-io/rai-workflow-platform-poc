// W6-13 (W6 plan section 8.1): the desk dashboard read. Every query joins `case` and starts from the W0-05 scope
// predicate `caseScopeWhere(actor)`, inside one read-only snapshot, so nothing outside the actor's scope is ever
// counted (A06) and every number describes the same instant. Counts desk records only: no telemetry.
//
// W6-09 extends this file: it adds the `qc_run.recheck = false` predicate to `findings.open`,
// `findings.unavailableOpen`, `qc.runs30d`, `qc.unavailableRuns30d` and `qc.pausedRuns30d`, and wires
// `findings.advisory` and `qc.rechecks30d`, which are 0 until the recheck column exists (W6 plan section 5).

import { and, count, eq, gt, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { DASHBOARD_DUE_SOON_WORKING_DAYS, LANES, type Lane } from '@rai/shared/constants';
import type { CaseStatus } from '@rai/shared/schemas/cases';
import { DASHBOARD_ACTIVITY_WEEKS, type DashboardResponse } from '@rai/shared/schemas/dashboard';
import { bangkokDate } from '@rai/shared/sla/working-days';
import type { Actor } from '../authz/policy.js';
import { caseScopeWhere } from '../cases/scope.js';
import { caseStatusSql } from '../cases/status.js';
import type { Db, Executor } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { laneDecision } from '../db/schema/lane-decision.js';
import { packVersion } from '../db/schema/pack-version.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { qcRun } from '../db/schema/qc-run.js';
import { latestDisposition, undispositioned } from '../findings/repository.js';
import { openReviewTargets } from '../sla/breach.js';
import { dueDatesFor, workingDaysAfter, type SlaCalendarMemo } from '../sla/due-dates.js';
import { projectionColumnForLane } from '../workflow/repository.js';

type Severity = DashboardResponse['findings']['open'][number]['severity'];
type LaneRow = DashboardResponse['lanes'][number];
type ActivityWeek = DashboardResponse['activity'][number];

/** W0-07 3.3 `Severity`, in display order. The stored `info` value is never a defect severity and is not counted. */
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];
/** The QC window of `qc.*30d`: run rows requested in `(asOf - 30 days, asOf]`. */
export const DASHBOARD_QC_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Written from W6-09 (the reason joins `QC_UNAVAILABLE_REASONS`) by the W6-17 QC pause. */
const DESK_PAUSED = sql`'desk_paused'`;

const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The eight Monday week starts ending with the Asia/Bangkok week that holds `today`, oldest first. */
export function activityWeekStarts(today: string): string[] {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const sinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const current = addDays(today, -sinceMonday);
  return Array.from({ length: DASHBOARD_ACTIVITY_WEEKS }, (_, index) =>
    addDays(current, 7 * (index - (DASHBOARD_ACTIVITY_WEEKS - 1))),
  );
}

/** Asia/Bangkok midnight of a calendar date, as an instant (UTC+7, no daylight saving). */
const bangkokMidnight = (isoDate: string) => new Date(`${isoDate}T00:00:00+07:00`);

/** The Monday (Asia/Bangkok) of an instant column, as `YYYY-MM-DD`. */
const bangkokWeek = (column: AnyPgColumn) =>
  sql<string>`to_char(date_trunc('week', ${column} AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD')`;

async function caseCounts(tx: Executor, scope: SQL): Promise<DashboardResponse['cases']> {
  const current = alias(packVersion, 'dashboard_current');
  const draft = alias(packVersion, 'dashboard_draft');
  // The queue's derivation (queue/repository.ts readQueue), so byStatus equals its statusCounts.
  const visible = tx
    .select({ status: caseStatusSql(current, draft).as('dashboard_status') })
    .from(cases)
    .leftJoin(current, eq(current.id, cases.currentVersionId))
    .leftJoin(draft, eq(draft.id, cases.draftVersionId))
    .where(scope)
    .as('dashboard_visible');
  const byStatus: Record<CaseStatus, number> = {
    draft: 0,
    in_review: 0,
    sent_back: 0,
    awaiting_disposition: 0,
    ready_for_launch: 0,
  };
  let total = 0;
  for (const row of await tx
    .select({ status: visible.status, n: count() })
    .from(visible)
    .groupBy(visible.status)) {
    byStatus[row.status] = row.n;
    total += row.n;
  }
  return { total, byStatus };
}

async function laneCounts(tx: Executor, scope: SQL, asOf: Date, today: string): Promise<LaneRow[]> {
  const rows = new Map<Lane, LaneRow>(
    LANES.map((lane) => [lane, { lane, pending: 0, approved: 0, sentBack: 0, dueSoon: 0, breached: 0 }]),
  );
  // Decided lanes, from the projection on each in-scope case's current submitted version.
  const projections = await tx
    .select({
      raiStatus: cases.raiStatus,
      privacyStatus: cases.privacyStatus,
      securityStatus: cases.securityStatus,
      n: count(),
    })
    .from(cases)
    .where(and(scope, isNotNull(cases.currentVersionId)))
    .groupBy(cases.raiStatus, cases.privacyStatus, cases.securityStatus);
  for (const projection of projections) {
    for (const lane of LANES) {
      const value = projection[projectionColumnForLane(lane)];
      const row = rows.get(lane)!;
      if (value === 'approved') row.approved += projection.n;
      else if (value === 'sent_back') row.sentBack += projection.n;
    }
  }
  // Pending lanes of versions that are still the review target, with the W3-05 due dates (listSlaBreaches' rule).
  const memo: SlaCalendarMemo = new Map();
  for (const target of await openReviewTargets(tx, scope)) {
    const version = { ...target, id: target.versionId };
    const horizon = await workingDaysAfter(tx, version, asOf, DASHBOARD_DUE_SOON_WORKING_DAYS, memo);
    for (const { lane, dueOn } of await dueDatesFor(tx, version, memo)) {
      if (!target.pendingLanes.includes(lane)) continue;
      const row = rows.get(lane)!;
      row.pending += 1;
      if (dueOn < today) row.breached += 1;
      else if (dueOn <= horizon) row.dueSoon += 1;
    }
  }
  return LANES.map((lane) => rows.get(lane)!);
}

async function findingCounts(tx: Executor, scope: SQL): Promise<DashboardResponse['findings']> {
  // Undispositioned (the Ready rule's open finding) on each in-scope case's current version.
  const openOnCurrent = (kind: 'defect' | 'unavailable') =>
    and(scope, eq(qcFinding.kind, kind), undispositioned);
  const defects = await tx
    .select({ lane: qcFinding.owningLane, severity: qcFinding.severity, n: count() })
    .from(qcFinding)
    .innerJoin(cases, eq(cases.currentVersionId, qcFinding.versionId))
    .leftJoinLateral(latestDisposition, sql`true`)
    .where(and(openOnCurrent('defect'), inArray(qcFinding.severity, [...SEVERITIES])))
    .groupBy(qcFinding.owningLane, qcFinding.severity);
  const open: DashboardResponse['findings']['open'] = [];
  for (const lane of LANES)
    for (const severity of SEVERITIES) {
      const found = defects.find((row) => row.lane === lane && row.severity === severity);
      if (found !== undefined && found.n > 0) open.push({ lane, severity, count: found.n });
    }

  const unavailable = await tx
    .select({
      lane: qcFinding.owningLane,
      n: count(),
      paused: countWhere(sql`${qcRun.unavailableReason} = ${DESK_PAUSED}`),
    })
    .from(qcFinding)
    .innerJoin(cases, eq(cases.currentVersionId, qcFinding.versionId))
    .innerJoin(qcRun, eq(qcRun.id, qcFinding.runId))
    .leftJoinLateral(latestDisposition, sql`true`)
    .where(openOnCurrent('unavailable'))
    .groupBy(qcFinding.owningLane);
  const unavailableFor = (lane: Lane) => {
    const row = unavailable.find((r) => r.lane === lane);
    return row === undefined ? { outage: 0, paused: 0 } : { outage: row.n - row.paused, paused: row.paused };
  };
  return {
    open,
    unavailableOpen: {
      ai_coe: unavailableFor('ai_coe'),
      dpo: unavailableFor('dpo'),
      it_security: unavailableFor('it_security'),
    },
    advisory: 0, // W6-09: recheck findings on current versions
  };
}

async function qcCounts(tx: Executor, scope: SQL, asOf: Date): Promise<DashboardResponse['qc']> {
  const since = new Date(asOf.getTime() - DASHBOARD_QC_WINDOW_DAYS * DAY_MS);
  const [row] = await tx
    .select({
      runs: count(),
      unavailable: countWhere(sql`${qcRun.status} = 'unavailable'`),
      paused: countWhere(sql`${qcRun.unavailableReason} = ${DESK_PAUSED}`),
    })
    .from(qcRun)
    .innerJoin(packVersion, eq(packVersion.id, qcRun.versionId))
    .innerJoin(cases, eq(cases.id, packVersion.caseId))
    .where(and(scope, gt(qcRun.requestedAt, since), lte(qcRun.requestedAt, asOf)));
  return {
    runs30d: row?.runs ?? 0,
    unavailableRuns30d: row?.unavailable ?? 0,
    pausedRuns30d: row?.paused ?? 0,
    rechecks30d: 0, // W6-09: recheck run rows
  };
}

async function activity(tx: Executor, scope: SQL, asOf: Date, today: string): Promise<ActivityWeek[]> {
  const starts = activityWeekStarts(today);
  const from = bangkokMidnight(starts[0]!);
  const weeks = new Map<string, ActivityWeek>(
    starts.map((weekStart) => [
      weekStart,
      { weekStart, submitted: 0, resubmitted: 0, sentBack: 0, ready: 0 },
    ]),
  );
  const inWindow = (column: AnyPgColumn) => and(gte(column, from), lte(column, asOf));

  const submittedWeek = bangkokWeek(packVersion.submittedAt);
  for (const row of await tx
    .select({
      week: submittedWeek,
      n: count(),
      resubmitted: countWhere(sql`${packVersion.versionNumber} > 1`),
    })
    .from(packVersion)
    .innerJoin(cases, eq(cases.id, packVersion.caseId))
    .where(and(scope, inWindow(packVersion.submittedAt)))
    .groupBy(submittedWeek)) {
    const week = weeks.get(row.week);
    if (week === undefined) continue;
    week.submitted = row.n;
    week.resubmitted = row.resubmitted;
  }

  const readyWeek = bangkokWeek(packVersion.readyAt);
  for (const row of await tx
    .select({ week: readyWeek, n: count() })
    .from(packVersion)
    .innerJoin(cases, eq(cases.id, packVersion.caseId))
    .where(and(scope, inWindow(packVersion.readyAt)))
    .groupBy(readyWeek)) {
    const week = weeks.get(row.week);
    if (week !== undefined) week.ready = row.n;
  }

  const decidedWeek = bangkokWeek(laneDecision.decidedAt);
  for (const row of await tx
    .select({ week: decidedWeek, n: count() })
    .from(laneDecision)
    .innerJoin(packVersion, eq(packVersion.id, laneDecision.versionId))
    .innerJoin(cases, eq(cases.id, packVersion.caseId))
    .where(and(scope, eq(laneDecision.decision, 'send_back'), inWindow(laneDecision.decidedAt)))
    .groupBy(decidedWeek)) {
    const week = weeks.get(row.week);
    if (week !== undefined) week.sentBack = row.n;
  }
  return starts.map((weekStart) => weeks.get(weekStart)!);
}

/** `GET /api/dashboard` for `actor` at `asOf` (the application clock). */
export async function readDashboard(db: Db, actor: Actor, asOf: Date): Promise<DashboardResponse> {
  const today = bangkokDate(asOf);
  const scope = caseScopeWhere(actor);
  return db.transaction(
    async (tx) => ({
      asOf: asOf.toISOString(),
      today,
      cases: await caseCounts(tx, scope),
      lanes: await laneCounts(tx, scope, asOf, today),
      findings: await findingCounts(tx, scope),
      qc: await qcCounts(tx, scope, asOf),
      risk: { available: false }, // W6-16: `case.risk_tier` once W5 writes it
      activity: await activity(tx, scope, asOf, today),
    }),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
