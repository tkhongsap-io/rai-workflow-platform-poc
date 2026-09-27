// W3-05 breach query. The notifier (W3-03) consumes this; there is no SLA HTTP route and no escalation.

import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { LANES, type Lane } from '@rai/shared/constants';
import type { SlaBreach } from '@rai/shared/schemas/sla';
import { bangkokDate } from '@rai/shared/sla/working-days';
import type { Executor } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { packVersion } from '../db/schema/pack-version.js';
import { projectionColumnForLane } from '../workflow/repository.js';
import { dueDatesFor, type SlaCalendarMemo } from './due-dates.js';

export interface OpenLaneTarget {
  caseId: string;
  versionId: string;
  submittedAt: Date;
  frozenConfiguration: unknown;
  pendingLanes: Lane[];
}

/**
 * Current submitted version that is still the review target, with the lanes that have no decision yet. `scope` is an
 * optional predicate over `case` (W6-13: the dashboard passes `caseScopeWhere(actor)`); without it, every case.
 */
export async function openReviewTargets(exec: Executor, scope?: SQL): Promise<OpenLaneTarget[]> {
  const rows = await exec
    .select({
      caseId: cases.id,
      versionId: packVersion.id,
      submittedAt: packVersion.submittedAt,
      frozenConfiguration: packVersion.frozenConfiguration,
      raiStatus: cases.raiStatus,
      privacyStatus: cases.privacyStatus,
      securityStatus: cases.securityStatus,
    })
    .from(cases)
    .innerJoin(packVersion, eq(packVersion.id, cases.currentVersionId))
    .where(
      and(
        isNull(cases.draftVersionId),
        isNull(packVersion.readyAt),
        isNotNull(packVersion.submittedAt),
        scope,
      ),
    );

  const targets: OpenLaneTarget[] = [];
  for (const row of rows) {
    if (row.submittedAt === null) continue;
    const pendingLanes = LANES.filter((lane) => row[projectionColumnForLane(lane)] === 'pending');
    if (pendingLanes.length === 0) continue;
    targets.push({
      caseId: row.caseId,
      versionId: row.versionId,
      submittedAt: row.submittedAt,
      frozenConfiguration: row.frozenConfiguration,
      pendingLanes,
    });
  }
  return targets;
}

/**
 * Pending lanes whose due date is strictly before the Asia/Bangkok date of `asOf`.
 * A successor draft or a Ready version is not a breach: the clock for N stops being the review target,
 * and the next submitted version starts its own clock (D06).
 */
export async function listSlaBreaches(exec: Executor, asOf: Date, scope?: SQL): Promise<SlaBreach[]> {
  const today = bangkokDate(asOf);
  const memo: SlaCalendarMemo = new Map();
  const breaches: SlaBreach[] = [];
  for (const target of await openReviewTargets(exec, scope)) {
    const { caseId, versionId } = target;
    for (const { lane, dueOn } of await dueDatesFor(exec, { ...target, id: versionId }, memo)) {
      if (target.pendingLanes.includes(lane) && dueOn < today)
        breaches.push({ caseId, versionId, lane, dueOn });
    }
  }
  breaches.sort(
    (a, b) =>
      a.dueOn.localeCompare(b.dueOn) || a.caseId.localeCompare(b.caseId) || a.lane.localeCompare(b.lane),
  );
  return breaches;
}
