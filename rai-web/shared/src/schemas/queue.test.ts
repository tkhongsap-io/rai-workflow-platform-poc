import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { QueueQuerySchema, QUEUE_DEFAULTS } from './queue.js';

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
