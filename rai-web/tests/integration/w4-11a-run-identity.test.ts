// W4-11a (W4a plan section 6): every new qc_run row records the bound runner's identity (engine_id,
// runner_version) and the number of rules it evaluated; the qc.run.* lines carry runner, runnerVersion and
// ruleRevision, completed lines also rulesEvaluated; qcKind comes from the bound runner; desk-health unavailableQc
// rows carry the runner label. Two runs on one version with different rule revisions are told apart from rows and
// lines alone. Synthetic probe runners only; fixture set slice1-synthetic@1.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import type { QcRunRequest, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { assertNoLeak } from '../support/log-capture.js';
import { app, capture, db, diagnostics, openFixtureApp, signIn, submit } from '../support/fixture-app.js';
import { asUser } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER_A = 'fx-user-owner-cm';
const ADMIN = 'fx-user-admin';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const START = Date.parse('2026-09-27T03:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now });

afterEach(() => {
  assertNoLeak(capture);
});

function completed(rulesEvaluated: string[]): QcRunResult {
  const at = new Date(clock).toISOString();
  return { status: 'completed', findings: [], rulesEvaluated, startedAt: at, finishedAt: at };
}

function probe(
  runner: string,
  runnerVersion: string,
  answer: (request: QcRunRequest) => QcRunResult | Promise<never>,
): QcRunner & { requests: QcRunRequest[] } {
  const requests: QcRunRequest[] = [];
  return {
    identity: { runner, runnerVersion },
    requests,
    run(request) {
      requests.push(request);
      return Promise.resolve(answer(request));
    },
  };
}

async function submitVendor() {
  const owner = await signIn(OWNER_A);
  const { version, correlationId } = await submit(owner, VENDOR.caseId);
  return {
    versionId: version.versionId,
    input: { caseId: VENDOR.caseId, versionId: version.versionId, correlationId },
  };
}

async function runRow(runId: string) {
  const rows = await db.owner.execute(
    sql`SELECT engine_id, runner_version, rules_evaluated, rule_revision, status FROM qc_run WHERE id = ${runId}`,
  );
  assert.equal(rows.rows.length, 1);
  return rows.rows[0] as {
    engine_id: string;
    runner_version: string;
    rules_evaluated: number | null;
    rule_revision: string;
    status: string;
  };
}

function linesFor(runId: string) {
  return capture.lines().filter((line) => line.fields?.['qcRunId'] === runId);
}

function fieldsOf(runId: string, event: string) {
  const found = linesFor(runId).filter((line) => line.event === event);
  assert.equal(found.length, 1, `${event} for ${runId}`);
  return found[0]!.fields!;
}

describe(`W4-11a run identity — ${SET}`, () => {
  it('a completed run records the runner identity and the evaluated rule count on the row and its lines', async () => {
    const { input } = await submitVendor();
    const runner = probe('substitute-scripted', '0.0.0', () =>
      completed(['PACK-SLOT-MISSING', 'PACK-STAGE-MISMATCH']),
    );
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'completed');
    const revision = runner.requests[0]!.qcRulesRevision;
    assert.ok(revision.length > 0);
    assert.deepEqual(await runRow(outcome.runId), {
      engine_id: 'substitute-scripted',
      runner_version: '0.0.0',
      rules_evaluated: 2,
      rule_revision: revision,
      status: 'completed',
    });
    const started = fieldsOf(outcome.runId, 'qc.run.started');
    assert.equal(started['runner'], 'substitute-scripted');
    assert.equal(started['runnerVersion'], '0.0.0');
    assert.equal(started['ruleRevision'], revision);
    assert.equal(started['qcKind'], 'substitute');
    const done = fieldsOf(outcome.runId, 'qc.run.completed');
    assert.equal(done['runner'], 'substitute-scripted');
    assert.equal(done['runnerVersion'], '0.0.0');
    assert.equal(done['ruleRevision'], revision);
    assert.equal(done['rulesEvaluated'], 2);
  });

  it('qcKind follows the bound runner: the deterministic runner reports deterministic', async () => {
    const { input } = await submitVendor();
    const runner = probe('deterministic', '0.1.0', () => completed([]));
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'completed');
    assert.equal(fieldsOf(outcome.runId, 'qc.run.started')['qcKind'], 'deterministic');
    // A completed run that evaluated nothing records 0, never NULL: it must not read as an older row.
    assert.equal((await runRow(outcome.runId)).rules_evaluated, 0);
    assert.equal(fieldsOf(outcome.runId, 'qc.run.completed')['rulesEvaluated'], 0);
  });

  it('an unavailable run records the bound runner identity, 0 rules evaluated, and says so on its line', async () => {
    const { input } = await submitVendor();
    const runner = probe('lane-probe', '2.1.0', () => Promise.reject(new Error('synthetic runner failure')));
    const outcome = await runAndPersistLaneQc(
      { db: db.app, runner, now, ...diagnostics },
      { ...input, lane: 'dpo' },
    );
    assert.equal(outcome.status, 'unavailable');
    const row = await runRow(outcome.runId);
    assert.deepEqual(
      { engine_id: row.engine_id, runner_version: row.runner_version, rules_evaluated: row.rules_evaluated },
      { engine_id: 'lane-probe', runner_version: '2.1.0', rules_evaluated: 0 },
    );
    const line = fieldsOf(outcome.runId, 'qc.run.unavailable');
    assert.equal(line['runner'], 'lane-probe');
    assert.equal(line['runnerVersion'], '2.1.0');
    assert.equal(line['ruleRevision'], row.rule_revision);
    assert.equal(line['reason'], 'runner_error');
  });

  it('a result refused by validation is recorded under the runner that produced it', async () => {
    const { input } = await submitVendor();
    const runner = probe('finding-probe', '3', (request) => ({
      ...completed(['PACK-SLOT-MISSING']),
      findings: [
        {
          findingKey: 'not-a-valid-key',
          ruleId: 'PACK-SLOT-MISSING',
          ruleRevision: request.qcRulesRevision,
          trigger: request.trigger,
          scope: { kind: 'slot', slot: 1 },
          severity: 'medium',
          owningLane: 'ai_coe',
          evidence: [],
          measure: null,
          message: { key: 'qc.finding.slot_missing', params: { slot: 1 } },
          provenance: { runner: 'finding-probe', runnerVersion: '3' },
        },
      ],
    }));
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'unavailable');
    const row = await runRow(outcome.runId);
    assert.deepEqual([row.engine_id, row.runner_version, row.rules_evaluated], ['finding-probe', '3', 0]);
  });

  it('with no runner bound the row and line name the unbound runner', async () => {
    const { input } = await submitVendor();
    const outcome = await runAndPersistSubmitQc({ db: db.app, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'unavailable');
    const row = await runRow(outcome.runId);
    assert.deepEqual([row.engine_id, row.runner_version, row.rules_evaluated], ['unbound', 'unbound', 0]);
    const line = fieldsOf(outcome.runId, 'qc.run.unavailable');
    assert.equal(line['runner'], 'unbound');
    assert.equal(line['runnerVersion'], 'unbound');
    assert.equal(line['ruleRevision'], row.rule_revision);
  });

  it('two runs on one version with different rule revisions are told apart from rows and lines alone', async () => {
    const { versionId, input } = await submitVendor();
    const first = await runAndPersistSubmitQc(
      {
        db: db.app,
        runner: probe('deterministic', '0.1.0', () => completed(['PACK-SLOT-MISSING'])),
        now,
        ...diagnostics,
      },
      input,
    );
    // Simulates the state W4-04 makes reachable (an upload run on the draft under an earlier qc_rules revision than
    // the one frozen at submit): the frozen revision of this synthetic version is replaced under the owner role.
    const later = randomUUID();
    await db.raw('owner', async (client) => {
      await client.query('BEGIN');
      await client.query('ALTER TABLE pack_version DISABLE TRIGGER pack_version_frozen');
      await client.query(
        `UPDATE pack_version SET frozen_configuration = frozen_configuration || jsonb_build_object('qc_rules', $2::text) WHERE id = $1`,
        [versionId, later],
      );
      await client.query('ALTER TABLE pack_version ENABLE TRIGGER pack_version_frozen');
      await client.query('COMMIT');
    });
    const second = await runAndPersistSubmitQc(
      {
        db: db.app,
        runner: probe('deterministic', '0.1.0', () =>
          completed(['PACK-SLOT-MISSING', 'PACK-STAGE-MISMATCH']),
        ),
        now,
        ...diagnostics,
      },
      input,
    );
    assert.notEqual(second.runId, first.runId);
    const [a, b] = [await runRow(first.runId), await runRow(second.runId)];
    assert.notEqual(a.rule_revision, b.rule_revision);
    assert.equal(b.rule_revision, later);
    assert.deepEqual([a.rules_evaluated, b.rules_evaluated], [1, 2]);
    for (const [run, row] of [
      [first, a],
      [second, b],
    ] as const) {
      assert.equal(fieldsOf(run.runId, 'qc.run.started')['ruleRevision'], row.rule_revision);
      assert.equal(fieldsOf(run.runId, 'qc.run.completed')['ruleRevision'], row.rule_revision);
    }
  });

  it('desk-health unavailableQc rows carry the runner label', async () => {
    const { input } = await submitVendor();
    const runner = probe('timeout-probe', '4.0.0', () => Promise.reject(new Error('synthetic')));
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    const admin = await signIn(ADMIN);
    const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
    assert.equal(view.statusCode, 200, view.body);
    const rows = view.json<DeskHealthReport>().unavailableQc.filter((row) => row.qcRunId === outcome.runId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.runner, 'timeout-probe');
    assert.equal(rows[0]!.runnerVersion, '4.0.0');
  });
});
