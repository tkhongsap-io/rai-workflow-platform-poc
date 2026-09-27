import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrationStatus, writableDirectory } from './probes.js';

test('migration readiness detects missing, rewritten and ahead journals rather than trusting count', () => {
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b']), 'current');
  assert.equal(migrationStatus(['a', 'b'], ['a']), 'pending');
  assert.equal(migrationStatus(['a', 'b'], []), 'pending');
  assert.equal(migrationStatus(['a', 'b'], ['a', 'changed']), 'unknown');
  assert.equal(migrationStatus(['a'], ['a', 'b']), 'unknown');
});
test('blob probe is read only and does not create missing directories or probe files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rai-health-'));
  try {
    assert.equal(await writableDirectory(root), 'ok');
    assert.deepEqual(await readdir(root), []);
    assert.equal(await writableDirectory(path.join(root, 'missing')), 'unreachable');
    await writeFile(path.join(root, 'file'), 'synthetic');
    assert.equal(await writableDirectory(path.join(root, 'file')), 'unreachable');
    assert.deepEqual(await readdir(root), ['file']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// W7-03 (W7 plan section 3.3; W0-04 "if ahead by an additive migration, it serves"): `ahead` only when the build's
// journal is a strict prefix of the database's and every extra hash is recorded as additive.
test('W7-03 migrationStatus table: current, pending, ahead-additive and every other ahead is unknown', () => {
  const classes: Record<string, 'additive' | 'restore-required' | 'copy-forward'> = {
    c: 'additive',
    d: 'additive',
    r: 'restore-required',
    f: 'copy-forward',
  };
  const classOf = (hash: string) => classes[hash];
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b'], classOf), 'current');
  assert.equal(migrationStatus(['a', 'b'], ['a'], classOf), 'pending');
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b', 'c'], classOf), 'ahead');
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b', 'c', 'd'], classOf), 'ahead');
  assert.equal(migrationStatus([], ['c'], classOf), 'ahead');
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b', 'r'], classOf), 'unknown', 'restore-required extra');
  assert.equal(
    migrationStatus(['a', 'b'], ['a', 'b', 'c', 'r'], classOf),
    'unknown',
    'one non-additive extra',
  );
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b', 'f'], classOf), 'unknown', 'copy-forward extra');
  assert.equal(migrationStatus(['a', 'b'], ['a', 'b', 'x'], classOf), 'unknown', 'extra with no class row');
  assert.equal(migrationStatus(['a', 'b'], ['a', 'x', 'c'], classOf), 'unknown', 'divergent then additive');
  assert.equal(migrationStatus(['a', 'b'], ['b', 'a', 'c'], classOf), 'unknown', 'reordered');
  // Without a class source nothing is additive: the pre-W7-03 answer.
  assert.equal(migrationStatus(['a'], ['a', 'c']), 'unknown');
});
