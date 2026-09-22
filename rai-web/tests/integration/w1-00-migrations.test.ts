// W1-00: migrations apply from an empty database and are idempotent on rerun (W0-04 "Schema evolution"); the base
// schema carries the W0-04 tables, the immutability triggers and the role grants.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations, migrationFileCount, MIGRATIONS_FOLDER } from '@rai/server/db/migrate';
import { openTestDatabase, type TestDatabase } from '../support/db.js';

let db: TestDatabase;

before(async () => {
  db = await openTestDatabase();
});
after(async () => {
  await db.close();
});

/** Drops every object the migrations created so the folder can be applied "from empty" again. */
async function dropEverything(): Promise<void> {
  await db.raw('owner', async (client) => {
    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    for (const { tablename } of tables.rows)
      await client.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
    const functions = await client.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'rai_%'`,
    );
    for (const { proname } of functions.rows)
      await client.query(`DROP FUNCTION IF EXISTS "${proname}"() CASCADE`);
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  });
}

test('migrations apply from an empty database and a rerun applies nothing', async () => {
  await dropEverything();
  const first = await runMigrations(db.urls.owner, MIGRATIONS_FOLDER);
  assert.equal(first.applied.length, migrationFileCount(MIGRATIONS_FOLDER));
  assert.equal(first.alreadyApplied, 0);
  const second = await runMigrations(db.urls.owner, MIGRATIONS_FOLDER);
  assert.deepEqual(second, { applied: [], alreadyApplied: first.applied.length });
  const third = await runMigrations(db.urls.owner, MIGRATIONS_FOLDER);
  assert.deepEqual(third, second);
});

test('the schema holds the W0-04 tables (plus W1-01 session, W1-09 fixture_set, W1-02 registry_counter and W2-01 notification), triggers and grants', async () => {
  const tables = await db.raw('owner', (c) =>
    c.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    ),
  );
  assert.deepEqual(
    tables.rows.map((r) => r.tablename),
    [
      'artifact',
      'artifact_slot',
      'audit_event',
      'case',
      'configuration_revision',
      'fixture_set', // W1-09 (0002_w1_09_fixture_set)
      'idempotency_key',
      'notification', // W2-01 (0004_w2_01_notification)
      'pack_version',
      'registry_counter', // W1-02 (0003_w1_02_registry_counter; W0-04 case.registry_id per-year sequence)
      'session', // W1-01 (0001_w1_01_session; W0-03 section 6.3)
    ],
  );

  const triggers = await db.raw('owner', (c) =>
    c.query<{ tgname: string; relname: string }>(
      `SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal ORDER BY t.tgname`,
    ),
  );
  assert.deepEqual(
    triggers.rows.map((r) => `${r.relname}.${r.tgname}`),
    [
      'artifact.artifact_frozen',
      'artifact_slot.artifact_slot_frozen',
      'audit_event.audit_event_append_only',
      'case.case_projection_gate',
      'configuration_revision.configuration_revision_frozen',
      'notification.notification_delivery_only', // W2-01: delivery columns only
      'pack_version.pack_version_frozen',
    ],
  );

  const grants = await db.raw('owner', (c) =>
    c.query<{ grantee: string; table_name: string; privilege_type: string }>(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('rai_app', 'rai_operator') ORDER BY grantee, table_name, privilege_type`,
    ),
  );
  const byGrantee = (g: string) =>
    grants.rows.filter((r) => r.grantee === g).map((r) => `${r.table_name}:${r.privilege_type}`);
  // rai_app: SELECT/INSERT everywhere; UPDATE only on the mutable tables; no DELETE, no TRUNCATE (W0-04 roles).
  assert.deepEqual(byGrantee('rai_app'), [
    'artifact:INSERT',
    'artifact:SELECT',
    'artifact:UPDATE',
    'artifact_slot:INSERT',
    'artifact_slot:SELECT',
    'artifact_slot:UPDATE',
    'audit_event:INSERT',
    'audit_event:SELECT',
    'case:INSERT',
    'case:SELECT',
    'case:UPDATE',
    'configuration_revision:INSERT',
    'configuration_revision:SELECT',
    'fixture_set:INSERT',
    'fixture_set:SELECT',
    'idempotency_key:INSERT',
    'idempotency_key:SELECT',
    'notification:INSERT', // W2-01: outbox insert in the business transaction; UPDATE is delivery columns only
    'notification:SELECT',
    'notification:UPDATE',
    'pack_version:INSERT',
    'pack_version:SELECT',
    'pack_version:UPDATE',
    'registry_counter:INSERT', // W1-02: the per-year counter is upserted inside the create transaction
    'registry_counter:SELECT',
    'registry_counter:UPDATE',
    'session:INSERT', // W1-01: W0-03 section 6.3 session rows (last_seen_at, revoked_at, locale are the mutable columns)
    'session:SELECT',
    'session:UPDATE',
  ]);
  // rai_operator: rai_app (by membership, docker/postgres/init) plus DELETE on idempotency_key and on session (W1-01 sweep).
  assert.deepEqual(byGrantee('rai_operator'), ['idempotency_key:DELETE', 'session:DELETE']);
});

test('rai_app has no DDL: it cannot create a table or a function', async () => {
  const ddl = await db.raw('app', async (client) => {
    try {
      await client.query('CREATE TABLE should_not_exist (id int)');
      return undefined;
    } catch (err) {
      return err as { code?: string };
    }
  });
  assert.equal(ddl?.code, '42501');
});
