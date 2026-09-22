// W3-05 breach query. The notifier (W3-03) consumes this; there is no SLA HTTP route and no escalation.

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { LANES, type Lane } from '@rai/shared/constants';
import type { SlaBreach } from '@rai/shared/schemas/sla';
import { bangkokDate, dueOn } from '@rai/shared/sla/working-days';
import type { Executor } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { packVersion } from '../db/schema/pack-version.js';
import { projectionColumnForLane } from '../workflow/repository.js';
import { frozenSlaCalendar } from './due-dates.js';

export interface OpenLaneTarget {
  caseId: string;
  versionId: string;
  submittedAt: Date;
  frozenConfiguration: unknown;
  pendingLanes: Lane[];
}

/** Current submitted version that is still the review target, with the lanes that have no decision yet. */
export async function openReviewTargets(exec: Executor): Promise<OpenLaneTarget[]> {
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
      and(isNull(cases.draftVersionId), isNull(packVersion.readyAt), isNotNull(packVersion.submittedAt)),
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
export async function listSlaBreaches(exec: Executor, asOf: Date): Promise<SlaBreach[]> {
  const today = bangkokDate(asOf);
  const targets = await openReviewTargets(exec);
  const breaches: SlaBreach[] = [];
  for (const target of targets) {
    const { sla, holidays } = await frozenSlaCalendar(exec, target.versionId, target.frozenConfiguration);
    for (const lane of target.pendingLanes) {
      const due = dueOn(target.submittedAt, sla[lane], holidays);
      if (due < today) {
        breaches.push({ caseId: target.caseId, versionId: target.versionId, lane, dueOn: due });
      }
    }
  }
  breaches.sort(
    (a, b) =>
      a.dueOn.localeCompare(b.dueOn) || a.caseId.localeCompare(b.caseId) || a.lane.localeCompare(b.lane),
  );
  return breaches;
}
