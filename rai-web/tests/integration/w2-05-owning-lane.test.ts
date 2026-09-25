// W2-05 Done when, the cases that waited for W0-06 section 7.3 (recorded 2026-09-25, #35): a waiver by a
// non-owning lane is forbidden on a slot-5 and on a pack-level finding, each carrying the lane the recorded rule
// assigns; a runner defect on slot 9 or outside the approving lane fails the run closed; an unavailable result is
// recorded as the QC-UNAVAILABLE finding of W0-07 3.6, owned per 7.3 part 4, once per open scope; an open
// outage finding blocks Ready until its lane dispositions it (A08); nothing is carried to N+1 (7.3 part 5).
// Submit-triggered QC is unbound in the fixture app, so submit runs are driven by hand as w2-05-dispositions does.
// Fixture set slice1-synthetic@1.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertNoLeak } from '../support/log-capture.js';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import type {
  LaneDecisionResponse,
  LaneQcRunResponse,
  VersionFindingsResponse,
} from '@rai/shared/schemas/review';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import type { QcFinding, QcRunRequest, QcRunResult, QcRunner, VersionRef } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { auditStore } from '@rai/server/audit/store';
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

const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SECURITY = 'fx-user-it-security';
const MISSING_SLOT = findFixtureCase('fx-case-missing-slot')!; // scripts a pack-level and a slot-5 finding
const HR = findFixtureCase('fx-case-hr-dualrole')!; // no QC script: approvals raise no other finding

const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));

let runner: ScriptedQcRunner;
const START = Date.parse('2026-09-25T06:01:00Z');
let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
openFixtureApp({
  now,
  qcRunner: () =>
    (runner = new ScriptedQcRunner({
      fixtureCaseIdOf: (version: VersionRef) => fixtureCaseIdByRowId.get(version.caseId),
      now,
    })),
});

afterEach(() => {
  assertNoLeak(capture);
});

const submitOk = async (session: FixtureSession, caseId: string) => (await submit(session, caseId)).version;

/** The suite's scripted runner, bound by hand for submit runs (the fixture app leaves submit QC unbound). */
const deps = () => ({ db: db.app, runner, now, ...diagnostics });

async function runLaneQc(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
): Promise<{ statusCode: number; body: LaneQcRunResponse | ErrorResponse }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision } },
  });
  return { statusCode: res.statusCode, body: res.json() };
}

async function laneQcRunId(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
): Promise<LaneQcRunResponse> {
  const qc = await runLaneQc(session, caseId, versionId, lane, await caseRevision(caseId));
  assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
  return qc.body as LaneQcRunResponse;
}

async function waive(session: FixtureSession, caseId: string, versionId: string, findingId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/findings/${findingId}/dispositions`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: {
      expectedVersion: { versionId, revision: await caseRevision(caseId) },
      kind: 'waived',
      reason: 'synthetic waiver for the W2-05 owning-lane case',
    },
  });
}

async function approve(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  qcRunId: string | null,
) {
  assert.ok(qcRunId, 'the lane-QC run body names its run');
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/approve`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: { expectedVersion: { versionId, revision: await caseRevision(caseId) }, qcRunId },
  });
}

async function sendBack(session: FixtureSession, caseId: string, versionId: string, lane: string) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/send-back`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: {
      expectedVersion: { versionId, revision: await caseRevision(caseId) },
      feedback: { items: [{ slot: 1, deficiency: 'synthetic send-back for the carry-over case' }] },
    },
  });
}

async function findingRows(versionId: string) {
  const rows = await db.owner.execute(
    sql`SELECT id, kind, slot, rule_id, owning_lane, severity, message_key FROM qc_finding WHERE version_id = ${versionId} ORDER BY created_at, id`,
  );
  return rows.rows as Array<{
    id: string;
    kind: string;
    slot: number | null;
    rule_id: string;
    owning_lane: string;
    severity: string;
    message_key: string;
  }>;
}

/** A completed run carrying one finding of the given scope and lane; the boundary decides whether it is valid. */
function probeRunner(
  scope: { kind: 'slot'; slot: 1 | 5 | 9 } | { kind: 'pack' },
  owningLane: 'ai_coe' | 'dpo' | 'it_security',
): QcRunner {
  return {
    identity: { runner: 'finding-probe', runnerVersion: '1' },
    run: (request: QcRunRequest): Promise<QcRunResult> => {
      const finding: QcFinding = {
        findingKey: findingKeyOf('PACK-SLOT-MISSING', scope),
        ruleId: 'PACK-SLOT-MISSING',
        ruleRevision: request.qcRulesRevision,
        trigger: request.trigger,
        scope,
        severity: 'medium',
        owningLane,
        evidence: [
          {
            artifactId: null,
            contentHash: null,
            slot: scope.kind === 'pack' ? null : scope.slot,
            locator: { kind: 'absent' },
          },
        ],
        measure: null,
        message: {
          key: 'qc.finding.pack_slot_missing',
          params: { slot: scope.kind === 'pack' ? 0 : scope.slot },
        },
        provenance: { runner: 'finding-probe', runnerVersion: '1' },
      };
      return Promise.resolve({
        status: 'completed',
        rulesEvaluated: ['PACK-SLOT-MISSING'],
        findings: [finding],
        startedAt: now().toISOString(),
        finishedAt: now().toISOString(),
      });
    },
  };
}

describe(`W2-05 owning lane (W0-06 7.3 recorded 2026-09-25) — ${SET}`, () => {
  it("pack-level finding is AI/COE's: submit stores PACK-STAGE-MISMATCH with slot null; DPO waiver 403, AI/COE waiver 201", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, MISSING_SLOT.caseId);
    const outcome = await runAndPersistSubmitQc(deps(), {
      caseId: MISSING_SLOT.caseId,
      versionId: version.versionId,
      correlationId: randomUUID(),
    });
    assert.equal(outcome.status, 'completed');
    const pack = (await findingRows(version.versionId)).find((r) => r.rule_id === 'PACK-STAGE-MISMATCH');
    assert.ok(pack, 'pack-level finding stored');
    assert.equal(pack.slot, null);
    assert.equal(pack.kind, 'defect');
    assert.equal(pack.owning_lane, 'ai_coe');
    assert.equal(pack.message_key, 'qc.finding.pack_stage_mismatch');
    assert.ok(
      outcome.findings.some((f) => f.findingId === pack.id && f.slot === null && f.owningLane === 'ai_coe'),
    );

    const wrong = await waive(await signIn(DPO), MISSING_SLOT.caseId, version.versionId, pack.id);
    assert.equal(wrong.statusCode, 403, wrong.body);
    const right = await waive(await signIn(AI_COE), MISSING_SLOT.caseId, version.versionId, pack.id);
    assert.equal(right.statusCode, 201, right.body);
  });

  it('slot-5 finding belongs to the lane whose rule raised it: DPO lane QC stores it owned by dpo; IT/Security waiver 403, DPO waiver 201', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, MISSING_SLOT.caseId);
    const dpo = await signIn(DPO);
    const body = await laneQcRunId(dpo, MISSING_SLOT.caseId, version.versionId, 'dpo');
    assert.equal(body.status, 'completed');
    const slot5 = body.findings.find((f) => f.slot === 5);
    assert.ok(slot5, 'slot-5 finding in the run body');
    assert.equal(slot5.ruleId, 'ACC-METRIC-CITED');
    assert.equal(slot5.owningLane, 'dpo');
    const row = (await findingRows(version.versionId)).find((r) => r.id === slot5.findingId);
    assert.deepEqual(
      { slot: row?.slot, owning_lane: row?.owning_lane, kind: row?.kind },
      { slot: 5, owning_lane: 'dpo', kind: 'defect' },
    );

    const wrong = await waive(
      await signIn(IT_SECURITY),
      MISSING_SLOT.caseId,
      version.versionId,
      slot5.findingId,
    );
    assert.equal(wrong.statusCode, 403, wrong.body);
    const right = await waive(dpo, MISSING_SLOT.caseId, version.versionId, slot5.findingId);
    assert.equal(right.statusCode, 201, right.body);
  });

  it('a slot-9 defect from the runner fails the submit run closed: unavailable runner_error, and the QC-UNAVAILABLE finding is stored for AI/COE', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, HR.caseId);
    const correlationId = randomUUID();
    const outcome = await runAndPersistSubmitQc(
      { db: db.app, runner: probeRunner({ kind: 'slot', slot: 9 }, 'ai_coe'), now, ...diagnostics },
      { caseId: HR.caseId, versionId: version.versionId, correlationId },
    );
    assert.equal(outcome.status, 'unavailable');
    assert.equal(outcome.reason, 'runner_error');
    const rows = await findingRows(version.versionId);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      {
        kind: rows[0]!.kind,
        slot: rows[0]!.slot,
        rule_id: rows[0]!.rule_id,
        owning_lane: rows[0]!.owning_lane,
        severity: rows[0]!.severity,
      },
      { kind: 'unavailable', slot: null, rule_id: 'QC-UNAVAILABLE', owning_lane: 'ai_coe', severity: 'high' },
    );
    assert.equal(outcome.findings[0]?.findingId, rows[0]!.id);
    const line = capture
      .lines()
      .find((l) => l.event === 'qc.run.unavailable' && l.correlationId === correlationId);
    assert.equal(line?.fields?.reason, 'runner_error');
  });

  it('a finding outside the approving lane fails the approve-attempt run closed; the outage finding is owned by that lane', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, HR.caseId);
    const outcome = await runAndPersistLaneQc(
      { db: db.app, runner: probeRunner({ kind: 'slot', slot: 5 }, 'it_security'), now, ...diagnostics },
      { caseId: HR.caseId, versionId: version.versionId, lane: 'dpo', correlationId: randomUUID() },
    );
    assert.equal(outcome.status, 'unavailable');
    assert.equal(outcome.reason, 'runner_error');
    const rows = await findingRows(version.versionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.rule_id, 'QC-UNAVAILABLE');
    assert.equal(rows[0]!.owning_lane, 'dpo');
  });

  it('dedup: two outages on one lane before anyone acts store two runs and one open finding; both run bodies name it', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, HR.caseId);
    const it_ = await signIn(IT_SECURITY);
    runner.simulateError('runner_error');
    const first = await laneQcRunId(it_, HR.caseId, version.versionId, 'it_security');
    runner.simulateError('runner_error');
    const second = await laneQcRunId(it_, HR.caseId, version.versionId, 'it_security');
    assert.equal(first.status, 'unavailable');
    assert.equal(second.status, 'unavailable');
    assert.notEqual(second.runId, first.runId, 'an unavailable approve attempt is retried, not replayed');
    assert.equal(second.findings[0]!.findingId, first.findings[0]!.findingId);
    const runs = await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id = ${version.versionId}`);
    assert.equal(runs.rows.length, 2);
    const rows = await findingRows(version.versionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.owning_lane, 'it_security');
  });

  it('after the owning lane waives the outage finding, the next outage appends a new open finding', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, HR.caseId);
    const it_ = await signIn(IT_SECURITY);
    runner.simulateError('runner_error');
    const first = await laneQcRunId(it_, HR.caseId, version.versionId, 'it_security');
    const waived = await waive(it_, HR.caseId, version.versionId, first.findings[0]!.findingId);
    assert.equal(waived.statusCode, 201, waived.body);
    runner.simulateError('runner_error');
    const next = await laneQcRunId(it_, HR.caseId, version.versionId, 'it_security');
    assert.notEqual(next.findings[0]!.findingId, first.findings[0]!.findingId);
    assert.equal((await findingRows(version.versionId)).length, 2);
  });

  it('not_configured (no runner bound): submit stores one QC-UNAVAILABLE finding owned by ai_coe; the replay returns the same findingId', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, HR.caseId);
    const input = { caseId: HR.caseId, versionId: version.versionId, correlationId: randomUUID() };
    const unbound = { db: db.app, now, ...diagnostics };
    const first = await runAndPersistSubmitQc(unbound, input);
    const replay = await runAndPersistSubmitQc(unbound, { ...input, correlationId: randomUUID() });
    assert.equal(first.status, 'unavailable');
    assert.equal(first.reason, 'not_configured');
    assert.equal(replay.runId, first.runId);
    assert.equal(replay.findings[0]!.findingId, first.findings[0]!.findingId);
    const rows = await findingRows(version.versionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.owning_lane, 'ai_coe');
  });

  it("A08: an open QC-UNAVAILABLE finding blocks Ready after three approvals; the owning lane's waiver releases it", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, HR.caseId);
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const it_ = await signIn(IT_SECURITY);
    runner.simulateError('runner_error');
    const outage = await laneQcRunId(dpo, HR.caseId, version.versionId, 'dpo');
    assert.equal(outage.status, 'unavailable');
    const outageFindingId = outage.findings[0]!.findingId;

    // W0-06 4.4: the reviewer may decide after seeing the unavailable run; it never counts as clean.
    const r1 = await approve(dpo, HR.caseId, version.versionId, 'dpo', outage.runId);
    assert.equal(r1.statusCode, 201, r1.body);
    const aiRun = await laneQcRunId(ai, HR.caseId, version.versionId, 'ai_coe');
    const r2 = await approve(ai, HR.caseId, version.versionId, 'ai_coe', aiRun.runId);
    assert.equal(r2.statusCode, 201, r2.body);
    const itRun = await laneQcRunId(it_, HR.caseId, version.versionId, 'it_security');
    const r3 = await approve(it_, HR.caseId, version.versionId, 'it_security', itRun.runId);
    assert.equal(r3.statusCode, 201, r3.body);
    assert.equal(r3.json<LaneDecisionResponse>().ready, false);
    const notReady = (
      await db.owner.execute(sql`SELECT ready_at FROM pack_version WHERE id = ${version.versionId}`)
    ).rows[0] as { ready_at: Date | null };
    assert.equal(notReady.ready_at, null);

    const waived = await waive(dpo, HR.caseId, version.versionId, outageFindingId);
    assert.equal(waived.statusCode, 201, waived.body);
    const ready = (
      await db.owner.execute(sql`SELECT ready_at FROM pack_version WHERE id = ${version.versionId}`)
    ).rows[0] as { ready_at: Date | null };
    assert.ok(ready.ready_at != null, 'Ready follows the disposition');
    const readyAudit = (await auditStore.read(db.owner, { caseId: HR.caseId })).find(
      (e) => e.action === 'case.ready_for_launch',
    );
    assert.equal(
      (readyAudit?.targetRef as { triggered_by_event?: string })?.triggered_by_event,
      'disposition.recorded',
    );
  });

  it('7.3 part 5: the QC-UNAVAILABLE finding on N is not carried to N+1 and stays readable on N', async () => {
    const owner = await signIn(OWNER_A);
    const n = await submitOk(owner, HR.caseId);
    const outage = await runAndPersistSubmitQc(
      { db: db.app, runner: probeRunner({ kind: 'slot', slot: 9 }, 'ai_coe'), now, ...diagnostics },
      { caseId: HR.caseId, versionId: n.versionId, correlationId: randomUUID() },
    );
    assert.equal(outage.status, 'unavailable');
    const ai = await signIn(AI_COE);
    await laneQcRunId(ai, HR.caseId, n.versionId, 'ai_coe');
    const sent = await sendBack(ai, HR.caseId, n.versionId, 'ai_coe');
    assert.equal(sent.statusCode, 201, sent.body);
    const n1 = await submitOk(owner, HR.caseId);
    assert.notEqual(n1.versionId, n.versionId);
    const healthy = await runAndPersistSubmitQc(deps(), {
      caseId: HR.caseId,
      versionId: n1.versionId,
      correlationId: randomUUID(),
    });
    assert.equal(healthy.status, 'completed');
    assert.equal((await findingRows(n1.versionId)).length, 0, 'nothing carried to N+1');

    const onN = await app.inject({
      method: 'GET',
      url: `/api/cases/${HR.caseId}/versions/${n.versionId}/findings`,
      headers: asUser(owner),
    });
    assert.equal(onN.statusCode, 200, onN.body);
    const listed = onN.json<VersionFindingsResponse>().findings;
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.ruleId, 'QC-UNAVAILABLE');
    assert.equal(listed[0]!.latestDisposition, null);
  });
});
