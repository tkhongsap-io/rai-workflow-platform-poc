// W2-01: notification outbox immutability (W0-04). rai_app may UPDATE only the four delivery columns; any other
// column change raises; DELETE is denied for rai_app (grant) and raises for rai_owner (trigger); UNIQUE
// (event, version_id, lane, recipient) rejects a duplicate insert.

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
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-01-notif-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-01-notif-out-'));
});
beforeEach(async () => {
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: new Date('2026-09-22T03:01:00Z'),
  });
});
after(async () => {
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

async function insertQueued(extra: { recipient?: string } = {}): Promise<string> {
  const id = uuidv7();
  await db.app.execute(sql`
    INSERT INTO notification (
      id, event, version_id, case_id, lane, recipient, deep_link_path, template_key, template_params,
      status, attempts, correlation_id
    ) VALUES (
      ${id}, 'lane_open', ${NONVENDOR.draftVersionId}, ${NONVENDOR.caseId}, 'ai_coe',
      ${extra.recipient ?? 'ai-coe@rai-desk.example'},
      ${`/cases/${NONVENDOR.caseId}/versions/${NONVENDOR.draftVersionId}`},
      'mail.lane_opened', ${JSON.stringify({ lane: 'ai_coe', version_id: NONVENDOR.draftVersionId })}::jsonb,
      'queued', 0, ${randomUUID()}
    )
  `);
  return id;
}

test('rai_app may update only status, attempts, next_attempt_at, last_error_code on notification', async () => {
  const id = await insertQueued();
  const ok = await expectSqlError(
    db,
    'app',
    `UPDATE notification SET status = 'sent', attempts = 1,
       next_attempt_at = now() + interval '1 minute', last_error_code = 'sink_failure'
     WHERE id = $1`,
    [id],
  );
  assert.equal(ok, undefined);
  const row = (
    await db.owner.execute(sql`SELECT status, attempts, last_error_code FROM notification WHERE id = ${id}`)
  ).rows[0] as { status: string; attempts: number; last_error_code: string };
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error_code, 'sink_failure');
});

test('updating any other notification column raises for rai_app and for rai_owner', async () => {
  const id = await insertQueued();
  for (const role of ['app', 'owner'] as const) {
    const err = await expectSqlError(
      db,
      role,
      `UPDATE notification SET recipient = 'other@rai-desk.example' WHERE id = $1`,
      [id],
    );
    assert.equal(err?.code, RAISE_EXCEPTION, role);
    assert.match(err?.message ?? '', /rai\.notification_immutable/);
  }
  const unchanged = (await db.owner.execute(sql`SELECT recipient FROM notification WHERE id = ${id}`))
    .rows[0] as { recipient: string };
  assert.equal(unchanged.recipient, 'ai-coe@rai-desk.example');
});

test('DELETE on notification is denied for rai_app (grant) and raises for rai_owner (trigger)', async () => {
  const id = await insertQueued();
  const appDelete = await expectSqlError(db, 'app', `DELETE FROM notification WHERE id = $1`, [id]);
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
  const ownerDelete = await expectSqlError(db, 'owner', `DELETE FROM notification WHERE id = $1`, [id]);
  assert.equal(ownerDelete?.code, RAISE_EXCEPTION);
  assert.equal(ownerDelete?.message, 'rai.append_only');
  const still = await db.owner.execute(sql`SELECT count(*)::int AS n FROM notification WHERE id = ${id}`);
  assert.equal((still.rows[0] as { n: number }).n, 1);
});

test('UNIQUE (event, version_id, lane, recipient) rejects a duplicate lane_open row', async () => {
  await insertQueued({ recipient: 'ai-coe@rai-desk.example' });
  const dup = await expectSqlError(
    db,
    'app',
    `INSERT INTO notification (
       id, event, version_id, case_id, lane, recipient, deep_link_path, template_key, template_params,
       status, attempts, correlation_id
     ) VALUES (
       $1, 'lane_open', $2, $3, 'ai_coe', 'ai-coe@rai-desk.example',
       $4, 'mail.lane_opened', '{}'::jsonb, 'queued', 0, $5
     )`,
    [
      uuidv7(),
      NONVENDOR.draftVersionId,
      NONVENDOR.caseId,
      `/cases/${NONVENDOR.caseId}/versions/${NONVENDOR.draftVersionId}`,
      randomUUID(),
    ],
  );
  assert.equal(dup?.code, '23505'); // unique_violation
});
