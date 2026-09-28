// W5-10 (W5 plan section 8 "QC input (W5-10)", R-11, R-17): the risk proposal as a soft QC input. The orchestrator
// loads the version's `submit` proposal into the required `QcRunRequest.riskProposal` for submit runs ({ status, tier }),
// `null` for a version without one (submitted before W5) and always `null` on upload and approve-attempt runs; `runKey`
// is unchanged. Under the deterministic runner the metadata rule RISK-TIER-UNKNOWN raises one soft pack finding owned
// by AI/COE when the proposal is `unknown` or `unavailable`, never for high/medium/low or no proposal. AI/COE may
// waive it and another lane may not. The rubric is the seeded SYNTHETIC PLACEHOLDER (D07 open); the rule and its
// severity are provisional until D09. Fixture app on the real Postgres; fixture set slice1-synthetic@1. Synthetic only.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { QcRunRequest, QcRunner } from '@rai/shared/qc/types';
import type { PackDraft } from '@rai/shared/schemas/pack';
import {
  runAndPersistLaneQc,
  runAndPersistSubmitQc,
  runAndPersistUploadQc,
} from '@rai/server/qc/orchestrator';
import { createDeterministicQcRunner } from '@rai/server/qc/deterministic/runner';
import { submitDraft } from '@rai/server/versions/service';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { assertNoLeak } from '../support/log-capture.js';
import {
  app,
  capture,
  caseRevision,
  db,
  diagnostics,
  openFixtureApp,
  signIn,
  submit,
} from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM, pre_launch, non-vendor, slot 1 attached, 3/4 N/A default
const THREE_HIGH = { RQ1: 'public', RQ2: 'automated', RQ4: 'customers' } as const; // High under the placeholder

const START = Date.parse('2026-09-28T03:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now, qcRunner: () => createDeterministicQcRunner({ now }) });

afterEach(() => {
  assertNoLeak(capture);
});

/** The deterministic runner, recording every request the orchestrator hands it. */
function recordingRunner() {
  const inner = createDeterministicQcRunner({ now });
  const requests: QcRunRequest[] = [];
  const runner: QcRunner = {
    identity: inner.identity,
    run(request, signal) {
      requests.push(request);
      return inner.run(request, signal);
    },
  };
  return { runner, requests };
}

async function readDraft(session: FixtureSession, caseId: string): Promise<PackDraft> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: asUser(session),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<PackDraft>();
}

async function saveAnswers(session: FixtureSession, caseId: string, riskAnswers: Record<string, string>) {
  const draft = await readDraft(session, caseId);
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision }, riskAnswers },
  });
  assert.equal(res.statusCode, 200, res.body);
}

async function submitCase(caseId: string) {
  const { version, correlationId } = await submit(await signIn(OWNER), caseId);
  return { caseId, versionId: version.versionId, correlationId };
}

async function proposalOf(versionId: string) {
  const r = await db.owner.execute(
    sql`SELECT status, tier FROM risk_proposal WHERE version_id = ${versionId}`,
  );
  return r.rows[0] as { status: string; tier: string | null } | undefined;
}

async function riskFindings(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT f.id, f.kind, f.slot, f.owning_lane, f.severity, f.message_key, f.message_params, f.evidence,
                 r.trigger
            FROM qc_finding f JOIN qc_run r ON r.id = f.run_id
           WHERE f.version_id = ${versionId} AND f.rule_id = 'RISK-TIER-UNKNOWN' ORDER BY f.created_at, f.id`,
    )
  ).rows as Array<{
    id: string;
    kind: string;
    slot: number | null;
    owning_lane: string;
    severity: string;
    message_key: string;
    message_params: Record<string, unknown>;
    evidence: unknown;
    trigger: string;
  }>;
}

async function submitRulesEvaluated(versionId: string) {
  const r = await db.owner.execute(
    sql`SELECT rules_evaluated FROM qc_run WHERE version_id = ${versionId} AND trigger = 'submit'`,
  );
  return (r.rows[0] as { rules_evaluated: number | null }).rules_evaluated;
}

async function waive(session: FixtureSession, caseId: string, versionId: string, findingId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/findings/${findingId}/dispositions`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: {
      expectedVersion: { versionId, revision: await caseRevision(caseId) },
      kind: 'waived',
      reason: 'synthetic waiver for the W5-10 risk-tier case',
    },
  });
}

/** A version as one submitted before W5 records it: no `risk_proposal` row (the append-only trigger is bypassed). */
async function dropProposal(versionId: string) {
  await db.raw('owner', async (client) => {
    await client.query('BEGIN');
    await client.query('ALTER TABLE risk_proposal DISABLE TRIGGER risk_proposal_append_only');
    await client.query('DELETE FROM risk_proposal WHERE version_id = $1', [versionId]);
    await client.query('ALTER TABLE risk_proposal ENABLE TRIGGER risk_proposal_append_only');
    await client.query('COMMIT');
  });
}

describe(`W5-10 RISK-TIER-UNKNOWN QC input — ${SET}`, () => {
  it('an answerless submit: the request carries the unknown proposal; one soft AI/COE pack finding; four rules evaluated; AI/COE may waive it, the DPO may not', async () => {
    const target = await submitCase(NONVENDOR.caseId);
    assert.deepEqual(await proposalOf(target.versionId), { status: 'proposed', tier: 'unknown' });
    const { runner, requests } = recordingRunner();
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, target);
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(requests[0]!.riskProposal, { status: 'proposed', tier: 'unknown' });
    assert.ok(requests[0]!.rules!.some((r) => r.ruleId === 'RISK-TIER-UNKNOWN'));

    const rows = await riskFindings(target.versionId);
    assert.deepEqual(
      rows.map((r) => ({
        kind: r.kind,
        slot: r.slot,
        lane: r.owning_lane,
        severity: r.severity,
        key: r.message_key,
        params: r.message_params,
        evidence: r.evidence,
        trigger: r.trigger,
      })),
      [
        {
          kind: 'defect',
          slot: null,
          lane: 'ai_coe',
          severity: 'medium',
          key: 'qc.finding.risk_tier_unknown',
          params: { status: 'unknown' },
          evidence: [{ artifact_id: null, content_hash: null, slot: null, locator: { kind: 'absent' } }],
          trigger: 'submit',
        },
      ],
    );
    assert.equal(await submitRulesEvaluated(target.versionId), 4);

    const wrong = await waive(await signIn(DPO), target.caseId, target.versionId, rows[0]!.id);
    assert.equal(wrong.statusCode, 403, wrong.body);
    const right = await waive(await signIn(AI_COE), target.caseId, target.versionId, rows[0]!.id);
    assert.equal(right.statusCode, 201, right.body);
  });

  it('a High proposal (three high answers, slot 1 attached) is carried to QC and raises nothing', async () => {
    await saveAnswers(await signIn(OWNER), NONVENDOR.caseId, { ...THREE_HIGH });
    const target = await submitCase(NONVENDOR.caseId);
    assert.deepEqual(await proposalOf(target.versionId), { status: 'proposed', tier: 'high' });
    const { runner, requests } = recordingRunner();
    await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, target);
    assert.deepEqual(requests[0]!.riskProposal, { status: 'proposed', tier: 'high' });
    assert.deepEqual(await riskFindings(target.versionId), []);
    assert.equal(await submitRulesEvaluated(target.versionId), 4);
  });

  it('an unavailable proposal (engine error at submit) is carried with a null tier and raises the finding with status unavailable', async () => {
    const owner = await signIn(OWNER);
    const draft = await readDraft(owner, NONVENDOR.caseId);
    const principal = findFixtureUser(OWNER)!;
    const correlationId = randomUUID();
    const result = await submitDraft(
      {
        db: db.app,
        now,
        emitter: diagnostics.emitter,
        errors: diagnostics.errors,
        riskEngine: () => {
          throw new Error('injected engine failure');
        },
      },
      {
        actor: {
          subjectId: principal.subjectId,
          displayName: principal.displayName,
          email: principal.email,
          roles: [...principal.roles],
        },
        role: 'owner',
        correlationId,
      },
      NONVENDOR.caseId,
      { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
      randomUUID(),
    );
    assert.equal(result.status, 201);
    const versionId = result.body.versionId;
    assert.deepEqual(await proposalOf(versionId), { status: 'unavailable', tier: null });
    const { runner, requests } = recordingRunner();
    await runAndPersistSubmitQc(
      { db: db.app, runner, now, ...diagnostics },
      { caseId: NONVENDOR.caseId, versionId, correlationId },
    );
    assert.deepEqual(requests[0]!.riskProposal, { status: 'unavailable', tier: null });
    const rows = await riskFindings(versionId);
    assert.deepEqual(
      rows.map((r) => [r.owning_lane, r.message_params]),
      [['ai_coe', { status: 'unavailable' }]],
    );
  });

  it('a version without a proposal (submitted before W5) carries null and raises nothing', async () => {
    const target = await submitCase(NONVENDOR.caseId);
    await dropProposal(target.versionId);
    const { runner, requests } = recordingRunner();
    await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, target);
    assert.equal(requests[0]!.riskProposal, null);
    assert.deepEqual(await riskFindings(target.versionId), []);
    assert.equal(await submitRulesEvaluated(target.versionId), 4, 'the rule is evaluated and raises nothing');
  });

  it('approve-attempt and upload runs carry null, whatever the proposal, and never raise the finding', async () => {
    const draft = await readDraft(await signIn(OWNER), NONVENDOR.caseId);
    const upload = recordingRunner();
    await runAndPersistUploadQc(
      { db: db.app, runner: upload.runner, now, ...diagnostics },
      { caseId: NONVENDOR.caseId, versionId: draft.draftId, slot: 1, correlationId: randomUUID() },
    );
    assert.equal(upload.requests.length, 1);
    assert.equal(upload.requests[0]!.riskProposal, null);

    const target = await submitCase(NONVENDOR.caseId);
    assert.deepEqual(await proposalOf(target.versionId), { status: 'proposed', tier: 'unknown' });
    const lane = recordingRunner();
    for (const l of ['ai_coe', 'dpo', 'it_security'] as const)
      await runAndPersistLaneQc(
        { db: db.app, runner: lane.runner, now, ...diagnostics },
        { ...target, lane: l, correlationId: randomUUID() },
      );
    assert.deepEqual(
      lane.requests.map((r) => [r.trigger, r.lane, r.riskProposal]),
      [
        ['approve_attempt', 'ai_coe', null],
        ['approve_attempt', 'dpo', null],
        ['approve_attempt', 'it_security', null],
      ],
    );
    assert.deepEqual(await riskFindings(target.versionId), []);
  });
});
