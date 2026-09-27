// W6-13: the eight Asia/Bangkok activity weeks (W6 plan section 8.1), Monday starts, oldest first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_ACTIVITY_WEEKS } from '@rai/shared/schemas/dashboard';
import { activityWeekStarts } from './repository.js';

test('the last week holds today; a Monday and a Sunday of the same week agree', () => {
  const monday = activityWeekStarts('2026-04-20');
  assert.equal(monday.length, DASHBOARD_ACTIVITY_WEEKS);
  assert.deepEqual(monday, [
    '2026-03-02',
    '2026-03-09',
    '2026-03-16',
    '2026-03-23',
    '2026-03-30',
    '2026-04-06',
    '2026-04-13',
    '2026-04-20',
  ]);
  assert.deepEqual(activityWeekStarts('2026-04-26'), monday);
  assert.equal(activityWeekStarts('2026-04-19').at(-1), '2026-04-13');
});

test('weeks cross month and year boundaries on calendar dates', () => {
  assert.deepEqual(activityWeekStarts('2027-01-01'), [
    '2026-11-09',
    '2026-11-16',
    '2026-11-23',
    '2026-11-30',
    '2026-12-07',
    '2026-12-14',
    '2026-12-21',
    '2026-12-28',
  ]);
});
