// Dedicated ephemeral database: never truncate the shared integration database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { MIGRATIONS_FOLDER, runMigrations } from '@rai/server/db/migrate';

const adminUrl = process.env['OBS_MIGRATION_ADMIN_URL'];
test(
  '0007 upgrades historical data and enforces digest provenance, daily dedup and late-QC immutability',
  { skip: adminUrl === undefined },
  async () => {
    const dbName = `obs_contract_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const scratch = await mkdtemp(path.join(tmpdir(), 'rai-obs-migrations-'));
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    const ownerUrl = new URL(url);
    ownerUrl.username = 'rai_owner';
    ownerUrl.password = 'rai_owner';
    const appUrl = new URL(url);
    appUrl.username = 'rai_app';
    appUrl.password = 'rai_app';
    let owner: pg.Client | undefined;
    let app: pg.Client | undefined;
    try {
      await admin.query(`CREATE DATABASE "${dbName}" OWNER rai_owner`);
      await mkdir(path.join(scratch, 'meta'));
      const journal = JSON.parse(
        await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { idx: number; tag: string }[] };
      const laterMigrations = journal.entries.filter((e) => e.idx >= 7).length;
      journal.entries = journal.entries.filter((e) => e.idx < 7);
      await writeFile(path.join(scratch, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(
          path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
          path.join(scratch, `${entry.tag}.sql`),
        );
      await runMigrations(ownerUrl.href, scratch);
      owner = new pg.Client({ connectionString: ownerUrl.href });
      await owner.connect();
      const caseId = randomUUID(),
        versionId = randomUUID(),
        oldRun = randomUUID(),
        correlation = randomUUID();
      await owner.query(
        `INSERT INTO "case" (id,registry_id,source_record_id,use_case_name,business_unit,business_owner,technical_owner,use_case_group,vendor_involved,model_type,owner_subject_id,business_unit_id,created_by) VALUES ($1,'SYN-OBS','Unknown','Synthetic','CM','Synthetic owner','Synthetic technical','service',false,'llm','fixture-owner','CM','fixture-owner')`,
        [caseId],
      );
      await owner.query(
        `INSERT INTO pack_version (id,case_id,version_number,created_by,stage_context,checklist_template_version) VALUES ($1,$2,1,'fixture-owner','pre_launch','v1')`,
        [versionId, caseId],
      );
      await owner.query(
        `INSERT INTO qc_run (id,version_id,trigger,engine_id,rule_revision,status,requested_at,completed_at,correlation_id) VALUES ($1,$2,'submit','substitute','v1','unavailable',now(),now(),$3)`,
        [oldRun, versionId, correlation],
      );
      const historicalDigest = randomUUID();
      await owner.query(
        `INSERT INTO notification (id,event,lane,recipient,deep_link_path,template_key,template_params,correlation_id) VALUES ($1,'sla_breach_digest','-','historical@rai-desk.example','/queue','mail.digest','{}',$2)`,
        [historicalDigest, correlation],
      );
      assert.equal((await runMigrations(ownerUrl.href)).applied.length, laterMigrations);
      assert.equal(
        (await owner.query('SELECT id FROM notification WHERE id=$1', [historicalDigest])).rows.length,
        1,
      );

      assert.equal((await runMigrations(ownerUrl.href)).applied.length, 0);
      assert.equal(
        (
          await owner.query<{ unavailable_reason: string | null }>(
            'SELECT unavailable_reason FROM qc_run WHERE id=$1',
            [oldRun],
          )
        ).rows[0]!.unavailable_reason,
        null,
      );
      // W4-11a (0009): a run written before the migration reads runner_version 'unrecorded' and no rule count.
      assert.deepEqual(
        (
          await owner.query<{ engine_id: string; runner_version: string; rules_evaluated: number | null }>(
            'SELECT engine_id, runner_version, rules_evaluated FROM qc_run WHERE id=$1',
            [oldRun],
          )
        ).rows[0],
        { engine_id: 'substitute', runner_version: 'unrecorded', rules_evaluated: null },
      );
      app = new pg.Client({ connectionString: appUrl.href });
      await app.connect();
      const db = app;
      const makeRun = async (day: string) => {
        const runId = randomUUID();
        await db.query(
          `INSERT INTO operator_job_run (id,job,digest_day,correlation_id,started_at,status) VALUES ($1,'sla_digest',$2,$3,now(),'running')`,
          [runId, day, correlation],
        );
        return runId;
      };
      const enqueue = async (
        runId: string,
        day: string,
        recipient = 'operator@rai-desk.example',
        event = 'sla_breach_digest',
        corr = correlation,
      ) => {
        const notice = randomUUID();
        await db.query('BEGIN');
        try {
          await db.query(
            `INSERT INTO notification (id,event,lane,recipient,deep_link_path,template_key,template_params,correlation_id) VALUES ($1,$2,'-',$3,'/queue','mail.digest','{}',$4)`,
            [notice, event, recipient, corr],
          );
          await db.query(
            'INSERT INTO operator_job_notification (job_run_id,notification_id,digest_day,recipient) VALUES ($1,$2,$3,$4)',
            [runId, notice, day, recipient],
          );
          await db.query('COMMIT');
          return notice;
        } catch (err) {
          await db.query('ROLLBACK');
          throw err;
        }
      };
      const first = await makeRun('2026-09-22');
      const notice = await enqueue(first, '2026-09-22');
      const duplicate = await makeRun('2026-09-22');
      await assert.rejects(enqueue(duplicate, '2026-09-22'), /operator_digest_day_recipient_key/);
      await assert.rejects(enqueue(randomUUID(), '2026-09-22'), /digest_provenance_invalid/);
      await assert.rejects(enqueue(duplicate, '2026-09-23'), /digest_provenance_invalid/);
      await assert.rejects(
        enqueue(duplicate, '2026-09-22', 'other@rai-desk.example', 'ready'),
        /digest_provenance_invalid/,
      );
      await assert.rejects(
        enqueue(duplicate, '2026-09-22', 'other@rai-desk.example', 'sla_breach_digest', randomUUID()),
        /digest_provenance_invalid/,
      );
      await assert.rejects(
        db.query(
          `INSERT INTO notification (id,event,lane,recipient,deep_link_path,template_key,template_params,correlation_id) VALUES ($1,'sla_breach_digest','-','orphan@rai-desk.example','/queue','mail.digest','{}',$2)`,
          [randomUUID(), correlation],
        ),
        /digest_job_link_required/,
      );
      await enqueue(await makeRun('2026-09-23'), '2026-09-23');
      await db.query(
        `UPDATE operator_job_run SET status='completed',finished_at=now(),breach_count=1 WHERE id=$1`,
        [first],
      );
      await assert.rejects(
        db.query(
          `UPDATE operator_job_run SET status='failed',error_stage='query',error_code='query_failed' WHERE id=$1`,
          [first],
        ),
      );
      await assert.rejects(
        enqueue(first, '2026-09-22', 'late@rai-desk.example'),
        /digest_provenance_invalid/,
      );
      for (const stage of ['query', 'render', 'enqueue']) {
        const runId = await makeRun('2026-09-22');
        await db.query(
          `UPDATE operator_job_run SET status='failed',finished_at=now(),error_stage=$2,error_code=$3 WHERE id=$1`,
          [runId, stage, `${stage}_failed`],
        );
      }
      await assert.rejects(
        db.query('DELETE FROM operator_job_notification WHERE notification_id=$1', [notice]),
      );
      await assert.rejects(
        owner.query('DELETE FROM operator_job_notification WHERE notification_id=$1', [notice]),
        /append_only/,
      );
      await assert.rejects(
        owner.query(`UPDATE qc_run SET unavailable_reason='timeout' WHERE id=$1`, [oldRun]),
        /append_only/,
      );
      await assert.rejects(
        db.query(
          `INSERT INTO qc_run (id,version_id,trigger,engine_id,runner_version,rule_revision,status,requested_at,completed_at,correlation_id,unavailable_reason) VALUES ($1,$2,'submit','substitute','0.0.0','v1','unavailable',now(),now(),$3,'private exception')`,
          [randomUUID(), versionId, correlation],
        ),
        /qc_run_unavailable_reason_check/,
      );
      // W4-11a (0009): the default was dropped, so a new run must name its runner version; counts are never negative.
      await assert.rejects(
        db.query(
          `INSERT INTO qc_run (id,version_id,trigger,engine_id,rule_revision,status,requested_at,completed_at,correlation_id,unavailable_reason) VALUES ($1,$2,'submit','substitute','v1','unavailable',now(),now(),$3,'timeout')`,
          [randomUUID(), versionId, correlation],
        ),
        /null value in column "runner_version"/,
      );
      await assert.rejects(
        db.query(
          `INSERT INTO qc_run (id,version_id,trigger,engine_id,runner_version,rules_evaluated,rule_revision,status,requested_at,completed_at,correlation_id) VALUES ($1,$2,'submit','substitute','0.0.0',-1,'v1','completed',now(),now(),$3)`,
          [randomUUID(), versionId, correlation],
        ),
        /qc_run_rules_evaluated_check/,
      );
      const lateId = randomUUID(),
        attempted = randomUUID();
      const lateSql = `INSERT INTO qc_late_result (id,qc_run_id,version_id,trigger,status,refused_finding_count,recorded_at,correlation_id) VALUES ($1,$2,$3,'submit','completed',2,now(),$4)`;
      await assert.rejects(
        db.query(lateSql, [lateId, attempted, versionId, correlation]),
        /qc_late_requires_ready/,
      );
      // Synthetic persistence fixture only; no claim of a valid workflow transition in this contract test.
      await owner.query('UPDATE pack_version SET ready_at=now() WHERE id=$1', [versionId]);
      await db.query(lateSql, [lateId, attempted, versionId, correlation]);
      await assert.rejects(db.query(lateSql, [randomUUID(), attempted, versionId, correlation]), /unique/);
      await assert.rejects(owner.query('DELETE FROM qc_late_result WHERE id=$1', [lateId]), /append_only/);
      await db.end();
      app = undefined;
      app = new pg.Client({ connectionString: appUrl.href });
      await app.connect();
      assert.equal((await app.query('SELECT * FROM qc_late_result WHERE id=$1', [lateId])).rows.length, 1);
      assert.equal(
        (await app.query('SELECT * FROM operator_job_notification WHERE notification_id=$1', [notice])).rows
          .length,
        1,
      );
      assert.equal((await app.query('SELECT * FROM qc_run WHERE id=$1', [attempted])).rows.length, 0);
    } finally {
      await app?.end();
      await owner?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
