// W7-01 (W7 plan section 3.1 and section 8): the backup command's pure parts and its output contract. The database
// half runs in tests/integration/w7-01-backup.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackupError, backupId, checkToolVersion, main, parseBackupArgs } from './backup.js';

const SECRET = 'n0t-in-output';
const env = {
  NODE_ENV: 'development',
  DATABASE_URL: `postgres://rai_app:${SECRET}@127.0.0.1:9/rai`,
  DATABASE_MIGRATE_URL: `postgres://rai_owner:${SECRET}@127.0.0.1:9/rai`,
  BLOB_DIR: '/tmp/rai-w7-01-unit-blobs',
  BACKUP_DIR: '/tmp/rai-w7-01-unit-backups',
  RAI_PG_TOOLS: 'path',
};

test('checkToolVersion refuses a pg_dump whose major differs from the server major (server_version_num)', () => {
  assert.doesNotThrow(() => checkToolVersion(16, '160015'));
  assert.doesNotThrow(() => checkToolVersion(17, '170002'));
  for (const [tool, server] of [
    [15, '160015'],
    [17, '160015'],
    [16, '150008'],
  ] as const)
    assert.throws(
      () => checkToolVersion(tool, server),
      (err: unknown) =>
        err instanceof BackupError && err.reason === 'pg_tools_version_mismatch' && err.stage === 'version',
    );
  assert.throws(() => checkToolVersion(16, 'x'), BackupError);
});

test('backupId is YYYYMMDDTHHMMSSZ-<label> in UTC; the label is a short lowercase slug, default "manual"', () => {
  const now = new Date('2026-09-27T08:15:09.500+07:00');
  assert.equal(backupId(now, 'w7-00'), '20260927T011509Z-w7-00');
  assert.equal(backupId(now, undefined), '20260927T011509Z-manual');
  for (const label of ['', 'W7', '../x', 'a b', '-x', 'x'.repeat(41), 'a/b', 'ไทย'])
    assert.throws(
      () => backupId(now, label),
      (err: unknown) => err instanceof BackupError && err.reason === 'invalid_label',
      label,
    );
});

test('parseBackupArgs takes --label <text> and nothing else', () => {
  assert.deepEqual(parseBackupArgs([]), {});
  assert.deepEqual(parseBackupArgs(['--label', 'w7-00']), { label: 'w7-00' });
  for (const argv of [['--label'], ['--lable', 'x'], ['x'], ['--label', 'a', '--label', 'b']])
    assert.throws(
      () => parseBackupArgs(argv),
      (err: unknown) => err instanceof BackupError && err.reason === 'invalid_arguments',
      argv.join(' '),
    );
});

function captured() {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

test('a configuration refusal prints one operator.backup.failed JSON line (stage config) and exits 78 before connecting', async () => {
  for (const [override, reason] of [
    [{ RAI_PG_TOOLS: undefined }, 'missing:RAI_PG_TOOLS'],
    [{ RAI_PG_TOOLS: 'podman:x' }, 'invalid:RAI_PG_TOOLS'],
    [{ BACKUP_DIR: undefined }, 'missing:BACKUP_DIR'],
    [{ BLOB_DIR: '' }, 'missing:BLOB_DIR'],
    [{ DATABASE_MIGRATE_URL: 'mysql://x' }, 'invalid:DATABASE_MIGRATE_URL'],
  ] as const) {
    const out = captured();
    // Port 9 has no Postgres: a command that got past the parse would fail with stage connect instead.
    const code = await main([], { ...env, ...override }, out.write);
    assert.equal(code, 78, reason);
    assert.equal(out.lines.length, 1, reason);
    const line = JSON.parse(out.lines[0]!) as Record<string, unknown>;
    assert.equal(line.event, 'operator.backup.failed');
    assert.equal(line.level, 'error');
    assert.deepEqual(line.fields, { stage: 'config', reason });
    assert.ok(!out.lines[0]!.includes(SECRET));
    assert.ok(!out.lines[0]!.includes('/tmp/'));
  }
});

test('an invalid --label prints operator.backup.failed with stage args and exits 64, before any config is read', async () => {
  const out = captured();
  assert.equal(await main(['--label', '../x'], {}, out.write), 64);
  assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, {
    stage: 'args',
    reason: 'invalid_label',
  });
});

test('an unreachable database prints operator.backup.failed (stage connect) and exits 1 with no URL or password', async () => {
  const out = captured();
  const code = await main([], env, out.write);
  assert.equal(code, 1);
  assert.equal(out.lines.length, 1);
  const line = JSON.parse(out.lines[0]!) as { event: string; fields: Record<string, unknown> };
  assert.equal(line.event, 'operator.backup.failed');
  assert.deepEqual(line.fields, { stage: 'connect', reason: 'database_unreachable' });
  assert.ok(!out.lines[0]!.includes(SECRET));
  assert.ok(!out.lines[0]!.includes('127.0.0.1'));
});
