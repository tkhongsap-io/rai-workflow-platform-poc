// W2-05: qc_run / qc_finding / disposition_event append-only (W0-04). UPDATE and DELETE raise for rai_app
// and rai_owner. Style matches tests/integration/w2-02-lane-decision-immutability.test.ts.

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
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-05-imm-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-05-imm-out-'));
});
beforeEach(async () => {
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: new Date('2026-09-22T06:01:00Z'),
  });
});
after(async () => {
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

async function insertRunFindingDisposition(): Promise<{
  runId: string;
  findingId: string;
  dispositionId: string;
}> {
  const runId = uuidv7();
  const findingId = uuidv7();
  const dispositionId = uuidv7();
  await db.app.execute(sql`
    INSERT INTO qc_run (
      id, version_id, trigger, slot, lane, engine_id, rule_revision,
      status, requested_at, completed_at, correlation_id
    ) VALUES (
      ${runId}, ${NONVENDOR.draftVersionId}, 'approve_attempt', NULL, 'dpo',
      'substitute-scripted', 'rev-test', 'completed', now(), now(), ${randomUUID()}
    )
  `);
  await db.app.execute(sql`
    INSERT INTO qc_finding (
      id, run_id, version_id, slot, kind, rule_id, rule_revision, severity, owning_lane,
      evidence, metric, denominator, threshold, message_key, message_params, created_at
    ) VALUES (
      ${findingId}, ${runId}, ${NONVENDOR.draftVersionId}, 6, 'defect',
      'TEST-RULE', 'rev-test', 'medium', 'dpo',
      '[]'::jsonb, NULL, NULL, NULL, 'qc.finding.test', '{}'::jsonb, now()
    )
  `);
  await db.app.execute(sql`
    INSERT INTO disposition_event (
      id, finding_id, kind, reason, evidence_ref, actor_subject_id, actor_role,
      created_at, correlation_id, idempotency_key_id
    ) VALUES (
      ${dispositionId}, ${findingId}, 'fixed', NULL, NULL,
      'fixture:fx-user-dpo', 'dpo', now(), ${randomUUID()}, NULL
    )
  `);
  return { runId, findingId, dispositionId };
}

for (const table of ['qc_run', 'qc_finding', 'disposition_event'] as const) {
  test(`UPDATE on ${table} raises for rai_app and for rai_owner (append-only trigger)`, async () => {
    const ids = await insertRunFindingDisposition();
    const id = table === 'qc_run' ? ids.runId : table === 'qc_finding' ? ids.findingId : ids.dispositionId;
    const setClause =
      table === 'qc_run'
        ? `engine_id = 'mutated'`
        : table === 'qc_finding'
          ? `severity = 'high'`
          : `actor_role = 'admin'`;
    for (const role of ['app', 'owner'] as const) {
      const err = await expectSqlError(db, role, `UPDATE ${table} SET ${setClause} WHERE id = $1`, [id]);
      if (role === 'app') {
        assert.equal(err?.code, INSUFFICIENT_PRIVILEGE, role);
      } else {
        assert.equal(err?.code, RAISE_EXCEPTION, role);
        assert.equal(err?.message, 'rai.append_only');
      }
    }
  });

  test(`DELETE on ${table} is denied for rai_app (grant) and raises for rai_owner (trigger)`, async () => {
    const ids = await insertRunFindingDisposition();
    const id = table === 'qc_run' ? ids.runId : table === 'qc_finding' ? ids.findingId : ids.dispositionId;
    const appDelete = await expectSqlError(db, 'app', `DELETE FROM ${table} WHERE id = $1`, [id]);
    assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
    const ownerDelete = await expectSqlError(db, 'owner', `DELETE FROM ${table} WHERE id = $1`, [id]);
    assert.equal(ownerDelete?.code, RAISE_EXCEPTION);
    assert.equal(ownerDelete?.message, 'rai.append_only');
    const still = await db.owner.execute(
      sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE id = '${id}'`),
    );
    assert.equal((still.rows[0] as { n: number }).n, 1);
  });
}
