// W7-02 (W7 plan section 3.2 and section 8): the restore command's pure parts and its output contract. The database
// half runs in tests/integration/w7-02-backup-restore.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  RestoreError,
  checkTargetName,
  databaseUrlFor,
  main,
  parseRestoreArgs,
  refuseLiveTarget,
} from './restore.js';

const SECRET = 'n0t-in-output';
const env = {
  NODE_ENV: 'development',
  DATABASE_URL: `postgres://rai_app:${SECRET}@127.0.0.1:9/rai`,
  DATABASE_MIGRATE_URL: `postgres://rai_owner:${SECRET}@127.0.0.1:9/rai`,
  DATABASE_ADMIN_URL: `postgres://postgres:${SECRET}@127.0.0.1:9/postgres`,
  BACKUP_DIR: '/tmp/rai-w7-02-unit-backups',
  RAI_PG_TOOLS: 'path',
};
const args = [
  '--from',
  '/tmp/rai-w7-02-unit-backups/x',
  '--target-db',
  'rai_restore_x',
  '--blob-dir',
  '/tmp/rai-w7-02-unit-blobs',
];

const reasonOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RestoreError) return err.reason;
    throw err;
  }
  return undefined;
};

test('parseRestoreArgs takes --from, --target-db and --blob-dir exactly once each, paths resolved absolute', () => {
  assert.deepEqual(
    parseRestoreArgs(['--from', 'b/x', '--target-db', 'rai_restore_1', '--blob-dir', 'r/blobs'], '/w'),
    {
      from: path.resolve('/w', 'b/x'),
      targetDb: 'rai_restore_1',
      blobDir: path.resolve('/w', 'r/blobs'),
    },
  );
  for (const argv of [
    [],
    ['--from', 'x', '--target-db', 'rai_restore_1'],
    ['--from', 'x', '--target-db', 'rai_restore_1', '--blob-dir'],
    [...args, '--from', 'y'],
    [...args, '--label', 'y'],
    ['--from', '', '--target-db', 'rai_restore_1', '--blob-dir', 'z'],
  ])
    assert.equal(
      reasonOf(() => parseRestoreArgs(argv, '/w')),
      'invalid_arguments',
      argv.join(' '),
    );
});

test('checkTargetName accepts a lowercase identifier only (it becomes a database name)', () => {
  for (const ok of ['rai_restore_20260927t030405z', 'r', '_x1', 'a'.repeat(63)])
    assert.equal(
      reasonOf(() => checkTargetName(ok)),
      undefined,
      ok,
    );
  for (const bad of ['', 'Rai', '1abc', 'a-b', 'a b', 'a"b', 'a;drop', 'a'.repeat(64), 'ไทย'])
    assert.equal(
      reasonOf(() => checkTargetName(bad)),
      'invalid_target_db',
      bad,
    );
});

test('refuseLiveTarget refuses the database any configured role URL names; other names pass', () => {
  const live = [env.DATABASE_URL, env.DATABASE_MIGRATE_URL];
  assert.equal(
    reasonOf(() => refuseLiveTarget('rai', live)),
    'restore_target_is_live',
  );
  assert.equal(
    reasonOf(() => refuseLiveTarget('rai_restore_x', live)),
    undefined,
  );
  assert.equal(
    reasonOf(() => refuseLiveTarget('other', [...live, 'postgres://a:b@h:1/other'])),
    'restore_target_is_live',
  );
});

test('databaseUrlFor replaces only the database name', () => {
  assert.equal(
    databaseUrlFor('postgres://postgres:pw@127.0.0.1:55385/postgres', 'rai_restore_x'),
    'postgres://postgres:pw@127.0.0.1:55385/rai_restore_x',
  );
  assert.equal(
    databaseUrlFor('postgres://rai_app:rai_app@127.0.0.1:54320/rai', 'rai_restore_y'),
    'postgres://rai_app:rai_app@127.0.0.1:54320/rai_restore_y',
  );
});

function captured() {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

test('a configuration refusal prints one operator.restore.failed JSON line (stage config) and exits 78', async () => {
  for (const [override, reason] of [
    [{ DATABASE_ADMIN_URL: undefined }, 'missing:DATABASE_ADMIN_URL'],
    [{ DATABASE_ADMIN_URL: 'mysql://x@y/z' }, 'invalid:DATABASE_ADMIN_URL'],
    [{ RAI_PG_TOOLS: undefined }, 'missing:RAI_PG_TOOLS'],
    [{ DATABASE_URL: undefined }, 'missing:DATABASE_URL'],
  ] as const) {
    const out = captured();
    const code = await main(args, { ...env, ...override }, out.write);
    assert.equal(code, 78, reason);
    assert.equal(out.lines.length, 1, reason);
    const line = JSON.parse(out.lines[0]!) as Record<string, unknown>;
    assert.equal(line.event, 'operator.restore.failed');
    assert.equal(line.level, 'error');
    assert.deepEqual(line.fields, { stage: 'config', reason });
    assert.ok(!out.lines[0]!.includes(SECRET));
    assert.ok(!out.lines[0]!.includes('/tmp/'));
  }
});

test('bad arguments print operator.restore.failed with stage args and exit 64 before any config is read', async () => {
  for (const [argv, reason] of [
    [[], 'invalid_arguments'],
    [['--from', 'x', '--target-db', 'Bad-Name', '--blob-dir', 'y'], 'invalid_target_db'],
  ] as const) {
    const out = captured();
    assert.equal(await main([...argv], {}, out.write), 64);
    assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, { stage: 'args', reason });
  }
});

test('the live database as target is refused (stage target) and exits 1 before anything is read or created', async () => {
  const out = captured();
  const code = await main(
    ['--from', '/nonexistent', '--target-db', 'rai', '--blob-dir', '/nonexistent-b'],
    env,
    out.write,
  );
  assert.equal(code, 1);
  assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, {
    stage: 'target',
    reason: 'restore_target_is_live',
  });
});

test('a missing manifest prints operator.restore.failed (stage manifest) with no path', async () => {
  const out = captured();
  const code = await main(
    ['--from', '/nonexistent-w7-02', '--target-db', 'rai_restore_x', '--blob-dir', '/nonexistent-b'],
    env,
    out.write,
  );
  assert.equal(code, 1);
  assert.equal(out.lines.length, 1);
  assert.deepEqual((JSON.parse(out.lines[0]!) as { fields: unknown }).fields, {
    stage: 'manifest',
    reason: 'manifest_unreadable',
  });
  assert.ok(!out.lines[0]!.includes('/nonexistent'));
});
