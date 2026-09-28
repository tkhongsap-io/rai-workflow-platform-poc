// W6-15 (W6 plan sections 8.2 and 9): the dashboard's pure presentation rules. Every countable number links to the
// W6-14 queue drill-down that lists the cases behind it; a 0 is plain text; bars come from the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DashboardResponse } from '@rai/shared/schemas/dashboard';
import { parseQueueQuery } from '../queue/view-model.js';
import {
  barPercent,
  countCell,
  defectQuery,
  findingCount,
  isEmptyDashboard,
  laneSlaQuery,
  laneStateQuery,
  queueLink,
  statusQuery,
  unavailableQuery,
  unavailableTotal,
} from './dashboard.view-model.js';

const DASHBOARD: DashboardResponse = {
  asOf: '2026-09-28T03:00:00.000Z',
  today: '2026-09-28',
  cases: {
    total: 3,
    byStatus: { draft: 1, in_review: 2, sent_back: 0, awaiting_disposition: 0, ready_for_launch: 0 },
  },
  lanes: [
    { lane: 'ai_coe', pending: 2, approved: 0, sentBack: 0, dueSoon: 1, breached: 0 },
    { lane: 'dpo', pending: 1, approved: 1, sentBack: 0, dueSoon: 0, breached: 1 },
    { lane: 'it_security', pending: 2, approved: 0, sentBack: 0, dueSoon: 0, breached: 0 },
  ],
  findings: {
    open: [
      { lane: 'dpo', severity: 'high', count: 2 },
      { lane: 'ai_coe', severity: 'low', count: 1 },
    ],
    unavailableOpen: {
      ai_coe: { outage: 0, paused: 0 },
      dpo: { outage: 1, paused: 2 },
      it_security: { outage: 0, paused: 0 },
    },
    advisory: 0,
  },
  qc: { runs30d: 4, unavailableRuns30d: 1, pausedRuns30d: 0, rechecks30d: 0 },
  risk: { available: false },
  activity: [],
};

/** The query a link opens, read back the way the queue screen reads its URL. */
function opened(to: string) {
  const [path, search = ''] = to.split('?');
  assert.equal(path, '/queue');
  const parsed = parseQueueQuery(search);
  assert.equal(parsed.valid, true, `${to} must parse on the queue screen`);
  return parsed.valid ? parsed.query : undefined;
}

test('a 0 is plain text and a count with a queue filter is a link to it', () => {
  assert.deepEqual(countCell(0, statusQuery('draft')), { kind: 'text', count: 0 });
  assert.deepEqual(countCell(4, undefined), { kind: 'text', count: 4 });
  assert.deepEqual(countCell(2, statusQuery('in_review')), {
    kind: 'link',
    count: 2,
    to: '/queue?status=in_review',
  });
  assert.equal(queueLink({}), '/queue');
});

test('each tile cell opens the W6-14 drill-down that lists the cases behind it', () => {
  assert.deepEqual(opened(queueLink(statusQuery('sent_back'))), {
    page: 1,
    pageSize: 25,
    searchBy: 'all',
    status: 'sent_back',
  });
  for (const state of ['pending', 'approved', 'sent_back'] as const) {
    const query = opened(queueLink(laneStateQuery('dpo', state)));
    assert.equal(query?.lane, 'dpo');
    assert.equal(query?.laneStatus, state);
    assert.equal(query?.sla, undefined);
  }
  for (const sla of ['due_soon', 'breached'] as const) {
    const query = opened(queueLink(laneSlaQuery('it_security', sla)));
    assert.equal(query?.lane, 'it_security');
    assert.equal(query?.sla, sla);
    assert.equal(query?.laneStatus, undefined);
  }
  // A defect count must not also list QC-unavailable findings of the same severity (W6-14 review, deviations).
  const defect = opened(queueLink(defectQuery('ai_coe', 'medium')));
  assert.equal(defect?.findingLane, 'ai_coe');
  assert.equal(defect?.findingSeverity, 'medium');
  assert.equal(defect?.findingKind, 'defect');
  const unavailable = opened(queueLink(unavailableQuery('dpo')));
  assert.equal(unavailable?.findingLane, 'dpo');
  assert.equal(unavailable?.findingKind, 'unavailable');
  assert.equal(unavailable?.findingSeverity, undefined);
});

test('finding cells read the served rows; a lane and severity with no row is 0', () => {
  assert.equal(findingCount(DASHBOARD, 'dpo', 'high'), 2);
  assert.equal(findingCount(DASHBOARD, 'ai_coe', 'low'), 1);
  assert.equal(findingCount(DASHBOARD, 'it_security', 'high'), 0);
  assert.equal(findingCount(DASHBOARD, 'dpo', 'medium'), 0);
  assert.equal(unavailableTotal(DASHBOARD, 'dpo'), 3); // outage plus paused: the filter lists both
  assert.equal(unavailableTotal(DASHBOARD, 'ai_coe'), 0);
});

test('bars are a share of the tile maximum, never wider than the tile, 0 when nothing is counted', () => {
  assert.equal(barPercent(0, 0), 0);
  assert.equal(barPercent(0, 5), 0);
  assert.equal(barPercent(5, 5), 100);
  assert.equal(barPercent(1, 4), 25);
  assert.equal(barPercent(9, 4), 100);
});

test('the dashboard is empty only when no case is in scope', () => {
  assert.equal(isEmptyDashboard(DASHBOARD), false);
  assert.equal(
    isEmptyDashboard({
      ...DASHBOARD,
      cases: {
        total: 0,
        byStatus: { draft: 0, in_review: 0, sent_back: 0, awaiting_disposition: 0, ready_for_launch: 0 },
      },
    }),
    true,
  );
});
