// W7-01 (W7 plan section 3.1 step 4): the digest over the tables W0-04 forbids migrations to rewrite. The same
// function runs at backup time (manifest) and on the restored copy (W7-02), so its canonical form is pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FROZEN_TABLES, canonicalJson, frozenDigest, type Exec } from './frozen-digest.js';

const EXPECTED_TABLES = [
  'pack_version',
  'artifact_slot',
  'artifact',
  'lane_decision',
  'qc_run',
  'qc_finding',
  'disposition_event',
  'audit_event',
  'configuration_revision',
];

function fakeExec(rowsFor: Record<string, Record<string, unknown>[]>, tz = 'UTC') {
  const queries: string[] = [];
  const exec: Exec = (text) => {
    queries.push(text);
    if (/current_setting\('TimeZone'\)/.test(text)) return Promise.resolve([{ tz }]);
    const entry = FROZEN_TABLES.find((t) => t.query === text);
    assert.ok(entry, `unexpected query ${text}`);
    return Promise.resolve((rowsFor[entry.table] ?? []).map((row) => ({ row })));
  };
  return { exec, queries };
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

test('canonicalJson sorts object keys at every depth, keeps array order and writes no whitespace', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [3, { z: null, y: 'x' }], c: true } }),
    '{"a":{"c":true,"d":[3,{"y":"x","z":null}]},"b":1}',
  );
  assert.equal(canonicalJson('ไทย "q"'), JSON.stringify('ไทย "q"'));
  assert.equal(canonicalJson([]), '[]');
  assert.equal(canonicalJson({}), '{}');
  assert.equal(canonicalJson({ a: undefined, b: 2 }), '{"b":2}');
});

test('the frozen tables are exactly the W0-04 list, each read in id order with its frozen filter', () => {
  assert.deepEqual(
    FROZEN_TABLES.map((t) => t.table),
    EXPECTED_TABLES,
  );
  for (const { table, query } of FROZEN_TABLES) {
    assert.match(query, /ORDER BY t\.id$/, table);
    assert.match(query, /^SELECT to_jsonb\(t\) AS row FROM /, table);
  }
  const byTable = Object.fromEntries(FROZEN_TABLES.map((t) => [t.table, t.query]));
  assert.match(byTable.pack_version!, /WHERE t\.submitted_at IS NOT NULL/);
  assert.match(byTable.artifact_slot!, /v\.submitted_at IS NOT NULL/);
  assert.match(byTable.configuration_revision!, /WHERE t\.published_at IS NOT NULL/);
  assert.match(byTable.audit_event!, /FROM "audit_event" t ORDER BY t\.id$/);
});

test('frozenDigest is SHA-256 of the canonical JSON {table: rows}, independent of key order, dependent on rows', async () => {
  const rows = {
    pack_version: [{ id: 'a', submitted_at: '2026-09-22T05:01:00+00:00', manifest_hash: 'h' }],
    audit_event: [
      { id: '1', event_type: 'version.submitted', payload: { b: 1, a: 2 } },
      { id: '2', event_type: 'lane.approved', payload: {} },
    ],
  };
  const { exec, queries } = fakeExec(rows);
  const digest = await frozenDigest(exec);
  const expected = sha256(
    canonicalJson(
      Object.fromEntries(EXPECTED_TABLES.map((t) => [t, (rows as Record<string, unknown[]>)[t] ?? []])),
    ),
  );
  assert.equal(digest, expected);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(queries.length, 1 + EXPECTED_TABLES.length);

  const reordered = {
    ...rows,
    pack_version: [{ manifest_hash: 'h', submitted_at: '2026-09-22T05:01:00+00:00', id: 'a' }],
    audit_event: [
      { payload: { a: 2, b: 1 }, event_type: 'version.submitted', id: '1' },
      { id: '2', payload: {}, event_type: 'lane.approved' },
    ],
  };
  assert.equal(await frozenDigest(fakeExec(reordered).exec), digest, 'key order does not matter');

  const swapped = { ...rows, audit_event: [rows.audit_event[1]!, rows.audit_event[0]!] };
  assert.notEqual(await frozenDigest(fakeExec(swapped).exec), digest, 'row order matters');
  const changed = { ...rows, pack_version: [{ ...rows.pack_version[0]!, manifest_hash: 'other' }] };
  assert.notEqual(await frozenDigest(fakeExec(changed).exec), digest, 'content matters');
  const moved = { pack_version: rows.pack_version, qc_run: rows.audit_event };
  assert.notEqual(await frozenDigest(fakeExec(moved).exec), digest, 'the table a row sits in matters');
});

test('frozenDigest refuses a session whose TimeZone is not UTC (row timestamps are rendered by the server)', async () => {
  await assert.rejects(frozenDigest(fakeExec({}, 'Asia/Bangkok').exec), /frozen_digest_timezone_not_utc/);
  assert.match(await frozenDigest(fakeExec({}, 'Etc/UTC').exec), /^[0-9a-f]{64}$/);
});
