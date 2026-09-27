// W3-05: per-lane due date from the version frozen at submit. A later configuration revision is not read.

import { Value } from 'typebox/value';
import { LANES, type Lane } from '@rai/shared/constants';
import { NotFoundError } from '@rai/shared/errors';
import { CalendarBodySchema, SlaBodySchema } from '@rai/shared/schemas/cases';
import type { LaneDue } from '@rai/shared/schemas/sla';
import { dueOn } from '@rai/shared/sla/working-days';
import { readVersionRow } from '../cases/repository.js';
import { readRevisionById } from '../configuration/store.js';
import type { Executor } from '../db/client.js';

export class FrozenSlaUnavailable extends Error {
  constructor(readonly versionId: string) {
    super(`version ${versionId} has no frozen sla and calendar revisions`);
    this.name = 'FrozenSlaUnavailable';
  }
}

/** Frozen (sla, calendar) revision pairs read once per request; nearly every version shares one pair. */
export type SlaCalendarMemo = Map<string, ReturnType<typeof readSlaCalendar>>;

function frozenId(frozen: unknown, kind: 'sla' | 'calendar'): string | undefined {
  if (frozen === null || typeof frozen !== 'object') return undefined;
  const id = (frozen as Record<string, unknown>)[kind];
  return typeof id === 'string' ? id : undefined;
}

async function readSlaCalendar(exec: Executor, slaId: string, calendarId: string) {
  const [slaRow, calendarRow] = await Promise.all([
    readRevisionById(exec, slaId),
    readRevisionById(exec, calendarId),
  ]);
  if (
    slaRow?.kind !== 'sla' ||
    !Value.Check(SlaBodySchema, slaRow.body) ||
    calendarRow?.kind !== 'calendar' ||
    !Value.Check(CalendarBodySchema, calendarRow.body)
  ) {
    return undefined;
  }
  return { sla: slaRow.body, holidays: calendarRow.body.holidays };
}

async function frozenSlaCalendar(
  exec: Executor,
  version: { id: string; frozenConfiguration: unknown },
  memo: SlaCalendarMemo,
) {
  const slaId = frozenId(version.frozenConfiguration, 'sla');
  const calendarId = frozenId(version.frozenConfiguration, 'calendar');
  if (slaId === undefined || calendarId === undefined) throw new FrozenSlaUnavailable(version.id);
  const key = `${slaId}:${calendarId}`;
  if (!memo.has(key)) memo.set(key, readSlaCalendar(exec, slaId, calendarId));
  const frozen = await memo.get(key);
  if (frozen === undefined) throw new FrozenSlaUnavailable(version.id);
  return frozen;
}

/**
 * W6-13: the Asia/Bangkok date `workingDays` working days after the date of `asOf`, walked with this version's frozen
 * calendar (the dashboard's due-soon horizon). Fails closed like `dueDatesFor`.
 */
export async function workingDaysAfter(
  exec: Executor,
  version: { id: string; frozenConfiguration: unknown },
  asOf: Date,
  workingDays: number,
  memo: SlaCalendarMemo = new Map(),
): Promise<string> {
  const frozen = await frozenSlaCalendar(exec, version, memo);
  return dueOn(asOf, workingDays, frozen.holidays);
}

/**
 * Due date of each lane. The clock is this version's `submitted_at` (D06: it restarts on the next submit).
 * Fails closed if the frozen sla or calendar revision is missing.
 */
export async function dueDatesFor(
  exec: Executor,
  version: { id: string; submittedAt: Date; frozenConfiguration: unknown },
  memo: SlaCalendarMemo = new Map(),
): Promise<LaneDue[]> {
  const frozen = await frozenSlaCalendar(exec, version, memo);
  const opened = version.submittedAt;
  return LANES.map((lane: Lane) => ({
    lane,
    openedAt: opened.toISOString(),
    dueOn: dueOn(opened, frozen.sla[lane], frozen.holidays),
  }));
}

export async function laneDueDates(exec: Executor, versionId: string): Promise<LaneDue[]> {
  const version = await readVersionRow(exec, versionId);
  if (version === undefined || version.submittedAt === null) throw new NotFoundError('version');
  return dueDatesFor(exec, { ...version, submittedAt: version.submittedAt });
}
