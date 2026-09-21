// `npm run store:verify` (W0-02 section 3.3; W0-04 "Artifact store"): re-hashes every blob an artifact row
// references (bytes_state = present) through the W1-03 BlobStore and compares hash and size; prints a summary and
// exits non-zero on any mismatch or missing object. Runs as rai_operator, never inside the request path.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createFilesystemBlobStore } from '../artifacts/blob-store.js';
import { parseDatabaseConfig, readEnv } from '../config.js';
import { createDb } from '../db/client.js';

export interface VerifyReport {
  referenced: number;
  ok: number;
  failures: { hash: string; reason: 'missing' | 'hash_mismatch' | 'size_mismatch' }[];
}

export async function verifyStore(operatorUrl: string, blobDir: string): Promise<VerifyReport> {
  const store = createFilesystemBlobStore(blobDir);
  const handle = createDb(operatorUrl, { max: 1 });
  try {
    const rows = await handle.db.execute(
      sql`SELECT content_hash AS hash, max(size_bytes)::bigint AS size FROM artifact WHERE bytes_state = 'present' GROUP BY content_hash ORDER BY content_hash`,
    );
    const report: VerifyReport = { referenced: rows.rows.length, ok: 0, failures: [] };
    for (const row of rows.rows as { hash: string; size: string }[]) {
      const result = await store.verify(row.hash, Number(row.size));
      if (result.ok) report.ok += 1;
      else report.failures.push({ hash: row.hash, reason: result.reason });
    }
    return report;
  } finally {
    await handle.close();
  }
}

export async function main(): Promise<number> {
  const env = readEnv();
  const blobDir = env.BLOB_DIR?.trim();
  if (blobDir === undefined || blobDir === '') {
    console.error('store:verify: BLOB_DIR is not set');
    return 1;
  }
  const { operatorUrl } = parseDatabaseConfig(env);
  const report = await verifyStore(operatorUrl, path.resolve(blobDir));
  console.log(
    `store:verify: ${report.referenced} referenced object(s), ${report.ok} verified, ${report.failures.length} failed`,
  );
  for (const f of report.failures) console.error(`store:verify: ${f.reason} ${f.hash}`);
  return report.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('store:verify: failed', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
