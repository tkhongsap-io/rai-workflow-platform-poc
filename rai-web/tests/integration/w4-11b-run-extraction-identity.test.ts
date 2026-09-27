// W4-11b (W4b plan sections 7, 8 and 9): a qc_run row records the extractor version, the model identity, the prompt
// revision and the model usage a runner reports in `QcRunResult.engine`, and an unavailable run keeps its bounded
// `detail` in `unavailable_detail` (`unspecified` when the detail is not a code). qc.run.completed / unavailable
// carry the same identities and numbers, the qc-runs read serves them, and desk-health unavailableQc rows show the
// detail. Two runs on one version that differ only in extractor, model or prompt are told apart from rows and lines
// alone. The migration applies on a W4a (0009) or later database with rows in it. Synthetic probe runners only; no extractor
// or model exists yet (W4-05b, W4-07a), so the identities are synthetic labels. Fixture set slice1-synthetic@1.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import type { QcEngineIdentity, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import type { VersionQcRunsResponse } from '@rai/shared/schemas/review';
import { MIGRATIONS_FOLDER, runMigrations } from '@rai/server/db/migrate';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { assertNoLeak } from '../support/log-capture.js';
import { app, capture, db, diagnostics, openFixtureApp, signIn, submit } from '../support/fixture-app.js';
import { asUser } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER_A = 'fx-user-owner-cm';
const ADMIN = 'fx-user-admin';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const START = Date.parse('2026-09-27T09:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now });

afterEach(() => {
  assertNoLeak(capture);
});

const EXTRACTOR = 'rai-extract/1+0.0.0';
const MODEL = {
  provider: 'local-fake' as const,
  modelId: 'fake-claims-1',
  promptRevision: 'claims/v1@0123456789ab',
  inputTokens: 120,
  outputTokens: 30,
  latencyMs: 45,
  costUsdMicros: 0,
};

function at(): string {
  return new Date(clock).toISOString();
}

function completed(engine?: QcEngineIdentity): QcRunResult {
  return {
    status: 'completed',
    findings: [],
    rulesEvaluated: [],
    startedAt: at(),
    finishedAt: at(),
    ...(engine === undefined ? {} : { engine }),
  };
}

function unavailable(
  reason: 'artifact_unreadable' | 'runner_error' | 'timeout' | 'not_configured',
  detail: string | null,
  engine?: QcEngineIdentity,
): QcRunResult {
  return {
    status: 'unavailable',
    reason,
    detail,
    startedAt: at(),
    finishedAt: at(),
    ...(engine === undefined ? {} : { engine }),
  };
}

function probe(answer: () => QcRunResult | Promise<never>): QcRunner {
  return {
    identity: { runner: 'content-probe', runnerVersion: '0.0.0' },
    run() {
      return Promise.resolve(answer());
    },
  };
}

async function submitVendor() {
  const owner = await signIn(OWNER_A);
  const { version, correlationId } = await submit(owner, VENDOR.caseId);
  return {
    owner,
    versionId: version.versionId,
    input: { caseId: VENDOR.caseId, versionId: version.versionId, correlationId },
  };
}

interface IdentityRow {
  status: string;
  extractor_version: string | null;
  model_provider: string | null;
  model_id: string | null;
  prompt_revision: string | null;
  model_input_tokens: number | null;
  model_output_tokens: number | null;
  model_latency_ms: number | null;
  model_cost_usd_micros: string | null; // bigint comes back as text
  unavailable_detail: string | null;
}

async function identityRow(runId: string): Promise<IdentityRow> {
  const rows = await db.owner.execute(
    sql`SELECT status, extractor_version, model_provider, model_id, prompt_revision, model_input_tokens,
               model_output_tokens, model_latency_ms, model_cost_usd_micros, unavailable_detail
          FROM qc_run WHERE id = ${runId}`,
  );
  assert.equal(rows.rows.length, 1);
  return rows.rows[0] as unknown as IdentityRow;
}

const NO_IDENTITY = {
  extractor_version: null,
  model_provider: null,
  model_id: null,
  prompt_revision: null,
  model_input_tokens: null,
  model_output_tokens: null,
  model_latency_ms: null,
  model_cost_usd_micros: null,
};

function fieldsOf(runId: string, event: string) {
  const found = capture.lines().filter((line) => line.fields?.['qcRunId'] === runId && line.event === event);
  assert.equal(found.length, 1, `${event} for ${runId}`);
  return found[0]!.fields!;
}

const IDENTITY_FIELDS = [
  'extractorVersion',
  'modelProvider',
  'modelId',
  'promptRevision',
  'modelInputTokens',
  'modelOutputTokens',
  'modelLatencyMs',
] as const;

function identityFieldsOf(fields: Record<string, unknown>) {
  return Object.fromEntries(IDENTITY_FIELDS.filter((k) => k in fields).map((k) => [k, fields[k]]));
}

async function qcRuns(versionId: string) {
  const owner = await signIn(OWNER_A);
  const res = await app.inject({
    url: `/api/cases/${VENDOR.caseId}/versions/${versionId}/qc-runs`,
    headers: asUser(owner),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<VersionQcRunsResponse>().runs;
}

describe(`W4-11b run identity for extraction and model use — ${SET}`, () => {
  it('a completed run records the extractor, model, prompt and usage on its row, its line and the qc-runs read', async () => {
    const { versionId, input } = await submitVendor();
    const runner = probe(() => completed({ extractorVersion: EXTRACTOR, model: MODEL }));
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(await identityRow(outcome.runId), {
      status: 'completed',
      extractor_version: EXTRACTOR,
      model_provider: 'local-fake',
      model_id: 'fake-claims-1',
      prompt_revision: 'claims/v1@0123456789ab',
      model_input_tokens: 120,
      model_output_tokens: 30,
      model_latency_ms: 45,
      model_cost_usd_micros: '0',
      unavailable_detail: null,
    });
    assert.deepEqual(identityFieldsOf(fieldsOf(outcome.runId, 'qc.run.completed')), {
      extractorVersion: EXTRACTOR,
      modelProvider: 'local-fake',
      modelId: 'fake-claims-1',
      promptRevision: 'claims/v1@0123456789ab',
      modelInputTokens: 120,
      modelOutputTokens: 30,
      modelLatencyMs: 45,
    });
    const [run] = (await qcRuns(versionId)).filter((r) => r.runId === outcome.runId);
    assert.ok(run !== undefined);
    assert.deepEqual(
      {
        extractorVersion: run.extractorVersion,
        model: run.model,
        modelUsage: run.modelUsage,
        unavailableDetail: run.unavailableDetail,
      },
      {
        extractorVersion: EXTRACTOR,
        model: { provider: 'local-fake', modelId: 'fake-claims-1', promptRevision: 'claims/v1@0123456789ab' },
        modelUsage: { inputTokens: 120, outputTokens: 30, latencyMs: 45 },
        unavailableDetail: null,
      },
    );
  });

  it('a run without extraction or model use records NULL identity and its line carries none', async () => {
    const { versionId, input } = await submitVendor();
    const outcome = await runAndPersistSubmitQc(
      { db: db.app, runner: probe(() => completed()), now, ...diagnostics },
      input,
    );
    assert.deepEqual(await identityRow(outcome.runId), {
      status: 'completed',
      ...NO_IDENTITY,
      unavailable_detail: null,
    });
    assert.deepEqual(identityFieldsOf(fieldsOf(outcome.runId, 'qc.run.completed')), {});
    const [run] = (await qcRuns(versionId)).filter((r) => r.runId === outcome.runId);
    assert.deepEqual(
      [run!.extractorVersion, run!.model, run!.modelUsage, run!.unavailableDetail],
      [null, null, null, null],
    );
  });

  it('an unavailable run keeps its extractor version and its detail on the row, the line and the operator rows', async () => {
    const { versionId, input } = await submitVendor();
    const runner = probe(() =>
      unavailable('artifact_unreadable', 'extract_limit_time', { extractorVersion: EXTRACTOR }),
    );
    const outcome = await runAndPersistLaneQc(
      { db: db.app, runner, now, ...diagnostics },
      { ...input, lane: 'ai_coe' },
    );
    assert.equal(outcome.status, 'unavailable');
    assert.deepEqual(await identityRow(outcome.runId), {
      status: 'unavailable',
      ...NO_IDENTITY,
      extractor_version: EXTRACTOR,
      unavailable_detail: 'extract_limit_time',
    });
    const line = fieldsOf(outcome.runId, 'qc.run.unavailable');
    assert.equal(line['unavailableDetail'], 'extract_limit_time');
    assert.equal(line['extractorVersion'], EXTRACTOR);
    assert.equal(line['reason'], 'artifact_unreadable');
    const [run] = (await qcRuns(versionId)).filter((r) => r.runId === outcome.runId);
    assert.equal(run!.unavailableDetail, 'extract_limit_time');
    assert.equal(run!.extractorVersion, EXTRACTOR);

    const admin = await signIn(ADMIN);
    const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
    assert.equal(view.statusCode, 200, view.body);
    const rows = view.json<DeskHealthReport>().unavailableQc.filter((row) => row.qcRunId === outcome.runId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.unavailableDetail, 'extract_limit_time');
  });

  it('a detail that is not a bounded code is stored as unspecified; a missing detail stays NULL', async () => {
    const { input } = await submitVendor();
    const text = await runAndPersistLaneQc(
      {
        db: db.app,
        runner: probe(() => unavailable('runner_error', 'Error: synthetic parser said something')),
        now,
        ...diagnostics,
      },
      { ...input, lane: 'dpo' },
    );
    assert.equal((await identityRow(text.runId)).unavailable_detail, 'unspecified');
    assert.equal(fieldsOf(text.runId, 'qc.run.unavailable')['unavailableDetail'], 'unspecified');

    const thrown = await runAndPersistLaneQc(
      {
        db: db.app,
        runner: probe(() => Promise.reject(new Error('synthetic'))),
        now,
        ...diagnostics,
      },
      { ...input, lane: 'it_security' },
    );
    assert.equal(thrown.status, 'unavailable');
    assert.equal((await identityRow(thrown.runId)).unavailable_detail, null);
    assert.ok(!('unavailableDetail' in fieldsOf(thrown.runId, 'qc.run.unavailable')));

    const admin = await signIn(ADMIN);
    const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
    const rows = view.json<DeskHealthReport>().unavailableQc;
    assert.equal(rows.find((row) => row.qcRunId === text.runId)!.unavailableDetail, 'unspecified');
    assert.equal(rows.find((row) => row.qcRunId === thrown.runId)!.unavailableDetail, null);
  });

  it('a validator refusal persists its violation as the detail and keeps the reported identity', async () => {
    const { input } = await submitVendor();
    const runner = probe(() => ({
      ...completed({ extractorVersion: EXTRACTOR }),
      findings: [
        {
          findingKey: 'not-a-valid-key',
          ruleId: 'PACK-SLOT-MISSING',
          ruleRevision: 'wrong-revision',
          trigger: 'submit',
          scope: { kind: 'slot', slot: 1 },
          severity: 'medium',
          owningLane: 'ai_coe',
          evidence: [],
          measure: null,
          message: { key: 'qc.finding.slot_missing', params: { slot: 1 } },
          provenance: { runner: 'content-probe', runnerVersion: '0.0.0' },
        },
      ],
    }));
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'unavailable');
    const row = await identityRow(outcome.runId);
    assert.match(row.unavailable_detail ?? '', /^[a-z0-9_]{1,64}$/);
    assert.notEqual(row.unavailable_detail, 'unspecified');
    assert.equal(row.extractor_version, EXTRACTOR);
  });

  it('an engine identity that is not an identifier fails the run as runner_error and records no identity', async () => {
    const { input } = await submitVendor();
    const runner = probe(() =>
      completed({ extractorVersion: 'extractor said: the document contains secret text', model: MODEL }),
    );
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'unavailable');
    assert.equal(outcome.reason, 'runner_error');
    assert.deepEqual(await identityRow(outcome.runId), {
      status: 'unavailable',
      ...NO_IDENTITY,
      unavailable_detail: 'engine_identity_invalid',
    });
    const line = fieldsOf(outcome.runId, 'qc.run.unavailable');
    assert.deepEqual(identityFieldsOf(line), {});
    assert.equal(line['unavailableDetail'], 'engine_identity_invalid');

    const provider = await runAndPersistLaneQc(
      {
        db: db.app,
        runner: probe(() =>
          completed({ model: { ...MODEL, provider: 'external-api' } as unknown as typeof MODEL }),
        ),
        now,
        ...diagnostics,
      },
      { ...input, lane: 'ai_coe' },
    );
    assert.equal(provider.status, 'unavailable');
    assert.equal((await identityRow(provider.runId)).unavailable_detail, 'engine_identity_invalid');
  });

  it('two runs on one version that differ only in extractor, model or prompt are told apart from rows and lines alone', async () => {
    const { versionId, input } = await submitVendor();
    const engines: QcEngineIdentity[] = [
      { extractorVersion: EXTRACTOR, model: MODEL },
      { extractorVersion: 'rai-extract/2+0.0.0', model: MODEL },
      { extractorVersion: EXTRACTOR, model: { ...MODEL, modelId: 'fake-claims-2' } },
      { extractorVersion: EXTRACTOR, model: { ...MODEL, promptRevision: 'claims/v2@ba9876543210' } },
    ];
    const runIds: string[] = [];
    // One approve attempt per lane gives each engine its own run on the same version (a completed lane run replays).
    const lanes = ['ai_coe', 'dpo', 'it_security'] as const;
    for (const [i, engine] of engines.entries()) {
      const deps = { db: db.app, runner: probe(() => completed(engine)), now, ...diagnostics };
      const outcome =
        i < lanes.length
          ? await runAndPersistLaneQc(deps, { ...input, lane: lanes[i]! })
          : await runAndPersistSubmitQc(deps, input);
      assert.equal(outcome.status, 'completed');
      runIds.push(outcome.runId);
    }
    const rowKeys = await Promise.all(
      runIds.map(async (id) => {
        const r = await identityRow(id);
        return `${r.extractor_version}|${r.model_provider}|${r.model_id}|${r.prompt_revision}`;
      }),
    );
    assert.equal(new Set(rowKeys).size, engines.length, rowKeys.join('\n'));
    const lineKeys = runIds.map((id) => {
      const f = fieldsOf(id, 'qc.run.completed');
      return `${String(f['extractorVersion'])}|${String(f['modelProvider'])}|${String(f['modelId'])}|${String(f['promptRevision'])}`;
    });
    assert.deepEqual(lineKeys, rowKeys);
    const served = (await qcRuns(versionId)).filter((r) => runIds.includes(r.runId));
    assert.equal(
      new Set(
        served.map(
          (r) => `${r.extractorVersion}|${r.model?.modelId ?? '-'}|${r.model?.promptRevision ?? '-'}`,
        ),
      ).size,
      engines.length,
    );
  });
});

const adminUrl = process.env['OBS_MIGRATION_ADMIN_URL'];

describe('W4-11b migration on a W4a database', () => {
  it(
    'applies on a database at the migration before it (W4a 0009 and later) with a run in it; earlier rows read NULL; the CHECKs hold',
    { skip: adminUrl === undefined },
    async () => {
      const dbName = `w4_11b_${randomUUID().replaceAll('-', '')}`;
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      const scratch = await mkdtemp(path.join(tmpdir(), 'rai-w4-11b-migrations-'));
      const url = new URL(adminUrl!);
      url.pathname = `/${dbName}`;
      const ownerUrl = new URL(url);
      ownerUrl.username = 'rai_owner';
      ownerUrl.password = 'rai_owner';
      const appUrl = new URL(url);
      appUrl.username = 'rai_app';
      appUrl.password = 'rai_app';
      let owner: pg.Client | undefined;
      let appClient: pg.Client | undefined;
      try {
        await admin.query(`CREATE DATABASE "${dbName}" OWNER rai_owner`);
        await mkdir(path.join(scratch, 'meta'));
        const journal = JSON.parse(
          await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
        ) as { entries: { idx: number; tag: string }[] };
        const own = journal.entries.find((e) => e.tag.endsWith('_w4_11b_run_extraction_identity'));
        assert.ok(own !== undefined, 'the W4-11b migration is in the journal');
        const w4a = journal.entries.find((e) => e.tag.endsWith('_w4_11a_run_identity'));
        assert.ok(w4a !== undefined && w4a.idx < own.idx);
        journal.entries = journal.entries.filter((e) => e.idx < own.idx);
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
          `INSERT INTO "case" (id,registry_id,source_record_id,use_case_name,business_unit,business_owner,technical_owner,use_case_group,vendor_involved,model_type,owner_subject_id,business_unit_id,created_by) VALUES ($1,'SYN-W4-11B','Unknown','Synthetic','CM','Synthetic owner','Synthetic technical','service',false,'llm','fixture-owner','CM','fixture-owner')`,
          [caseId],
        );
        await owner.query(
          `INSERT INTO pack_version (id,case_id,version_number,created_by,stage_context,checklist_template_version) VALUES ($1,$2,1,'fixture-owner','pre_launch','v1')`,
          [versionId, caseId],
        );
        await owner.query(
          `INSERT INTO qc_run (id,version_id,trigger,engine_id,runner_version,rules_evaluated,rule_revision,status,unavailable_reason,requested_at,completed_at,correlation_id) VALUES ($1,$2,'submit','deterministic','0.0.0',0,'v1','unavailable','runner_error',now(),now(),$3)`,
          [oldRun, versionId, correlation],
        );
        const later = journal.entries.length;
        const all = (
          JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
            entries: unknown[];
          }
        ).entries.length;
        assert.equal((await runMigrations(ownerUrl.href)).applied.length, all - later);

        const old = (
          await owner.query(
            `SELECT extractor_version, model_provider, model_id, prompt_revision, model_input_tokens, model_output_tokens,
                    model_latency_ms, model_cost_usd_micros, unavailable_detail FROM qc_run WHERE id=$1`,
            [oldRun],
          )
        ).rows[0] as Record<string, unknown>;
        assert.deepEqual(old, { ...NO_IDENTITY, unavailable_detail: null });

        appClient = new pg.Client({ connectionString: appUrl.href });
        await appClient.connect();
        const insert = (columns: Record<string, unknown>, status = 'unavailable') => {
          const base: Record<string, unknown> = {
            id: randomUUID(),
            version_id: versionId,
            trigger: 'submit',
            engine_id: 'content',
            runner_version: '0.0.0',
            rule_revision: 'v1',
            status,
            unavailable_reason: status === 'unavailable' ? 'artifact_unreadable' : null,
            requested_at: new Date(),
            completed_at: new Date(),
            correlation_id: correlation,
            ...columns,
          };
          const keys = Object.keys(base);
          return appClient!.query(
            `INSERT INTO qc_run (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
            keys.map((k) => base[k]),
          );
        };
        // The rai_app role writes every new column (the existing INSERT grant covers them).
        await insert({
          extractor_version: EXTRACTOR,
          model_provider: 'local-fake',
          model_id: 'fake-claims-1',
          prompt_revision: 'claims/v1@0123456789ab',
          model_input_tokens: 0,
          model_output_tokens: 0,
          model_latency_ms: 0,
          model_cost_usd_micros: 0,
          unavailable_detail: 'extract_crash',
        });
        for (const column of [
          'model_input_tokens',
          'model_output_tokens',
          'model_latency_ms',
          'model_cost_usd_micros',
        ])
          await assert.rejects(insert({ [column]: -1 }), new RegExp(`qc_run_${column}_check`), column);
        await assert.rejects(
          insert({ unavailable_detail: 'extract_crash' }, 'completed'),
          /qc_run_unavailable_detail_check/,
        );
        for (const bad of ['Extract crash', 'x'.repeat(65), '', 'a/b', 'simulated:timeout'])
          await assert.rejects(insert({ unavailable_detail: bad }), /qc_run_unavailable_detail_check/, bad);
        // Rows stay append-only: the new columns are never updated.
        await assert.rejects(
          owner.query(`UPDATE qc_run SET unavailable_detail='timeout' WHERE id=$1`, [oldRun]),
          /append_only/,
        );
      } finally {
        await appClient?.end();
        await owner?.end();
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
        await admin.end();
        await rm(scratch, { recursive: true, force: true });
      }
    },
  );
});
