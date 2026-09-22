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
