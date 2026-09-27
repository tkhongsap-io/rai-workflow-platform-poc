// `npm run backup [-- --label <text>]` (W7-01; W7 plan section 3.1, W7-D5, W7-D6): an operator command, never an
// HTTP route. Writes <BACKUP_DIR>/<YYYYMMDDTHHMMSSZ-label>/ with
//   db.dump        pg_dump --format=custom --no-owner of the database as rai_owner, session rows excluded (a restore
//                  can never revive a revoked session, and a backup holds no token hashes);
//   blobs/         every blob an artifact row references (bytes_state = present), in the W0-04 layout, each hash
//                  verified while copying; copied after the dump finishes (a blob commits before its row and blobs
//                  are write-once, so every row in the dump has its bytes);
//   manifest.json  { backupId, createdAt, buildCommit, journal, dumpSha256, blobs, tableCounts, frozenDigest,
//                  fixtureSet }, written last, so a directory without it is not a backup.
// The manifest's journal, counts, digest, fixture set and blob list are read inside the repeatable-read transaction
// whose exported snapshot pg_dump uses, so the manifest describes exactly the dump. Directories 0700, files 0600;
// a failure removes the partial directory. Output: one JSON line through buildLogLine (W0-10 section 3.3,
// `operator.backup.completed` / `operator.backup.failed`), never a URL, password, path or row content.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { keyPathFor } from '../artifacts/blob-store.js';
import {
  ConfigError,
  EXIT_CONFIG,
  parseBackupConfig,
  parseDatabaseConfig,
  readEnv,
  type Env,
} from '../config.js';
import { MIGRATIONS_FOLDER } from '../db/migrate.js';
import { buildLogLine } from '../observability/log.js';
import { frozenDigest } from './frozen-digest.js';
import { PgToolsError, connectionFromUrl, resolvePgTools, type PgTools } from './pg-tools.js';

export const EXIT_USAGE = 64;

export type BackupStage =
  'args' | 'config' | 'connect' | 'version' | 'prepare' | 'snapshot' | 'dump' | 'blobs' | 'manifest';

export class BackupError extends Error {
  constructor(
    readonly stage: BackupStage,
    readonly reason: string, // a code, never a value
  ) {
    super(`backup ${stage}: ${reason}`);
    this.name = 'BackupError';
  }
}

export interface BackupRunConfig {
  migrateUrl: string; // rai_owner: owns every table, so it can dump them all
  blobDir: string;
  backupDir: string; // absolute, already checked by parseBackupConfig
  label?: string | undefined;
  buildCommit: string;
}

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  buildCommit: string;
  journal: { tag: string | null; hash: string }[]; // drizzle.__drizzle_migrations in order; tag null if unknown here
  dumpSha256: string;
  blobs: { count: number; totalBytes: number };
  tableCounts: Record<string, number>; // every public table except session
  frozenDigest: string;
  fixtureSet: { name: string; version: string; sha256: string }[];
}

export interface BackupResult {
  backupId: string;
  manifest: BackupManifest;
  durationMs: number;
}

/** W7 plan 3.1 step 1: pg_dump's major must equal the server's (`SHOW server_version_num`, e.g. 160015 → 16). */
export function checkToolVersion(toolMajor: number, serverVersionNum: string): void {
  if (!/^\d{5,6}$/.test(serverVersionNum)) throw new BackupError('version', 'server_version_unreadable');
  if (Math.floor(Number(serverVersionNum) / 10_000) !== toolMajor)
    throw new BackupError('version', 'pg_tools_version_mismatch');
}

const LABEL = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `YYYYMMDDTHHMMSSZ-<label>` in UTC; the label is a short lowercase slug (it names a directory). */
export function backupId(now: Date, label: string | undefined): string {
  const slug = label ?? 'manual';
  if (!LABEL.test(slug)) throw new BackupError('args', 'invalid_label');
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `${stamp}-${slug}`;
}

export function parseBackupArgs(argv: readonly string[]): { label?: string } {
  const out: { label?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] !== '--label' || value === undefined || out.label !== undefined)
      throw new BackupError('args', 'invalid_arguments');
    out.label = value;
    i += 1;
  }
  return out;
}

/** hash → tag for the migrations this build knows (journal entries and files pair by index). */
async function knownTags(): Promise<Map<string, string>> {
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const tags = new Map<string, string>();
  files.forEach((file, i) => {
    const entry = journal.entries[i];
    if (entry !== undefined) tags.set(file.hash, entry.tag);
  });
  return tags;
}

interface SnapshotFacts {
  journal: BackupManifest['journal'];
  tableCounts: Record<string, number>;
  frozenDigest: string;
  fixtureSet: BackupManifest['fixtureSet'];
  blobs: { hash: string; size: number }[];
}

async function readFacts(client: pg.Client): Promise<SnapshotFacts> {
  const tags = await knownTags();
  const applied = await client.query<{ hash: string }>(
    'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC',
  );
  const tables = await client.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'session' ORDER BY 1`,
  );
  const tableCounts: Record<string, number> = {};
  for (const { name } of tables.rows) {
    const count = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`,
    );
    tableCounts[name] = Number(count.rows[0]!.n);
  }
  const fixtureSet = await client.query<{ name: string; version: string; sha256: string }>(
    'SELECT name, version, sha256 FROM fixture_set ORDER BY name, version',
  );
  const blobs = await client.query<{ hash: string; size: string }>(
    `SELECT content_hash AS hash, max(size_bytes)::bigint AS size FROM artifact
      WHERE bytes_state = 'present' GROUP BY content_hash ORDER BY content_hash`,
  );
  return {
    journal: applied.rows.map((r) => ({ tag: tags.get(r.hash) ?? null, hash: r.hash })),
    tableCounts,
    frozenDigest: await frozenDigest(
      async (text) => (await client.query<Record<string, unknown>>(text)).rows,
    ),
    fixtureSet: fixtureSet.rows,
    blobs: blobs.rows.map((r) => ({ hash: r.hash, size: Number(r.size) })),
  };
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Copies one blob into the backup's W0-04 layout, hashing and counting on the way. */
async function copyBlob(
  blobDir: string,
  targetRoot: string,
  blob: { hash: string; size: number },
): Promise<void> {
  const target = keyPathFor(targetRoot, blob.hash);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(keyPathFor(blobDir, blob.hash)),
      meter,
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new BackupError('blobs', 'blob_missing');
    throw new BackupError('blobs', 'blob_copy_failed');
  }
  if (hash.digest('hex') !== blob.hash) throw new BackupError('blobs', 'blob_hash_mismatch');
  if (size !== blob.size) throw new BackupError('blobs', 'blob_size_mismatch');
}

const asBackupError = (stage: BackupStage, err: unknown, fallback: string): BackupError => {
  if (err instanceof BackupError) return err;
  if (err instanceof PgToolsError) return new BackupError(stage, err.reason);
  return new BackupError(stage, fallback);
};

/** W7 plan section 3.1 steps 1-5. `now` names the backup; the duration is measured separately. */
export async function runBackup(
  config: BackupRunConfig,
  tools: PgTools,
  now: () => Date = () => new Date(),
): Promise<BackupResult> {
  const started = performance.now();
  const createdAt = now();
  const id = backupId(createdAt, config.label);
  let conn: ReturnType<typeof connectionFromUrl>;
  try {
    conn = connectionFromUrl(config.migrateUrl);
  } catch {
    throw new BackupError('connect', 'invalid_database_url');
  }
  const client = new pg.Client({
    connectionString: config.migrateUrl,
    application_name: 'rai-backup',
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch {
    throw new BackupError('connect', 'database_unreachable');
  }
  let dir: string | undefined;
  try {
    await client.query(`SET TimeZone = 'UTC'`); // the frozen digest renders timestamps in the session zone
    const server = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    let toolMajor: number;
    try {
      toolMajor = await tools.version();
    } catch (err) {
      throw asBackupError('version', err, 'pg_tools_unavailable');
    }
    checkToolVersion(toolMajor, server.rows[0]!.server_version_num);

    try {
      await mkdir(config.backupDir, { recursive: true, mode: 0o700 });
      await mkdir(path.join(config.backupDir, id), { mode: 0o700 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new BackupError('prepare', 'backup_exists');
      throw new BackupError('prepare', 'backup_dir_unwritable');
    }
    dir = path.join(config.backupDir, id);
    const dumpPath = path.join(dir, 'db.dump');

    let facts: SnapshotFacts;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const snapshot = await client.query<{ id: string }>('SELECT pg_export_snapshot() AS id');
      try {
        facts = await readFacts(client);
      } catch (err) {
        throw asBackupError('snapshot', err, 'snapshot_read_failed');
      }
      try {
        await tools.dump(
          conn,
          [
            '--format=custom',
            '--no-owner',
            '--exclude-table-data=public.session',
            `--snapshot=${snapshot.rows[0]!.id}`,
          ],
          dumpPath,
        );
      } catch (err) {
        throw asBackupError('dump', err, 'dump_failed');
      }
    } finally {
      await client.query('COMMIT').catch(() => undefined);
    }

    const blobsRoot = path.join(dir, 'blobs');
    await mkdir(blobsRoot, { mode: 0o700 });
    for (const blob of facts.blobs) await copyBlob(path.resolve(config.blobDir), blobsRoot, blob);

    let manifest: BackupManifest;
    try {
      manifest = {
        backupId: id,
        createdAt: createdAt.toISOString(),
        buildCommit: config.buildCommit,
        journal: facts.journal,
        dumpSha256: await sha256File(dumpPath),
        blobs: { count: facts.blobs.length, totalBytes: facts.blobs.reduce((sum, b) => sum + b.size, 0) },
        tableCounts: facts.tableCounts,
        frozenDigest: facts.frozenDigest,
        fixtureSet: facts.fixtureSet,
      };
      await writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (err) {
      throw asBackupError('manifest', err, 'manifest_write_failed');
    }
    return { backupId: id, manifest, durationMs: Math.round(performance.now() - started) };
  } catch (err) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    throw asBackupError('snapshot', err, 'internal_error');
  } finally {
    await client.end().catch(() => undefined);
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
  const failed = (stage: BackupStage, reason: string) =>
    print(
      write,
      buildLogLine('operator.backup.failed', { stage, reason }, { strict: true, correlationId: null }),
    );
  let args: { label?: string };
  try {
    args = parseBackupArgs(argv);
    if (args.label !== undefined) backupId(new Date(), args.label);
  } catch (err) {
    failed('args', err instanceof BackupError ? err.reason : 'invalid_arguments');
    return EXIT_USAGE;
  }
  let run: BackupRunConfig;
  let tools: PgTools;
  try {
    const { migrateUrl } = parseDatabaseConfig(env);
    const backup = parseBackupConfig(env);
    const blobDir = env.BLOB_DIR?.trim();
    if (blobDir === undefined || blobDir === '') throw new ConfigError('missing:BLOB_DIR');
    const buildCommit = env.BUILD_COMMIT?.trim();
    run = {
      migrateUrl,
      blobDir: path.resolve(blobDir),
      backupDir: backup.backupDir,
      label: args.label,
      buildCommit: buildCommit === undefined || buildCommit === '' ? 'unrecorded' : buildCommit,
    };
    tools = resolvePgTools(backup);
  } catch (err) {
    if (err instanceof ConfigError) {
      failed('config', err.reason);
      return EXIT_CONFIG;
    }
    throw err;
  }
  try {
    const result = await runBackup(run, tools);
    print(
      write,
      buildLogLine(
        'operator.backup.completed',
        {
          backupId: result.backupId,
          blobCount: result.manifest.blobs.count,
          tableCount: Object.keys(result.manifest.tableCounts).length,
          durationMs: result.durationMs,
        },
        { strict: true, correlationId: null },
      ),
    );
    return 0;
  } catch (err) {
    const error = asBackupError('snapshot', err, 'internal_error');
    failed(error.stage, error.reason);
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify(buildLogLine('operator.backup.failed', { stage: 'config', reason: 'internal_error' }, { strict: true, correlationId: null }))}\n`,
      );
      process.exit(1);
    });
}
