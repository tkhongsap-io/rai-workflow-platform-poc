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

test('the schema holds the W0-04 tables (plus W1-01 session, W1-09 fixture_set, W1-02 registry_counter, W2-01 notification, W2-02 lane_decision, W2-05 qc/disposition and W3-07a operational tables), triggers and grants', async () => {
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
      'disposition_event', // W2-05 (0006_w2_05_findings_dispositions)
      'fixture_set', // W1-09 (0002_w1_09_fixture_set)
      'idempotency_key',
      'lane_decision', // W2-02 (0005_w2_02_lane_decision)
      'notification', // W2-01 (0004_w2_01_notification)
      'operator_job_notification', // W3-07a: digest provenance/daily dedup
      'operator_job_run', // W3-07a: operational job lifecycle
      'pack_version',
      'qc_finding', // W2-05
      'qc_late_result', // W3-07a: durable refused append, not a QC run
      'qc_run', // W2-05
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
      'notification.digest_requires_job', // W3-07a: deferred, new digest INSERT only
      'disposition_event.disposition_event_append_only', // W2-05
      'lane_decision.lane_decision_append_only', // W2-02
      'notification.notification_delivery_only', // W2-01: delivery columns only
      'operator_job_run.operator_job_guard', // W3-07a
      'operator_job_notification.operator_job_link_guard', // W3-07a
      'pack_version.pack_version_frozen',
      'qc_finding.qc_finding_append_only', // W2-05
      'qc_late_result.qc_late_guard', // W3-07a
      'qc_run.qc_run_append_only', // W2-05
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
    'disposition_event:INSERT', // W2-05: append-only
    'disposition_event:SELECT',
    'fixture_set:INSERT',
    'fixture_set:SELECT',
    'idempotency_key:INSERT',
    'idempotency_key:SELECT',
    'lane_decision:INSERT', // W2-02: append-only
    'lane_decision:SELECT',
    'notification:INSERT', // W2-01: outbox insert in the business transaction; UPDATE is delivery columns only
    'notification:SELECT',
    'notification:UPDATE',
    'operator_job_notification:INSERT',
    'operator_job_notification:SELECT',
    'operator_job_run:INSERT',
    'operator_job_run:SELECT', // UPDATE is limited to lifecycle columns below
    'pack_version:INSERT',
    'pack_version:SELECT',
    'pack_version:UPDATE',
    'qc_finding:INSERT', // W2-05: append-only
    'qc_finding:SELECT',
    'qc_late_result:INSERT',
    'qc_late_result:SELECT',
    'qc_run:INSERT', // W2-05: append-only
    'qc_run:SELECT',
    'registry_counter:INSERT', // W1-02: the per-year counter is upserted inside the create transaction
    'registry_counter:SELECT',
    'registry_counter:UPDATE',
    'session:INSERT', // W1-01: W0-03 section 6.3 session rows (last_seen_at, revoked_at, locale are the mutable columns)
    'session:SELECT',
    'session:UPDATE',
  ]);
  const jobUpdateColumns = await db.raw('owner', (c) =>
    c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.role_column_grants
       WHERE table_schema = 'public' AND table_name = 'operator_job_run'
         AND grantee = 'rai_app' AND privilege_type = 'UPDATE' ORDER BY column_name`,
    ),
  );
  assert.deepEqual(
    jobUpdateColumns.rows.map((r) => r.column_name),
    ['breach_count', 'error_code', 'error_stage', 'finished_at', 'status'],
  );
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
