// D06 working-day arithmetic. Asia/Bangkok has no daylight-saving shift, so a calendar date is the UTC
// date of the instant plus seven hours. The open date is not one of the counted days: the due date is
// the Bangkok date reached by walking `workingDays` weekdays forward, skipping Saturday, Sunday and
// the frozen holiday list. SLA values and holidays are arguments; this module does not read configuration.

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` in Asia/Bangkok for an instant. */
export function bangkokDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parts(isoDate: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) throw new Error(`not a calendar date: ${isoDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function weekday(isoDate: string): number {
  const { year, month, day } = parts(isoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addCalendarDays(isoDate: string, days: number): string {
  const { year, month, day } = parts(isoDate);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWorkingDay(isoDate: string, holidays: ReadonlySet<string>): boolean {
  const day = weekday(isoDate);
  if (day === 0 || day === 6) return false;
  return !holidays.has(isoDate);
}

/**
 * Due date for a lane that opened at `openedAt` with `workingDays` working days of allowance.
 * `holidays` are `YYYY-MM-DD` dates that are not working days (D06 Thai public-holiday list).
 */
export function dueOn(openedAt: Date, workingDays: number, holidays: readonly string[]): string {
  if (!Number.isInteger(workingDays) || workingDays < 1) {
    throw new Error('workingDays must be a positive integer');
  }
  const skipped = new Set(holidays);
  let cursor = bangkokDate(openedAt);
  let remaining = workingDays;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (isWorkingDay(cursor, skipped)) remaining -= 1;
  }
  return cursor;
}
