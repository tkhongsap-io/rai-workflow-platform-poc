// W1-00 Done when: the audit store has no update or delete path in the data-access layer (unit test in
// server/src/audit/store.test.ts), and as defence in depth a direct SQL UPDATE or DELETE on audit_event is rejected
// by the database: as rai_app by the missing grant, as rai_owner by the trigger (W0-04 "Audit log", A11).

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AuditRefRejected, auditStore } from '@rai/server/audit/store';
import { withTransaction } from '@rai/server/db/transaction';
import {
  INSUFFICIENT_PRIVILEGE,
  RAISE_EXCEPTION,
  expectSqlError,
  openTestDatabase,
  type TestDatabase,
} from '../support/db.js';

let db: TestDatabase;

before(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await db.reset();
});
after(async () => {
  await db.close();
});

test('append writes one row with actor, action, refs and correlation id; read returns rows in seq order', async () => {
  const correlationId = randomUUID();
  await withTransaction(db.app, async (tx) => {
    await auditStore.append(tx, {
      actorSubjectId: 'fixture:fx-user-admin',
      actorRole: 'admin',
      action: 'audit.read',
      targetRef: { configuration_revision_id: randomUUID() },
      correlationId,
    });
    await auditStore.append(tx, {
      actorSubjectId: 'system',
      actorRole: 'system',
      action: 'notification.failed',
      correlationId,
    });
  });
  const rows = await auditStore.read(db.app, { correlationId });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.action),
    ['audit.read', 'notification.failed'],
  );
  assert.ok(rows[0]!.seq < rows[1]!.seq);
  assert.equal(rows[0]!.actorSubjectId, 'fixture:fx-user-admin');
  assert.equal(rows[1]!.correlationId, correlationId);
  const after1 = await auditStore.read(db.app, { afterSeq: rows[0]!.seq });
  assert.deepEqual(
    after1.map((r) => r.id),
    [rows[1]!.id],
  );
});

test('append is rejected before any write when a ref carries text instead of references', async () => {
  await assert.rejects(
    withTransaction(db.app, (tx) =>
      auditStore.append(tx, {
        actorSubjectId: 'fixture:fx-user-owner-cm',
        actorRole: 'owner',
        action: 'draft.saved',
        afterRef: { feedback: 'Please attach the signed DPA for the vendor engagement' },
        correlationId: randomUUID(),
      }),
    ),
    AuditRefRejected,
  );
  assert.deepEqual(await auditStore.read(db.app, {}), []);
});

test('a direct SQL UPDATE or DELETE on audit_event is rejected as rai_app (grant) and as rai_owner (trigger)', async () => {
  const correlationId = randomUUID();
  await withTransaction(db.app, (tx) =>
    auditStore.append(tx, {
      actorSubjectId: 'system',
      actorRole: 'system',
      action: 'notification.queued',
      correlationId,
    }),
  );
  const [row] = await auditStore.read(db.app, { correlationId });
  assert.ok(row);

  const appUpdate = await expectSqlError(
    db,
    'app',
    `UPDATE audit_event SET actor_role = 'admin' WHERE id = $1`,
    [row.id],
  );
  assert.equal(appUpdate?.code, INSUFFICIENT_PRIVILEGE);
  const appDelete = await expectSqlError(db, 'app', `DELETE FROM audit_event WHERE id = $1`, [row.id]);
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
  const appTruncate = await expectSqlError(db, 'app', `TRUNCATE audit_event`);
  assert.equal(appTruncate?.code, INSUFFICIENT_PRIVILEGE);

  const ownerUpdate = await expectSqlError(
    db,
    'owner',
    `UPDATE audit_event SET actor_role = 'admin' WHERE id = $1`,
    [row.id],
  );
  assert.equal(ownerUpdate?.code, RAISE_EXCEPTION);
  assert.equal(ownerUpdate?.message, 'rai.append_only');
  const ownerDelete = await expectSqlError(db, 'owner', `DELETE FROM audit_event WHERE id = $1`, [row.id]);
  assert.equal(ownerDelete?.code, RAISE_EXCEPTION);
  assert.equal(ownerDelete?.message, 'rai.append_only');
  const ownerDeleteAll = await expectSqlError(db, 'owner', `DELETE FROM audit_event`);
  assert.equal(ownerDeleteAll?.message, 'rai.append_only');

  const [unchanged] = await auditStore.read(db.app, { correlationId });
  assert.deepEqual(unchanged, row);
});

test('rai_app cannot DELETE from any business table; rai_operator may delete idempotency keys only', async () => {
  const roles = await Promise.all(
    (['app', 'owner', 'operator'] as const).map((role) =>
      db.raw(
        role,
        async (c) => (await c.query<{ current_user: string }>('SELECT current_user')).rows[0]!.current_user,
      ),
    ),
  );
  assert.deepEqual(roles, ['rai_app', 'rai_owner', 'rai_operator'], 'each handle connects as its W0-04 role');
  for (const table of [
    'case',
    'pack_version',
    'artifact',
    'artifact_slot',
    'configuration_revision',
    'idempotency_key',
    'audit_event',
  ]) {
    const err = await expectSqlError(db, 'app', `DELETE FROM "${table}"`);
    assert.equal(err?.code, INSUFFICIENT_PRIVILEGE, `rai_app DELETE on ${table}`);
  }
  assert.equal(
    await expectSqlError(
      db,
      'operator',
      `DELETE FROM idempotency_key WHERE created_at < now() - interval '72 hours'`,
    ),
    undefined,
  );
  const err = await expectSqlError(db, 'operator', `DELETE FROM "case"`);
  assert.equal(err?.code, INSUFFICIENT_PRIVILEGE, 'rai_operator DELETE on case');
});
