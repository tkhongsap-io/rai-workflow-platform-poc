// W6-01 (W6 plan section 8.1): the dashboard read shape, before the route exists (W6-13 serves it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { DASHBOARD_ACTIVITY_WEEKS, DashboardResponseSchema, type DashboardResponse } from './dashboard.js';

const lanes = ['ai_coe', 'dpo', 'it_security'] as const;
const response: DashboardResponse = {
  asOf: '2026-09-27T03:00:00.000Z',
  today: '2026-09-27',
  cases: {
    total: 6,
    byStatus: { draft: 1, in_review: 2, sent_back: 1, awaiting_disposition: 1, ready_for_launch: 1 },
  },
  lanes: lanes.map((lane) => ({ lane, pending: 2, approved: 1, sentBack: 1, dueSoon: 1, breached: 0 })),
  findings: {
    open: [
      { lane: 'dpo', severity: 'high', count: 2 },
      { lane: 'ai_coe', severity: 'low', count: 1 },
    ],
    unavailableOpen: {
      ai_coe: { outage: 1, paused: 0 },
      dpo: { outage: 0, paused: 0 },
      it_security: { outage: 0, paused: 0 },
    },
    advisory: 0,
  },
  qc: { runs30d: 12, unavailableRuns30d: 1, pausedRuns30d: 0, rechecks30d: 0 },
  risk: { available: false },
  activity: Array.from({ length: DASHBOARD_ACTIVITY_WEEKS }, (_, index) => ({
    weekStart: `2026-08-${String(3 + index * 7).padStart(2, '0')}`,
    submitted: index,
    resubmitted: 0,
    sentBack: 0,
    ready: 0,
  })),
};

test('a full dashboard response validates; activity covers eight weeks', () => {
  assert.equal(DASHBOARD_ACTIVITY_WEEKS, 8);
  assert.equal(Value.Check(DashboardResponseSchema, response), true);
  assert.equal(
    Value.Check(DashboardResponseSchema, {
      ...response,
      risk: { available: true, tiers: [{ tier: 'unknown', count: 1 }], notAssessed: 5 },
    }),
    true,
  );
});

test('every case status and every lane is present; severity has no info; no unknown key', () => {
  const { draft: _draft, ...missingStatus } = response.cases.byStatus;
  const { dpo: _dpo, ...missingLane } = response.findings.unavailableOpen;
  for (const bad of [
    { ...response, cases: { ...response.cases, byStatus: missingStatus } },
    { ...response, findings: { ...response.findings, unavailableOpen: missingLane } },
    {
      ...response,
      findings: { ...response.findings, open: [{ lane: 'dpo', severity: 'info', count: 1 }] },
    },
    { ...response, findings: { ...response.findings, open: [{ lane: 'hr', severity: 'high', count: 1 }] } },
    { ...response, lanes: [{ ...response.lanes[0], breached: -1 }] },
    { ...response, qc: { ...response.qc, rechecks30d: 1.5 } },
    { ...response, risk: { available: true } },
    { ...response, risk: { available: false, tiers: [] } },
    { ...response, today: '27/09/2026' },
    { ...response, activity: [{ ...response.activity[0], weekStart: 'week 1' }] },
    { ...response, telemetry: {} },
  ])
    assert.equal(Value.Check(DashboardResponseSchema, bad), false, JSON.stringify(bad).slice(0, 120));
});
