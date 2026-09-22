import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import pg from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { MIGRATIONS_FOLDER } from '../db/migrate.js';
import { PROBE_TIMEOUT_MS, type HealthProbes } from './health.js';

/** Compare the complete ordered journal; equal counts alone could hide rewritten/mismatched migrations. */
export function migrationStatus(
  expected: readonly string[],
  applied: readonly string[],
): 'current' | 'pending' | 'unknown' {
  if (applied.length > expected.length || applied.some((hash, index) => hash !== expected[index]))
    return 'unknown';
  return applied.length === expected.length ? 'current' : 'pending';
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
async function query(connectionString: string, sql: string): Promise<pg.QueryResult> {
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
    return await client.query(sql);
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
        return migrationStatus(
          expected,
          result.rows.map((row: { hash: string }) => row.hash),
        );
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        return code === '42P01' || code === '3F000' ? 'pending' : 'unknown';
      }
    },
    blob: () => writableDirectory(blobRoot),
  };
}
