// `npm run db:cleanup [--report]` (W0-02 section 3.3; W0-04 "Retention and deletion"): expires idempotency keys
// older than IDEMPOTENCY_TTL_HOURS as rai_operator; `--report` lists stale drafts (dry run; deletion waits for D08)
// and, once W1-03 lands the blob store, orphan blobs. Never runs inside the request path.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { parseDatabaseConfig, readEnv } from '../config.js';
import { createDb } from '../db/client.js';

const DRAFT_STALE_DAYS = 180; // proposed; D08 decides

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const env = readEnv();
  const { operatorUrl } = parseDatabaseConfig(env);
  const ttlHours = Number(env.IDEMPOTENCY_TTL_HOURS ?? '72');
  const report = argv.includes('--report');
  const handle = createDb(operatorUrl, { max: 1 });
  try {
    if (report) {
      const drafts = await handle.db.execute(
        sql`SELECT count(*) AS n FROM "case" WHERE current_version_id IS NULL AND updated_at < now() - make_interval(days => ${DRAFT_STALE_DAYS})`,
      );
      console.log(
        `db:cleanup --report: unsubmitted drafts untouched for ${DRAFT_STALE_DAYS} days: ${(drafts.rows[0] as { n: string }).n} (dry run; deletion waits for D08)`,
      );
      console.log('db:cleanup --report: orphan-blob report arrives with the W1-03a blob store');
      return;
    }
    const result = await handle.db.execute(
      sql`DELETE FROM idempotency_key WHERE created_at < now() - make_interval(hours => ${ttlHours})`,
    );
    console.log(`db:cleanup: expired ${result.rowCount ?? 0} idempotency key(s) older than ${ttlHours} h`);
  } finally {
    await handle.close();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error('db:cleanup: failed', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
