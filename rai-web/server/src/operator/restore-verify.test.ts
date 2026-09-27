// W7-02 (W7 plan section 3.2 and section 8): the verifier's check list and its output contract. Every check runs
// against a real restored database in tests/integration/w7-02-backup-restore.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_IDS, DELETE_GRANT_EXCEPTIONS, main } from './restore-verify.js';

const SECRET = 'n0t-in-output';
const env = {
  NODE_ENV: 'development',
  DATABASE_URL: `postgres://rai_app:${SECRET}@127.0.0.1:9/rai`,
  DATABASE_MIGRATE_URL: `postgres://rai_owner:${SECRET}@127.0.0.1:9/rai`,
  DATABASE_ADMIN_URL: `postgres://postgres:${SECRET}@127.0.0.1:9/postgres`,
  BACKUP_DIR: '/tmp/rai-w7-02-unit-backups',
  RAI_PG_TOOLS: 'path',
};
const args = ['--from', '/tmp/x', '--target-db', 'rai_restore_x', '--blob-dir', '/tmp/y'];

function captured() {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

test('the checks are the plan section 3.2 table, in its order; the only DELETE exception is configuration_draft', () => {
  assert.deepEqual(
    [...CHECK_IDS],
    [
      'journal',
      'counts',
      'frozen_digest',
      'manifest_hashes',
      'blobs',
      'a07_frozen_slot',
      'a11_audit',
      'grants',
    ],
  );
  assert.deepEqual([...DELETE_GRANT_EXCEPTIONS], ['configuration_draft']);
});

test('a configuration refusal prints one operator.restore_verify.failed line (stage config) and exits 78', async () => {
  for (const [override, reason] of [
    [{ DATABASE_ADMIN_URL: undefined }, 'missing:DATABASE_ADMIN_URL'],
    [{ RAI_PG_TOOLS: 'podman:x' }, 'invalid:RAI_PG_TOOLS'],
  ] as const) {
    const out = captured();
    assert.equal(await main(args, { ...env, ...override }, out.write), 78, reason);
    assert.equal(out.lines.length, 1);
    const line = JSON.parse(out.lines[0]!) as Record<string, unknown>;
    assert.equal(line.event, 'operator.restore_verify.failed');
    assert.equal(line.level, 'error');
    assert.deepEqual(line.fields, { stage: 'config', reason });
    assert.ok(!out.lines[0]!.includes(SECRET));
  }
});

test('bad arguments exit 64 with stage args', async () => {
  const out = captured();
  assert.equal(await main(['--from', 'x'], {}, out.write), 64);
  assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, {
    stage: 'args',
    reason: 'invalid_arguments',
  });
});

test('a missing manifest exits 1 with stage manifest and no path', async () => {
  const out = captured();
  assert.equal(
    await main(
      ['--from', '/nonexistent-w7-02', '--target-db', 'rai_restore_x', '--blob-dir', '/tmp/y'],
      env,
      out.write,
    ),
    1,
  );
  assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, {
    stage: 'manifest',
    reason: 'manifest_unreadable',
  });
  assert.ok(!out.lines[0]!.includes('/nonexistent'));
});

test('an unreachable target database exits 1 with stage connect and no URL or password', async () => {
  // A manifest must exist for the verifier to reach the connection; the missing one above stops earlier.
  const out = captured();
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'rai-w7-02-verify-unit-'));
  try {
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        backupId: '20260927T000000Z-x',
        createdAt: '2026-09-27T00:00:00.000Z',
        buildCommit: 'x',
        journal: [],
        dumpSha256: '0'.repeat(64),
        blobs: { count: 0, totalBytes: 0 },
        tableCounts: {},
        frozenDigest: '0'.repeat(64),
        fixtureSet: [],
      }),
    );
    const code = await main(
      ['--from', dir, '--target-db', 'rai_restore_x', '--blob-dir', dir],
      env,
      out.write,
    );
    assert.equal(code, 1);
    assert.equal(out.lines.length, 1);
    assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, {
      stage: 'connect',
      reason: 'database_unreachable',
    });
    assert.ok(!out.lines[0]!.includes(SECRET));
    assert.ok(!out.lines[0]!.includes('127.0.0.1'));
    assert.ok(!out.lines[0]!.includes(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
