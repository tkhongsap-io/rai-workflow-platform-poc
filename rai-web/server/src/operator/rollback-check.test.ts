// W7-03 (W7 plan section 3.3 and section 8): the rollback check's verdict on three synthetic journals, its argument
// rule, the backups it names and its output contract. The database half runs in
// tests/integration/w7-03-migration-classes.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATIONS_FOLDER, readMigrationJournal } from '../db/migrate.js';
import { AHEAD_READINESS_TAG_SUFFIX, type RollbackClass } from '../db/migration-classes.js';
import {
  ROLLBACK_EXIT,
  RollbackCheckError,
  aheadReadinessHash,
  findMatchingBackups,
  main,
  parseRollbackArgs,
  rollbackVerdict,
} from './rollback-check.js';

const classes: Record<string, RollbackClass> = {
  h0: 'additive',
  h1: 'additive',
  h2: 'additive',
  h3: 'restore-required',
  h4: 'additive',
  h5: 'copy-forward',
};
const classOf = (hash: string) => classes[hash];
const applied = (...hashes: string[]) => hashes.map((hash) => ({ hash, tag: `tag_${hash}` }));
// The synthetic journal's W7-03 migration (the one that makes a build answer readiness `ahead`) is h0, so every
// target below that carries h0 is a build at or after W7-03.
const AHEAD = 'h0';

test('journal 1: target is a prefix and every extra is additive → binary_only', () => {
  assert.deepEqual(rollbackVerdict(['h0', 'h1'], applied('h0', 'h1', 'h2'), classOf, AHEAD), {
    verdict: 'binary_only',
    extraMigrations: ['tag_h2'],
  });
  assert.deepEqual(rollbackVerdict(['h0', 'h1'], applied('h0', 'h1'), classOf, AHEAD), {
    verdict: 'binary_only',
    extraMigrations: [],
  });
});

test('journal 2: target is a prefix and an extra is not additive → restore_required naming the first one', () => {
  assert.deepEqual(rollbackVerdict(['h0'], applied('h0', 'h1', 'h3', 'h4', 'h5'), classOf, AHEAD), {
    verdict: 'restore_required',
    extraMigrations: ['tag_h1', 'tag_h3', 'tag_h4', 'tag_h5'],
    blockingMigration: 'tag_h3',
    blockingReason: 'not_additive',
  });
  assert.deepEqual(
    rollbackVerdict(
      ['h0', 'h1', 'h2', 'h3', 'h4'],
      applied('h0', 'h1', 'h2', 'h3', 'h4', 'h5'),
      classOf,
      AHEAD,
    ),
    {
      verdict: 'restore_required',
      extraMigrations: ['tag_h5'],
      blockingMigration: 'tag_h5',
      blockingReason: 'not_additive',
    },
  );
  // A hash with no recorded class is not additive.
  assert.deepEqual(rollbackVerdict(['h0'], applied('h0', 'hx'), classOf, AHEAD), {
    verdict: 'restore_required',
    extraMigrations: ['tag_hx'],
    blockingMigration: 'tag_hx',
    blockingReason: 'not_additive',
  });
});

test('a target built before W7-03 cannot serve ahead: restore_required even when every extra is additive', () => {
  // W7 plan section 3.3 and the W0-04 amendment: binary-only rollback is possible only to a build at or after W7-03.
  // Here the W7-03 migration is h2: the target [h0, h1] predates it, so its readiness answers `unknown` (not ready)
  // against the longer journal although h2 is additive.
  assert.deepEqual(rollbackVerdict(['h0', 'h1'], applied('h0', 'h1', 'h2'), classOf, 'h2'), {
    verdict: 'restore_required',
    extraMigrations: ['tag_h2'],
    blockingMigration: 'tag_h2',
    blockingReason: 'target_predates_ahead_readiness',
  });
  assert.deepEqual(rollbackVerdict(['h0'], applied('h0', 'h1', 'h2', 'h4'), classOf, 'h2'), {
    verdict: 'restore_required',
    extraMigrations: ['tag_h1', 'tag_h2', 'tag_h4'],
    blockingMigration: 'tag_h1',
    blockingReason: 'target_predates_ahead_readiness',
  });
  // A non-additive extra is named first, whatever the target: no build rolls back past it without a restore.
  assert.deepEqual(rollbackVerdict(['h0'], applied('h0', 'h1', 'h2', 'h3'), classOf, 'h2'), {
    verdict: 'restore_required',
    extraMigrations: ['tag_h1', 'tag_h2', 'tag_h3'],
    blockingMigration: 'tag_h3',
    blockingReason: 'not_additive',
  });
  // At or after W7-03 the extras decide; with no extras the target is the database's own journal (`current`).
  assert.deepEqual(rollbackVerdict(['h0', 'h1', 'h2'], applied('h0', 'h1', 'h2', 'h4'), classOf, 'h2'), {
    verdict: 'binary_only',
    extraMigrations: ['tag_h4'],
  });
  assert.deepEqual(rollbackVerdict(['h0', 'h1'], applied('h0', 'h1'), classOf, 'h2'), {
    verdict: 'binary_only',
    extraMigrations: [],
  });
});

test("the ahead-readiness migration is the one W7-03 migration of this build's journal, found by tag suffix", () => {
  const journal = readMigrationJournal(MIGRATIONS_FOLDER);
  const named = journal.filter(({ tag }) => tag.endsWith(AHEAD_READINESS_TAG_SUFFIX));
  assert.equal(named.length, 1);
  assert.equal(aheadReadinessHash(journal), named[0]!.hash);
  assert.throws(
    () => aheadReadinessHash(journal.filter(({ tag }) => !tag.endsWith(AHEAD_READINESS_TAG_SUFFIX))),
    (err: unknown) => err instanceof RollbackCheckError && err.reason === 'build_journal_invalid',
  );
});

test('journal 3: target is not a prefix → incompatible', () => {
  for (const target of [
    ['h0', 'changed'], // rewritten migration
    ['h1', 'h0'], // reordered
    ['h0', 'h1', 'h2', 'h9'], // target ahead of the database
  ])
    assert.deepEqual(rollbackVerdict(target, applied('h0', 'h1', 'h2'), classOf, AHEAD), {
      verdict: 'incompatible',
      extraMigrations: [],
    });
  assert.deepEqual(ROLLBACK_EXIT, { binary_only: 0, restore_required: 3, incompatible: 4 });
});

test('parseRollbackArgs takes --target-migrations <path> and nothing else', () => {
  assert.deepEqual(parseRollbackArgs(['--target-migrations', '/x/server/drizzle']), {
    targetMigrations: '/x/server/drizzle',
  });
  for (const argv of [
    [],
    ['--target-migrations'],
    ['--target', 'x'],
    ['x'],
    ['--target-migrations', 'a', '--target-migrations', 'b'],
  ])
    assert.throws(
      () => parseRollbackArgs(argv),
      (err: unknown) => err instanceof RollbackCheckError && err.reason === 'invalid_arguments',
      argv.join(' '),
    );
});

test('findMatchingBackups names backups whose manifest journal equals the target, newest first', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rai-w7-03-backups-'));
  try {
    const manifest = async (id: string, hashes: string[] | string) => {
      await mkdir(path.join(root, id));
      await writeFile(
        path.join(root, id, 'manifest.json'),
        typeof hashes === 'string'
          ? hashes
          : JSON.stringify({ backupId: id, journal: hashes.map((hash) => ({ tag: null, hash })) }),
      );
    };
    await manifest('20260927T010000Z-a', ['h0', 'h1']);
    await manifest('20260927T020000Z-b', ['h0', 'h1', 'h2']);
    await manifest('20260927T030000Z-c', ['h0', 'h1']);
    await manifest('20260927T040000Z-d', '{not json');
    await manifest('20260927T050000Z-e', ['h0']);
    await mkdir(path.join(root, '20260927T060000Z-no-manifest'));
    await writeFile(path.join(root, 'stray-file'), 'x');
    assert.deepEqual(await findMatchingBackups(root, ['h0', 'h1']), [
      '20260927T030000Z-c',
      '20260927T010000Z-a',
    ]);
    assert.deepEqual(await findMatchingBackups(root, ['h9']), []);
    assert.deepEqual(await findMatchingBackups(path.join(root, 'missing'), ['h0']), []);
    assert.deepEqual(await findMatchingBackups(undefined, ['h0']), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function captured() {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}
const SECRET = 'n0t-in-output';

test('the command prints one failed line: 64 for arguments, 78 for configuration, never a URL or password', async () => {
  const usage = captured();
  assert.equal(await main([], { NODE_ENV: 'development' }, usage.write), 64);
  const config = captured();
  assert.equal(
    await main(['--target-migrations', '/nowhere'], { NODE_ENV: 'development' }, config.write),
    78,
  );
  const badDir = captured();
  assert.equal(
    await main(
      ['--target-migrations', '/nowhere'],
      {
        NODE_ENV: 'development',
        DATABASE_URL: `postgres://rai_app:${SECRET}@127.0.0.1:9/rai`,
        DATABASE_MIGRATE_URL: `postgres://rai_owner:${SECRET}@127.0.0.1:9/rai`,
        BACKUP_DIR: '.',
      },
      badDir.write,
      { cwd: path.resolve('.') },
    ),
    78,
  );
  for (const [{ lines }, stage, reason] of [
    [usage, 'args', 'invalid_arguments'],
    [config, 'config', 'missing:DATABASE_URL'],
    [badDir, 'config', 'invalid:BACKUP_DIR'],
  ] as const) {
    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]!) as { event: string; level: string; fields: Record<string, unknown> };
    assert.equal(line.event, 'operator.rollback_check.failed');
    assert.equal(line.level, 'error');
    assert.deepEqual(line.fields, { stage, reason });
    assert.equal(lines[0]!.includes(SECRET), false);
    assert.equal(lines[0]!.includes('postgres://'), false);
  }
});

test('an unreadable target folder or an unreachable database fails with exit 1 and a code only', async () => {
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: `postgres://rai_app:${SECRET}@127.0.0.1:9/rai`,
    DATABASE_MIGRATE_URL: `postgres://rai_owner:${SECRET}@127.0.0.1:9/rai`,
  };
  const missing = captured();
  assert.equal(
    await main(['--target-migrations', path.join(tmpdir(), 'rai-w7-03-none')], env, missing.write),
    1,
  );
  assert.deepEqual((JSON.parse(missing.lines[0]!) as { fields: unknown }).fields, {
    stage: 'target',
    reason: 'target_unreadable',
  });
  const unreachable = captured();
  assert.equal(
    await main(['--target-migrations', path.resolve('server/drizzle')], env, unreachable.write),
    1,
  );
  assert.deepEqual((JSON.parse(unreachable.lines[0]!) as { fields: unknown }).fields, {
    stage: 'connect',
    reason: 'database_unreachable',
  });
  assert.equal(unreachable.lines[0]!.includes(SECRET), false);
});
