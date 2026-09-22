// Query/probe integration only: notification producer/retry and HTTP acceptance remain separate gates.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStoreProbes } from '@rai/server/observability/probes';
import { computeReadiness } from '@rai/server/observability/health';
import { readDeskHealth } from '@rai/server/observability/operator';
import { openTestDatabase, type TestDatabase } from '../support/db.js';

let db: TestDatabase;
let root: string;
before(async () => {
  db = await openTestDatabase();
  await db.reset();
  root = await mkdtemp(path.join(tmpdir(), 'rai-obs-'));
});
after(async () => {
  await db?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
function readiness() {
  return computeReadiness(
    {
      identity: () => ({ mode: 'fixture', ready: true }),
      loopbackBind: true,
      mailKind: 'memory',
      qcKind: 'substitute',
      build: { commit: 'dev', schemaVersion: '8' },
    },
    {
      ...createStoreProbes(db.urls.app, root),
      mailSink: () => Promise.resolve('ok'),
      qc: () => Promise.resolve('unavailable'),
    },
  );
}
test('actual rai_app probes read the migrated journal and empty writable blob root safely', async () => {
  const report = await readiness();
  assert.equal(report.status, 'ready');
  assert.equal(report.store.migrations, 'current');
  const failed = createStoreProbes('postgres://synthetic:synthetic@127.0.0.1:1/rai', root);
  assert.equal(await failed.db(), 'unreachable');
  assert.equal(await failed.migrations(), 'unknown');
  assert.equal(JSON.stringify(report).includes(root), false);
  assert.equal(JSON.stringify(report).includes('postgres://'), false);
});
test('operator SQL preserves unknown QC and unscheduled failures, derives terminal category and bounds rows', async () => {
  const caseId = randomUUID(),
    versionId = randomUUID(),
    correlation = randomUUID(),
    jobId = randomUUID();
  await db.raw('owner', async (client) => {
    await client.query(
      `INSERT INTO "case" (id,registry_id,source_record_id,use_case_name,business_unit,business_owner,technical_owner,use_case_group,vendor_involved,model_type,owner_subject_id,business_unit_id,created_by) VALUES ($1,'SYN-OBS','Unknown','Synthetic','CM','Synthetic owner','Synthetic technical','service',false,'llm','fixture-owner','CM','fixture-owner')`,
      [caseId],
    );
    await client.query(
      `INSERT INTO pack_version (id,case_id,version_number,created_by,stage_context,checklist_template_version) VALUES ($1,$2,1,'fixture-owner','pre_launch','v1')`,
      [versionId, caseId],
    );
    for (let index = 0; index < 101; index++)
      await client.query(
        `INSERT INTO qc_run (id,version_id,trigger,lane,engine_id,rule_revision,status,requested_at,completed_at,correlation_id) VALUES ($1,$2,'approve_attempt','dpo','substitute','v1','unavailable',now(),now(),$3)`,
        [randomUUID(), versionId, correlation],
      );
    for (const [status, attempts, lane] of [
      ['queued', 1, 'dpo'],
      ['failed', 4, 'ai_coe'],
    ] as const)
      await client.query(
        `INSERT INTO notification (id,event,case_id,version_id,lane,recipient,deep_link_path,template_key,template_params,status,attempts,last_error_code,correlation_id) VALUES ($1,'lane_open',$2,$3,$4,'synthetic@rai-desk.example','/cases/synthetic','mail.lane_opened','{}',$5,$6,'sink_failure',$7)`,
        [randomUUID(), caseId, versionId, lane, status, attempts, correlation],
      );
    await client.query(
      `INSERT INTO operator_job_run (id,job,digest_day,correlation_id,started_at,status) VALUES ($1,'sla_digest','2026-09-22',$2,now(),'running')`,
      [jobId, correlation],
    );
    await client.query(
      `UPDATE operator_job_run SET status='failed',finished_at=now(),error_stage='query',error_code='query_failed' WHERE id=$1`,
      [jobId],
    );
  });
  const report = await readDeskHealth(db.app, await readiness(), []);
  assert.equal(report.unavailableQc.length, 100);
  assert.ok(
    report.unavailableQc.every(
      (run) => run.reason === 'unknown' && run.owningLane === undefined && run.correlationId === correlation,
    ),
  );
  const queued = report.failedMail.find((mail) => mail.status === 'queued')!;
  assert.equal(queued.nextAttemptAt, undefined);
  const failed = report.failedMail.find((mail) => mail.status === 'failed')!;
  assert.equal(failed.failureCategory, 'mail_delivery_failed');
  assert.equal(failed.lastErrorCode, 'sink_failure');
  assert.equal(report.slaDigest.lastRun?.jobRunId, jobId);
  assert.deepEqual(report.slaDigest.lastRun?.notificationIds, []);
  assert.equal(report.slaDigest.recentFailures[0]?.correlationId, correlation);
  assert.equal(report.slaDigest.recentFailures[0]?.stage, 'query');
});
