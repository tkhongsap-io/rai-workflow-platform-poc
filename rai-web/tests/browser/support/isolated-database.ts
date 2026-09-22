// A second application process with a different sink must not share the suite dispatcher/outbox.
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

export async function withIsolatedFixtureDatabase<T>(
  run: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const env = readEnv();
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.RAI_IDENTITY_MODE, 'fixture');
  const config = parseDatabaseConfig(env);
  const source = new URL(config.url);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  const adminUrl = new URL(env.OBS_MIGRATION_ADMIN_URL ?? config.url);
  if (!env.OBS_MIGRATION_ADMIN_URL) {
    // Same synthetic local/CI admin as docker-compose.yml and ci.yml; never an application credential.
    adminUrl.username = 'postgres';
    adminUrl.password = 'postgres-local';
  }
  for (const value of [config.url, config.migrateUrl, config.operatorUrl, adminUrl.href]) {
    const url = new URL(value);
    assert.equal(url.hostname, source.hostname);
    assert.equal(url.port, source.port);
    assert.equal(url.pathname, source.pathname);
    assert(!url.search && !url.hash, 'no connection-routing overrides in isolated browser fixtures');
  }
  const name = `browser_mail_${randomUUID().replaceAll('-', '')}`;
  const forDatabase = (value: string) => {
    const url = new URL(value);
    url.pathname = `/${name}`;
    return url.href;
  };
  const overrides = {
    DATABASE_URL: forDatabase(config.url),
    DATABASE_MIGRATE_URL: forDatabase(config.migrateUrl),
    DATABASE_OPERATOR_URL: forDatabase(config.operatorUrl),
  };
  const admin = new pg.Client({ connectionString: adminUrl.href });
  await admin.connect();
  let dir: string | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" OWNER rai_owner`);
    created = true;
    dir = await mkdtemp(path.join(tmpdir(), 'rai-browser-mail-'));
    const blobDir = path.join(dir, 'blobs');
    await mkdir(path.join(dir, 'mail'));
    await runMigrations(overrides.DATABASE_MIGRATE_URL);
    const db = createDb(overrides.DATABASE_OPERATOR_URL);
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
    return await run({ ...overrides, BLOB_DIR: blobDir, MAIL_SINK_DIR: path.join(dir, 'mail') });
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }
}
