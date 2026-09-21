// Database reset for the real-server browser specs (W1-INT; W0-02 section 8.1: "The built SPA served by a real API
// process in test mode against the real Postgres; fixture identity"). The evidence configuration has no
// `/__substitute/reset`: a spec that saves, uploads or submits starts each test from fixture set
// slice1-synthetic@1 by emptying the business tables (tests/support/db.ts, as rai_owner) and reloading the set
// through the same loader `npm run fixtures:load` runs, into the blob directory the server process was started
// with (playwright.config.ts: BLOB_DIR=./.local/test/blobs). Sessions and the registry counter are emptied too, so
// a created case is RAI-<year>-0001 again. The database is the one `.env` names; nothing here is a substitute.

import path from 'node:path';
import { sql } from 'drizzle-orm';
import { loadFixtures, type LoadResult } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { openTestDatabase, type TestDatabase } from '../../support/db.js';
import { RAI_WEB_ROOT } from '../../support/process.js';

/** What playwright.config.ts hands the server as BLOB_DIR (relative to rai-web/), resolved. */
export const SERVER_BLOB_DIR = path.join(RAI_WEB_ROOT, '.local', 'test', 'blobs');

/** `fixture set <name>@<version> <sha256[0:12]>`, for spec titles and the evidence record (section 8.3). */
export const FIXTURE_SET = fixtureSetLabel(readManifest());

/** Opens the three role handles for one callback and closes them; migrations are applied once by the open. */
export async function withDatabase<T>(fn: (db: TestDatabase) => Promise<T>): Promise<T> {
  const db = await openTestDatabase();
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** Empties every business table plus sessions and the registry counter, then loads the fixture set. */
export async function resetToFixtureSet(): Promise<LoadResult> {
  return withDatabase(async (db) => {
    await db.reset();
    await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
    return loadFixtures(db.operator, { nodeEnv: 'test', identityMode: 'fixture', blobDir: SERVER_BLOB_DIR });
  });
}

/** One row of a plain query as rai_owner (assertions on what the server wrote; never through the UI). */
export async function queryRows<T extends Record<string, unknown>>(
  statement: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withDatabase((db) =>
    db.raw('owner', async (client) => (await client.query(statement, params)).rows as T[]),
  );
}
