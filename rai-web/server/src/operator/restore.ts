// `npm run restore -- --from <backupDir> --target-db <name> --blob-dir <dir>` (W7-02; W7 plan section 3.2, W7-D7):
// an operator command, never an HTTP route. Restores a W7-01 backup into a NEW database and a NEW blob directory;
// the live database and blob directory are never touched, and the operator repoints configuration afterwards.
//
//   1. refuses a target that is the live database (any configured role URL's database), an existing database or an
//      existing blob directory, a missing or malformed manifest, and a dump whose SHA-256 is not the manifest's,
//      before anything is created;
//   2. refuses pg_restore of another major version than the server's;
//   3. as DATABASE_ADMIN_URL: CREATE DATABASE <name> OWNER rai_owner; in it, the per-database statements of
//      docker/postgres/init/001-roles.sql that a dump does not carry; then pg_restore --no-owner --role=rai_owner
//      --exit-on-error over stdin (triggers are post-data, so they are created after the load and fire on nothing);
//   4. copies <backupDir>/blobs/ into the blob directory in the W0-04 layout, re-hashing each file against its key.
// A failure after the database or blob directory was created drops that database and removes that directory, so a
// failed restore leaves nothing behind. Output: one JSON line through buildLogLine (W0-10 section 3.3,
// `operator.restore.completed` / `operator.restore.failed`), never a URL, password, path or row content.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { keyPathFor } from '../artifacts/blob-store.js';
import {
  ConfigError,
  EXIT_CONFIG,
  parseDatabaseConfig,
  parseRestoreConfig,
  readEnv,
  type Env,
} from '../config.js';
import { buildLogLine } from '../observability/log.js';
import type { BackupManifest } from './backup.js';
import { PgToolsError, connectionFromUrl, resolvePgTools, type PgTools } from './pg-tools.js';

export const EXIT_USAGE = 64;

export type RestoreStage =
  'args' | 'config' | 'target' | 'manifest' | 'connect' | 'version' | 'create' | 'restore' | 'blobs';

export class RestoreError extends Error {
  constructor(
    readonly stage: RestoreStage,
    readonly reason: string, // a code, never a value
  ) {
    super(`restore ${stage}: ${reason}`);
    this.name = 'RestoreError';
  }
}

export interface RestoreArgs {
  from: string; // absolute backup directory (holds manifest.json, db.dump, blobs/)
  targetDb: string;
  blobDir: string; // absolute
}

export interface RestoreRunConfig {
  adminUrl: string;
  /** The configured role URLs; the database any of them names is the live one and never a target. */
  liveUrls: readonly string[];
}

export interface RestoreResult {
  backupId: string;
  durationMs: number;
}

const FLAGS = { '--from': 'from', '--target-db': 'targetDb', '--blob-dir': 'blobDir' } as const;

/** `--from`, `--target-db` and `--blob-dir`, each exactly once; paths resolved against `cwd`. Shared by verify. */
export function parseRestoreArgs(argv: readonly string[], cwd: string = process.cwd()): RestoreArgs {
  const out: Partial<Record<'from' | 'targetDb' | 'blobDir', string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as keyof typeof FLAGS;
    const value = argv[i + 1];
    const key = Object.hasOwn(FLAGS, flag) ? FLAGS[flag] : undefined;
    if (key === undefined || value === undefined || value === '' || out[key] !== undefined)
      throw new RestoreError('args', 'invalid_arguments');
    out[key] = value;
  }
  if (out.from === undefined || out.targetDb === undefined || out.blobDir === undefined)
    throw new RestoreError('args', 'invalid_arguments');
  checkTargetName(out.targetDb);
  return {
    from: path.resolve(cwd, out.from),
    targetDb: out.targetDb,
    blobDir: path.resolve(cwd, out.blobDir),
  };
}

const TARGET = /^[a-z_][a-z0-9_]{0,62}$/;

/** The target becomes a database name: a lowercase identifier only, so it never needs quoting rules. */
export function checkTargetName(name: string): void {
  if (!TARGET.test(name)) throw new RestoreError('args', 'invalid_target_db');
}

const databaseOf = (url: string): string => connectionFromUrl(url).database;

/** Refuses the database a configured role URL names (W7-D7: the live database is never a restore target). */
export function refuseLiveTarget(targetDb: string, liveUrls: readonly string[]): void {
  if (liveUrls.some((url) => databaseOf(url) === targetDb))
    throw new RestoreError('target', 'restore_target_is_live');
}

/** `url` with only its database name replaced. */
export function databaseUrlFor(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${encodeURIComponent(database)}`;
  return next.href;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Reads and shape-checks `<from>/manifest.json`; `manifest_unreadable` otherwise. Shared by verify. */
export async function readBackupManifest(from: string): Promise<BackupManifest> {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(path.join(from, 'manifest.json'), 'utf8')) as BackupManifest;
  } catch {
    throw new RestoreError('manifest', 'manifest_unreadable');
  }
  const ok =
    typeof manifest === 'object' &&
    manifest !== null &&
    typeof manifest.backupId === 'string' &&
    Array.isArray(manifest.journal) &&
    manifest.journal.every((j) => typeof j?.hash === 'string') &&
    typeof manifest.dumpSha256 === 'string' &&
    HEX64.test(manifest.dumpSha256) &&
    typeof manifest.frozenDigest === 'string' &&
    typeof manifest.tableCounts === 'object' &&
    manifest.tableCounts !== null &&
    typeof manifest.blobs?.count === 'number';
  if (!ok) throw new RestoreError('manifest', 'manifest_unreadable');
  return manifest;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Every file under `<root>/sha256/`, as its hash key; anything that is not in the W0-04 layout is refused. */
async function backupBlobKeys(root: string): Promise<string[]> {
  const base = path.join(root, 'sha256');
  if (!(await exists(base))) return [];
  const keys: string[] = [];
  for (const a of await readdir(base))
    for (const b of await readdir(path.join(base, a)))
      for (const h of await readdir(path.join(base, a, b))) {
        if (!HEX64.test(h) || h.slice(0, 2) !== a || h.slice(2, 4) !== b)
          throw new RestoreError('blobs', 'blob_layout_invalid');
        keys.push(h);
      }
  return keys.sort();
}

/** Copies one blob into the target's W0-04 layout, re-hashing it against its key. */
async function copyBlob(sourceRoot: string, targetRoot: string, hash: string): Promise<void> {
  const target = keyPathFor(targetRoot, hash);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const digest = createHash('sha256');
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      digest.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(keyPathFor(sourceRoot, hash)),
      meter,
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    throw new RestoreError('blobs', 'blob_copy_failed');
  }
  if (digest.digest('hex') !== hash) throw new RestoreError('blobs', 'blob_hash_mismatch');
}

const asRestoreError = (stage: RestoreStage, err: unknown, fallback: string): RestoreError => {
  if (err instanceof RestoreError) return err;
  if (err instanceof PgToolsError) return new RestoreError(stage, err.reason);
  return new RestoreError(stage, fallback);
};

/** W7 plan section 3.2 (restore). */
export async function runRestore(
  config: RestoreRunConfig,
  tools: PgTools,
  input: RestoreArgs,
): Promise<RestoreResult> {
  const started = performance.now();
  checkTargetName(input.targetDb);
  refuseLiveTarget(input.targetDb, config.liveUrls);

  const manifest = await readBackupManifest(input.from);
  const dumpPath = path.join(input.from, 'db.dump');
  let dumpSha: string;
  try {
    dumpSha = await sha256File(dumpPath);
  } catch {
    throw new RestoreError('manifest', 'dump_unreadable');
  }
  if (dumpSha !== manifest.dumpSha256) throw new RestoreError('manifest', 'dump_sha256_mismatch');

  let adminConn: ReturnType<typeof connectionFromUrl>;
  try {
    adminConn = connectionFromUrl(config.adminUrl);
  } catch {
    throw new RestoreError('connect', 'invalid_database_url');
  }
  const admin = new pg.Client({
    connectionString: config.adminUrl,
    application_name: 'rai-restore',
    connectionTimeoutMillis: 10_000,
  });
  try {
    await admin.connect();
  } catch {
    throw new RestoreError('connect', 'database_unreachable');
  }
  let createdDb = false;
  let createdBlobDir = false;
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [input.targetDb]);
    if (found.rows.length > 0 || (await exists(input.blobDir)))
      throw new RestoreError('target', 'restore_target_exists');

    const server = await admin.query<{ server_version_num: string }>('SHOW server_version_num');
    let toolMajor: number;
    try {
      toolMajor = await tools.version();
    } catch (err) {
      throw asRestoreError('version', err, 'pg_tools_unavailable');
    }
    const serverNum = server.rows[0]!.server_version_num;
    if (!/^\d{5,6}$/.test(serverNum)) throw new RestoreError('version', 'server_version_unreadable');
    if (Math.floor(Number(serverNum) / 10_000) !== toolMajor)
      throw new RestoreError('version', 'pg_tools_version_mismatch');

    try {
      await admin.query(`CREATE DATABASE "${input.targetDb}" OWNER rai_owner`);
      createdDb = true;
    } catch {
      throw new RestoreError('create', 'create_database_failed');
    }
    const targetUrl = databaseUrlFor(config.adminUrl, input.targetDb);
    const inTarget = new pg.Client({ connectionString: targetUrl, application_name: 'rai-restore' });
    try {
      await inTarget.connect();
      // docker/postgres/init/001-roles.sql, the per-database statements a dump does not carry.
      await inTarget.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await inTarget.query('GRANT USAGE ON SCHEMA public TO rai_app, rai_operator');
    } catch {
      throw new RestoreError('create', 'prepare_database_failed');
    } finally {
      await inTarget.end().catch(() => undefined);
    }

    try {
      await tools.restore(
        { ...adminConn, database: input.targetDb },
        ['--no-owner', '--role=rai_owner', '--exit-on-error'],
        dumpPath,
      );
    } catch (err) {
      throw asRestoreError('restore', err, 'restore_failed');
    }

    try {
      await mkdir(path.dirname(input.blobDir), { recursive: true, mode: 0o700 });
      await mkdir(input.blobDir, { mode: 0o700 });
      createdBlobDir = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST')
        throw new RestoreError('target', 'restore_target_exists');
      throw new RestoreError('blobs', 'blob_dir_unwritable');
    }
    const sourceRoot = path.join(input.from, 'blobs');
    let keys: string[];
    try {
      keys = await backupBlobKeys(sourceRoot);
    } catch (err) {
      throw asRestoreError('blobs', err, 'blob_layout_invalid');
    }
    for (const hash of keys) await copyBlob(sourceRoot, input.blobDir, hash);

    return { backupId: manifest.backupId, durationMs: Math.round(performance.now() - started) };
  } catch (err) {
    // Leave nothing behind: only what this run created is removed, never an existing target.
    if (createdBlobDir) await rm(input.blobDir, { recursive: true, force: true });
    if (createdDb)
      await admin.query(`DROP DATABASE IF EXISTS "${input.targetDb}" WITH (FORCE)`).catch(() => undefined);
    throw asRestoreError('restore', err, 'internal_error');
  } finally {
    await admin.end().catch(() => undefined);
  }
}

type Write = (line: string) => void;

function print(write: Write, line: ReturnType<typeof buildLogLine>): void {
  write(JSON.stringify(line));
}

/** The command: parse, run, print one JSON line; returns the exit code (0, 1, 64 usage, 78 configuration). */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Env = readEnv(),
  write: Write = (line) => process.stdout.write(`${line}\n`),
): Promise<number> {
  const failed = (stage: RestoreStage, reason: string) =>
    print(
      write,
      buildLogLine('operator.restore.failed', { stage, reason }, { strict: true, correlationId: null }),
    );
  let args: RestoreArgs;
  try {
    args = parseRestoreArgs(argv);
  } catch (err) {
    failed('args', err instanceof RestoreError ? err.reason : 'invalid_arguments');
    return EXIT_USAGE;
  }
  let run: RestoreRunConfig;
  let tools: PgTools;
  try {
    const database = parseDatabaseConfig(env);
    const restore = parseRestoreConfig(env);
    run = { adminUrl: restore.adminUrl, liveUrls: [database.url, database.migrateUrl, database.operatorUrl] };
    tools = resolvePgTools(restore);
  } catch (err) {
    if (err instanceof ConfigError) {
      failed('config', err.reason);
      return EXIT_CONFIG;
    }
    throw err;
  }
  try {
    const result = await runRestore(run, tools, args);
    print(
      write,
      buildLogLine(
        'operator.restore.completed',
        { backupId: result.backupId, durationMs: result.durationMs },
        { strict: true, correlationId: null },
      ),
    );
    return 0;
  } catch (err) {
    const error = asRestoreError('restore', err, 'internal_error');
    failed(error.stage, error.reason);
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify(buildLogLine('operator.restore.failed', { stage: 'config', reason: 'internal_error' }, { strict: true, correlationId: null }))}\n`,
      );
      process.exit(1);
    });
}
