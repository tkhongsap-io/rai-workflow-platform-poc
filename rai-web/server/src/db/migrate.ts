// `npm run migrate` (W0-02 section 3.3; W0-04 "Schema evolution"): applies the pending forward-only SQL migrations
// under server/drizzle/ to DATABASE_MIGRATE_URL as rai_owner, one transaction per file, recording each in Drizzle's
// migrations table (drizzle.__drizzle_migrations, the shape drizzle-kit and drizzle-orm's own migrator use).
// The server never calls this; main.ts never migrates. Idempotent: a rerun applies nothing.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { parseDatabaseConfig, readEnv } from '../config.js';

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
    return result;
  } finally {
    await client.end();
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
