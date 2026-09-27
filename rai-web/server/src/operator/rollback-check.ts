// `npm run release:check-rollback -- --target-migrations <path to the target release's server/drizzle>` (W7-03;
// W7 plan section 3.3, W7-D8): an operator command, never an HTTP route. It answers whether rolling this database
// back to the target release needs only its binary or a restore:
//   binary_only       the target's journal is a prefix of the database's, and it equals it or it carries the W7-03
//                     migration and every newer applied migration is recorded additive: the target build serves
//                     with readiness `ahead` or `current` (exit 0);
//   restore_required  a newer applied migration is not recorded additive (blockingReason `not_additive`), or the
//                     target predates W7-03 and so cannot answer `ahead` (`target_predates_ahead_readiness`): names
//                     the blocking migration and the backups under BACKUP_DIR whose manifest journal equals the
//                     target's (exit 3);
//   incompatible      the target's journal is not a prefix of the database's (exit 4).
// It reads the database (DATABASE_URL, rai_app: drizzle.__drizzle_migrations and schema_migration_class), the same
// source readiness uses, so `binary_only` means the target build's /readyz answers `ahead` or `current`. Output:
// one JSON line through buildLogLine (W0-10 section 3.3), never a URL, password or path.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  ConfigError,
  EXIT_CONFIG,
  parseDatabaseConfig,
  parseOptionalBackupDir,
  readEnv,
  type Env,
} from '../config.js';
import { MIGRATIONS_FOLDER, readMigrationJournal } from '../db/migrate.js';
import { AHEAD_READINESS_TAG_SUFFIX, isRollbackClass, type RollbackClass } from '../db/migration-classes.js';
import { buildLogLine } from '../observability/log.js';

export const EXIT_USAGE = 64;
export const ROLLBACK_EXIT = Object.freeze({ binary_only: 0, restore_required: 3, incompatible: 4 } as const);

export type RollbackStage = 'args' | 'config' | 'target' | 'connect' | 'read';

export class RollbackCheckError extends Error {
  constructor(
    readonly stage: RollbackStage,
    readonly reason: string, // a code, never a value
  ) {
    super(`rollback check ${stage}: ${reason}`);
    this.name = 'RollbackCheckError';
  }
}

export type BlockingReason = 'not_additive' | 'target_predates_ahead_readiness';

export type RollbackVerdict =
  | { verdict: 'binary_only'; extraMigrations: string[] }
  | {
      verdict: 'restore_required';
      extraMigrations: string[];
      blockingMigration: string;
      blockingReason: BlockingReason;
    }
  | { verdict: 'incompatible'; extraMigrations: [] };

/**
 * The verdict for rolling a database whose applied journal is `applied` back to a release whose journal is `target`
 * (hashes, in order). `classOf` is the recorded class of an applied hash; no class means not additive. `aheadHash`
 * is the hash of the W7-03 migration: a target without it answers readiness `unknown` (not ready) for any longer
 * journal, so with extras that are all additive it still needs a restore, and the first extra blocks. A
 * non-additive extra is reported first (`not_additive`): no build can roll back past it without a restore.
 */
export function rollbackVerdict(
  target: readonly string[],
  applied: readonly { hash: string; tag: string }[],
  classOf: (hash: string) => RollbackClass | undefined,
  aheadHash: string,
): RollbackVerdict {
  if (target.length > applied.length || target.some((hash, index) => applied[index]!.hash !== hash))
    return { verdict: 'incompatible', extraMigrations: [] };
  const extras = applied.slice(target.length);
  const extraMigrations = extras.map(({ tag }) => tag);
  const blocking = extras.find(({ hash }) => classOf(hash) !== 'additive');
  if (blocking !== undefined)
    return {
      verdict: 'restore_required',
      extraMigrations,
      blockingMigration: blocking.tag,
      blockingReason: 'not_additive',
    };
  if (extras.length > 0 && !target.includes(aheadHash))
    return {
      verdict: 'restore_required',
      extraMigrations,
      blockingMigration: extras[0]!.tag,
      blockingReason: 'target_predates_ahead_readiness',
    };
  return { verdict: 'binary_only', extraMigrations };
}

/** The hash of the W7-03 migration in `journal` (this build's); a journal without exactly one is a broken build. */
export function aheadReadinessHash(journal: readonly { tag: string; hash: string }[]): string {
  const named = journal.filter(({ tag }) => tag.endsWith(AHEAD_READINESS_TAG_SUFFIX));
  if (named.length !== 1) throw new RollbackCheckError('read', 'build_journal_invalid');
  return named[0]!.hash;
}

export function parseRollbackArgs(argv: readonly string[]): { targetMigrations: string } {
  let targetMigrations: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (argv[i] !== '--target-migrations' || value === undefined || targetMigrations !== undefined)
      throw new RollbackCheckError('args', 'invalid_arguments');
    targetMigrations = value;
  }
  if (targetMigrations === undefined) throw new RollbackCheckError('args', 'invalid_arguments');
  return { targetMigrations };
}

/** Backup IDs under `backupDir` whose manifest journal hashes equal `target`, newest first (IDs start with a UTC stamp). */
export async function findMatchingBackups(
  backupDir: string | undefined,
  target: readonly string[],
): Promise<string[]> {
  if (backupDir === undefined) return [];
  let names: string[];
  try {
    names = (await readdir(backupDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const name of names) {
    try {
      const manifest = JSON.parse(await readFile(path.join(backupDir, name, 'manifest.json'), 'utf8')) as {
        journal?: unknown;
      };
      if (!Array.isArray(manifest.journal)) continue;
      const hashes = manifest.journal.map((entry: unknown) => (entry as { hash?: unknown } | null)?.hash);
      if (hashes.length === target.length && hashes.every((hash, index) => hash === target[index]))
        matches.push(name);
    } catch {
      // not a backup (no or unreadable manifest)
    }
  }
  return matches.sort().reverse();
}

interface AppliedMigration {
  hash: string;
  tag: string;
  rollbackClass: RollbackClass | undefined;
}

/** The database's applied journal with each migration's recorded tag and class (schema_migration_class). */
async function readApplied(connectionString: string): Promise<AppliedMigration[]> {
  const client = new pg.Client({
    connectionString,
    application_name: 'rai-rollback-check',
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch {
    throw new RollbackCheckError('connect', 'database_unreachable');
  }
  try {
    const applied = await client.query<{ hash: string }>(
      'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC',
    );
    const recorded = new Map<string, { tag: string; rollbackClass: RollbackClass | undefined }>();
    const table = await client.query<{ t: string | null }>(
      `SELECT to_regclass('public.schema_migration_class') AS t`,
    );
    if (table.rows[0]?.t !== null && table.rows[0]?.t !== undefined) {
      const rows = await client.query<{ hash: string; tag: string; rollback_class: string }>(
        'SELECT hash, tag, rollback_class FROM schema_migration_class',
      );
      for (const row of rows.rows)
        recorded.set(row.hash, {
          tag: row.tag,
          rollbackClass: isRollbackClass(row.rollback_class) ? row.rollback_class : undefined,
        });
    }
    // A hash with no class row is named by this build's journal, or by its hash when this build does not know it.
    const buildTags = new Map(readMigrationJournal(MIGRATIONS_FOLDER).map(({ hash, tag }) => [hash, tag]));
    return applied.rows.map(({ hash }) => ({
      hash,
      tag: recorded.get(hash)?.tag ?? buildTags.get(hash) ?? hash,
      rollbackClass: recorded.get(hash)?.rollbackClass,
    }));
  } catch (err) {
    if (err instanceof RollbackCheckError) throw err;
    throw new RollbackCheckError('read', 'database_read_failed');
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface RollbackCheckResult {
  verdict: RollbackVerdict;
  matchingBackups: string[];
}

export async function runRollbackCheck(config: {
  databaseUrl: string;
  targetMigrations: string;
  backupDir: string | undefined;
}): Promise<RollbackCheckResult> {
  let target: string[];
  try {
    target = readMigrationJournal(path.resolve(config.targetMigrations)).map(({ hash }) => hash);
  } catch {
    throw new RollbackCheckError('target', 'target_unreadable');
  }
  const aheadHash = aheadReadinessHash(readMigrationJournal(MIGRATIONS_FOLDER));
  const applied = await readApplied(config.databaseUrl);
  const classes = new Map(applied.map(({ hash, rollbackClass }) => [hash, rollbackClass]));
  const verdict = rollbackVerdict(target, applied, (hash) => classes.get(hash), aheadHash);
  return {
    verdict,
    matchingBackups:
      verdict.verdict === 'restore_required' ? await findMatchingBackups(config.backupDir, target) : [],
  };
}

type Write = (line: string) => void;

/** The command: parse, run, print one JSON line; returns the exit code (0, 3, 4; 1, 64 usage, 78 configuration). */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Env = readEnv(),
  write: Write = (line) => process.stdout.write(`${line}\n`),
  where: { cwd?: string; repoRoot?: string } = {},
): Promise<number> {
  const failed = (stage: RollbackStage, reason: string) =>
    write(
      JSON.stringify(
        buildLogLine(
          'operator.rollback_check.failed',
          { stage, reason },
          { strict: true, correlationId: null },
        ),
      ),
    );
  let args: { targetMigrations: string };
  try {
    args = parseRollbackArgs(argv);
  } catch {
    failed('args', 'invalid_arguments');
    return EXIT_USAGE;
  }
  let databaseUrl: string;
  let backupDir: string | undefined;
  try {
    databaseUrl = parseDatabaseConfig(env).url;
    backupDir = parseOptionalBackupDir(env, where);
  } catch (err) {
    if (err instanceof ConfigError) {
      failed('config', err.reason);
      return EXIT_CONFIG;
    }
    throw err;
  }
  try {
    const { verdict, matchingBackups } = await runRollbackCheck({
      databaseUrl,
      targetMigrations: args.targetMigrations,
      backupDir,
    });
    write(
      JSON.stringify(
        buildLogLine(
          'operator.rollback_check.completed',
          {
            verdict: verdict.verdict,
            extraMigrations: verdict.extraMigrations,
            ...(verdict.verdict === 'restore_required'
              ? {
                  blockingMigration: verdict.blockingMigration,
                  blockingReason: verdict.blockingReason,
                  matchingBackups,
                }
              : {}),
          },
          { strict: true, correlationId: null },
        ),
      ),
    );
    return ROLLBACK_EXIT[verdict.verdict];
  } catch (err) {
    const error = err instanceof RollbackCheckError ? err : new RollbackCheckError('read', 'internal_error');
    failed(error.stage, error.reason);
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify(buildLogLine('operator.rollback_check.failed', { stage: 'read', reason: 'internal_error' }, { strict: true, correlationId: null }))}\n`,
      );
      process.exit(1);
    });
}
