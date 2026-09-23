// `npm run store:cleanup` (W0-02 section 3.3; W0-04 "Unsubmitted drafts and failed uploads"): removes temp files
// under BLOB_DIR/tmp older than BLOB_TMP_MAX_AGE_HOURS through the W1-03 BlobStore. Orphan-blob removal waits for
// D08; an object under sha256/ is never deleted here. Never runs inside the request path.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFilesystemBlobStore } from '../artifacts/blob-store.js';
import { parseRetentionConfig, readEnv, type Env } from '../config.js';

export async function main(env: Env = readEnv()): Promise<number> {
  const blobDir = env.BLOB_DIR?.trim();
  if (blobDir === undefined || blobDir === '') {
    console.error('store:cleanup: BLOB_DIR is not set');
    return 1;
  }
  const { blobTmpMaxAgeHours: maxAgeHours } = parseRetentionConfig(env);
  const store = createFilesystemBlobStore(path.resolve(blobDir));
  const removed = await store.cleanupTemp(maxAgeHours * 3_600_000);
  console.log(
    `store:cleanup: removed ${removed} temp file(s) older than ${maxAgeHours} h under ${path.join(store.root, 'tmp')}`,
  );
  console.log(
    'store:cleanup: orphan objects under sha256/ are reported by store:verify and removed only after D08',
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('store:cleanup: failed', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
