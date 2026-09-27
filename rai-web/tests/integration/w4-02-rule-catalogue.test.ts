// W4-02 (W4a plan section 3): the orchestrator loads the `qc_rules` catalogue by the recorded revision ID, selects
// the rules for the version's checklist template, trigger and model type, and passes them as `request.rules`.
// A submitted version reads its own frozen revision; a draft (the W4-04 upload case) reads the revision in force
// strictly before the instant. A version whose recorded revision is of another kind (frozen before W4-02) is sent
// no rules; an approve attempt the runner answers `not_configured` is retried, not replayed. An unknown template
// version is `runner_error`, never a clean pass. Synthetic probe runners only; fixture set slice1-synthetic@1.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import type { QcRunRequest, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import type { ConfigurationBodies } from '@rai/shared/schemas/cases';
import { readVersionRow } from '@rai/server/cases/repository';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { ruleContextOf } from '@rai/server/qc/rules-revision';
import { assertNoLeak } from '../support/log-capture.js';
import { capture, db, diagnostics, openFixtureApp, signIn, submit } from '../support/fixture-app.js';

const SET = fixtureSetLabel(readManifest());
const OWNER_A = 'fx-user-owner-cm';
const VENDOR = findFixtureCase('fx-case-vendor')!; // llm, v2.0
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // classic_ml, v1.0 Sheet3
const NA_REASONS = findFixtureCase('fx-case-na-reasons')!; // llm, v1.0 Sheet3

const START = Date.parse('2026-09-27T04:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now });

afterEach(() => {
  assertNoLeak(capture);
});

function answer(result: 'completed' | 'not_configured'): QcRunResult {
  const at = new Date(clock).toISOString();
  return result === 'completed'
    ? { status: 'completed', findings: [], rulesEvaluated: [], startedAt: at, finishedAt: at }
    : { status: 'unavailable', reason: 'not_configured', detail: null, startedAt: at, finishedAt: at };
}

/** Answers as the W4-03 deterministic runner will: no rules in the request is `not_configured`, never a clean pass. */
function probe(): QcRunner & { requests: QcRunRequest[] } {
  const requests: QcRunRequest[] = [];
  return {
    identity: { runner: 'rules-probe', runnerVersion: '1.0.0' },
    requests,
    run(request) {
      requests.push(request);
      return Promise.resolve(answer(request.rules === null ? 'not_configured' : 'completed'));
    },
  };
}

const ruleIds = (request: QcRunRequest | undefined) => request?.rules?.map((r) => r.ruleId);

async function submitCase(caseId: string) {
  const owner = await signIn(OWNER_A);
  const { version, correlationId } = await submit(owner, caseId);
  return { version, input: { caseId, versionId: version.versionId, correlationId } };
}

async function seededQcRules(): Promise<{ id: string; label: string }> {
  const rows = (
    await db.owner.execute(
      sql`SELECT id, body->>'label' AS label FROM configuration_revision WHERE kind = 'qc_rules'`,
    )
  ).rows as Array<{ id: string; label: string }>;
  assert.equal(rows.length, 1);
  return rows[0]!;
}

async function publishQcRules(body: ConfigurationBodies['qc_rules'], publishedAt: Date) {
  return withTransaction(db.app, (tx) =>
    publishRevision(tx, {
      kind: 'qc_rules',
      body,
      publishedBy: 'system',
      publishedRole: 'system',
      correlationId: randomUUID(),
      publishedAt,
    }),
  );
}

/** Rewrites a synthetic version's frozen revision as rai_owner, the frozen-row trigger disabled in one transaction. */
async function refreeze(versionId: string, configurationRevisionId: string, qcRules: string | null) {
  await db.raw('owner', async (client) => {
    await client.query('BEGIN');
    await client.query('ALTER TABLE pack_version DISABLE TRIGGER pack_version_frozen');
    await client.query(
      `UPDATE pack_version
          SET configuration_revision_id = $2,
              frozen_configuration = CASE WHEN $3::text IS NULL THEN frozen_configuration - 'qc_rules'
                                          ELSE frozen_configuration || jsonb_build_object('qc_rules', $3::text) END
        WHERE id = $1`,
      [versionId, configurationRevisionId, qcRules],
    );
    await client.query('ALTER TABLE pack_version ENABLE TRIGGER pack_version_frozen');
    await client.query('COMMIT');
  });
}

async function revisionIdOfKind(kind: string): Promise<string> {
  const rows = (
    await db.owner.execute(sql`SELECT id FROM configuration_revision WHERE kind = ${kind} LIMIT 1`)
  ).rows as Array<{ id: string }>;
  return rows[0]!.id;
}

async function runsOf(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT trigger, lane, engine_id, rule_revision, status, unavailable_reason, rules_evaluated
            FROM qc_run WHERE version_id = ${versionId} ORDER BY requested_at, id`,
    )
  ).rows;
}

async function unavailableFindings(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT id, owning_lane FROM qc_finding WHERE version_id = ${versionId} AND kind = 'unavailable'`,
    )
  ).rows as Array<{ id: string; owning_lane: string }>;
}

describe(`W4-02 rule catalogue — ${SET}`, () => {
  it('a new submit freezes the seeded qc_rules revision and QC requests carry the rules it selects', async () => {
    const seeded = await seededQcRules();
    assert.equal(seeded.label, 'w4a.1');

    const vendor = await submitCase(VENDOR.caseId);
    assert.equal(vendor.version.configurationRevisionId, seeded.id);
    const runner = probe();
    const deps = { db: db.app, runner, now, ...diagnostics };
    const submitted = await runAndPersistSubmitQc(deps, vendor.input);
    assert.equal(submitted.status, 'completed');
    assert.equal(runner.requests[0]!.qcRulesRevision, seeded.id); // the recorded revision is the ID, never the label
    assert.deepEqual(ruleIds(runner.requests[0]), [
      'PACK-SLOT-MISSING',
      'PACK-STAGE-MISMATCH',
      'PACK-NA-VENDOR-DOC',
    ]);
    await runAndPersistLaneQc(deps, { ...vendor.input, lane: 'dpo' });
    // v2.0 never inherits the v1.0 Sheet-3 bands.
    assert.deepEqual(ruleIds(runner.requests[1]), [
      'PACK-SLOT-MISSING',
      'ACC-METRIC-CITED',
      'ACC-EXTRACTION-NOT-HALLUCINATION',
    ]);

    const naReasons = await submitCase(NA_REASONS.caseId);
    await runAndPersistLaneQc(deps, { ...naReasons.input, lane: 'ai_coe' });
    assert.deepEqual(ruleIds(runner.requests[2]), [
      'PACK-SLOT-MISSING',
      'ACC-METRIC-CITED',
      'ACC-EXTRACTION-NOT-HALLUCINATION',
      'ACC-BAND-V1-SHEET3',
    ]);

    const classic = await submitCase(NONVENDOR.caseId);
    await runAndPersistLaneQc(deps, { ...classic.input, lane: 'ai_coe' });
    assert.deepEqual(ruleIds(runner.requests[3]), ['PACK-SLOT-MISSING', 'ACC-CLASSIC-ML-METRIC']);
    for (const request of runner.requests) assert.equal(request.qcRulesRevision, seeded.id);
  });

  it('a submitted version reads its frozen revision; a draft reads the revision in force strictly before the instant', async () => {
    const seeded = await seededQcRules();
    const vendor = await submitCase(VENDOR.caseId);
    const publishedAt = now();
    const next = await publishQcRules(
      {
        label: 'w4a.2',
        templates: {
          'v1.0 Sheet3': { rules: [] },
          'v2.0': {
            rules: [
              {
                ruleId: 'PACK-SLOT-MISSING',
                engine: 'metadata',
                triggers: ['approve_attempt'],
                severity: 'low',
              },
            ],
          },
        },
      },
      publishedAt,
    );
    const after = new Date(publishedAt.getTime() + 1);

    // The historical version re-evaluated reads its own frozen revision, never the current one.
    const runner = probe();
    await runAndPersistLaneQc({ db: db.app, runner, now, ...diagnostics }, { ...vendor.input, lane: 'dpo' });
    assert.equal(runner.requests[0]!.qcRulesRevision, seeded.id);
    assert.deepEqual(ruleIds(runner.requests[0]), [
      'PACK-SLOT-MISSING',
      'ACC-METRIC-CITED',
      'ACC-EXTRACTION-NOT-HALLUCINATION',
    ]);
    const submittedRow = (await readVersionRow(db.app, vendor.version.versionId))!;
    const frozen = await ruleContextOf(db.app, submittedRow, after);
    assert.equal(frozen.ruleRevision, seeded.id);
    assert.equal(frozen.catalogue?.label, 'w4a.1');

    // The open draft of another case: the same rule the freeze uses (published strictly before the instant).
    const draftId = (
      (await db.owner.execute(sql`SELECT draft_version_id FROM "case" WHERE id = ${NA_REASONS.caseId}`))
        .rows[0] as {
        draft_version_id: string;
      }
    ).draft_version_id;
    const draft = (await readVersionRow(db.app, draftId))!;
    assert.equal(draft.submittedAt, null);
    const atPublish = await ruleContextOf(db.app, draft, publishedAt);
    assert.equal(atPublish.ruleRevision, seeded.id);
    assert.equal(atPublish.catalogue?.label, 'w4a.1');
    const inForce = await ruleContextOf(db.app, draft, after);
    assert.equal(inForce.ruleRevision, next.id);
    assert.equal(inForce.catalogue?.label, 'w4a.2');

    // A submit after the publish freezes the new revision, and its runs record it.
    const later = await submitCase(NA_REASONS.caseId);
    assert.equal(later.version.configurationRevisionId, next.id);
    await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, later.input);
    assert.equal(runner.requests[1]!.qcRulesRevision, next.id);
    assert.deepEqual(runner.requests[1]!.rules, []); // a zero-rule selection, distinct from no catalogue
  });

  it('a version frozen before W4-02 gets no rules; approve attempts answered not_configured are retried, not replayed', async () => {
    const vendor = await submitCase(VENDOR.caseId);
    // Before W4-02 the freeze recorded a revision of a view kind (W0-02 7.3 rule), and no qc_rules key.
    const legacy = await revisionIdOfKind('checklist_templates');
    await refreeze(vendor.version.versionId, legacy, null);
    const runner = probe();
    const deps = { db: db.app, runner, now, ...diagnostics };
    const input = { ...vendor.input, lane: 'dpo' as const };

    const first = await runAndPersistLaneQc(deps, input);
    assert.equal(first.status, 'unavailable');
    assert.equal(first.status === 'unavailable' ? first.reason : null, 'not_configured');
    assert.equal(runner.requests[0]!.rules, null);
    assert.equal(runner.requests[0]!.qcRulesRevision, legacy); // the recorded ID is unchanged

    const second = await runAndPersistLaneQc(deps, input);
    assert.equal(runner.requests.length, 2, 'the second attempt calls the runner again');
    assert.notEqual(second.runId, first.runId);
    assert.equal(second.status === 'unavailable' ? second.reason : null, 'not_configured');
    const runs = await runsOf(vendor.version.versionId);
    assert.deepEqual(
      runs.map((r) => [
        r['trigger'],
        r['lane'],
        r['engine_id'],
        r['rule_revision'],
        r['status'],
        r['unavailable_reason'],
      ]),
      [
        ['approve_attempt', 'dpo', 'rules-probe', legacy, 'unavailable', 'not_configured'],
        ['approve_attempt', 'dpo', 'rules-probe', legacy, 'unavailable', 'not_configured'],
      ],
    );
    // One open QC-UNAVAILABLE finding for the scope, reused by the retry (W0-07 3.6): an outage, never a clean pass.
    const findings = await unavailableFindings(vendor.version.versionId);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.owning_lane, 'dpo');
    assert.deepEqual(
      second.findings.map((f) => f.findingId),
      [findings[0]!.id],
    );

    // A recorded ID with no revision row is treated the same way: no catalogue, no rules.
    const missing = randomUUID();
    await refreeze(vendor.version.versionId, legacy, missing);
    const context = await ruleContextOf(
      db.app,
      (await readVersionRow(db.app, vendor.version.versionId))!,
      now(),
    );
    assert.deepEqual(context, { ruleRevision: missing, catalogue: null });
  });

  it('an unknown template version records runner_error without calling the runner', async () => {
    await publishQcRules({ label: 'w4a.partial', templates: { 'v1.0 Sheet3': { rules: [] } } }, now());
    const vendor = await submitCase(VENDOR.caseId); // v2.0, absent from the frozen catalogue
    const runner = probe();
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, vendor.input);
    assert.equal(runner.requests.length, 0);
    assert.equal(outcome.status, 'unavailable');
    assert.equal(outcome.status === 'unavailable' ? outcome.reason : null, 'runner_error');
    const runs = await runsOf(vendor.version.versionId);
    assert.deepEqual(
      runs.map((r) => [
        r['trigger'],
        r['engine_id'],
        r['status'],
        r['unavailable_reason'],
        r['rules_evaluated'],
      ]),
      [['submit', 'rules-probe', 'unavailable', 'runner_error', 0]],
    );
    const findings = await unavailableFindings(vendor.version.versionId);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.owning_lane, 'ai_coe');
    const line = capture
      .lines()
      .find((l) => l.event === 'qc.run.unavailable' && l.fields?.['qcRunId'] === outcome.runId);
    assert.equal(line?.fields?.['reason'], 'runner_error');
  });
});
