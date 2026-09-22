import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueueQuery, queueParams, NEXT_ACTION_LABELS } from './view-model.js';

test('URL values round-trip without dropping literal Thai/wildcard filters', () => {
  const query = {
    search: 'ชื่อ%_\\',
    searchBy: 'owner' as const,
    status: 'sent_back' as const,
    owner: 'synthetic:owner',
    useCaseGroup: 'g & x',
    page: 2,
    pageSize: 1,
  };
  assert.deepEqual(parseQueueQuery(queueParams(query).toString()), { valid: true, query });
  assert.deepEqual(parseQueueQuery(''), { valid: true, query: { page: 1, pageSize: 25, searchBy: 'all' } });
});
test('malformed, duplicate and unknown restrictions never widen a URL silently', () => {
  for (const q of [
    'page=0',
    'page=1.5',
    'page=-1',
    'page=NaN',
    'page=1e2',
    'page=1000001',
    'pageSize=101',
    'owner=',
    'status=ready',
    'searchBy=email',
    'allCases=true',
    'status=draft&status=in_review',
    '__proto__=x',
  ])
    assert.deepEqual(parseQueueQuery(q), { valid: false }, q);
  assert.equal(parseQueueQuery('search=' + 'x'.repeat(201)).valid, false);
});
test('pagination preserves applied restrictions and action labels use the API cue', () => {
  const parsed = parseQueueQuery('owner=x&search=abc&page=3');
  assert.ok(parsed.valid);
  const next = parseQueueQuery(queueParams({ ...parsed.query, page: 4 }).toString());
  assert.deepEqual(next, {
    valid: true,
    query: { owner: 'x', search: 'abc', page: 4, pageSize: 25, searchBy: 'all' },
  });
  assert.equal(NEXT_ACTION_LABELS.resolve_findings, 'queue.next.resolve_findings');
  assert.equal(NEXT_ACTION_LABELS.review_complete, 'queue.next.review_complete');
});
