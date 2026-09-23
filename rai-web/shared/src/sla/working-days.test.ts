import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bangkokDate, dueOn } from './working-days.js';

const SONGKRAN = ['2026-04-13', '2026-04-14', '2026-04-15'];

describe('working-day SLA', () => {
  it('reads the Bangkok calendar date, seven hours ahead of UTC', () => {
    assert.equal(bangkokDate(new Date('2026-04-08T17:30:00.000Z')), '2026-04-09');
    assert.equal(bangkokDate(new Date('2026-04-09T16:59:00.000Z')), '2026-04-09');
  });

  it('skips the weekend after a Thursday open (DPO 3 → the following Tuesday)', () => {
    const opened = new Date('2026-09-24T02:00:00.000Z'); // Thursday 09:00 Bangkok
    assert.equal(dueOn(opened, 3, []), '2026-09-29');
    assert.equal(dueOn(opened, 5, []), '2026-10-01');
  });

  it('skips a holiday block that sits on the next working days', () => {
    const opened = new Date('2026-04-09T02:00:00.000Z'); // Thursday before Songkran
    assert.equal(dueOn(opened, 3, SONGKRAN), '2026-04-17');
    assert.equal(dueOn(opened, 5, SONGKRAN), '2026-04-21');
  });

  it('does not count the open date itself when that date is a working day', () => {
    const friday = new Date('2026-09-25T02:00:00.000Z');
    assert.equal(dueOn(friday, 1, []), '2026-09-28');
  });

  it('counts from the Bangkok date: a Friday-evening UTC open is a Saturday open', () => {
    assert.equal(dueOn(new Date('2026-09-25T17:30:00.000Z'), 3, []), '2026-09-30');
  });

  it('crosses the year over a holiday open date and a New Year holiday', () => {
    const newYearEve = new Date('2026-12-31T02:00:00.000Z'); // a holiday itself
    assert.equal(dueOn(newYearEve, 3, ['2026-12-31', '2027-01-01']), '2027-01-06');
  });
});
