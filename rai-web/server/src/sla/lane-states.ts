// W6-13 / W6-14 (W6 plan sections 8.1 and 8.2): the SLA state of every pending lane on an open review target. The
// dashboard counts these states and the queue drill-down filters on them, through this one function, so a dashboard
// number and the list its link opens can never disagree.

import type { SQL } from 'drizzle-orm';
import { DASHBOARD_DUE_SOON_WORKING_DAYS, type Lane } from '@rai/shared/constants';
import { bangkokDate } from '@rai/shared/sla/working-days';
import type { Executor } from '../db/client.js';
import { openReviewTargets } from './breach.js';
import { dueDatesFor, workingDaysAfter, type SlaCalendarMemo } from './due-dates.js';

/** `breached`: due before today (as `listSlaBreaches`); `due_soon`: not breached, due within the horizon. */
export type PendingLaneSla = 'breached' | 'due_soon' | 'on_track';

export interface PendingLaneState {
  caseId: string;
  versionId: string;
  lane: Lane;
  dueOn: string;
  sla: PendingLaneSla;
}

/**
 * Each pending lane of the `openReviewTargets` set (optionally scoped by a predicate over `case`) with its due date on
 * the version's frozen calendar and its SLA state at `asOf`. `due_soon` means due on or before the date
 * `DASHBOARD_DUE_SOON_WORKING_DAYS` working days after the Asia/Bangkok date of `asOf`; due today is due soon.
 */
export async function pendingLaneStates(
  exec: Executor,
  asOf: Date,
  scope?: SQL,
  memo: SlaCalendarMemo = new Map(),
): Promise<PendingLaneState[]> {
  const today = bangkokDate(asOf);
  const states: PendingLaneState[] = [];
  for (const target of await openReviewTargets(exec, scope)) {
    const version = { ...target, id: target.versionId };
    const horizon = await workingDaysAfter(exec, version, asOf, DASHBOARD_DUE_SOON_WORKING_DAYS, memo);
    for (const { lane, dueOn } of await dueDatesFor(exec, version, memo)) {
      if (!target.pendingLanes.includes(lane)) continue;
      const sla: PendingLaneSla = dueOn < today ? 'breached' : dueOn <= horizon ? 'due_soon' : 'on_track';
      states.push({ caseId: target.caseId, versionId: target.versionId, lane, dueOn, sla });
    }
  }
  return states;
}
