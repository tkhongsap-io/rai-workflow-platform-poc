// W2-02: lane_decision append-only (W0-04). UPDATE and DELETE raise for rai_app and rai_owner; rai_app has no
// UPDATE/DELETE grant. Style matches tests/integration/w2-01-notification.test.ts.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@rai/shared/ids';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import {
  INSUFFICIENT_PRIVILEGE,
  RAISE_EXCEPTION,
  expectSqlError,
  openTestDatabase,
  type TestDatabase,
} from '../support/db.js';

const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;

let db: TestDatabase;
let blobDir: string;
let outputDir: string;

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-02-ld-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-02-ld-out-'));
});
beforeEach(async () => {
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: new Date('2026-09-22T04:01:00Z'),
  });
});
after(async () => {
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

async function insertDecision(): Promise<string> {
  const id = uuidv7();
  await db.app.execute(sql`
    INSERT INTO lane_decision (
      id, version_id, lane, decision, actor_subject_id, actor_role,
      feedback, observed_qc_run_id, decided_at, correlation_id
    ) VALUES (
      ${id}, ${NONVENDOR.draftVersionId}, 'dpo', 'approve',
      'fixture:fx-user-dpo', 'dpo', NULL, ${randomUUID()}::uuid,
      now(), ${randomUUID()}
    )
  `);
  return id;
}

test('UPDATE on lane_decision raises for rai_app and for rai_owner (append-only trigger)', async () => {
  const id = await insertDecision();
  for (const role of ['app', 'owner'] as const) {
    const err = await expectSqlError(
      db,
      role,
      `UPDATE lane_decision SET actor_role = 'admin' WHERE id = $1`,
      [id],
    );
    // rai_app: no UPDATE grant → insufficient_privilege; rai_owner: trigger → rai.append_only
    if (role === 'app') {
      assert.equal(err?.code, INSUFFICIENT_PRIVILEGE, role);
    } else {
      assert.equal(err?.code, RAISE_EXCEPTION, role);
      assert.equal(err?.message, 'rai.append_only');
    }
  }
  const unchanged = (await db.owner.execute(sql`SELECT actor_role FROM lane_decision WHERE id = ${id}`))
    .rows[0] as { actor_role: string };
  assert.equal(unchanged.actor_role, 'dpo');
});

test('DELETE on lane_decision is denied for rai_app (grant) and raises for rai_owner (trigger)', async () => {
  const id = await insertDecision();
  const appDelete = await expectSqlError(db, 'app', `DELETE FROM lane_decision WHERE id = $1`, [id]);
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
  const ownerDelete = await expectSqlError(db, 'owner', `DELETE FROM lane_decision WHERE id = $1`, [id]);
  assert.equal(ownerDelete?.code, RAISE_EXCEPTION);
  assert.equal(ownerDelete?.message, 'rai.append_only');
  const still = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision WHERE id = ${id}`);
  assert.equal((still.rows[0] as { n: number }).n, 1);
});
