// `npm run migrate` (W0-02 section 3.3; W0-04 "Schema evolution"): applies the pending forward-only SQL migrations
// under server/drizzle/ to DATABASE_MIGRATE_URL as rai_owner, one transaction per file, recording each in Drizzle's
// migrations table (drizzle.__drizzle_migrations, the shape drizzle-kit and drizzle-orm's own migrator use).
// The server never calls this; main.ts never migrates. Idempotent: a rerun applies nothing. W7-03: after applying,
// it records every applied migration's rollback class in schema_migration_class (recordMigrationClasses).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { parseDatabaseConfig, readEnv } from '../config.js';
import { MIGRATION_CLASSES, MigrationClassError, type RollbackClass } from './migration-classes.js';

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface MigrateResult {
  applied: string[]; // hashes applied by this run, in order
  alreadyApplied: number;
}

/** Applies pending migrations from `folder` using `connectionString` (rai_owner). */
export async function runMigrations(
  connectionString: string,
  folder: string = MIGRATIONS_FOLDER,
): Promise<MigrateResult> {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const client = new pg.Client({ connectionString, application_name: 'rai-migrate' });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    const { rows } = await client.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at ASC, id ASC`,
    );
    const appliedHashes = new Set(rows.map((r) => r.hash));
    const lastMillis = rows.length > 0 ? Number(rows[rows.length - 1]!.created_at) : -1;

    const result: MigrateResult = { applied: [], alreadyApplied: 0 };
    for (const migration of migrations) {
      if (appliedHashes.has(migration.hash)) {
        result.alreadyApplied += 1;
        continue;
      }
      if (migration.folderMillis <= lastMillis) {
        // Forward-only: a file older than the last applied one that is not recorded means the folder was rewritten.
        throw new Error(
          `migration folder is behind the database: unapplied migration ${migration.folderMillis} precedes the last applied ${lastMillis}`,
        );
      }
      await client.query('BEGIN');
      try {
        for (const statement of migration.sql) {
          if (statement.trim().length > 0) await client.query(statement);
        }
        await client.query(
          `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) VALUES ($1, $2)`,
          [migration.hash, migration.folderMillis],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      result.applied.push(migration.hash);
    }
    await recordMigrationClasses(client, folder);
    return result;
  } finally {
    await client.end();
  }
}

export interface JournalMigration {
  tag: string;
  hash: string;
  folderMillis: number;
}

/**
 * Pairs Drizzle's migration files (hash, folderMillis; no tag) with meta/_journal.json entries by index, the order
 * `readMigrationFiles` reads them in. A count mismatch fails with `migration_journal_mismatch`.
 */
export function pairMigrationJournal(
  files: readonly { hash: string; folderMillis: number }[],
  entries: readonly { tag: string }[],
): JournalMigration[] {
  if (files.length !== entries.length) throw new MigrationClassError('migration_journal_mismatch');
  return files.map((file, index) => ({
    tag: entries[index]!.tag,
    hash: file.hash,
    folderMillis: file.folderMillis,
  }));
}

/** The folder's migrations in journal order, each with its tag (W7-03). */
export function readMigrationJournal(folder: string = MIGRATIONS_FOLDER): JournalMigration[] {
  const files = readMigrationFiles({ migrationsFolder: folder });
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  return pairMigrationJournal(files, journal.entries);
}

/**
 * W7-03 (W7 plan section 3.3): records the rollback class of every migration applied to this database that the
 * folder's journal names, back-filling ones applied before W7-03. Does nothing when schema_migration_class does not
 * exist yet (a folder or database from before W7-03). Idempotent: existing rows are kept (`ON CONFLICT (hash) DO
 * NOTHING`); a stored class that differs from `classes` fails with `migration_class_changed`, a named tag without
 * an entry with `migration_class_missing`, and the transaction writes nothing.
 */
export async function recordMigrationClasses(
  client: pg.Client,
  folder: string = MIGRATIONS_FOLDER,
  classes: Readonly<Record<string, RollbackClass>> = MIGRATION_CLASSES,
): Promise<void> {
  const table = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.schema_migration_class') AS t`,
  );
  if (table.rows[0]?.t === null || table.rows[0]?.t === undefined) return;
  const tagOf = new Map(readMigrationJournal(folder).map(({ hash, tag }) => [hash, tag]));
  const { rows } = await client.query<{ hash: string }>(
    `SELECT hash FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at ASC, id ASC`,
  );
  const named: { hash: string; tag: string; rollbackClass: RollbackClass }[] = [];
  for (const { hash } of rows) {
    const tag = tagOf.get(hash);
    if (tag === undefined) continue; // applied by another build; that build's migrate records it
    const rollbackClass = Object.hasOwn(classes, tag) ? classes[tag] : undefined;
    if (rollbackClass === undefined) throw new MigrationClassError('migration_class_missing');
    named.push({ hash, tag, rollbackClass });
  }
  await client.query('BEGIN');
  try {
    for (const { hash, tag, rollbackClass } of named)
      await client.query(
        `INSERT INTO schema_migration_class (hash, tag, rollback_class) VALUES ($1, $2, $3) ON CONFLICT (hash) DO NOTHING`,
        [hash, tag, rollbackClass],
      );
    const stored = await client.query<{ hash: string; rollback_class: string }>(
      'SELECT hash, rollback_class FROM schema_migration_class WHERE hash = ANY($1::text[])',
      [named.map(({ hash }) => hash)],
    );
    const expected = new Map(named.map(({ hash, rollbackClass }) => [hash, rollbackClass]));
    if (stored.rows.some((row) => expected.get(row.hash) !== row.rollback_class))
      throw new MigrationClassError('migration_class_changed');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** The number of migration files in the folder: the schema version this build expects. */
export function migrationFileCount(folder: string = MIGRATIONS_FOLDER): number {
  return readMigrationFiles({ migrationsFolder: folder }).length;
}

async function main(): Promise<void> {
  const { migrateUrl } = parseDatabaseConfig(readEnv());
  const result = await runMigrations(migrateUrl);
  console.log(
    `migrate: applied ${result.applied.length} migration(s), ${result.alreadyApplied} already applied`,
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error('migrate: failed', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
