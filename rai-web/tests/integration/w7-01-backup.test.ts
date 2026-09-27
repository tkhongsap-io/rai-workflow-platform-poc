// W7-01 (W7 plan section 3.1, section 9 row W7-01): `npm run backup` against a journeyed fixture database. The
// backup must write the dump, the referenced blobs and a manifest whose frozenDigest matches a direct computation.
// RAI_PG_TOOLS comes from rai-web/.env locally (docker-compose:<project>) and from the CI integration job
// (docker:<service container>); a missing value fails this suite, it never skips (plan section 2).
//
// Journey (fixture set slice1-synthetic@1): owner submits the non-vendor case, DPO approves after a lane QC run,
// AI/COE sends back with feedback, which creates the successor draft. Every row comes from a real transition.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import { parseBackupConfig, readEnv } from '@rai/server/config';
import { runBackup, type BackupManifest } from '@rai/server/operator/backup';
import { frozenDigest } from '@rai/server/operator/frozen-digest';
import { resolvePgTools, type PgTools } from '@rai/server/operator/pg-tools';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import {
  app,
  caseRevision,
  db,
  fixtureBlobDir,
  openFixtureApp,
  signIn,
  submitOk,
} from '../support/fixture-app.js';
import { RAI_WEB_ROOT } from '../support/process.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const START = Date.parse('2026-09-27T03:00:00Z');
const now = () => new Date(START);
openFixtureApp({ now });

const scratch: string[] = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

async function scratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function post(session: FixtureSession, url: string, payload: object, idempotent = true) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...(idempotent ? { 'idempotency-key': randomUUID() } : {}),
      ...asUser(session),
    },
    payload,
  });
}

async function journey(): Promise<void> {
  const owner = await signIn('fx-user-owner-cm');
  const n = await submitOk(owner, NONVENDOR.caseId);
  const revision = await caseRevision(NONVENDOR.caseId);
  const base = `/api/cases/${NONVENDOR.caseId}/versions/${n.versionId}/lanes`;
  const dpo = await signIn('fx-user-dpo');
  const run = await post(
    dpo,
    `${base}/dpo/qc-run`,
    { expectedVersion: { versionId: n.versionId, revision } },
    false,
  );
  assert.equal(run.statusCode, 200, run.body);
  const approved = await post(dpo, `${base}/dpo/approve`, {
    expectedVersion: { versionId: n.versionId, revision },
    qcRunId: run.json<LaneQcRunResponse>().runId,
  });
  assert.equal(approved.statusCode, 201, approved.body);
  const sent = await post(await signIn('fx-user-ai-coe'), `${base}/ai_coe/send-back`, {
    expectedVersion: { versionId: n.versionId, revision },
    feedback: { items: [{ slot: 1, deficiency: 'Use-case brief missing risk note' }] },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.ok(sent.json<LaneDecisionResponse>().successorDraftVersionId);
}

/** A raw rai_owner client with the session TimeZone the digest needs. */
async function ownerClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: db.urls.owner });
  await client.connect();
  await client.query(`SET TimeZone = 'UTC'`);
  return client;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const mode = async (p: string) => (await stat(p)).mode & 0o777;

function configuredTools(): { tools: PgTools; backupDir: string } {
  // BACKUP_DIR comes from the test, outside the repository; RAI_PG_TOOLS from the environment, required.
  const backupDir = '/nonexistent-overridden-below';
  const config = parseBackupConfig({ ...readEnv(), BACKUP_DIR: backupDir });
  return { tools: resolvePgTools(config), backupDir };
}

describe('W7-01 backup of a journeyed fixture database', () => {
  it('writes db.dump, the referenced blobs and a manifest whose frozenDigest, counts and journal match the database', async () => {
    await journey();
    const { tools } = configuredTools();
    const backupDir = await scratchDir('rai-w7-01-backups-');
    const result = await runBackup(
      {
        migrateUrl: db.urls.owner,
        blobDir: fixtureBlobDir(),
        backupDir,
        label: 'w7-01-test',
        buildCommit: 'test-commit',
      },
      tools,
      () => new Date('2026-09-27T03:04:05Z'),
    );
    assert.equal(result.backupId, '20260927T030405Z-w7-01-test');
    const dir = path.join(backupDir, result.backupId);
    assert.deepEqual((await readdir(dir)).sort(), ['blobs', 'db.dump', 'manifest.json']);
    assert.equal(await mode(dir), 0o700);
    assert.equal(await mode(path.join(dir, 'db.dump')), 0o600);
    assert.equal(await mode(path.join(dir, 'manifest.json')), 0o600);
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
    assert.deepEqual(manifest, result.manifest);
    assert.equal(manifest.backupId, result.backupId);
    assert.equal(manifest.createdAt, '2026-09-27T03:04:05.000Z');
    assert.equal(manifest.buildCommit, 'test-commit');

    const client = await ownerClient();
    try {
      // frozenDigest: the manifest value equals a direct computation on the live database (nothing wrote since).
      const direct = await frozenDigest(
        async (text) => (await client.query<Record<string, unknown>>(text)).rows,
      );
      assert.equal(manifest.frozenDigest, direct);
      // The journey wrote frozen rows: submitted versions, their slots, a decision, QC runs and audit events.
      const { rows: frozen } = await client.query<{
        versions: string;
        decisions: string;
        audit: string;
        runs: string;
      }>(
        `SELECT (SELECT count(*) FROM pack_version WHERE submitted_at IS NOT NULL) AS versions,
                (SELECT count(*) FROM lane_decision) AS decisions,
                (SELECT count(*) FROM audit_event) AS audit,
                (SELECT count(*) FROM qc_run) AS runs`,
      );
      assert.ok(Number(frozen[0]!.versions) >= 1 && Number(frozen[0]!.decisions) >= 2);
      assert.ok(Number(frozen[0]!.audit) > 0 && Number(frozen[0]!.runs) >= 1);

      // journal: every applied migration, in order, with its tag.
      const { rows: applied } = await client.query<{ hash: string }>(
        'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
      );
      assert.deepEqual(
        manifest.journal.map((j) => j.hash),
        applied.map((r) => r.hash),
      );
      const journalFile = JSON.parse(
        await readFile(path.join(RAI_WEB_ROOT, 'server/drizzle/meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      assert.deepEqual(
        manifest.journal.map((j) => j.tag),
        journalFile.entries.map((e) => e.tag),
      );

      // tableCounts: every public table except session, with its row count.
      const { rows: tables } = await client.query<{ name: string }>(
        `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
      );
      const expected: Record<string, number> = {};
      for (const { name } of tables) {
        if (name === 'session') continue;
        const { rows } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM "${name}"`);
        expected[name] = Number(rows[0]!.n);
      }
      assert.deepEqual(manifest.tableCounts, expected);
      assert.ok(!('session' in manifest.tableCounts));
      const { rows: sessions } = await client.query<{ n: string }>('SELECT count(*) AS n FROM session');
      assert.ok(Number(sessions[0]!.n) >= 3, 'the journey signed in three users, so session rows exist');

      // fixtureSet: the loaded set identity.
      const { rows: sets } = await client.query<{ name: string; version: string; sha256: string }>(
        'SELECT name, version, sha256 FROM fixture_set ORDER BY name, version',
      );
      assert.deepEqual(manifest.fixtureSet, sets);

      // blobs: every present artifact hash, copied in the W0-04 layout, re-hashing to its key.
      const { rows: blobs } = await client.query<{ hash: string; size: string }>(
        `SELECT content_hash AS hash, max(size_bytes) AS size FROM artifact WHERE bytes_state = 'present' GROUP BY 1 ORDER BY 1`,
      );
      assert.ok(blobs.length > 0);
      assert.deepEqual(manifest.blobs, {
        count: blobs.length,
        totalBytes: blobs.reduce((sum, b) => sum + Number(b.size), 0),
      });
      for (const { hash, size } of blobs) {
        const copy = path.join(dir, 'blobs', 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash);
        assert.equal(await sha256File(copy), hash);
        assert.equal((await stat(copy)).size, Number(size));
        assert.equal(await mode(copy), 0o600);
        assert.equal(await mode(path.dirname(copy)), 0o700);
      }
    } finally {
      await client.end();
    }

    // The dump: custom format, hashed in the manifest, holding the schema and no session data.
    const dump = path.join(dir, 'db.dump');
    assert.equal((await readFile(dump)).subarray(0, 5).toString('latin1'), 'PGDMP');
    assert.equal(manifest.dumpSha256, await sha256File(dump));
    const { stdout: listing } = await tools.restore(null, ['--list'], dump);
    assert.match(listing, /TABLE public audit_event /);
    assert.match(listing, /TABLE DATA public audit_event /);
    assert.match(listing, /TABLE public session /, 'the session table itself is kept');
    assert.doesNotMatch(listing, /TABLE DATA public session /, 'session rows are excluded');
    assert.match(listing, /TABLE DATA drizzle __drizzle_migrations /);
    assert.match(listing, /TRIGGER public /);

    // A second backup with the same id is refused; the first is untouched.
    await assert.rejects(
      runBackup(
        {
          migrateUrl: db.urls.owner,
          blobDir: fixtureBlobDir(),
          backupDir,
          label: 'w7-01-test',
          buildCommit: 'x',
        },
        tools,
        () => new Date('2026-09-27T03:04:05Z'),
      ),
      (err: unknown) => (err as { reason?: string }).reason === 'backup_exists',
    );
    assert.equal(await sha256File(dump), manifest.dumpSha256);
  });

  it('refuses pg_dump of another major version before writing anything', async () => {
    const { tools } = configuredTools();
    const backupDir = path.join(await scratchDir('rai-w7-01-mismatch-'), 'backups');
    const wrongMajor: PgTools = { ...tools, version: async () => (await tools.version()) + 1 };
    await assert.rejects(
      runBackup(
        { migrateUrl: db.urls.owner, blobDir: fixtureBlobDir(), backupDir, label: 'x', buildCommit: 'x' },
        wrongMajor,
        now,
      ),
      (err: unknown) => (err as { reason?: string }).reason === 'pg_tools_version_mismatch',
    );
    await assert.rejects(stat(backupDir), /ENOENT/, 'no backup directory was created');
  });

  it('a blob missing from BLOB_DIR fails the backup and removes the partial backup directory', async () => {
    const { tools } = configuredTools();
    const backupDir = await scratchDir('rai-w7-01-missing-');
    const emptyBlobs = await scratchDir('rai-w7-01-empty-blobs-');
    await assert.rejects(
      runBackup(
        { migrateUrl: db.urls.owner, blobDir: emptyBlobs, backupDir, label: 'x', buildCommit: 'x' },
        tools,
        now,
      ),
      (err: unknown) => (err as { reason?: string; stage?: string }).reason === 'blob_missing',
    );
    assert.deepEqual(await readdir(backupDir), []);
  });

  it('npm run backup prints one operator.backup.completed line and no URL, password or path', async () => {
    const backupDir = await scratchDir('rai-w7-01-command-');
    const env = {
      ...(readEnv() as Record<string, string>),
      DATABASE_MIGRATE_URL: db.urls.owner,
      BLOB_DIR: fixtureBlobDir(),
      BACKUP_DIR: backupDir,
      BUILD_COMMIT: 'cmd-test',
    };
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--conditions=rai-source', 'server/src/operator/backup.ts', '--label', 'cmd'],
      { cwd: RAI_WEB_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stderr);
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1, stdout);
    const line = JSON.parse(lines[0]!) as { event: string; level: string; fields: Record<string, unknown> };
    assert.equal(line.event, 'operator.backup.completed');
    assert.equal(line.level, 'info');
    assert.deepEqual(Object.keys(line.fields).sort(), ['backupId', 'blobCount', 'durationMs', 'tableCount']);
    assert.match(String(line.fields.backupId), /^\d{8}T\d{6}Z-cmd$/);
    assert.ok(Number(line.fields.blobCount) > 0);
    for (const secret of [db.urls.owner, new URL(db.urls.owner).password, backupDir, 'postgres://'])
      assert.ok(
        !stdout.includes(secret) && !stderr.includes(secret),
        'no URL, password or path in the output',
      );
    const manifest = JSON.parse(
      await readFile(path.join(backupDir, String(line.fields.backupId), 'manifest.json'), 'utf8'),
    ) as BackupManifest;
    assert.equal(manifest.buildCommit, 'cmd-test');
    assert.equal(Object.keys(manifest.tableCounts).length, line.fields.tableCount);
  });
});
