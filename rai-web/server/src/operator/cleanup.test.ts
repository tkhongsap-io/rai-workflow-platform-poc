import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigError } from '../config.js';
import { main as dbCleanup } from './db-cleanup.js';
import { main as storeCleanup } from './store-cleanup.js';

const retention = {
  IDEMPOTENCY_TTL_HOURS: '72',
  BLOB_ORPHAN_MIN_AGE_HOURS: '24',
  BLOB_TMP_MAX_AGE_HOURS: '1',
};
const isMissing = (name: string) => (e: unknown) =>
  e instanceof ConfigError && e.reason === `missing:${name}`;

test('db:cleanup refuses an empty IDEMPOTENCY_TTL_HOURS before it connects, so no key is expired', async () => {
  // Port 9 has no Postgres: a command that got past the parse would fail with a connection error instead.
  const unreachable = 'postgres://rai_owner:x@127.0.0.1:9/rai';
  await assert.rejects(
    dbCleanup([], {
      ...retention,
      DATABASE_URL: unreachable,
      DATABASE_MIGRATE_URL: unreachable,
      IDEMPOTENCY_TTL_HOURS: '',
    }),
    isMissing('IDEMPOTENCY_TTL_HOURS'),
  );
});

test('store:cleanup refuses an empty BLOB_TMP_MAX_AGE_HOURS and leaves an in-flight staging file alone', async () => {
  const blobDir = await mkdtemp(path.join(tmpdir(), 'rai-store-cleanup-'));
  try {
    const tmp = path.join(blobDir, 'tmp');
    await mkdir(tmp);
    await writeFile(path.join(tmp, 'in-flight'), 'x');
    await assert.rejects(
      storeCleanup({ ...retention, BLOB_DIR: blobDir, BLOB_TMP_MAX_AGE_HOURS: '' }),
      isMissing('BLOB_TMP_MAX_AGE_HOURS'),
    );
    assert.deepEqual(await readdir(tmp), ['in-flight']);
  } finally {
    await rm(blobDir, { recursive: true, force: true });
  }
});
