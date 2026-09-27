// W2-02: lane_decision append-only (W0-04). UPDATE and DELETE raise for rai_app and rai_owner; rai_app has no
// UPDATE/DELETE grant. observed_qc_run_id references qc_run. Style matches tests/integration/w2-01-notification.test.ts.

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
  const runId = randomUUID();
  await db.app.execute(sql`
    INSERT INTO qc_run (id, version_id, trigger, lane, engine_id, runner_version, rule_revision, status, requested_at, completed_at, correlation_id)
    VALUES (${runId}, ${NONVENDOR.draftVersionId}, 'approve_attempt', 'dpo', 'substitute', '0.0.0', 'v1', 'completed', now(), now(), ${randomUUID()})
  `);
  await db.app.execute(sql`
    INSERT INTO lane_decision (
      id, version_id, lane, decision, actor_subject_id, actor_role, actor_scopes,
      feedback, observed_qc_run_id, decided_at, correlation_id
    ) VALUES (
      ${id}, ${NONVENDOR.draftVersionId}, 'dpo', 'approve',
      'fixture:fx-user-dpo', 'dpo', '[{"role":"dpo","scope":{"kind":"all_cases","lane":"dpo"}}]'::jsonb,
      NULL, ${runId}::uuid, now(), ${randomUUID()}
    )
  `);
  return id;
}

test('observed_qc_run_id must name a stored qc_run', async () => {
  const err = await expectSqlError(
    db,
    'app',
    `INSERT INTO lane_decision (id, version_id, lane, decision, actor_subject_id, actor_role, observed_qc_run_id, decided_at, correlation_id)
     VALUES ($1, $2, 'dpo', 'approve', 'fixture:fx-user-dpo', 'dpo', $3, now(), 'c')`,
    [uuidv7(), NONVENDOR.draftVersionId, randomUUID()],
  );
  assert.equal(err?.code, '23503'); // foreign_key_violation
});

test('UPDATE on lane_decision raises for rai_app and for rai_owner (append-only trigger)', async () => {
  const id = await insertDecision();
  for (const role of ['app', 'owner'] as const) {
    for (const set of [`actor_role = 'admin'`, `actor_scopes = '[]'::jsonb`]) {
      const err = await expectSqlError(db, role, `UPDATE lane_decision SET ${set} WHERE id = $1`, [id]);
      // rai_app: no UPDATE grant → insufficient_privilege; rai_owner: trigger → rai.append_only
      if (role === 'app') {
        assert.equal(err?.code, INSUFFICIENT_PRIVILEGE, role);
      } else {
        assert.equal(err?.code, RAISE_EXCEPTION, role);
        assert.equal(err?.message, 'rai.append_only');
      }
    }
  }
  const unchanged = (
    await db.owner.execute(sql`SELECT actor_role, actor_scopes FROM lane_decision WHERE id = ${id}`)
  ).rows[0] as { actor_role: string; actor_scopes: unknown[] };
  assert.equal(unchanged.actor_role, 'dpo');
  assert.equal(unchanged.actor_scopes.length, 1);
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
