// Database bootstrap for the integration layer (W0-02 section 8.1: the real Postgres, migrated, reset per file).
// Reads the three role URLs from the environment (rai-web/.env or the shell), applies pending migrations once as
// rai_owner, and hands each test file a handle per role plus a reset that empties every business table. Lane C
// owns this directory (W1-12 extends it with the fixture sign-in and the log capture); W1-00 creates the base.

import pg from 'pg';
import { sql } from 'drizzle-orm';
import { parseDatabaseConfig, readEnv } from '@rai/server/config';
import { createDb, type Db, type DbHandle } from '@rai/server/db/client';
import { runMigrations, MIGRATIONS_FOLDER } from '@rai/server/db/migrate';

export interface TestDatabase {
  /** The application role: what the Fastify process uses (rai_app). */
  app: Db;
  /** The schema owner: migrations and privileged assertions (rai_owner). */
  owner: Db;
  /** The operator role: cleanup commands (rai_operator; defaults to the owner URL locally). */
  operator: Db;
  urls: { app: string; owner: string; operator: string };
  /** Empties every business table (as rai_owner; TRUNCATE fires no row trigger) so a file starts from nothing. */
  reset(): Promise<void>;
  /** Runs a callback with a raw pg client for one role; used to assert grants and triggers with plain SQL. */
  raw<T>(role: 'app' | 'owner' | 'operator', fn: (client: pg.Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Every table the substrate creates, in truncation order (TRUNCATE ... CASCADE handles the FKs). */
export const BUSINESS_TABLES = [
  'audit_event',
  'idempotency_key',
  'artifact_slot',
  'artifact',
  'pack_version',
  'case',
  'configuration_revision',
] as const;

export async function openTestDatabase(): Promise<TestDatabase> {
  const { url, migrateUrl, operatorUrl } = parseDatabaseConfig(readEnv());
  await runMigrations(migrateUrl, MIGRATIONS_FOLDER);
  const handles: Record<'app' | 'owner' | 'operator', DbHandle> = {
    app: createDb(url, { max: 4 }),
    owner: createDb(migrateUrl, { max: 2 }),
    operator: createDb(operatorUrl, { max: 2 }),
  };
  const urls = { app: url, owner: migrateUrl, operator: operatorUrl };
  return {
    app: handles.app.db,
    owner: handles.owner.db,
    operator: handles.operator.db,
    urls,
    async reset() {
      const list = BUSINESS_TABLES.map((t) => `"${t}"`).join(', ');
      await handles.owner.db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
    },
    async raw(role, fn) {
      const client = new pg.Client({ connectionString: urls[role], application_name: `rai-test-${role}` });
      await client.connect();
      try {
        return await fn(client);
      } finally {
        await client.end();
      }
    },
    async close() {
      await Promise.all(Object.values(handles).map((h) => h.close()));
    },
  };
}

/** Runs `statement` as `role` and returns the Postgres error, or undefined when it unexpectedly succeeded. */
export async function expectSqlError(
  db: TestDatabase,
  role: 'app' | 'owner' | 'operator',
  statement: string,
  params: unknown[] = [],
): Promise<(Error & { code?: string; detail?: string }) | undefined> {
  return db.raw(role, async (client) => {
    try {
      await client.query(statement, params);
      return undefined;
    } catch (err) {
      return err as Error & { code?: string; detail?: string };
    }
  });
}

/** Postgres SQLSTATE for "insufficient_privilege". */
export const INSUFFICIENT_PRIVILEGE = '42501';
/** Postgres SQLSTATE for a RAISE EXCEPTION without an explicit code. */
export const RAISE_EXCEPTION = 'P0001';
