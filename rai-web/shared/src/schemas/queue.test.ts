import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { QueueDrilldownQuerySchema, QueueQuerySchema, QUEUE_DEFAULTS } from './queue.js';

test('queue accepts defaults and combined Thai search with scoped filters', () => {
  assert.equal(Value.Check(QueueQuerySchema, {}), true);
  assert.deepEqual(QUEUE_DEFAULTS, { page: 1, pageSize: 25, searchBy: 'all' });
  assert.equal(
    Value.Check(QueueQuerySchema, {
      search: 'ข้อมูล',
      searchBy: 'all',
      status: 'awaiting_disposition',
      owner: 'fixture-owner',
      useCaseGroup: 'service',
      page: 2,
      pageSize: 100,
    }),
    true,
  );
});
test('queue rejects malformed or unbounded queries', () => {
  for (const query of [
    { page: 0 },
    { page: 1.5 },
    { page: 1000001 },
    { pageSize: 101 },
    { status: 'ready' },
    { searchBy: 'email' },
    { owner: '' },
    { useCaseGroup: '' },
    { search: 'a'.repeat(201) },
    { includeAll: true },
  ])
    assert.equal(Value.Check(QueueQuerySchema, query), false, JSON.stringify(query));
});

// W6-01 (W6 plan section 8.2): the dashboard drill-down filters are declared here; W6-14 applies them inside the
// scoped query and only then adds them to the served QueueQuerySchema, so a filter is never accepted and ignored.
test('drill-down filters validate their closed value sets', () => {
  assert.equal(Value.Check(QueueDrilldownQuerySchema, {}), true);
  assert.equal(
    Value.Check(QueueDrilldownQuerySchema, {
      lane: 'dpo',
      laneStatus: 'pending',
      sla: 'breached',
      findingLane: 'ai_coe',
      findingSeverity: 'high',
      findingKind: 'unavailable',
    }),
    true,
  );
  assert.equal(Value.Check(QueueDrilldownQuerySchema, { sla: 'due_soon' }), true);
  for (const query of [
    { lane: 'hr' },
    { laneStatus: 'ready' },
    { sla: 'overdue' },
    { findingSeverity: 'info' },
    { findingKind: 'advisory' },
    { riskTier: 'high' }, // W6-16 adds it
    { status: 'draft' }, // the base queue filters are QueueQuerySchema's
  ])
    assert.equal(Value.Check(QueueDrilldownQuerySchema, query), false, JSON.stringify(query));
});
test('the served queue query does not accept a drill-down filter before W6-14 applies it', () => {
  for (const query of [{ lane: 'dpo' }, { sla: 'breached' }, { findingKind: 'defect' }])
    assert.equal(Value.Check(QueueQuerySchema, query), false, JSON.stringify(query));
});
