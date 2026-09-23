// `npm run db:cleanup [--report]` (W0-02 section 3.3; W0-04 "Retention and deletion"): expires idempotency keys
// older than IDEMPOTENCY_TTL_HOURS and removes expired and revoked session rows (W0-03 section 6.3, W1-01) as
// rai_operator; `--report` lists stale drafts and orphan blobs (objects under BLOB_DIR/sha256 no artifact row
// references; W1-03 blob store), both dry run: deletion waits for D08. Never runs inside the request path.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createFilesystemBlobStore } from '../artifacts/blob-store.js';
import { parseDatabaseConfig, parseRetentionConfig, readEnv, type Env } from '../config.js';
import { createDb } from '../db/client.js';
import { sweepSessions } from '../identity/session.js';

const DRAFT_STALE_DAYS = 180; // proposed; D08 decides

export async function main(argv: string[] = process.argv.slice(2), env: Env = readEnv()): Promise<void> {
  const { operatorUrl } = parseDatabaseConfig(env);
  const { idempotencyTtlHours: ttlHours } = parseRetentionConfig(env);
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
      const blobDir = env.BLOB_DIR?.trim();
      if (blobDir === undefined || blobDir === '') {
        console.log('db:cleanup --report: BLOB_DIR is not set; orphan-blob report skipped');
        return;
      }
      const referenced = await handle.db.execute(sql`SELECT DISTINCT content_hash AS hash FROM artifact`);
      const known = new Set((referenced.rows as { hash: string }[]).map((r) => r.hash));
      const objects = await createFilesystemBlobStore(path.resolve(blobDir)).listObjects();
      const orphans = objects.filter((h) => !known.has(h));
      console.log(
        `db:cleanup --report: ${objects.length} object(s) under BLOB_DIR, ${orphans.length} referenced by no artifact row (dry run; removal waits for D08)`,
      );
      return;
    }
    const result = await handle.db.execute(
      sql`DELETE FROM idempotency_key WHERE created_at < now() - make_interval(hours => ${ttlHours})`,
    );
    console.log(`db:cleanup: expired ${result.rowCount ?? 0} idempotency key(s) older than ${ttlHours} h`);
    const sessions = await sweepSessions(handle.db);
    console.log(`db:cleanup: removed ${sessions} expired or revoked session row(s)`);
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
