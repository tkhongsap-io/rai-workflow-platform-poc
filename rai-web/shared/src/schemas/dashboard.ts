// W6-01 contract (W6 plan section 8.1): the desk dashboard read, `GET /api/dashboard` (action `dashboard.view`,
// served by W6-13). The dashboard was added under Ta's delegation of 2026-09-27; it is not a PRD requirement. It counts
// desk records only, every count inside the actor's scope (`caseScopeWhere`); no telemetry, no monitoring.

import { Type, type Static } from 'typebox';
import { CASE_STATUSES } from './cases.js';
import { LaneSchema } from './review.js';

/** Activity covers the last eight Asia/Bangkok weeks (Monday starts). */
export const DASHBOARD_ACTIVITY_WEEKS = 8;

const object = <T extends Parameters<typeof Type.Object>[0]>(fields: T) =>
  Type.Object(fields, { additionalProperties: false });
const count = Type.Integer({ minimum: 0 });
const isoDate = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
// W0-07 3.3 `Severity` (shared/src/qc/types.ts): no `info`.
const SeveritySchema = Type.Enum(['high', 'medium', 'low'] as const);
const unavailableCounts = object({ outage: count, paused: count });

export const DashboardResponseSchema = object({
  asOf: Type.String({ minLength: 1 }), // ISO instant of the read
  today: isoDate, // the Asia/Bangkok date of `asOf`
  /** `byStatus` equals the queue's `statusCounts` for the same actor (tested invariant, W6-13). */
  cases: object({
    total: count,
    byStatus: object(
      Object.fromEntries(CASE_STATUSES.map((status) => [status, count])) as {
        [S in (typeof CASE_STATUSES)[number]]: typeof count;
      },
    ),
  }),
  /** Per lane, on each in-scope case's current submitted version. `breached`: due before `today`. */
  lanes: Type.Array(
    object({
      lane: LaneSchema,
      pending: count,
      approved: count,
      sentBack: count,
      dueSoon: count, // pending, not breached, due within DASHBOARD_DUE_SOON_WORKING_DAYS working days
      breached: count,
    }),
  ),
  findings: object({
    /** Undispositioned defects on current versions; advisory (recheck) findings excluded (W6-09). */
    open: Type.Array(object({ lane: LaneSchema, severity: SeveritySchema, count })),
    /** Open QC-UNAVAILABLE findings; `paused` counts runs whose reason is `desk_paused` (W6-09, W6-17). */
    unavailableOpen: object({
      ai_coe: unavailableCounts,
      dpo: unavailableCounts,
      it_security: unavailableCounts,
    }),
    advisory: count, // recheck findings on current versions; 0 until W6-09 wires it
  }),
  /**
   * Run rows in the last 30 days (under QC_MODE=content one trigger writes two rows, each counted). The first three
   * exclude recheck runs (W6-09); `pausedRuns30d` is a subset of `unavailableRuns30d`; `rechecks30d` is 0 until W6-09.
   */
  qc: object({ runs30d: count, unavailableRuns30d: count, pausedRuns30d: count, rechecks30d: count }),
  /** W6-16: tiers as stored on `case.risk_tier` (labels are D07's, provisional); until W5, `available: false`. */
  risk: Type.Union([
    object({ available: Type.Literal(false) }),
    object({
      available: Type.Literal(true),
      tiers: Type.Array(object({ tier: Type.String({ minLength: 1 }), count })),
      notAssessed: count,
    }),
  ]),
  activity: Type.Array(
    object({ weekStart: isoDate, submitted: count, resubmitted: count, sentBack: count, ready: count }),
    { maxItems: DASHBOARD_ACTIVITY_WEEKS },
  ),
});
export type DashboardResponse = Static<typeof DashboardResponseSchema>;
