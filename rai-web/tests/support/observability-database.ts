// W3-INT sidecar only: never migrate/reset the configured suite database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { readEnv, parseDatabaseConfig } from '@rai/server/config';
import { createDb } from '@rai/server/db/client';
import { runMigrations } from '@rai/server/db/migrate';
import { loadFixtures } from '@rai/fixtures/load';

/** Pure preflight: complete all checks before even constructing a database client. */
export function observabilityDatabaseConfig(env: Record<string, string | undefined>) {
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.RAI_IDENTITY_MODE, 'fixture');
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATE_URL', 'DATABASE_OPERATOR_URL'])
    assert.ok(env[key]?.trim(), `explicit ${key} required`);
  const config = parseDatabaseConfig(env);
  const source = new URL(config.url);
  const admin = new URL(env.OBS_MIGRATION_ADMIN_URL ?? config.url);
  if (!env.OBS_MIGRATION_ADMIN_URL) {
    // Existing compose/CI synthetic administrator; never a production credential.
    admin.username = 'postgres';
    admin.password = 'postgres-local';
  }
  for (const value of [config.url, config.migrateUrl, config.operatorUrl, admin.href]) {
    const url = new URL(value);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Postgres URL required');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'literal loopback required');
    assert.equal(url.hostname, source.hostname, 'all database hosts must match');
    assert.equal(url.port, source.port, 'all database ports must match');
    assert.equal(url.pathname, source.pathname, 'all source database names must match');
    assert.ok(!url.search && !url.hash, 'connection-routing overrides forbidden');
  }
  return { ...config, adminUrl: admin.href };
}

export async function withObservabilityDatabase<T>(
  migrated: boolean,
  run: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const config = observabilityDatabaseConfig(readEnv());
  const name = `w3_obs_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^w3_obs_[0-9a-f]{32}$/);
  const forDatabase = (value: string) => {
    const url = new URL(value);
    url.pathname = `/${name}`;
    return url.href;
  };
  const urls = {
    DATABASE_URL: forDatabase(config.url),
    DATABASE_MIGRATE_URL: forDatabase(config.migrateUrl),
    DATABASE_OPERATOR_URL: forDatabase(config.operatorUrl),
  };
  const admin = new pg.Client({ connectionString: config.adminUrl });
  let created = false;
  let dir: string | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" OWNER rai_owner`);
    created = true;
    dir = await mkdtemp(path.join(tmpdir(), 'rai-w3-int-obs-'));
    const blobDir = path.join(dir, 'blobs');
    const mailDir = path.join(dir, 'mail');
    await mkdir(blobDir);
    await mkdir(mailDir);
    if (migrated) {
      await runMigrations(urls.DATABASE_MIGRATE_URL);
      const db = createDb(urls.DATABASE_OPERATOR_URL);
      try {
        await loadFixtures(db.db, {
          nodeEnv: 'test',
          identityMode: 'fixture',
          blobDir,
          outputDir: path.join(dir, 'fixtures'),
        });
      } finally {
        await db.close();
      }
    }
    return await run({ ...urls, BLOB_DIR: blobDir, MAIL_SINK_DIR: mailDir, LOG_LEVEL: 'info' });
  } finally {
    try {
      // Only the name generated above can reach cleanup, never the configured source database.
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }
}
