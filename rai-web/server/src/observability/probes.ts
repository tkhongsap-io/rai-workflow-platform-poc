import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import pg from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { MIGRATIONS_FOLDER } from '../db/migrate.js';
import { isRollbackClass, type RollbackClass } from '../db/migration-classes.js';
import { PROBE_TIMEOUT_MS, type HealthProbes } from './health.js';

/** The recorded rollback class of an applied migration (schema_migration_class), or undefined when none is. */
export type MigrationClassOf = (hash: string) => RollbackClass | undefined;

/**
 * Compare the complete ordered journal; equal counts alone could hide rewritten/mismatched migrations. W7-03 (W0-04
 * "if ahead by an additive migration, it serves"): `ahead` when this build's journal is a strict prefix of the
 * database's and every extra hash is recorded as additive; a hash with no recorded class is not additive.
 */
export function migrationStatus(
  expected: readonly string[],
  applied: readonly string[],
  classOf: MigrationClassOf = () => undefined,
): 'current' | 'pending' | 'ahead' | 'unknown' {
  const shared = Math.min(applied.length, expected.length);
  for (let index = 0; index < shared; index++) if (applied[index] !== expected[index]) return 'unknown';
  if (applied.length < expected.length) return 'pending';
  if (applied.length === expected.length) return 'current';
  return applied.slice(expected.length).every((hash) => classOf(hash) === 'additive') ? 'ahead' : 'unknown';
}

export async function writableDirectory(root: string): Promise<'ok' | 'unreachable' | 'not_writable'> {
  try {
    if (!(await stat(root)).isDirectory()) return 'unreachable';
  } catch {
    return 'unreachable';
  }
  try {
    await access(root, constants.W_OK);
    return 'ok';
  } catch {
    return 'not_writable';
  }
}

/** Short-lived read-only connections avoid exhausting the business pool when it is blocked or unreachable. */
async function query(connectionString: string, sql: string, params?: unknown[]): Promise<pg.QueryResult> {
  const client = new pg.Client({
    connectionString,
    application_name: 'rai-readiness',
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    query_timeout: PROBE_TIMEOUT_MS,
    statement_timeout: PROBE_TIMEOUT_MS,
  });
  // Terminate the socket too: a Promise.race timeout alone would leave its query/connection alive.
  const timer = setTimeout(() => {
    void client.end().catch(() => {});
  }, PROBE_TIMEOUT_MS);
  try {
    await client.connect();
    return await client.query(sql, params);
  } finally {
    clearTimeout(timer);
    await client.end().catch(() => {});
  }
}

export function createStoreProbes(
  connectionString: string,
  blobRoot: string,
  migrationsFolder = MIGRATIONS_FOLDER,
): Pick<HealthProbes, 'db' | 'migrations' | 'blob'> {
  const expected = readMigrationFiles({ migrationsFolder }).map((migration) => migration.hash);
  async function recordedClasses(hashes: readonly string[]): Promise<MigrationClassOf> {
    try {
      const result = await query(
        connectionString,
        'SELECT hash, rollback_class FROM schema_migration_class WHERE hash = ANY($1::text[])',
        [hashes],
      );
      const classes = new Map<string, RollbackClass>();
      for (const row of result.rows as { hash: string; rollback_class: unknown }[])
        if (isRollbackClass(row.rollback_class)) classes.set(row.hash, row.rollback_class);
      return (hash) => classes.get(hash);
    } catch (error) {
      // A database from before W7-03 has no class table: nothing is recorded, so nothing is additive.
      if ((error as { code?: unknown } | null)?.code === '42P01') return () => undefined;
      throw error;
    }
  }

  return {
    async db() {
      try {
        await query(connectionString, 'SELECT 1');
        return 'ok';
      } catch (error) {
        // pg cancellation (statement_timeout) has a stable code; never inspect or return error.message.
        return (error as { code?: unknown } | null)?.code === '57014' ? 'timeout' : 'unreachable';
      }
    },
    async migrations() {
      try {
        const result = await query(
          connectionString,
          'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC',
        );
        const applied = result.rows.map((row: { hash: string }) => row.hash);
        const status = migrationStatus(expected, applied);
        if (status !== 'unknown' || applied.length <= expected.length) return status;
        // Only a longer journal can be `ahead`: read the recorded classes of the extra hashes from the database,
        // never this build's map, which cannot know a newer build's tags (W7 plan section 3.3).
        return migrationStatus(expected, applied, await recordedClasses(applied.slice(expected.length)));
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        return code === '42P01' || code === '3F000' ? 'pending' : 'unknown';
      }
    },
    blob: () => writableDirectory(blobRoot),
  };
}
