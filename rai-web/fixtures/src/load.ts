// `npm run fixtures:load` (W0-02 section 3.3; W0-08 section 8.7): loads the fixture set into an EMPTY database,
// inside one transaction, and refuses a non-empty one and any NODE_ENV outside development/test. W1-00 loads the
// part it owns, the configuration seed (the fixture identities live in the fixture identity provider, not in a
// table); W1-09 extends this file with the cases, draft versions, slot dispositions, objects and artifact rows and
// the fixture_set row. Fixtures never fake a transition (W0-08 8.1 rule 4).

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '@rai/server/db/client';
import { withTransaction } from '@rai/server/db/transaction';
import { applyConfigurationSeed, SEED_KINDS } from '@rai/server/configuration/seed';
import { parseDatabaseConfig, parseNodeEnv, readEnv } from '@rai/server/config';

export const FIXTURE_SET = Object.freeze({ name: 'slice1-synthetic', version: '1' }); // manifest and hash: W1-09

export class FixturesRefused extends Error {
  constructor(reason: string) {
    super(`fixtures:load refused: ${reason}`);
    this.name = 'FixturesRefused';
  }
}

export async function databaseIsEmpty(db: Db): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT (SELECT count(*) FROM "case") + (SELECT count(*) FROM configuration_revision) + (SELECT count(*) FROM audit_event) AS n`,
  );
  return Number((result.rows[0] as { n: string }).n) === 0;
}

export interface LoadResult {
  publishedKinds: string[];
  correlationId: string;
}

/** Loads the W1-00-owned seed into an empty database. `publishedAt` is one second in the past so that a submission
 *  made right after loading is "after the publish time" under the provisional activation rule. */
export async function loadFixtures(db: Db, options: { nodeEnv: string; now?: Date }): Promise<LoadResult> {
  if (options.nodeEnv !== 'development' && options.nodeEnv !== 'test')
    throw new FixturesRefused(`NODE_ENV=${options.nodeEnv}`);
  if (!(await databaseIsEmpty(db))) throw new FixturesRefused('database is not empty (run npm run reset)');
  const correlationId = randomUUID();
  const publishedAt = new Date((options.now ?? new Date()).getTime() - 1000);
  await withTransaction(db, async (tx) => {
    await applyConfigurationSeed(tx, { correlationId, publishedAt });
  });
  return { publishedKinds: [...SEED_KINDS], correlationId };
}

async function main(): Promise<void> {
  const env = readEnv();
  const nodeEnv = parseNodeEnv(env);
  const { operatorUrl } = parseDatabaseConfig(env);
  const handle = createDb(operatorUrl, { max: 2 });
  try {
    const result = await loadFixtures(handle.db, { nodeEnv });
    console.log(
      `fixtures:load: fixture set ${FIXTURE_SET.name}@${FIXTURE_SET.version} (manifest hash arrives with W1-09)`,
    );
    console.log(`fixtures:load: published configuration revisions: ${result.publishedKinds.join(', ')}`);
  } finally {
    await handle.close();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
