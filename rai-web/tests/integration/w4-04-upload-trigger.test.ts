// W4-04 (W4a plan section 5): the W0-07 `upload` QC trigger on the save-draft attach, on the real Postgres, through
// the in-process fixture app (production composition: composeAppDeps binds the trigger in app.ts when a runner is
// bound). One run per changed attach and none on an unchanged save; two attaches in one save run separately; slot 9
// fires no run (register row "D05 refinement (upload slot 5 and 9)"); an upload run has lane NULL and its slot;
// outage findings are owned by the slot's lane (slot 5: AI/COE) and reused per version and owning lane; a run that
// lands after submit appends to the open version, and a carried outage gates Ready (A08); Ready → late, a
// send-back-closed version → nothing written; the save response never waits and the drain waits for the run. The
// runner is a synthetic probe held by a gate where timing matters. Fixture set slice1-synthetic@1.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import type { QcRunRequest, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import type { PackDraft, PackDraftUpdateRequest, SlotNumber } from '@rai/shared/schemas/pack';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { createDeterministicQcRunner } from '@rai/server/qc/deterministic/runner';
import { runAndPersistUploadQc } from '@rai/server/qc/orchestrator';
import { assertNoLeak } from '../support/log-capture.js';
import {
  app,
  capture,
  caseRevision,
  db,
  diagnostics,
  openFixtureApp,
  rebuildApp,
  signIn,
  submit,
} from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SECURITY = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
// HR, non-vendor, classic_ml, v1.0 Sheet3: slots 1, 2, 5, 6, 7, 8 attached; 3 and 4 N/A; 9 not yet. No QC script.
const HR = findFixtureCase('fx-case-hr-dualrole')!;

const START = Date.parse('2026-09-27T06:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

/** A synthetic runner: submit and approve attempts complete clean; upload answers as the test sets, behind a gate. */
class UploadProbe implements QcRunner {
  readonly identity = Object.freeze({ runner: 'upload-probe', runnerVersion: '1.0.0' });
  readonly uploads: QcRunRequest[] = [];
  answer: 'completed' | 'unavailable' = 'completed';
  private gate: Promise<void> | undefined;
  private arrived: Array<() => void> = [];

  /** Holds every upload call until the returned function is called. */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = undefined;
      release();
    };
  }

  /** Resolves once `count` upload calls have reached the runner; fails after 5 s. */
  reached(count: number): Promise<void> {
    if (this.uploads.length >= count) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`expected ${count} upload calls, saw ${this.uploads.length}`)),
        5000,
      );
      const check = () => {
        if (this.uploads.length < count) {
          this.arrived.push(check);
          return;
        }
        clearTimeout(timer);
        resolve();
      };
      this.arrived.push(check);
    });
  }

  async run(request: QcRunRequest): Promise<QcRunResult> {
    const at = now().toISOString();
    if (request.trigger === 'upload') {
      this.uploads.push(request);
      const waiting = this.arrived.splice(0);
      for (const wake of waiting) wake();
      if (this.gate !== undefined) await this.gate;
      if (this.answer === 'unavailable')
        return { status: 'unavailable', reason: 'timeout', detail: null, startedAt: at, finishedAt: at };
    }
    return { status: 'completed', findings: [], rulesEvaluated: [], startedAt: at, finishedAt: at };
  }
}

let probe: UploadProbe;
openFixtureApp({ now, qcRunner: () => (probe = new UploadProbe()) });

afterEach(() => {
  assertNoLeak(capture);
});

interface RunRow {
  id: string;
  version_id: string;
  trigger: string;
  slot: number | null;
  lane: string | null;
  engine_id: string;
  status: string;
  unavailable_reason: string | null;
  rules_evaluated: number | null;
  correlation_id: string;
}

async function uploadRuns(caseId: string): Promise<RunRow[]> {
  return (
    await db.owner.execute(
      sql`SELECT r.id, r.version_id, r.trigger, r.slot, r.lane, r.engine_id, r.status, r.unavailable_reason,
                 r.rules_evaluated, r.correlation_id
            FROM qc_run r JOIN pack_version v ON v.id = r.version_id
           WHERE v.case_id = ${caseId} AND r.trigger = 'upload' ORDER BY r.requested_at, r.id`,
    )
  ).rows as unknown as RunRow[];
}

async function outageFindings(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT f.id, f.run_id, f.owning_lane, f.slot, r.trigger
            FROM qc_finding f JOIN qc_run r ON r.id = f.run_id
           WHERE f.version_id = ${versionId} AND f.kind = 'unavailable' ORDER BY f.created_at, f.id`,
    )
  ).rows as Array<{ id: string; run_id: string; owning_lane: string; slot: number | null; trigger: string }>;
}

/** Polls until the case has `count` upload runs (a background run lands after the save's response). */
async function untilUploadRuns(caseId: string, count: number): Promise<RunRow[]> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const rows = await uploadRuns(caseId);
    if (rows.length >= count) return rows;
    if (Date.now() > deadline) assert.fail(`expected ${count} upload runs, saw ${rows.length}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Waits for every tracked background task (drain), then rebuilds the app on the same database. */
async function settle() {
  await diagnostics.drain.close();
  await rebuildApp({ qcRunner: probe });
}

async function draft(session: FixtureSession, caseId: string): Promise<PackDraft> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: asUser(session),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<PackDraft>();
}

/** The artifact attached to a slot of the case's open draft. */
function artifactOn(current: PackDraft, slot: SlotNumber): string {
  const state = current.slots[slot];
  assert.equal(state?.state, 'attached', `slot ${slot} is attached`);
  return (state as { artifactId: string }).artifactId;
}

async function attach(session: FixtureSession, caseId: string, slots: Partial<Record<SlotNumber, string>>) {
  const current = await draft(session, caseId);
  const body: PackDraftUpdateRequest = {
    expectedVersion: { versionId: current.draftId, revision: current.draftRevision },
    slots: Object.fromEntries(
      Object.entries(slots).map(([slot, artifactId]) => [slot, { state: 'attached', artifactId }]),
    ),
  };
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: body,
  });
  assert.equal(res.statusCode, 200, res.body);
  return { draftId: current.draftId, correlationId: String(res.headers['x-correlation-id']) };
}

async function laneQc(session: FixtureSession, caseId: string, versionId: string, lane: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision: await caseRevision(caseId) } },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<LaneQcRunResponse>();
}

async function approve(session: FixtureSession, caseId: string, versionId: string, lane: string) {
  const run = await laneQc(session, caseId, versionId, lane);
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/approve`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: { expectedVersion: { versionId, revision: await caseRevision(caseId) }, qcRunId: run.runId },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<LaneDecisionResponse>();
}

async function approveAll(caseId: string, versionId: string) {
  await approve(await signIn(DPO), caseId, versionId, 'dpo');
  await approve(await signIn(AI_COE), caseId, versionId, 'ai_coe');
  return approve(await signIn(IT_SECURITY), caseId, versionId, 'it_security');
}

async function readyAt(versionId: string): Promise<Date | null> {
  return (
    (await db.owner.execute(sql`SELECT ready_at FROM pack_version WHERE id = ${versionId}`)).rows[0] as {
      ready_at: Date | null;
    }
  ).ready_at;
}

describe(`W4-04 upload trigger — ${SET}`, () => {
  it('one run per changed attach: lane NULL, slot recorded, the save correlation, the probe named; none on an unchanged save', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const { draftId, correlationId } = await attach(owner, HR.caseId, { 1: artifactOn(before, 2) });
    const [run] = await untilUploadRuns(HR.caseId, 1);
    assert.deepEqual(
      {
        version: run!.version_id,
        slot: run!.slot,
        lane: run!.lane,
        engine: run!.engine_id,
        status: run!.status,
        correlation: run!.correlation_id,
      },
      {
        version: draftId,
        slot: 1,
        lane: null,
        engine: 'upload-probe',
        status: 'completed',
        correlation: correlationId,
      },
    );
    // W0-07 3.3: the request carries the one uploaded slot and its artifact, on the draft (isDraft).
    const request = probe.uploads[0]!;
    assert.deepEqual(
      request.slots.map((s) => s.slot),
      [1],
    );
    assert.deepEqual(
      request.artifacts.map((a) => [a.slot, a.artifactId]),
      [[1, artifactOn(before, 2)]],
    );
    assert.equal(request.version.isDraft, true);
    assert.equal(request.lane, null);
    assert.equal(request.laneMappingVersion, 'lane-mapping/v1');
    assert.equal(request.checklistTemplateVersion, 'v1.0 Sheet3');

    // The same reference saved again is no change: no second run.
    const after = await draft(owner, HR.caseId);
    await attach(owner, HR.caseId, { 1: artifactOn(after, 1) });
    await settle();
    assert.equal((await uploadRuns(HR.caseId)).length, 1);
    assert.equal(probe.uploads.length, 1);
  });

  it('two attaches in one save run separately (the in-flight key is the runKey, not the version)', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const release = probe.hold();
    await attach(owner, HR.caseId, { 1: artifactOn(before, 2), 2: artifactOn(before, 1) });
    await probe.reached(2);
    assert.notEqual(probe.uploads[0]!.runKey, probe.uploads[1]!.runKey);
    release();
    const runs = await untilUploadRuns(HR.caseId, 2);
    assert.deepEqual(runs.map((r) => r.slot).sort(), [1, 2]);
  });

  it('slot 9 fires no run and writes no qc_run row (register row "D05 refinement (upload slot 5 and 9)")', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    await attach(owner, HR.caseId, { 9: artifactOn(before, 1) });
    await settle();
    assert.equal(probe.uploads.length, 0);
    const rows = (await db.owner.execute(sql`SELECT count(*)::int AS n FROM qc_run WHERE slot = 9`))
      .rows[0] as { n: number };
    assert.equal(rows.n, 0);
    assert.deepEqual(await uploadRuns(HR.caseId), []);
  });

  it('the save-draft response never waits for QC; the drain waits for the run before the app closes', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const release = probe.hold();
    await attach(owner, HR.caseId, { 6: artifactOn(before, 7) }); // 200 while the run is held
    await probe.reached(1);
    assert.deepEqual(await uploadRuns(HR.caseId), [], 'nothing recorded while the runner is held');

    let closed = false;
    const closing = diagnostics.drain.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(closed, false, 'the drain is still waiting for the upload run');
    release();
    await closing;
    const [run] = await uploadRuns(HR.caseId);
    assert.equal(run?.slot, 6);
    assert.equal(run?.status, 'completed');
    await rebuildApp({ qcRunner: probe });
  });

  it('outages: the slot lane owns the finding, slot 5 is AI/COE; reused per version and owning lane', async () => {
    const owner = await signIn(OWNER);
    probe.answer = 'unavailable';
    const before = await draft(owner, HR.caseId);
    // Two DPO-slot outages, one on slot 5 and one IT/Security slot: three findings, four runs.
    await attach(owner, HR.caseId, { 2: artifactOn(before, 1) }); // dpo
    await untilUploadRuns(HR.caseId, 1);
    await attach(owner, HR.caseId, { 2: artifactOn(before, 5) }); // dpo again: reuse
    await untilUploadRuns(HR.caseId, 2);
    await attach(owner, HR.caseId, { 5: artifactOn(before, 6) }); // slot 5: AI/COE
    await untilUploadRuns(HR.caseId, 3);
    await attach(owner, HR.caseId, { 7: artifactOn(before, 8) }); // it_security
    const runs = await untilUploadRuns(HR.caseId, 4);
    assert.ok(runs.every((r) => r.status === 'unavailable' && r.unavailable_reason === 'timeout'));
    assert.ok(runs.every((r) => r.lane === null && r.rules_evaluated === 0));
    const findings = await outageFindings(before.draftId);
    assert.deepEqual(
      findings.map((f) => [f.owning_lane, f.trigger, f.slot]),
      [
        ['dpo', 'upload', null],
        ['ai_coe', 'upload', null],
        ['it_security', 'upload', null],
      ],
    );
    // The DPO's second outage appended a run row and reused the open finding.
    assert.equal(findings[0]!.run_id, runs[0]!.id);

    // Desk health names the owning lane of an unavailable upload run the same way.
    const admin = await signIn(ADMIN);
    const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
    assert.equal(view.statusCode, 200, view.body);
    const lanes = new Map(
      view
        .json<DeskHealthReport>()
        .unavailableQc.filter((row) => row.trigger === 'upload')
        .map((row) => [row.qcRunId, row.owningLane]),
    );
    assert.deepEqual(
      runs.map((r) => lanes.get(r.id)),
      ['dpo', 'dpo', 'ai_coe', 'it_security'],
    );
  });

  it('a run that completes after submit appends to the submitted, still open version', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const release = probe.hold();
    const { draftId } = await attach(owner, HR.caseId, { 8: artifactOn(before, 6) });
    await probe.reached(1);
    const { version } = await submit(owner, HR.caseId);
    assert.equal(version.versionId, draftId, 'the draft row is the row that becomes the version');
    release();
    const [run] = await untilUploadRuns(HR.caseId, 1);
    assert.equal(run!.version_id, version.versionId);
    assert.equal(run!.status, 'completed');
  });

  it('A08: an upload outage carried into the submitted version gates Ready until its owning lane dispositions it', async () => {
    const owner = await signIn(OWNER);
    probe.answer = 'unavailable';
    const before = await draft(owner, HR.caseId);
    await attach(owner, HR.caseId, { 2: artifactOn(before, 1) }); // DPO slot
    await untilUploadRuns(HR.caseId, 1);
    probe.answer = 'completed';
    const { version } = await submit(owner, HR.caseId);
    const [outage] = await outageFindings(version.versionId);
    assert.equal(outage?.owning_lane, 'dpo');

    const last = await approveAll(HR.caseId, version.versionId);
    assert.equal(last.ready, false);
    assert.equal(await readyAt(version.versionId), null);

    const dpo = await signIn(DPO);
    const waived = await app.inject({
      method: 'POST',
      url: `/api/cases/${HR.caseId}/findings/${outage.id}/dispositions`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(dpo) },
      payload: {
        expectedVersion: { versionId: version.versionId, revision: await caseRevision(HR.caseId) },
        kind: 'waived',
        reason: 'synthetic waiver for the W4-04 carried upload outage',
      },
    });
    assert.equal(waived.statusCode, 201, waived.body);
    assert.ok((await readyAt(version.versionId)) != null, 'Ready follows the disposition');
  });

  it('after Ready the run is late: nothing written, one qc.run.late line and a late-result row', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const release = probe.hold();
    await attach(owner, HR.caseId, { 1: artifactOn(before, 2) });
    await probe.reached(1);
    const { version } = await submit(owner, HR.caseId);
    const last = await approveAll(HR.caseId, version.versionId);
    assert.equal(last.ready, true);
    const readyBefore = await readyAt(version.versionId);
    release();
    await settle();
    assert.deepEqual(await uploadRuns(HR.caseId), []);
    assert.deepEqual(await outageFindings(version.versionId), []);
    assert.deepEqual(await readyAt(version.versionId), readyBefore);
    const late = (
      await db.owner.execute(
        sql`SELECT trigger, lane, status FROM qc_late_result WHERE version_id = ${version.versionId}`,
      )
    ).rows;
    assert.deepEqual(late, [{ trigger: 'upload', lane: null, status: 'completed' }]);
    const lines = capture.lines().filter((l) => l.event === 'qc.run.late');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.fields?.['trigger'], 'upload');
    assert.equal(
      capture.lines().filter((l) => l.event === 'error.captured').length,
      0,
      'a late run is not an internal error',
    );
  });

  it('a version closed by a send-back takes no upload evidence: version_closed, nothing written anywhere', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const release = probe.hold();
    await attach(owner, HR.caseId, { 1: artifactOn(before, 2) });
    await probe.reached(1);
    const { version } = await submit(owner, HR.caseId);
    const it_ = await signIn(IT_SECURITY);
    const sentBack = await app.inject({
      method: 'POST',
      url: `/api/cases/${HR.caseId}/versions/${version.versionId}/lanes/it_security/send-back`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(it_) },
      payload: {
        expectedVersion: { versionId: version.versionId, revision: await caseRevision(HR.caseId) },
        feedback: { items: [{ slot: 6, deficiency: 'synthetic send-back for the W4-04 closed case' }] },
      },
    });
    assert.equal(sentBack.statusCode, 201, sentBack.body);
    release();
    await settle();
    assert.deepEqual(await uploadRuns(HR.caseId), []);
    const late = (
      await db.owner.execute(
        sql`SELECT count(*)::int AS n FROM qc_late_result WHERE version_id = ${version.versionId}`,
      )
    ).rows[0] as { n: number };
    assert.equal(late.n, 0);
    assert.equal(capture.lines().filter((l) => l.event === 'error.captured').length, 0);
  });

  it('with the deterministic runner a completed upload run evaluates 0 rules and stores no finding', async () => {
    const owner = await signIn(OWNER);
    const before = await draft(owner, HR.caseId);
    const current = await attach(owner, HR.caseId, { 6: artifactOn(before, 7) });
    await settle(); // the probe's own run for this attach
    const outcome = await runAndPersistUploadQc(
      { db: db.app, runner: createDeterministicQcRunner({ now }), now, ...diagnostics },
      { caseId: HR.caseId, versionId: current.draftId, slot: 6, correlationId: current.correlationId },
    );
    assert.ok(outcome !== undefined);
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(outcome.findings, []);
    const runs = await uploadRuns(HR.caseId);
    const run = runs.find((r) => r.id === outcome.runId)!;
    assert.deepEqual(
      { engine: run.engine_id, rulesEvaluated: run.rules_evaluated, slot: run.slot, lane: run.lane },
      { engine: 'deterministic', rulesEvaluated: 0, slot: 6, lane: null },
    );
    const findings = (
      await db.owner.execute(sql`SELECT count(*)::int AS n FROM qc_finding WHERE run_id = ${outcome.runId}`)
    ).rows[0] as { n: number };
    assert.equal(findings.n, 0);
  });
});
