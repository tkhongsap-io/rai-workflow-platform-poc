// `npm run restore:verify -- --from <backupDir> --target-db <name> --blob-dir <dir>` (W7-02; W7 plan section 3.2):
// re-proves a restored copy against its backup's manifest. It connects with DATABASE_ADMIN_URL with the database
// name replaced by <name>. Each role check runs in its own transaction after SET LOCAL ROLE rai_app or rai_owner (the
// admin role can assume both; rai_owner cannot assume rai_app), and every transaction is rolled back: the verifier
// writes nothing. Checks, in order:
//
//   journal          drizzle.__drizzle_migrations hashes, in order, equal the manifest's journal
//   counts           per-table row counts (session excluded) equal tableCounts
//   frozen_digest    frozenDigest of the restored database (UTC session) equals the manifest's
//   manifest_hashes  every submitted pack_version's manifest_hash equals manifestHash of its slot rows
//   blobs            verifyStore on the restored blob directory: every referenced object present, hash and size
//   a07_frozen_slot  as rai_app, UPDATE artifact_slot of a submitted version fails with rai.frozen_version
//   a11_audit        UPDATE and DELETE of audit_event fail as rai_app (privilege) and as rai_owner (trigger)
//   grants           the public tables rai_app may DELETE from are a subset of { configuration_draft } (W0-04 as
//                    amended by W6-02); any other is named
//
// Exit 0 only when every check passes. Output: one JSON line through buildLogLine (`operator.restore_verify.completed`
// with check ids only, or `operator.restore_verify.failed` when it cannot run), never a URL, password or path.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { ConfigError, EXIT_CONFIG, parseRestoreConfig, readEnv, type Env } from '../config.js';
import { createDb } from '../db/client.js';
import { buildLogLine } from '../observability/log.js';
import { manifestHash } from '../versions/manifest.js';
import { readSlotsWithArtifacts } from '../versions/repository.js';
import type { BackupManifest } from './backup.js';
import { frozenDigest } from './frozen-digest.js';
import {
  EXIT_USAGE,
  RestoreError,
  databaseUrlFor,
  parseRestoreArgs,
  readBackupManifest,
  type RestoreArgs,
} from './restore.js';
import { verifyStore } from './store-verify.js';

export const CHECK_IDS = Object.freeze([
  'journal',
  'counts',
  'frozen_digest',
  'manifest_hashes',
  'blobs',
  'a07_frozen_slot',
  'a11_audit',
  'grants',
] as const);
export type CheckId = (typeof CHECK_IDS)[number];

/** W0-04 roles rule as amended by W6-02: rai_app has DELETE on no table except these (not evidence). */
export const DELETE_GRANT_EXCEPTIONS: readonly string[] = Object.freeze(['configuration_draft']);

export interface CheckResult {
  id: CheckId;
  ok: boolean;
  /** Codes, table names or counts only; never row content. */
  detail?: string;
}

export interface VerifyReport {
  backupId: string;
  ok: boolean;
  checks: CheckResult[];
}

export interface VerifyInput {
  adminUrl: string;
  targetDb: string;
  from: string;
  blobDir: string;
}

const INSUFFICIENT_PRIVILEGE = '42501';

type PgError = Error & { code?: string };

/**
 * Runs `statement` inside BEGIN / SET LOCAL ROLE <role> / ROLLBACK and returns the error it raised, or undefined
 * with the affected row count when it unexpectedly succeeded. Never commits.
 */
async function probe(
  client: pg.Client,
  role: 'rai_app' | 'rai_owner',
  statement: string,
  params: unknown[] = [],
): Promise<{ error?: PgError; rowCount?: number }> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(statement, params);
    return { rowCount: result.rowCount ?? 0 };
  } catch (err) {
    return { error: err as PgError };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function checkJournal(client: pg.Client, manifest: BackupManifest): Promise<CheckResult> {
  const { rows } = await client.query<{ hash: string }>(
    'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC',
  );
  const restored = rows.map((r) => r.hash);
  const expected = manifest.journal.map((j) => j.hash);
  const ok = restored.length === expected.length && restored.every((h, i) => h === expected[i]);
  return ok
    ? { id: 'journal', ok }
    : { id: 'journal', ok, detail: `restored ${restored.length}, manifest ${expected.length}` };
}

async function checkCounts(client: pg.Client, manifest: BackupManifest): Promise<CheckResult> {
  const { rows: tables } = await client.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'session' ORDER BY 1`,
  );
  const restored: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`,
    );
    restored[name] = Number(rows[0]!.n);
  }
  const names = [...new Set([...Object.keys(restored), ...Object.keys(manifest.tableCounts)])].sort();
  const differing = names.filter((n) => restored[n] !== manifest.tableCounts[n]);
  return differing.length === 0
    ? { id: 'counts', ok: true }
    : { id: 'counts', ok: false, detail: differing.join(',') };
}

async function checkFrozenDigest(client: pg.Client, manifest: BackupManifest): Promise<CheckResult> {
  const digest = await frozenDigest(async (text) => (await client.query<Record<string, unknown>>(text)).rows);
  return { id: 'frozen_digest', ok: digest === manifest.frozenDigest };
}

async function checkManifestHashes(url: string): Promise<CheckResult> {
  const handle = createDb(url, { max: 1 });
  try {
    const { rows } = await handle.db.execute(
      sql`SELECT id, manifest_hash FROM pack_version WHERE submitted_at IS NOT NULL ORDER BY id`,
    );
    let checked = 0;
    let mismatched = 0;
    let unhashed = 0;
    for (const row of rows as { id: string; manifest_hash: string | null }[]) {
      if (row.manifest_hash === null) {
        unhashed += 1; // a version frozen before manifest hashes were stored has nothing to compare
        continue;
      }
      const slots = await readSlotsWithArtifacts(handle.db, row.id);
      checked += 1;
      if (manifestHash(slots.manifest) !== row.manifest_hash) mismatched += 1;
    }
    const detail = `checked ${checked}, mismatched ${mismatched}, unhashed ${unhashed}`;
    return { id: 'manifest_hashes', ok: mismatched === 0, detail };
  } finally {
    await handle.close();
  }
}

async function checkBlobs(url: string, blobDir: string, manifest: BackupManifest): Promise<CheckResult> {
  const report = await verifyStore(url, blobDir);
  const ok = report.failures.length === 0 && report.referenced === manifest.blobs.count;
  if (ok) return { id: 'blobs', ok };
  const reasons = [...new Set(report.failures.map((f) => f.reason))].sort().join(',');
  return {
    id: 'blobs',
    ok,
    detail: `referenced ${report.referenced}, manifest ${manifest.blobs.count}, failed ${report.failures.length}${reasons === '' ? '' : ` (${reasons})`}`,
  };
}

const raisedAs = (result: { error?: PgError }, message: string) => result.error?.message === message;
const refusedPrivilege = (result: { error?: PgError }) => result.error?.code === INSUFFICIENT_PRIVILEGE;

async function checkA07(client: pg.Client): Promise<CheckResult> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT s.id FROM artifact_slot s JOIN pack_version v ON v.id = s.version_id
      WHERE v.submitted_at IS NOT NULL ORDER BY s.id LIMIT 1`,
  );
  if (rows.length === 0) return { id: 'a07_frozen_slot', ok: false, detail: 'no_rows' };
  const result = await probe(client, 'rai_app', 'UPDATE artifact_slot SET reason = reason WHERE id = $1', [
    rows[0]!.id,
  ]);
  return raisedAs(result, 'rai.frozen_version')
    ? { id: 'a07_frozen_slot', ok: true }
    : { id: 'a07_frozen_slot', ok: false, detail: result.error?.code ?? 'update_succeeded' };
}

async function checkA11(client: pg.Client): Promise<CheckResult> {
  const { rows } = await client.query<{ seq: string }>('SELECT min(seq)::text AS seq FROM audit_event');
  const seq = rows[0]?.seq;
  if (seq === null || seq === undefined) return { id: 'a11_audit', ok: false, detail: 'no_rows' };
  const failures: string[] = [];
  const cases = [
    ['rai_app', 'UPDATE audit_event SET action = action WHERE seq = $1', 'app_update'],
    ['rai_app', 'DELETE FROM audit_event WHERE seq = $1', 'app_delete'],
    ['rai_owner', 'UPDATE audit_event SET action = action WHERE seq = $1', 'owner_update'],
    ['rai_owner', 'DELETE FROM audit_event WHERE seq = $1', 'owner_delete'],
  ] as const;
  for (const [role, statement, name] of cases) {
    const result = await probe(client, role, statement, [seq]);
    const refused = role === 'rai_app' ? refusedPrivilege(result) : raisedAs(result, 'rai.append_only');
    if (!refused) failures.push(name);
  }
  return failures.length === 0
    ? { id: 'a11_audit', ok: true }
    : { id: 'a11_audit', ok: false, detail: failures.join(',') };
}

async function checkGrants(client: pg.Client): Promise<CheckResult> {
  // has_table_privilege counts direct, inherited and PUBLIC grants, so a grant by any route is seen.
  const { rows } = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND has_table_privilege('rai_app', c.oid, 'DELETE')
      ORDER BY 1`,
  );
  const extra = rows.map((r) => r.name).filter((name) => !DELETE_GRANT_EXCEPTIONS.includes(name));
  return extra.length === 0
    ? { id: 'grants', ok: true }
    : { id: 'grants', ok: false, detail: extra.join(',') };
}

/** Every check against the restored copy; a check that throws is reported failed with a code, never skipped. */
export async function verifyRestore(input: VerifyInput): Promise<VerifyReport> {
  const manifest = await readBackupManifest(input.from);
  const url = databaseUrlFor(input.adminUrl, input.targetDb);
  const client = new pg.Client({
    connectionString: url,
    application_name: 'rai-restore-verify',
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch {
    throw new RestoreError('connect', 'database_unreachable');
  }
  const checks: CheckResult[] = [];
  const run = async (id: CheckId, fn: () => Promise<CheckResult>) => {
    try {
      checks.push(await fn());
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      checks.push({ id, ok: false, detail: (err as PgError).code ?? 'check_failed' });
    }
  };
  try {
    await client.query(`SET TimeZone = 'UTC'`); // the frozen digest renders timestamps in the session zone
    await run('journal', () => checkJournal(client, manifest));
    await run('counts', () => checkCounts(client, manifest));
    await run('frozen_digest', () => checkFrozenDigest(client, manifest));
    await run('manifest_hashes', () => checkManifestHashes(url));
    await run('blobs', () => checkBlobs(url, input.blobDir, manifest));
    await run('a07_frozen_slot', () => checkA07(client));
    await run('a11_audit', () => checkA11(client));
    await run('grants', () => checkGrants(client));
  } finally {
    await client.end().catch(() => undefined);
  }
  return { backupId: manifest.backupId, ok: checks.every((c) => c.ok), checks };
}

type Write = (line: string) => void;

function print(write: Write, line: ReturnType<typeof buildLogLine>): void {
  write(JSON.stringify(line));
}

/** The command: parse, verify, print one JSON line; exit 0 when every check passes, 1, 64 usage, 78 configuration. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Env = readEnv(),
  write: Write = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  const failed = (stage: string, reason: string) =>
    print(
      write,
      buildLogLine(
        'operator.restore_verify.failed',
        { stage, reason },
        { strict: true, correlationId: null },
      ),
    );
  let args: RestoreArgs;
  try {
    args = parseRestoreArgs(argv);
  } catch (err) {
    failed('args', err instanceof RestoreError ? err.reason : 'invalid_arguments');
    return EXIT_USAGE;
  }
  let adminUrl: string;
  try {
    adminUrl = parseRestoreConfig(env).adminUrl;
  } catch (err) {
    if (err instanceof ConfigError) {
      failed('config', err.reason);
      return EXIT_CONFIG;
    }
    throw err;
  }
  let report: VerifyReport;
  try {
    report = await verifyRestore({ adminUrl, ...args });
  } catch (err) {
    const error = err instanceof RestoreError ? err : new RestoreError('connect', 'internal_error');
    failed(error.stage, error.reason);
    return 1;
  }
  print(
    write,
    buildLogLine(
      'operator.restore_verify.completed',
      {
        backupId: report.backupId,
        ok: report.ok,
        failedChecks: report.checks.filter((c) => !c.ok).map((c) => c.id),
      },
      { strict: true, correlationId: null, level: report.ok ? 'info' : 'warn' },
    ),
  );
  return report.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify(buildLogLine('operator.restore_verify.failed', { stage: 'config', reason: 'internal_error' }, { strict: true, correlationId: null }))}\n`,
      );
      process.exit(1);
    });
}
