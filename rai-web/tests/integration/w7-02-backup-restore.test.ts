// W7-02 (W7 plan section 3.2, section 9 row W7-02): backup → restore into a new database and blob directory →
// `restore:verify` passes every check → the real server, started on the restored copy, serves version 1 and
// version 2, their findings and decisions exactly as the source did, and a download byte-identical to the frozen
// slot's hash. Negatives: an existing target and a tampered dump are refused before anything is created; on a second
// restored copy a tampered blob, a tampered frozen row, disabled A07/A11 triggers and a stray DELETE grant each fail
// their named check, and `configuration_draft`'s DELETE (W6-02) passes `grants`.
//
// RAI_PG_TOOLS and DATABASE_ADMIN_URL come from rai-web/.env locally and from the CI integration step; a missing
// value fails this suite, it never skips (plan section 2). The admin URL is the one OBS_MIGRATION_ADMIN_URL carries
// (tests/support/observability-database.ts): one credential, two names. `after` stops the server, drops every
// rai_restore_* database this file created and removes its directories, so reruns start clean.
//
// Journey (fixture set slice1-synthetic@1, fx-case-vendor, scripted QC substitute): owner submits v1; AI/COE runs
// lane QC and waives a finding; DPO sends back; owner resubmits v2; DPO runs lane QC and approves v2; AI/COE runs
// lane QC on v2. Every row comes from a real transition.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type {
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
} from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { parseRestoreConfig, readEnv } from '@rai/server/config';
import { runBackup, type BackupManifest } from '@rai/server/operator/backup';
import { resolvePgTools } from '@rai/server/operator/pg-tools';
import { databaseUrlFor, runRestore, type RestoreRunConfig } from '@rai/server/operator/restore';
import { verifyRestore, type VerifyReport } from '@rai/server/operator/restore-verify';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import type { VersionRef } from '@rai/shared/qc/types';
import {
  app,
  caseRevision,
  db,
  fixtureBlobDir,
  openFixtureApp,
  signIn,
  submitOk,
} from '../support/fixture-app.js';
import { observabilityDatabaseConfig } from '../support/observability-database.js';
import { RAI_WEB_ROOT, startTestServer, type TestServerProcess } from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, asUser, firstCookie, type FixtureSession } from '../support/sign-in.js';

const VENDOR = findFixtureCase('fx-case-vendor')!;
const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));
const START = Date.parse('2026-09-27T04:00:00Z');
const now = () => new Date(START);
openFixtureApp({
  now,
  qcRunner: () =>
    new ScriptedQcRunner({
      fixtureCaseIdOf: (version: VersionRef) => fixtureCaseIdByRowId.get(version.caseId),
      now,
    }),
});

// ---------------------------------------------------------------------------------------------- configuration

const env = readEnv();
// Required: parseRestoreConfig throws missing:RAI_PG_TOOLS / missing:DATABASE_ADMIN_URL (the suite fails, never skips).
const restoreConfig = parseRestoreConfig({ ...env, BACKUP_DIR: '/nonexistent-overridden-by-the-test' });
const tools = resolvePgTools(restoreConfig);
const adminUrl = restoreConfig.adminUrl;

// ------------------------------------------------------------------------------------------------- cleanup

const scratch: string[] = [];
const createdDatabases = new Set<string>();
let server: TestServerProcess | undefined;

after(async () => {
  try {
    await server?.stop();
  } finally {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      for (const name of createdDatabases) {
        assert.match(name, /^rai_restore_[a-z0-9_]+$/); // only a name this file generated reaches DROP
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
      for (const dir of scratch) await rm(dir, { recursive: true, force: true });
    }
  }
});

async function scratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A fresh rai_restore_* name, recorded for the `after` drop before anything can create it. */
function targetName(): string {
  const name = `rai_restore_w702_${randomBytes(6).toString('hex')}`;
  createdDatabases.add(name);
  return name;
}

const liveUrls = () => [db.urls.app, db.urls.owner, db.urls.operator];
const runConfig = (): RestoreRunConfig => ({ adminUrl, liveUrls: liveUrls() });

async function databaseExists(name: string): Promise<boolean> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return rows.length === 1;
  } finally {
    await admin.end();
  }
}

/** Runs `fn` as the admin role connected to database `name`. */
async function asAdminOn<T>(name: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrlFor(adminUrl, name) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const blobPath = (root: string, hash: string) =>
  path.join(root, 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash);

function failedIds(report: VerifyReport): string[] {
  return report.checks.filter((c) => !c.ok).map((c) => c.id);
}

// ------------------------------------------------------------------------------------------------- journey

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

async function laneQc(session: FixtureSession, versionId: string, lane: string, revision: number) {
  const res = await post(
    session,
    `/api/cases/${VENDOR.caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    { expectedVersion: { versionId, revision } },
    false,
  );
  assert.equal(res.statusCode, 200, res.body);
  return res.json<LaneQcRunResponse>();
}

interface Journey {
  v1: SubmittedVersion;
  v2: SubmittedVersion;
}

async function journey(): Promise<Journey> {
  const owner = await signIn('fx-user-owner-cm');
  const ai = await signIn('fx-user-ai-coe');
  const dpo = await signIn('fx-user-dpo');
  const v1 = await submitOk(owner, VENDOR.caseId);
  const rev1 = await caseRevision(VENDOR.caseId);

  const qc1 = await laneQc(ai, v1.versionId, 'ai_coe', rev1);
  assert.equal(qc1.status, 'completed');
  assert.ok(qc1.findings.length >= 1, 'the scripted substitute records AI/COE findings on fx-case-vendor');
  const waived = await post(
    ai,
    `/api/cases/${VENDOR.caseId}/findings/${qc1.findings[0]!.findingId}/dispositions`,
    {
      expectedVersion: { versionId: v1.versionId, revision: rev1 },
      kind: 'waived',
      reason: 'synthetic residual risk accepted for the restore rehearsal',
    },
  );
  assert.equal(waived.statusCode, 201, waived.body);
  assert.equal(waived.json<DispositionResponse>().kind, 'waived');

  const sent = await post(dpo, `/api/cases/${VENDOR.caseId}/versions/${v1.versionId}/lanes/dpo/send-back`, {
    expectedVersion: { versionId: v1.versionId, revision: rev1 },
    feedback: { items: [{ slot: 2, deficiency: 'Purpose statement is missing' }] },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.ok(sent.json<LaneDecisionResponse>().successorDraftVersionId);

  const draftRes = await app.inject({
    method: 'GET',
    url: `/api/cases/${VENDOR.caseId}/draft`,
    headers: asUser(owner),
  });
  assert.equal(draftRes.statusCode, 200, draftRes.body);
  const draft = draftRes.json<PackDraft>();
  const resubmitted = await post(owner, `/api/cases/${VENDOR.caseId}/draft/submit`, {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  });
  assert.equal(resubmitted.statusCode, 201, resubmitted.body);
  const v2 = resubmitted.json<SubmittedVersion>();
  assert.equal(v2.versionNumber, 2);
  assert.equal(v2.parentVersionId, v1.versionId);

  const rev2 = await caseRevision(VENDOR.caseId);
  const dpoRun = await laneQc(dpo, v2.versionId, 'dpo', rev2);
  const approved = await post(dpo, `/api/cases/${VENDOR.caseId}/versions/${v2.versionId}/lanes/dpo/approve`, {
    expectedVersion: { versionId: v2.versionId, revision: rev2 },
    qcRunId: dpoRun.runId,
  });
  assert.equal(approved.statusCode, 201, approved.body);
  await laneQc(ai, v2.versionId, 'ai_coe', await caseRevision(VENDOR.caseId));
  return { v1, v2 };
}

/** The reads the restored server must answer identically, taken from the source app before the backup. */
function readPaths({ v1, v2 }: Journey): string[] {
  const base = `/api/cases/${VENDOR.caseId}`;
  return [
    `${base}/versions`,
    `${base}/versions/${v1.versionId}`,
    `${base}/versions/${v2.versionId}`,
    `${base}/versions/${v1.versionId}/findings`,
    `${base}/versions/${v2.versionId}/findings`,
    `${base}/versions/${v1.versionId}/qc-runs`,
    `${base}/versions/${v2.versionId}/qc-runs`,
  ];
}

async function sourceReads(paths: readonly string[]): Promise<Record<string, unknown>> {
  const owner = await signIn('fx-user-owner-cm');
  const out: Record<string, unknown> = {};
  for (const url of paths) {
    const res = await app.inject({ method: 'GET', url, headers: asUser(owner) });
    assert.equal(res.statusCode, 200, `${url}: ${res.body}`);
    out[url] = res.json();
  }
  return out;
}

async function httpSignIn(base: string, fixtureUserId: string): Promise<string> {
  const res = await fetch(`${base}${FIXTURE_SIGN_IN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ fixtureUserId }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = firstCookie(res.headers.get('set-cookie') ?? undefined);
  assert.ok(cookie !== undefined, 'no session cookie');
  return cookie;
}

function runCommand(script: string, argv: readonly string[], overrides: Record<string, string>) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=rai-source', `server/src/operator/${script}`, ...argv],
    {
      cwd: RAI_WEB_ROOT,
      env: { ...(env as Record<string, string>), ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on('close', (code) => resolve({ code, stdout, stderr })),
  );
}

// ------------------------------------------------------------------------------------------------- the suite

describe('W7-02 backup → restore → verify → real server on the restored copy', () => {
  it('restores into a new database and blob dir, passes every check, and serves v1, v2 and a byte-identical download', async () => {
    // The admin URL is the observability sidecar's admin credential (one admin, two names).
    const obsAdmin = new URL(observabilityDatabaseConfig(env).adminUrl);
    const admin = new URL(adminUrl);
    assert.deepEqual(
      [admin.username, admin.password, admin.hostname, admin.port],
      [obsAdmin.username, obsAdmin.password, obsAdmin.hostname, obsAdmin.port],
      'DATABASE_ADMIN_URL and OBS_MIGRATION_ADMIN_URL name the same admin credential and server',
    );

    const journeyed = await journey();
    const paths = readPaths(journeyed);
    const expected = await sourceReads(paths);
    const v2View = expected[
      `/api/cases/${VENDOR.caseId}/versions/${journeyed.v2.versionId}`
    ] as SubmittedVersion;
    assert.ok(v2View.decisions.some((d) => d.lane === 'dpo' && d.decision === 'approve'));
    const v1View = expected[
      `/api/cases/${VENDOR.caseId}/versions/${journeyed.v1.versionId}`
    ] as SubmittedVersion;
    assert.ok(v1View.decisions.some((d) => d.lane === 'dpo' && d.decision === 'send_back'));

    const backupDir = await scratchDir('rai-w7-02-backups-');
    const backup = await runBackup(
      {
        migrateUrl: db.urls.owner,
        blobDir: fixtureBlobDir(),
        backupDir,
        label: 'w7-02-test',
        buildCommit: 'test-commit',
      },
      tools,
      () => new Date('2026-09-27T04:05:06Z'),
    );
    const from = path.join(backupDir, backup.backupId);

    // Restore through the command entry file (what `npm run restore` runs), then verify through its entry file.
    const target = targetName();
    const restoreRoot = await scratchDir('rai-w7-02-restore-');
    const blobDir = path.join(restoreRoot, 'blobs');
    const commandEnv = {
      DATABASE_URL: db.urls.app,
      DATABASE_MIGRATE_URL: db.urls.owner,
      DATABASE_OPERATOR_URL: db.urls.operator,
      DATABASE_ADMIN_URL: adminUrl,
      BACKUP_DIR: backupDir,
    };
    const argv = ['--from', from, '--target-db', target, '--blob-dir', blobDir];
    const restored = await runCommand('restore.ts', argv, commandEnv);
    assert.equal(restored.code, 0, restored.stdout + restored.stderr);
    const restoreLines = restored.stdout.trim().split('\n');
    assert.equal(restoreLines.length, 1, restored.stdout);
    const restoreLine = JSON.parse(restoreLines[0]!) as { event: string; fields: Record<string, unknown> };
    assert.equal(restoreLine.event, 'operator.restore.completed');
    assert.deepEqual(Object.keys(restoreLine.fields).sort(), ['backupId', 'durationMs']);
    assert.equal(restoreLine.fields.backupId, backup.backupId);

    const verified = await runCommand('restore-verify.ts', argv, commandEnv);
    assert.equal(verified.code, 0, verified.stdout + verified.stderr);
    const verifyLines = verified.stdout.trim().split('\n');
    assert.equal(verifyLines.length, 1, verified.stdout);
    const verifyLine = JSON.parse(verifyLines[0]!) as {
      event: string;
      level: string;
      fields: Record<string, unknown>;
    };
    assert.equal(verifyLine.event, 'operator.restore_verify.completed');
    assert.equal(verifyLine.level, 'info');
    assert.deepEqual(verifyLine.fields, { backupId: backup.backupId, ok: true, failedChecks: [] });
    for (const out of [restored, verified])
      for (const secret of [
        adminUrl,
        new URL(adminUrl).password,
        db.urls.owner,
        backupDir,
        restoreRoot,
        'postgres://',
      ])
        assert.ok(!out.stdout.includes(secret) && !out.stderr.includes(secret), 'no URL, password or path');

    // The in-process verifier reports every check by id, all passing, with the restored blobs counted.
    const report = await verifyRestore({ adminUrl, targetDb: target, from, blobDir });
    assert.deepEqual(
      report.checks.map((c) => [c.id, c.ok]),
      [
        ['journal', true],
        ['counts', true],
        ['frozen_digest', true],
        ['manifest_hashes', true],
        ['blobs', true],
        ['a07_frozen_slot', true],
        ['a11_audit', true],
        ['grants', true],
      ],
      JSON.stringify(report.checks),
    );
    assert.equal(report.ok, true);
    // Both submitted versions of the journey (and any fixture ones) were re-hashed, none mismatched.
    const hashes = /^checked (\d+), mismatched 0, unhashed (\d+)$/.exec(
      String(report.checks.find((c) => c.id === 'manifest_hashes')!.detail),
    );
    assert.ok(hashes !== null && Number(hashes[1]) >= 2, 'v1 and v2 manifest hashes recomputed');

    // Restored layout: 0700 directories, 0600 files, every backup blob present and re-hashing to its key.
    assert.equal((await stat(blobDir)).mode & 0o777, 0o700);
    const manifest = JSON.parse(await readFile(path.join(from, 'manifest.json'), 'utf8')) as BackupManifest;
    assert.ok(manifest.blobs.count > 0);

    // The live database and blob directory were not touched: the source app still reads the same thing.
    assert.deepEqual(await sourceReads(paths), expected);

    // The real server on the restored copy: same responses over HTTP, and a byte-identical download.
    const restoredServer = await startTestServer({
      env: {
        DATABASE_URL: databaseUrlFor(db.urls.app, target),
        DATABASE_MIGRATE_URL: databaseUrlFor(db.urls.owner, target),
        DATABASE_OPERATOR_URL: databaseUrlFor(db.urls.operator, target),
        BLOB_DIR: blobDir,
      },
    });
    server = restoredServer;
    const baseUrl = restoredServer.baseUrl;
    const cookie = await httpSignIn(baseUrl, 'fx-user-owner-cm');
    const headers = { cookie, 'sec-fetch-site': 'same-origin' };
    for (const url of paths) {
      const res = await fetch(`${baseUrl}${url}`, { headers });
      assert.equal(res.status, 200, url);
      assert.deepEqual(await res.json(), expected[url], `restored ${url} equals the source`);
    }
    const attached = Object.values(v2View.slots).find((s) => s.state === 'attached');
    assert.ok(attached !== undefined && attached.state === 'attached', 'v2 has an attached slot');
    const download = await fetch(`${baseUrl}/api/artifacts/${attached.artifact.artifactId}`, {
      headers,
    });
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.length, attached.artifact.sizeBytes);
    assert.equal(sha256(bytes), attached.artifact.sha256, 'downloaded bytes hash to the frozen slot sha256');
    assert.equal(
      sha256(await readFile(blobPath(path.join(from, 'blobs'), attached.artifact.sha256))),
      attached.artifact.sha256,
    );
    // The server is serving the restored database: its journal is current there (readiness 200).
    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 200, await ready.text());
    server = undefined;
    await restoredServer.stop();

    // An existing target (database, or blob directory) is refused and nothing is created or overwritten.
    await assert.rejects(
      runRestore(runConfig(), tools, { from, targetDb: target, blobDir: path.join(restoreRoot, 'other') }),
      {
        reason: 'restore_target_exists',
      },
    );
    const fresh = targetName();
    await assert.rejects(runRestore(runConfig(), tools, { from, targetDb: fresh, blobDir }), {
      reason: 'restore_target_exists',
    });
    assert.equal(await databaseExists(fresh), false);
    // The live database's name is refused.
    await assert.rejects(
      runRestore(runConfig(), tools, {
        from,
        targetDb: new URL(db.urls.app).pathname.slice(1),
        blobDir: path.join(restoreRoot, 'x'),
      }),
      { reason: 'restore_target_is_live' },
    );

    // A tampered dump is refused before a database or blob directory is created.
    const tampered = path.join(await scratchDir('rai-w7-02-tampered-'), backup.backupId);
    await cp(from, tampered, { recursive: true });
    const handle = await open(path.join(tampered, 'db.dump'), 'r+');
    try {
      const at = Math.floor((await handle.stat()).size / 2);
      const one = Buffer.alloc(1);
      await handle.read(one, 0, 1, at);
      one[0] = one[0]! ^ 0xff;
      await handle.write(one, 0, 1, at);
    } finally {
      await handle.close();
    }
    const tamperedTarget = targetName();
    const tamperedBlobs = path.join(restoreRoot, 'tampered-blobs');
    await assert.rejects(
      runRestore(runConfig(), tools, { from: tampered, targetDb: tamperedTarget, blobDir: tamperedBlobs }),
      {
        stage: 'manifest',
        reason: 'dump_sha256_mismatch',
      },
    );
    assert.equal(await databaseExists(tamperedTarget), false);
    await assert.rejects(stat(tamperedBlobs), /ENOENT/);
  });

  it('on a second restored copy each tamper fails exactly its named check, and the configuration_draft DELETE exception passes', async () => {
    await journey();
    const backupDir = await scratchDir('rai-w7-02-backups-neg-');
    const backup = await runBackup(
      {
        migrateUrl: db.urls.owner,
        blobDir: fixtureBlobDir(),
        backupDir,
        label: 'w7-02-neg',
        buildCommit: 'x',
      },
      tools,
      () => new Date('2026-09-27T04:06:07Z'),
    );
    const from = path.join(backupDir, backup.backupId);
    const target = targetName();
    const blobDir = path.join(await scratchDir('rai-w7-02-restore-neg-'), 'blobs');
    const result = await runRestore(runConfig(), tools, { from, targetDb: target, blobDir });
    assert.equal(result.backupId, backup.backupId);
    const verify = () => verifyRestore({ adminUrl, targetDb: target, from, blobDir });
    assert.deepEqual(failedIds(await verify()), []);

    // W6-02's exception is in force on the restored copy, and passes.
    const hasDelete = (table: string) =>
      asAdminOn(
        target,
        async (c) =>
          (
            await c.query<{ ok: boolean }>(`SELECT has_table_privilege('rai_app', $1, 'DELETE') AS ok`, [
              `public.${table}`,
            ])
          ).rows[0]!.ok,
      );
    assert.equal(await hasDelete('configuration_draft'), true);
    assert.equal(await hasDelete('lane_decision'), false);

    // 1. A tampered blob fails `blobs` only.
    const manifest = JSON.parse(await readFile(path.join(from, 'manifest.json'), 'utf8')) as BackupManifest;
    assert.ok(manifest.blobs.count > 0);
    const { rows: blobRows } = await asAdminOn(target, (c) =>
      c.query<{ hash: string }>(
        `SELECT content_hash AS hash FROM artifact WHERE bytes_state = 'present' ORDER BY 1 LIMIT 1`,
      ),
    );
    const victim = blobPath(blobDir, blobRows[0]!.hash);
    const original = await readFile(victim);
    const flipped = Buffer.from(original);
    flipped[0] = flipped[0]! ^ 0xff;
    await writeFile(victim, flipped);
    let report = await verify();
    assert.deepEqual(failedIds(report), ['blobs']);
    assert.equal(report.ok, false);
    await writeFile(victim, original);
    assert.deepEqual(failedIds(await verify()), []);

    // 2. A frozen row changed behind the triggers fails `frozen_digest` only (counts are unchanged).
    await asAdminOn(target, async (c) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL session_replication_role = replica'); // bypasses the append-only trigger
      await c.query(
        `UPDATE audit_event SET occurred_at = occurred_at + interval '1 second' WHERE seq = (SELECT min(seq) FROM audit_event)`,
      );
      await c.query('COMMIT');
    });
    report = await verify();
    assert.deepEqual(failedIds(report), ['frozen_digest']);
    await asAdminOn(target, async (c) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL session_replication_role = replica');
      await c.query(
        `UPDATE audit_event SET occurred_at = occurred_at - interval '1 second' WHERE seq = (SELECT min(seq) FROM audit_event)`,
      );
      await c.query('COMMIT');
    });
    assert.deepEqual(failedIds(await verify()), []);

    // 2b. A stored manifest hash changed behind the triggers fails `manifest_hashes` (and the digest it is part of).
    const { rows: hashed } = await asAdminOn(target, (c) =>
      c.query<{ id: string; manifest_hash: string }>(
        `SELECT id, manifest_hash FROM pack_version WHERE manifest_hash IS NOT NULL ORDER BY id LIMIT 1`,
      ),
    );
    assert.equal(hashed.length, 1);
    const setHash = (value: string) =>
      asAdminOn(target, async (c) => {
        await c.query('BEGIN');
        await c.query('SET LOCAL session_replication_role = replica');
        await c.query('UPDATE pack_version SET manifest_hash = $1 WHERE id = $2', [value, hashed[0]!.id]);
        await c.query('COMMIT');
      });
    await setHash('0'.repeat(64));
    report = await verify();
    assert.deepEqual(failedIds(report), ['frozen_digest', 'manifest_hashes']);
    assert.match(String(report.checks.find((c) => c.id === 'manifest_hashes')!.detail), /mismatched 1/);
    await setHash(hashed[0]!.manifest_hash);
    assert.deepEqual(failedIds(await verify()), []);

    // 3. Without the frozen-slot trigger, A07 is not re-proved; without the audit trigger, A11 is not.
    await asAdminOn(target, (c) => c.query('ALTER TABLE artifact_slot DISABLE TRIGGER USER'));
    assert.deepEqual(failedIds(await verify()), ['a07_frozen_slot']);
    await asAdminOn(target, (c) => c.query('ALTER TABLE artifact_slot ENABLE TRIGGER USER'));
    await asAdminOn(target, (c) => c.query('ALTER TABLE audit_event DISABLE TRIGGER USER'));
    report = await verify();
    assert.deepEqual(failedIds(report), ['a11_audit']);
    await asAdminOn(target, (c) => c.query('ALTER TABLE audit_event ENABLE TRIGGER USER'));

    // 4. A scratch DELETE grant on an evidence table fails `grants`, naming that table and not the exception.
    await asAdminOn(target, (c) => c.query('GRANT DELETE ON lane_decision TO rai_app'));
    report = await verify();
    assert.deepEqual(failedIds(report), ['grants']);
    const grants = report.checks.find((c) => c.id === 'grants')!;
    assert.match(String(grants.detail), /lane_decision/);
    assert.doesNotMatch(String(grants.detail), /configuration_draft/);
    await asAdminOn(target, (c) => c.query('REVOKE DELETE ON lane_decision FROM rai_app'));

    // 5. An extra row fails `counts`, naming the table (a fixture_set row inserted behind the loader).
    await asAdminOn(target, (c) =>
      c.query(
        `INSERT INTO fixture_set (name, version, sha256, correlation_id) VALUES ('w7-02-tamper', '1', $1, 'w7-02')`,
        ['0'.repeat(64)],
      ),
    );
    report = await verify();
    assert.deepEqual(failedIds(report), ['counts']);
    assert.match(String(report.checks.find((c) => c.id === 'counts')!.detail), /fixture_set/);
    await asAdminOn(target, (c) => c.query(`DELETE FROM fixture_set WHERE name = 'w7-02-tamper'`));

    // Back to a faithful copy: every check passes again.
    assert.deepEqual(failedIds(await verify()), []);
  });
});
