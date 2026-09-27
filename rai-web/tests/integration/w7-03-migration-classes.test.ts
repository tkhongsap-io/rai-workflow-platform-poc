// W7-03 (W7 plan section 3.3, section 9 row W7-03): `npm run migrate` records every applied migration's rollback
// class in schema_migration_class (back-filled, idempotent, skipped when the table does not exist yet); readiness
// answers `ahead` (ready) only when every migration the build does not know is recorded as additive, reading the
// classes from the database rather than the build's map; `release:check-rollback` gives its three verdicts.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MIGRATIONS_FOLDER,
  readMigrationJournal,
  recordMigrationClasses,
  runMigrations,
} from '@rai/server/db/migrate';
import { MIGRATION_CLASSES, MigrationClassError } from '@rai/server/db/migration-classes';
import { createStoreProbes } from '@rai/server/observability/probes';
import { computeReadiness } from '@rai/server/observability/health';
import { main as rollbackCheck } from '@rai/server/operator/rollback-check';
import {
  INSUFFICIENT_PRIVILEGE,
  RAISE_EXCEPTION,
  expectSqlError,
  openTestDatabase,
  type TestDatabase,
} from '../support/db.js';
import {
  buildJournalTags,
  createScratchDatabase,
  extendedMigrationFolder,
  prefixMigrationFolder,
  withClient,
  type ScratchDatabase,
} from '../support/migration-folder.js';

let db: TestDatabase;
let root: string;
let tags: string[];
before(async () => {
  db = await openTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), 'rai-w7-03-'));
  tags = await buildJournalTags();
});
after(async () => {
  await db?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

interface ClassRow {
  hash: string;
  tag: string;
  rollback_class: string;
  recorded_at: Date;
}
const classRows = (url: string) =>
  withClient(
    url,
    async (client) =>
      (
        await client.query<ClassRow>(
          'SELECT hash, tag, rollback_class, recorded_at FROM schema_migration_class ORDER BY tag',
        )
      ).rows,
  );
const expectedRows = () =>
  readMigrationJournal(MIGRATIONS_FOLDER)
    .map(({ tag, hash }) => ({ hash, tag, rollback_class: MIGRATION_CLASSES[tag] }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
const withoutTime = (rows: ClassRow[]) =>
  rows.map(({ hash, tag, rollback_class }) => ({ hash, tag, rollback_class }));

/**
 * The journal length of the "release" the readiness and rollback tests start from: the W7-03 migration followed by
 * the longest unbroken run of additive migrations after it. W6-02 (#214) put a restore-required migration after
 * W7-03's, so the full journal no longer ends additive; W7-06 (#217) then added an additive one after W6-02's, so
 * "the longest journal ending additive" would put a restore-required migration between W7-03 and the release end and
 * leave no pre-W7-03 target whose later migrations are all additive. The release database below is migrated to this
 * prefix instead, and every assertion keeps its meaning whatever later migrations are classed.
 */
function releaseLength(): number {
  const w703 = tags.findIndex((tag) => tag.endsWith('_w7_03_migration_class'));
  assert.ok(w703 >= 0);
  assert.equal(MIGRATION_CLASSES[tags[w703]!], 'additive', 'the W7-03 migration is additive');
  let n = w703 + 1;
  while (n < tags.length && MIGRATION_CLASSES[tags[n]!] === 'additive') n++;
  return n;
}
/** Smallest journal length whose later migrations (up to the release) are all additive: the binary-only target. */
function additivePrefix(): number {
  let p = releaseLength();
  while (p > 0 && MIGRATION_CLASSES[tags[p - 1]!] === 'additive') p--;
  assert.ok(p < releaseLength(), 'the release ends with an additive migration');
  return p;
}
/** Journal length just before the release's newest non-additive migration: a rollback past it needs a restore. */
function restorePrefix(): number {
  const last = tags.slice(0, releaseLength()).findLastIndex((tag) => MIGRATION_CLASSES[tag] !== 'additive');
  assert.ok(last >= 0, '0007, 0009 (W7-D9) and 0010_w5_03_risk are restore-required');
  return last;
}

test('migrate back-fills one class row per applied migration from the map, and a rerun changes nothing', async () => {
  const first = await classRows(db.urls.owner);
  assert.deepEqual(withoutTime(first), expectedRows());
  const rerun = await runMigrations(db.urls.owner, MIGRATIONS_FOLDER);
  assert.deepEqual(rerun.applied, []);
  const second = await classRows(db.urls.owner);
  assert.deepEqual(second, first, 'no new row and no recorded_at change on rerun');
});

test('schema_migration_class is readable by rai_app and rai_operator, writable by nobody at runtime, append-only', async () => {
  for (const role of ['app', 'operator'] as const) {
    const who = await db.raw(
      role,
      async (c) => (await c.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u,
    );
    assert.equal(who, role === 'app' ? 'rai_app' : 'rai_operator');
    const count = await db.raw(
      role,
      async (c) => (await c.query('SELECT hash FROM schema_migration_class')).rowCount,
    );
    assert.equal(count, tags.length);
    for (const statement of [
      `INSERT INTO schema_migration_class (hash, tag, rollback_class) VALUES ('synthetic', 'synthetic', 'additive')`,
      `UPDATE schema_migration_class SET rollback_class = 'additive'`,
      `DELETE FROM schema_migration_class`,
    ])
      assert.equal(
        (await expectSqlError(db, role, statement))?.code,
        INSUFFICIENT_PRIVILEGE,
        `${role}: ${statement}`,
      );
  }
  for (const statement of [
    `UPDATE schema_migration_class SET rollback_class = 'copy-forward' WHERE tag = '${tags[0]}'`,
    `DELETE FROM schema_migration_class WHERE tag = '${tags[0]}'`,
  ]) {
    const err = await expectSqlError(db, 'owner', statement);
    assert.equal(err?.code, RAISE_EXCEPTION, statement);
    assert.equal(err?.message, 'rai.append_only');
  }
  const bad = await expectSqlError(
    db,
    'owner',
    `INSERT INTO schema_migration_class (hash, tag, rollback_class) VALUES ('synthetic', 'synthetic', 'forward repair only')`,
  );
  assert.equal(bad?.code, '23514', 'only the three W0-04 classes');
});

test('the writer refuses a map without a tag (migration_class_missing) or with a changed class (migration_class_changed)', async () => {
  const before = await classRows(db.urls.owner);
  const missing: Record<string, string> = { ...MIGRATION_CLASSES };
  delete missing[tags[3]!];
  const changed = { ...MIGRATION_CLASSES, [tags[0]!]: 'restore-required' as const };
  for (const [classes, code] of [
    [missing, 'migration_class_missing'],
    [changed, 'migration_class_changed'],
  ] as const)
    await withClient(db.urls.owner, async (client) => {
      await assert.rejects(
        recordMigrationClasses(client, MIGRATIONS_FOLDER, classes as typeof MIGRATION_CLASSES),
        (err: unknown) => err instanceof MigrationClassError && err.code === code,
      );
    });
  assert.deepEqual(await classRows(db.urls.owner), before);
});

let scratch: ScratchDatabase | undefined;
let release: { db: ScratchDatabase; folder: string } | undefined;
after(async () => {
  await scratch?.drop();
  await release?.db.drop();
});

/** A scratch database migrated to the release journal (see releaseLength), created once. */
async function releaseDatabase(): Promise<{ db: ScratchDatabase; folder: string }> {
  if (release !== undefined) return release;
  const folder = await prefixMigrationFolder(root, releaseLength());
  const releaseDb = await createScratchDatabase('w7_03_release');
  release = { db: releaseDb, folder };
  await runMigrations(releaseDb.urls.owner, folder);
  return release;
}

test('on a database and folder without the W7-03 migration the writer does nothing; applying it back-fills 0000 onward', async () => {
  scratch = await createScratchDatabase('w7_03');
  const w703 = tags.findIndex((tag) => tag.endsWith('_w7_03_migration_class'));
  assert.ok(w703 > 0);
  const older = await prefixMigrationFolder(root, w703);
  const first = await runMigrations(scratch.urls.owner, older);
  assert.equal(first.applied.length, w703);
  assert.equal(await runMigrations(scratch.urls.owner, older).then((r) => r.applied.length), 0);
  const regclass = await withClient(
    scratch.urls.owner,
    async (c) =>
      (await c.query<{ t: string | null }>(`SELECT to_regclass('public.schema_migration_class') AS t`))
        .rows[0]!.t,
  );
  assert.equal(regclass, null);

  const upgraded = await runMigrations(scratch.urls.owner, MIGRATIONS_FOLDER);
  assert.equal(upgraded.applied.length, tags.length - w703);
  assert.deepEqual(withoutTime(await classRows(scratch.urls.owner)), expectedRows());
});

const readinessWith = (url: string, folder: string) =>
  computeReadiness(
    {
      identity: () => ({ mode: 'fixture', ready: true }),
      loopbackBind: true,
      mailKind: 'memory',
      qcKind: 'substitute',
      build: { commit: 'dev', schemaVersion: '10' },
    },
    {
      ...createStoreProbes(url, root, folder),
      mailSink: () => Promise.resolve('ok'),
      qc: () => Promise.resolve('unavailable'),
    },
  );

test('readiness: an older build whose extra migrations are all recorded additive is ready with migrations ahead', async () => {
  assert.ok(scratch, 'the scratch database test ran first');
  const full = await readinessWith(scratch.urls.app, MIGRATIONS_FOLDER);
  assert.deepEqual([full.status, full.store.migrations], ['ready', 'current']);
  const { db: releaseDb, folder } = await releaseDatabase();
  const current = await readinessWith(releaseDb.urls.app, folder);
  assert.deepEqual([current.status, current.store.migrations], ['ready', 'current']);
  const ahead = await readinessWith(releaseDb.urls.app, await prefixMigrationFolder(root, additivePrefix()));
  assert.deepEqual([ahead.status, ahead.store.migrations], ['ready', 'ahead']);
  const restore = await readinessWith(releaseDb.urls.app, await prefixMigrationFolder(root, restorePrefix()));
  assert.deepEqual([restore.status, restore.store.migrations], ['not_ready', 'unknown']);
});

test('rollback check: binary_only, restore_required with the matching backup, incompatible; exit 0, 3, 4', async () => {
  assert.ok(scratch);
  const { db: releaseDb, folder: releaseFolder } = await releaseDatabase();
  const backups = path.join(root, 'backups');
  const restoreTarget = await prefixMigrationFolder(root, restorePrefix());
  const targetJournal = readMigrationJournal(restoreTarget);
  const preW703Target = await prefixMigrationFolder(root, additivePrefix());
  for (const [id, journal] of [
    ['20260927T010000Z-before', targetJournal],
    ['20260927T020000Z-other', targetJournal.slice(0, 1)],
    ['20260927T030000Z-before-w7-03', readMigrationJournal(preW703Target)],
  ] as const) {
    await mkdir(path.join(backups, id), { recursive: true });
    await writeFile(
      path.join(backups, id, 'manifest.json'),
      JSON.stringify({ backupId: id, journal: journal.map(({ tag, hash }) => ({ tag, hash })) }),
    );
  }
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: releaseDb.urls.app,
    DATABASE_MIGRATE_URL: releaseDb.urls.owner,
    BACKUP_DIR: backups,
  };
  const run = async (folder: string) => {
    const lines: string[] = [];
    const code = await rollbackCheck(['--target-migrations', folder], env, (line) => void lines.push(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.includes('postgres://'), false);
    assert.equal(lines[0]!.includes(root), false, 'no path is printed');
    const line = JSON.parse(lines[0]!) as { event: string; fields: Record<string, unknown> };
    assert.equal(line.event, 'operator.rollback_check.completed');
    return { code, fields: line.fields };
  };

  // Every migration after the pre-W7-03 journal is additive, but that build (W7-01) answers readiness `unknown` for
  // any longer journal: W7 plan section 3.3 and the W0-04 amendment allow binary-only rollback only to a build at or
  // after W7-03, so the target that predates it needs a restore.
  const additive = additivePrefix();
  assert.equal(tags[additive]!.endsWith('_w7_03_migration_class'), true, 'the pre-W7-03 journal');
  assert.deepEqual(await run(preW703Target), {
    code: 3,
    fields: {
      verdict: 'restore_required',
      extraMigrations: tags.slice(additive, releaseLength()),
      blockingMigration: tags[additive],
      blockingReason: 'target_predates_ahead_readiness',
      matchingBackups: ['20260927T030000Z-before-w7-03'],
    },
  });
  assert.deepEqual(await run(releaseFolder), {
    code: 0,
    fields: { verdict: 'binary_only', extraMigrations: [] },
  });

  const restore = restorePrefix();
  assert.deepEqual(await run(restoreTarget), {
    code: 3,
    fields: {
      verdict: 'restore_required',
      extraMigrations: tags.slice(restore, releaseLength()),
      blockingMigration: tags[restore],
      blockingReason: 'not_additive',
      matchingBackups: ['20260927T010000Z-before'],
    },
  });

  const rewritten = await prefixMigrationFolder(root, 3, { [tags[1]!]: '-- rewritten\nSELECT 1;\n' });
  assert.deepEqual(await run(rewritten), {
    code: 4,
    fields: { verdict: 'incompatible', extraMigrations: [] },
  });
});

test("rollback check and readiness: a newer release's additive migration rolls back binary-only to this build", async () => {
  assert.ok(scratch, 'the scratch database tests ran first');
  // A synthetic newer release: this build's journal plus one additive migration (a new table only).
  const extraTag = `${String(tags.length).padStart(4, '0')}_synthetic_newer_release`;
  const newer = await extendedMigrationFolder(root, {
    tag: extraTag,
    sql: '-- rollback expectation: additive; synthetic\nCREATE TABLE "synthetic_newer_release" ("id" integer PRIMARY KEY);\n',
  });
  // This build's map does not name the synthetic tag: migrate applies it and then fails closed on recording
  // (readiness falls back from `ahead` to `unknown` until the newer release's migrate records its class).
  await assert.rejects(
    runMigrations(scratch.urls.owner, newer),
    (err: unknown) => err instanceof MigrationClassError && err.code === 'migration_class_missing',
  );
  const unrecorded = await readinessWith(scratch.urls.app, MIGRATIONS_FOLDER);
  assert.deepEqual([unrecorded.status, unrecorded.store.migrations], ['not_ready', 'unknown']);
  await withClient(scratch.urls.owner, (client) =>
    recordMigrationClasses(client, newer, { ...MIGRATION_CLASSES, [extraTag]: 'additive' }),
  );

  const lines: string[] = [];
  const code = await rollbackCheck(
    ['--target-migrations', MIGRATIONS_FOLDER],
    { NODE_ENV: 'development', DATABASE_URL: scratch.urls.app, DATABASE_MIGRATE_URL: scratch.urls.owner },
    (line) => void lines.push(line),
  );
  assert.equal(code, 0);
  assert.deepEqual((JSON.parse(lines[0]!) as { fields: unknown }).fields, {
    verdict: 'binary_only',
    extraMigrations: [extraTag],
  });
  // The binary_only promise: this build (at or after W7-03) is ready with migrations `ahead` on that database.
  const ahead = await readinessWith(scratch.urls.app, MIGRATIONS_FOLDER);
  assert.deepEqual([ahead.status, ahead.store.migrations], ['ready', 'ahead']);
});
