// W3-05: per-lane due date from the version frozen at submit. A later configuration revision is not read.

import { Value } from 'typebox/value';
import { LANES, type Lane } from '@rai/shared/constants';
import { NotFoundError } from '@rai/shared/errors';
import { CalendarBodySchema, SlaBodySchema, type ConfigurationBodies } from '@rai/shared/schemas/cases';
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

function frozenId(frozen: unknown, kind: 'sla' | 'calendar'): string | undefined {
  if (frozen === null || typeof frozen !== 'object') return undefined;
  const id = (frozen as Record<string, unknown>)[kind];
  return typeof id === 'string' ? id : undefined;
}

/** SLA working days and holiday list frozen on this version. Fails closed if either revision is missing. */
export async function frozenSlaCalendar(
  exec: Executor,
  versionId: string,
  frozen: unknown,
): Promise<{ sla: ConfigurationBodies['sla']; holidays: readonly string[] }> {
  const slaId = frozenId(frozen, 'sla');
  const calendarId = frozenId(frozen, 'calendar');
  if (slaId === undefined || calendarId === undefined) throw new FrozenSlaUnavailable(versionId);
  const [slaRow, calendarRow] = await Promise.all([
    readRevisionById(exec, slaId),
    readRevisionById(exec, calendarId),
  ]);
  if (slaRow === undefined || slaRow.kind !== 'sla' || !Value.Check(SlaBodySchema, slaRow.body)) {
    throw new FrozenSlaUnavailable(versionId);
  }
  if (
    calendarRow === undefined ||
    calendarRow.kind !== 'calendar' ||
    !Value.Check(CalendarBodySchema, calendarRow.body)
  ) {
    throw new FrozenSlaUnavailable(versionId);
  }
  return { sla: slaRow.body, holidays: calendarRow.body.holidays };
}

/** Due date of each lane. The clock is this version's `submitted_at` (D06: it restarts on the next submit). */
export async function laneDueDates(exec: Executor, versionId: string): Promise<LaneDue[]> {
  const version = await readVersionRow(exec, versionId);
  if (version === undefined || version.submittedAt === null) throw new NotFoundError('version');
  const opened = version.submittedAt;
  const { sla, holidays } = await frozenSlaCalendar(exec, versionId, version.frozenConfiguration);
  return LANES.map((lane: Lane) => ({
    lane,
    openedAt: opened.toISOString(),
    dueOn: dueOn(opened, sla[lane], holidays),
  }));
}
