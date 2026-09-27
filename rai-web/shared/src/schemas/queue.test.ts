import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import {
  QueueDrilldownQuerySchema,
  QueueQuerySchema,
  QUEUE_DEFAULTS,
  QUEUE_DRILLDOWN_KEYS,
} from './queue.js';

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
// W6-14 applies the drill-down filters inside the scoped query (server/src/queue/repository.ts), so the served schema
// now accepts them; it replaces W6-01's "not accepted before W6-14" test, as that test anticipated.
test('the served queue query accepts every drill-down key with the base filters, and still refuses riskTier', () => {
  const drill = {
    lane: 'dpo',
    laneStatus: 'sent_back',
    sla: 'due_soon',
    findingLane: 'it_security',
    findingSeverity: 'low',
    findingKind: 'defect',
  };
  assert.equal(Value.Check(QueueQuerySchema, { ...drill, status: 'in_review', search: 'x', page: 2 }), true);
  assert.deepEqual(QUEUE_DRILLDOWN_KEYS, Object.keys(QueueDrilldownQuerySchema.properties));
  assert.deepEqual([...QUEUE_DRILLDOWN_KEYS].sort(), Object.keys(drill).sort());
  for (const query of [{ lane: 'hr' }, { sla: 'overdue' }, { findingSeverity: 'info' }, { riskTier: 'high' }])
    assert.equal(Value.Check(QueueQuerySchema, query), false, JSON.stringify(query));
});
