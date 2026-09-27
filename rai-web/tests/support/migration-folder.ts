// W7-03: build folders that look like an older release's server/drizzle (the first `count` journal entries of this
// build) and scratch databases to apply them to, so the class writer, the `ahead` readiness and the rollback check
// are proved against real journals without touching the suite database's migration history.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { readEnv } from '@rai/server/config';
import { MIGRATIONS_FOLDER } from '@rai/server/db/migrate';
import { observabilityDatabaseConfig } from './observability-database.js';

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

export async function buildJournalTags(): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  return journal.entries.map((entry) => entry.tag);
}

/**
 * A folder holding this build's first `count` migrations and a journal trimmed to them. `rewrite` replaces the SQL of
 * the named tags (a rewritten file gets a different hash, as an edited merged migration would).
 */
export async function prefixMigrationFolder(
  root: string,
  count: number,
  rewrite: Record<string, string> = {},
): Promise<string> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  assert.ok(count >= 0 && count <= journal.entries.length);
  const folder = await mkdtemp(path.join(root, `drizzle-${count}-`));
  await mkdir(path.join(folder, 'meta'));
  journal.entries = journal.entries.slice(0, count);
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const { tag } of journal.entries) {
    const target = path.join(folder, `${tag}.sql`);
    if (rewrite[tag] === undefined) await copyFile(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), target);
    else await writeFile(target, rewrite[tag]);
  }
  return folder;
}

/**
 * A folder holding this build's whole journal plus one synthetic migration after it: what a newer release's
 * server/drizzle looks like to this build, so a rollback from that release to this build can be proved.
 */
export async function extendedMigrationFolder(
  root: string,
  extra: { tag: string; sql: string },
): Promise<string> {
  const journal = JSON.parse(
    await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  const folder = await mkdtemp(path.join(root, 'drizzle-extended-'));
  await mkdir(path.join(folder, 'meta'));
  for (const { tag } of journal.entries)
    await copyFile(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), path.join(folder, `${tag}.sql`));
  const last = journal.entries.at(-1)!;
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: extra.tag });
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  await writeFile(path.join(folder, `${extra.tag}.sql`), extra.sql);
  return folder;
}

export interface ScratchDatabase {
  urls: { app: string; owner: string; operator: string };
  drop(): Promise<void>;
}

/** An empty database owned by rai_owner, on the suite's server, dropped by `drop()`. Never migrated here. */
export async function createScratchDatabase(prefix: string): Promise<ScratchDatabase> {
  const config = observabilityDatabaseConfig(readEnv());
  const name = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  assert.match(name, /^[a-z0-9_]+$/);
  const forDatabase = (value: string) => {
    const url = new URL(value);
    url.pathname = `/${name}`;
    return url.href;
  };
  const admin = new pg.Client({ connectionString: config.adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" OWNER rai_owner`);
  } finally {
    await admin.end();
  }
  return {
    urls: {
      app: forDatabase(config.url),
      owner: forDatabase(config.migrateUrl),
      operator: forDatabase(config.operatorUrl),
    },
    async drop() {
      const dropper = new pg.Client({ connectionString: config.adminUrl });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

export async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
