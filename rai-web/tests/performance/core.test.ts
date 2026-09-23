import type { QueueItem } from '@rai/shared/schemas/queue';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durations, guard, percentile95, queueShape, expectedQueue, type RunConfig } from './core.js';

const config: RunConfig = {
  baseUrl: 'http://127.0.0.1:8899',
  target: { host: '127.0.0.1', port: 54999, database: 'rai_perf_unit' },
  urls: {
    app: 'postgresql://rai_app:synthetic@127.0.0.1:54999/rai_perf_unit',
    owner: 'postgresql://rai_owner:synthetic@127.0.0.1:54999/rai_perf_unit',
    operator: 'postgresql://rai_operator:synthetic@127.0.0.1:54999/rai_perf_unit',
  },
  finalHead: 'a'.repeat(40),
  authorization: 'parent-authorized-final-head',
};
test('guard requires explicit matching isolated URLs for every role; pure, no connections', () => {
  guard(config);
  for (const role of ['app', 'owner', 'operator'] as const) {
    for (const url of [
      '',
      config.urls[role].replace('54999', '54365'),
      config.urls[role].replace('rai_perf_unit', 'rai_dev'),
      config.urls[role].replace('127.0.0.1', 'example.com'),
      config.urls[role] + '?options=unsafe',
      config.urls[role].replace(`rai_${role}:`, 'postgres:'),
    ]) {
      assert.throws(() => guard({ ...config, urls: { ...config.urls, [role]: url } }));
    }
  }
  assert.throws(() => guard({ ...config, finalHead: 'pending' }));
  assert.throws(() => guard({ ...config, baseUrl: 'https://example.com' }));
  assert.throws(() => guard({ ...config, target: { ...config.target, port: 54365 } }));
});
test('nearest-rank p95 is sample 190 of 200; rejects empty/nonfinite/error placeholders', () => {
  assert.equal(percentile95(Array.from({ length: 200 }, (_, i) => 200 - i)), 190);
  for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => percentile95(values));
});
test('duration join requires exactly one valid queue completion per sample', () => {
  const line = (id: string, ms: unknown) =>
    JSON.stringify({
      event: 'request.completed',
      correlationId: id,
      fields: { route: '/api/queue', status: 200, durationMs: ms },
    });
  assert.deepEqual(durations(`${line('b', 2)}\n${line('a', 1)}`, ['a', 'b']), [1, 2]);
  for (const log of ['', line('b', 2), `${line('a', 1)}\n${line('a', 2)}`, line('a', -1), line('a', '1')])
    assert.throws(() => durations(log, ['a']));
  assert.throws(() => durations(line('a', 1), ['a', 'a']));
});
test('malformed queue evidence is rejected before any percentile', () => {
  for (const response of [null, {}, { total: -1 }, { total: 0, page: 1, pageSize: 101, items: [] }])
    assert.throws(() => queueShape(response));
});

test('scope, counts and literal Unicode search precede pagination in the evidence oracle', () => {
  const a: QueueItem = {
    caseId: 'a',
    registryId: 'PERF-A',
    useCaseName: 'ทดสอบ cafe\u0301 %_!\\',
    businessUnitId: 'CM',
    businessUnit: 'CM',
    businessOwner: 'fixture:fx-user-owner-cm',
    ownerDisplayName: 'Synthetic A',
    useCaseGroup: 'customer-analytics',
    sourceRecordId: { kind: 'unknown' },
    status: 'draft',
    currentVersionNumber: null,
    latestVersionNumber: 1,
    updatedAt: '2026-09-22T00:00:00Z',
    lanes: [],
    nextAction: 'prepare_pack',
  };
  const b = {
    ...a,
    caseId: 'b',
    businessOwner: 'fixture:fx-user-owner-cm-2',
    businessUnitId: 'HR',
    useCaseName: 'other',
  };
  for (const search of ['café', 'cafe\u0301', '%', '_', '!', '\\', 'ทดสอบ']) {
    const q = expectedQueue([a, b], 'fx-user-owner-cm', { search, page: 2, pageSize: 1 });
    queueShape(q);
    assert.equal(q.total, 1);
    assert.equal(q.items.length, 0);
    assert.equal(q.statusCounts.draft, 1);
    assert.deepEqual(q.filterOptions.owners, [{ value: a.businessOwner, label: a.ownerDisplayName }]);
  }
  assert.equal(expectedQueue([a, b], 'fx-user-spoc-cm', {}).total, 1);
  assert.equal(expectedQueue([a, b], 'fx-user-dpo', {}).total, 2);
  assert.equal(expectedQueue([a, b], 'fx-user-owner-cm-2', { search: '%' }).total, 0);
  assert.throws(() =>
    queueShape({ ...expectedQueue([a], 'fx-user-admin', {}), items: [{ ...a, currentVersionNumber: 1 }] }),
  );
});
