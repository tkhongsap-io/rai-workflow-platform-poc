// W2-05 Done when (A09 / D05 / W0-06 §7.4 single-lane only): synthetic single-lane defect from the W1-10
// substitute can be dispositioned append-only. Reason required for waived/N/A; non-owning lane 403; owner's
// fixed stays proposed until owning lane confirms; finding bytes unchanged after disposition; second event
// appends; unavailable stores qc_run status=unavailable plus the QC-UNAVAILABLE finding owned per W0-06 7.3 as
// recorded on 2026-09-25 (#35; the category cases are in w2-05-owning-lane.test.ts). Ready is W2-06. Fixture set
// slice1-synthetic@1.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertNoLeak } from '../support/log-capture.js';
import { sql } from 'drizzle-orm';
import { StaleVersionError, type ErrorResponse } from '@rai/shared/errors';
import type { DispositionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import type { QcRunRequest, QcRunResult, QcRunner, VersionRef } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { createDb } from '@rai/server/db/client';
import { recordDisposition } from '@rai/server/findings/service';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
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

const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SECURITY = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
const SPOC_CM = 'fx-user-spoc-cm';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));

let runner: ScriptedQcRunner;
const START = Date.parse('2026-09-22T06:01:00Z');
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

/** Submits, and checks the audit row and the request log carry the response's correlation id. */
async function submitOk(session: FixtureSession, caseId: string) {
  const { version, correlationId } = await submit(session, caseId);
  const audit = await db.owner.execute(
    sql`SELECT id, correlation_id FROM audit_event WHERE action = 'version.submitted' AND target_version_id = ${version.versionId}`,
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]!.correlation_id, correlationId);
  assert.ok(
    capture
      .lines()
      .some((line) => line.event === 'request.completed' && line.correlationId === correlationId),
  );
  return version;
}

async function runLaneQc(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
): Promise<{ statusCode: number; body: LaneQcRunResponse | ErrorResponse; correlationId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision } },
  });
  return {
    statusCode: res.statusCode,
    body: res.json(),
    correlationId: String(res.headers['x-correlation-id']),
  };
}

function dispose(
  session: FixtureSession,
  caseId: string,
  findingId: string,
  body: unknown,
  key: string = randomUUID(),
) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/findings/${findingId}/dispositions`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: body as object,
  });
}

/** A completed run with one PACK-SLOT-MISSING finding; the slot/lane pair decides whether it validates. */
function slotMissingResult(
  request: QcRunRequest,
  slot: 1 | 2 | 5,
  owningLane: 'ai_coe' | 'dpo',
): QcRunResult {
  const scope = { kind: 'slot', slot } as const;
  return {
    status: 'completed',
    rulesEvaluated: ['PACK-SLOT-MISSING'],
    findings: [
      {
        findingKey: findingKeyOf('PACK-SLOT-MISSING', scope),
        ruleId: 'PACK-SLOT-MISSING',
        ruleRevision: request.qcRulesRevision,
        trigger: request.trigger,
        scope,
        severity: 'medium',
        owningLane,
        evidence: [{ artifactId: null, contentHash: null, slot, locator: { kind: 'absent' } }],
        measure: null,
        message: { key: 'qc.finding.slot_missing', params: { slot } },
        provenance: { runner: 'finding-probe', runnerVersion: '1' },
      },
    ],
    startedAt: now().toISOString(),
    finishedAt: now().toISOString(),
  };
}

describe(`W2-05 findings and dispositions — ${SET}`, () => {
  it('submit API coalesces concurrent calls and replays one unavailable outcome with original audit correlation', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const submitted = await db.owner.execute(
      sql`SELECT correlation_id FROM audit_event WHERE action = 'version.submitted' AND target_version_id = ${version.versionId}`,
    );
    const correlationId = String(submitted.rows[0]!.correlation_id);
    const input = { caseId: VENDOR.caseId, versionId: version.versionId, correlationId };
    let calls = 0;
    const runner: QcRunner = {
      identity: { runner: 'submit-probe', runnerVersion: '1' },
      run(request) {
        calls++;
        assert.equal(request.trigger, 'submit');
        assert.equal(request.lane, null);
        assert.equal(request.correlationId, correlationId);
        return Promise.resolve({
          status: 'unavailable',
          reason: 'timeout',
          detail: null,
          startedAt: now().toISOString(),
          finishedAt: now().toISOString(),
        });
      },
    };
    const deps = { db: db.app, runner, now, ...diagnostics };
    const [first, concurrent] = await Promise.all([
      runAndPersistSubmitQc(deps, input),
      runAndPersistSubmitQc(deps, input),
    ]);
    assert.deepEqual(concurrent, first);
    assert.deepEqual(await runAndPersistSubmitQc(deps, input), first);
    assert.equal(calls, 1);
    assert.equal(first.status, 'unavailable');
    // W0-07 3.6 / W0-06 7.3 (2026-09-25): an unavailable submit run stores its finding, owned by the pack owner.
    assert.equal(first.findings.length, 1);
    assert.equal(first.findings[0]!.ruleId, 'QC-UNAVAILABLE');
    assert.equal(first.findings[0]!.slot, null);
    assert.equal(first.findings[0]!.owningLane, 'ai_coe');
    const rows = await db.owner.execute(
      sql`SELECT trigger, lane, unavailable_reason, correlation_id FROM qc_run WHERE id = ${first.runId}`,
    );
    assert.deepEqual(rows.rows, [
      { trigger: 'submit', lane: null, unavailable_reason: 'timeout', correlation_id: correlationId },
    ]);
    const audits = await db.owner.execute(
      sql`SELECT correlation_id FROM audit_event WHERE action = 'qc.run_recorded' AND target_ref->>'run_id' = ${first.runId}`,
    );
    assert.deepEqual(audits.rows, [{ correlation_id: correlationId }]);
    const logs = capture.lines().filter((line) => line.fields?.qcRunId === first.runId);
    assert.equal(logs.filter((line) => line.event === 'qc.run.unavailable').length, 1);
    assert.equal(logs.filter((line) => line.event === 'error.captured').length, 1);
    assert.ok(logs.every((line) => line.correlationId === correlationId));
  });

  it('lane QC coalesces concurrent calls for one version and lane into one unavailable run', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    let calls = 0;
    const unavailable: QcRunner = {
      identity: { runner: 'lane-probe', runnerVersion: '1' },
      run() {
        calls++;
        return Promise.resolve({
          status: 'unavailable',
          reason: 'runner_error',
          detail: null,
          startedAt: now().toISOString(),
          finishedAt: now().toISOString(),
        });
      },
    };
    const deps = { db: db.app, runner: unavailable, now, ...diagnostics };
    const input = (lane: 'ai_coe' | 'dpo') => ({
      caseId: VENDOR.caseId,
      versionId: version.versionId,
      lane,
      correlationId: randomUUID(),
    });
    const [first, concurrent, otherLane] = await Promise.all([
      runAndPersistLaneQc(deps, input('ai_coe')),
      runAndPersistLaneQc(deps, input('ai_coe')),
      runAndPersistLaneQc(deps, input('dpo')),
    ]);
    assert.deepEqual(concurrent, first);
    assert.equal(first.status, 'unavailable');
    assert.notEqual(otherLane.runId, first.runId);
    assert.equal(calls, 2);
    const runs = await db.owner.execute(
      sql`SELECT lane FROM qc_run WHERE version_id = ${version.versionId} ORDER BY lane`,
    );
    assert.deepEqual(runs.rows, [{ lane: 'ai_coe' }, { lane: 'dpo' }]);

    // Once settled, an unavailable approve_attempt run is retried (W0-07 3.7).
    const retried = await runAndPersistLaneQc(deps, input('ai_coe'));
    assert.notEqual(retried.runId, first.runId);
    assert.equal(calls, 3);
  });

  it('submit API refuses a result that arrives after Ready without a QC run, finding or audit', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const correlationId = randomUUID();
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`);
    const pending = runAndPersistSubmitQc(
      {
        db: db.app,
        now,
        ...diagnostics,
        runner: {
          identity: { runner: 'submit-late', runnerVersion: '1' },
          async run() {
            enter();
            await gate;
            return {
              status: 'completed',
              rulesEvaluated: [],
              findings: [],
              startedAt: now().toISOString(),
              finishedAt: now().toISOString(),
            };
          },
        },
      },
      { caseId: VENDOR.caseId, versionId: version.versionId, correlationId },
    );
    const rejected = assert.rejects(pending, { code: 'stale_version' });
    await entered;
    try {
      await db.owner.execute(sql`UPDATE pack_version SET ready_at=now() WHERE id=${version.versionId}`);
    } finally {
      release();
    }
    await rejected;
    const late = await db.owner.execute(
      sql`SELECT trigger, lane, correlation_id FROM qc_late_result WHERE version_id=${version.versionId}`,
    );
    assert.deepEqual(late.rows, [{ trigger: 'submit', lane: null, correlation_id: correlationId }]);
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id=${version.versionId}`)).rows.length,
      0,
    );
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_finding WHERE version_id=${version.versionId}`)).rows
        .length,
      0,
    );
    assert.deepEqual(
      (await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`)).rows,
      before.rows,
    );
    assert.equal(
      capture.lines().filter((line) => line.event === 'qc.run.late' && line.correlationId === correlationId)
        .length,
      1,
    );
  });

  it('releases the case row lock before the QC runner returns', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let markEntered: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const runner: QcRunner = {
      identity: { runner: 'lock-probe', runnerVersion: '1' },
      async run() {
        markEntered();
        await runGate;
        return {
          status: 'unavailable',
          reason: 'timeout',
          detail: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
        };
      },
    };
    const pending = runAndPersistLaneQc(
      { db: db.app, runner, now, timeoutMs: 30_000 },
      {
        caseId: VENDOR.caseId,
        versionId: version.versionId,
        lane: 'ai_coe',
        correlationId: randomUUID(),
      },
    );
    try {
      await entered;
      const started = Date.now();
      await db.raw('app', async (client) => {
        await client.query('BEGIN');
        try {
          await client.query("SET LOCAL lock_timeout = '750ms'");
          await client.query('SELECT id FROM "case" WHERE id = $1 FOR UPDATE', [VENDOR.caseId]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
      const waited = Date.now() - started;
      assert.ok(waited < 750, `case lock held during QC for ${waited}ms`);
    } finally {
      releaseRun();
      await pending.catch(() => undefined);
    }
    const outcome = await pending;
    assert.equal(outcome.status, 'unavailable');
  });

  it('does not persist lane QC when a send-back opens a successor draft during the run', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let markEntered: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const runner: QcRunner = {
      identity: { runner: 'lock-probe', runnerVersion: '1' },
      async run() {
        markEntered();
        await runGate;
        return {
          status: 'completed',
          rulesEvaluated: [],
          findings: [],
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
        };
      },
    };
    const pending = runAndPersistLaneQc(
      { db: db.app, runner, now, timeoutMs: 30_000 },
      {
        caseId: VENDOR.caseId,
        versionId: version.versionId,
        lane: 'ai_coe',
        correlationId: randomUUID(),
      },
    );
    try {
      await entered;
      const dpo = await signIn(DPO);
      const sent = await app.inject({
        method: 'POST',
        url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/lanes/dpo/send-back`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          ...asUser(dpo),
        },
        payload: {
          expectedVersion: { versionId: version.versionId, revision },
          feedback: { items: [{ slot: 2, deficiency: 'purpose is missing' }] },
        },
      });
      assert.equal(sent.statusCode, 201, sent.body);
    } finally {
      releaseRun();
      await pending.catch(() => undefined);
    }
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof StaleVersionError);
      assert.equal(err.details?.reason, 'version_closed');
      return true;
    });
    const runs = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${version.versionId} AND lane = 'ai_coe'`,
    );
    assert.equal(Number((runs.rows[0] as { n: number }).n), 0);
  });

  it('records a single-lane AI/COE defect on fx-case-vendor slot 1 via the injected substitute', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    const body = qc.body as LaneQcRunResponse;
    assert.equal(body.status, 'completed');
    assert.ok(body.runId);
    assert.ok(body.findings.length >= 1);
    const slot1 = body.findings.find((f) => f.slot === 1);
    assert.ok(slot1, 'slot 1 defect expected');
    assert.equal(slot1.owningLane, 'ai_coe');
    assert.ok(slot1.messageParams, 'qc-run finding must carry messageParams for t()');
    assert.equal(slot1.messageParams.slot, 1);
    const withMetric = body.findings.find(
      (f) => f.messageKey === 'qc.finding.acc_extraction_not_hallucination',
    );
    assert.ok(withMetric?.messageParams, 'scripted finding with metric params');
    assert.equal(withMetric.messageParams.metric, 'extraction_accuracy');

    const rows = await db.owner.execute(
      sql`SELECT owning_lane, kind, slot FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.ok(rows.rows.length >= 1);
    for (const row of rows.rows as Array<{ owning_lane: string; kind: string; slot: number }>) {
      assert.equal(row.kind, 'defect');
      assert.ok([1, 2, 3, 4, 6, 7, 8].includes(row.slot)); // fx-case-vendor scripts single-lane findings only
    }
  });

  it('waived / N/A without a reason is 422; finding unchanged', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const body = qc.body as LaneQcRunResponse;
    const findingId = body.findings[0]!.findingId;

    const before = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);
    const waived = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'waived',
    });
    assert.equal(waived.statusCode, 422, waived.body);
    assert.equal(waived.json<ErrorResponse>().error.code, 'invalid_input');

    const na = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'not_applicable',
      reason: '   ',
    });
    assert.equal(na.statusCode, 422, na.body);

    const after = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);
    assert.deepEqual(after.rows, before.rows);
    const events = await db.owner.execute(
      sql`SELECT id FROM disposition_event WHERE finding_id = ${findingId}`,
    );
    assert.equal(events.rows.length, 0);
  });

  it('non-owning lane and Admin are 403; finding bytes unchanged', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const body = qc.body as LaneQcRunResponse;
    const findingId = body.findings.find((f) => f.owningLane === 'ai_coe')!.findingId;
    const before = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);

    const dpo = await signIn(DPO);
    const wrong = await dispose(dpo, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'waived',
      reason: 'not my lane',
    });
    assert.equal(wrong.statusCode, 403, wrong.body);

    const admin = await signIn(ADMIN);
    const adminRes = await dispose(admin, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed',
    });
    assert.equal(adminRes.statusCode, 403, adminRes.body);

    const after = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);
    assert.deepEqual(after.rows, before.rows);
  });

  it('a disposition on a finding of N after N+1 is submitted is 409 version_superseded; nothing written', async () => {
    const owner = await signIn(OWNER_A);
    const n = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, n.versionId, 'ai_coe', revision);
    const findingId = (qc.body as LaneQcRunResponse).findings[0]!.findingId;

    const dpo = await signIn(DPO);
    const sent = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${n.versionId}/lanes/dpo/send-back`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(dpo) },
      payload: {
        expectedVersion: { versionId: n.versionId, revision },
        feedback: { items: [{ slot: 2, deficiency: 'purpose is missing' }] },
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const draft = (
      await app.inject({ method: 'GET', url: `/api/cases/${VENDOR.caseId}/draft`, headers: asUser(owner) })
    ).json<PackDraft>();
    const resubmitted = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/draft/submit`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(owner) },
      payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
    });
    assert.equal(resubmitted.statusCode, 201, resubmitted.body);
    const n1 = resubmitted.json<SubmittedVersion>();

    const finding = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);
    const audits = await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`);
    const stale = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: n.versionId, revision },
      kind: 'waived',
      reason: 'accepted residual risk',
    });
    assert.equal(stale.statusCode, 409, stale.body);
    const err = stale.json<ErrorResponse>().error;
    assert.equal(err.code, 'stale_version');
    const details = err.details as { reason: string; current: { versionId: string } };
    assert.equal(details.reason, 'version_superseded');
    assert.equal(details.current.versionId, n1.versionId);

    assert.deepEqual(
      (await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`)).rows,
      finding.rows,
    );
    assert.equal((await db.owner.execute(sql`SELECT id FROM disposition_event`)).rows.length, 0);
    assert.deepEqual(
      (await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`)).rows,
      audits.rows,
    );
  });

  it("owner's fixed stays proposed until the owning lane confirms; second disposition appends", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const body = qc.body as LaneQcRunResponse;
    const findingId = body.findings[0]!.findingId;
    const before = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);

    const proposed = await dispose(owner, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed_proposed',
    });
    assert.equal(proposed.statusCode, 201, proposed.body);
    assert.equal(proposed.json<DispositionResponse>().kind, 'fixed_proposed');

    const confirmed = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed_confirmed',
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal(confirmed.json<DispositionResponse>().kind, 'fixed_confirmed');

    const events = await db.owner.execute(
      sql`SELECT kind FROM disposition_event WHERE finding_id = ${findingId} ORDER BY created_at ASC, id ASC`,
    );
    assert.deepEqual(
      (events.rows as Array<{ kind: string }>).map((r) => r.kind),
      ['fixed_proposed', 'fixed_confirmed'],
    );

    const after = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);
    assert.deepEqual(after.rows, before.rows, 'finding row bytes must not change after disposition');
  });

  it('latest disposition uses a monotonic stamp when the application clock is frozen', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const findingId = (qc.body as LaneQcRunResponse).findings[0]!.findingId;

    // Freeze the app clock across both inserts; monotonic stamp still orders them.
    clock = Date.parse('2026-09-22T07:00:00.000Z');
    await rebuildApp();
    const ownerFrozen = await signIn(OWNER_A);
    const aiFrozen = await signIn(AI_COE);
    const proposed = await dispose(ownerFrozen, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed_proposed',
    });
    assert.equal(proposed.statusCode, 201, proposed.body);

    const confirmed = await dispose(aiFrozen, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed_confirmed',
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);

    const latest = await db.owner.execute(sql`
      SELECT kind, created_at FROM disposition_event
      WHERE finding_id = ${findingId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    assert.equal((latest.rows[0] as { kind: string }).kind, 'fixed_confirmed');
    const createdAt = (latest.rows[0] as { created_at: Date }).created_at;

    const audit = await db.owner.execute(sql`
      SELECT occurred_at FROM audit_event
      WHERE action = 'disposition.confirmed'
        AND target_ref->>'disposition_id' = ${confirmed.json<DispositionResponse>().dispositionId}
      ORDER BY seq DESC
      LIMIT 1
    `);
    assert.equal(audit.rows.length, 1);
    assert.equal(
      new Date((audit.rows[0] as { occurred_at: Date }).occurred_at).toISOString(),
      new Date(createdAt).toISOString(),
    );
  });

  it('a disposition that reads the clock first but commits last is still the latest one', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const findingId = (qc.body as LaneQcRunResponse).findings[0]!.findingId;
    const expectedVersion = { versionId: version.versionId, revision };

    // The owner's proposal starts first but waits for a connection on a pool whose only client is held.
    const slow = createDb(db.urls.app, { max: 1 });
    const held = await slow.pool.connect();
    const { subjectId, displayName, email, roles } = findFixtureUser(OWNER_A)!;
    const proposing = recordDisposition(
      { db: slow.db, now },
      {
        actor: { subjectId, displayName, email, roles: [...roles] },
        role: 'owner',
        correlationId: randomUUID(),
      },
      VENDOR.caseId,
      findingId,
      { expectedVersion, kind: 'fixed_proposed' },
      randomUUID(),
    );
    // The reviewer's waiver starts later and commits first.
    clock += 1_000;
    const waived = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion,
      kind: 'waived',
      reason: 'Synthetic: accepted for the pilot',
    });
    assert.equal(waived.statusCode, 201, waived.body);
    held.release();
    try {
      assert.equal((await proposing).status, 201);
    } finally {
      await slow.close();
    }

    // The proposal committed last, so it is the effective state and the owning lane can confirm it.
    const confirmed = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion,
      kind: 'fixed_confirmed',
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    const events = await db.owner.execute(
      sql`SELECT kind FROM disposition_event WHERE finding_id = ${findingId} ORDER BY created_at, id`,
    );
    assert.deepEqual(
      (events.rows as Array<{ kind: string }>).map((r) => r.kind),
      ['waived', 'fixed_proposed', 'fixed_confirmed'],
    );
  });

  it('unavailable not_configured stores one unbound run; a second call returns the same id', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);

    // Rebuild without a QC runner (production posture).
    await rebuildApp({ qcRunner: null });

    const ai = await signIn(AI_COE);
    const first = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    const firstBody = first.body as LaneQcRunResponse;
    assert.equal(firstBody.status, 'unavailable');
    assert.equal(firstBody.reason, 'not_configured');
    assert.ok(firstBody.runId);
    // W0-07 3.6 (rule recorded 2026-09-25): not_configured stores the QC-UNAVAILABLE finding, owned by the run's lane.
    assert.equal(firstBody.findings.length, 1);
    assert.equal(firstBody.findings[0]!.ruleId, 'QC-UNAVAILABLE');
    assert.equal(firstBody.findings[0]!.owningLane, 'ai_coe');

    const second = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(second.statusCode, 200);
    const secondBody = second.body as LaneQcRunResponse;
    assert.equal(secondBody.status, 'unavailable');
    assert.equal(secondBody.runId, firstBody.runId);
    assert.equal(secondBody.findings[0]!.findingId, firstBody.findings[0]!.findingId);
    assert.equal(
      capture
        .lines()
        .filter((line) => line.event === 'qc.run.unavailable' && line.fields?.qcRunId === firstBody.runId)
        .length,
      1,
    );
    assert.equal(
      capture
        .lines()
        .filter((line) => line.correlationId === second.correlationId && line.event?.startsWith('qc.run.'))
        .length,
      0,
    );

    const runs = await db.owner.execute(
      sql`SELECT id, status, engine_id FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal(runs.rows.length, 1);
    assert.equal((runs.rows[0] as { status: string }).status, 'unavailable');
    assert.equal((runs.rows[0] as { engine_id: string }).engine_id, 'unbound');
    // W0-07 3.6 (rule recorded 2026-09-25): the unbound run stores its one QC-UNAVAILABLE finding and records it.
    const findings = await db.owner.execute(
      sql`SELECT id, kind FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.deepEqual(findings.rows, [{ id: firstBody.findings[0]!.findingId, kind: 'unavailable' }]);
    const audits = await db.owner.execute(sql`
      SELECT target_ref->>'finding_count' AS finding_count
      FROM audit_event
      WHERE action = 'qc.run_recorded' AND target_version_id = ${version.versionId}
    `);
    assert.equal(audits.rows.length, 1);
    assert.equal((audits.rows[0] as { finding_count: string }).finding_count, '1');

    await rebuildApp();
  });

  it('unavailable result stores qc_run status=unavailable plus the QC-UNAVAILABLE finding and returns runId', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    runner.simulateError('runner_error');
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    const body = qc.body as LaneQcRunResponse;
    assert.equal(body.status, 'unavailable');
    assert.ok(body.runId);
    // W0-07 3.6 (rule recorded 2026-09-25): the outage is a stored finding of kind unavailable, never zero findings.
    assert.equal(body.findings.length, 1);
    assert.equal(body.findings[0]!.ruleId, 'QC-UNAVAILABLE');

    const findings = await db.owner.execute(
      sql`SELECT id, kind, owning_lane FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.deepEqual(findings.rows, [
      { id: body.findings[0]!.findingId, kind: 'unavailable', owning_lane: 'ai_coe' },
    ]);
    const runs = await db.owner.execute(
      sql`SELECT id, status FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal(runs.rows.length, 1);
    assert.equal((runs.rows[0] as { status: string }).status, 'unavailable');
    assert.equal((runs.rows[0] as { id: string }).id, body.runId);
    const stored = await db.owner.execute(
      sql`SELECT unavailable_reason, correlation_id FROM qc_run WHERE id = ${body.runId}`,
    );
    assert.equal(stored.rows[0]!.unavailable_reason, 'runner_error');
    assert.equal(stored.rows[0]!.correlation_id, qc.correlationId);
    const audit = await db.owner.execute(
      sql`SELECT id, correlation_id, target_ref FROM audit_event WHERE action='qc.run_recorded' AND target_version_id=${version.versionId}`,
    );
    assert.equal(audit.rows.length, 1);
    assert.equal((audit.rows[0]!.target_ref as { run_id: string }).run_id, body.runId);
    assert.equal(audit.rows[0]!.correlation_id, qc.correlationId);
    const diagnostics = capture.lines().filter((line) => line.correlationId === qc.correlationId);
    assert.equal(diagnostics.filter((line) => line.event === 'qc.run.unavailable').length, 1);
    assert.equal(
      diagnostics.filter(
        (line) => line.event === 'error.captured' && line.fields?.category === 'qc_unavailable',
      ).length,
      1,
    );
  });

  it('replaying a completed approve_attempt returns the same run and appends nothing', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const first = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(first.statusCode, 200);
    const firstBody = first.body as LaneQcRunResponse;
    assert.equal(firstBody.status, 'completed');

    const second = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(second.statusCode, 200);
    const secondBody = second.body as LaneQcRunResponse;
    assert.equal(secondBody.status, 'completed');
    assert.equal(secondBody.runId, firstBody.runId);
    assert.equal(
      capture
        .lines()
        .filter((line) => line.event === 'qc.run.completed' && line.fields?.qcRunId === firstBody.runId)
        .length,
      1,
    );
    assert.equal(
      capture
        .lines()
        .filter((line) => line.correlationId === second.correlationId && line.event?.startsWith('qc.run.'))
        .length,
      0,
    );
    assert.deepEqual(
      secondBody.findings.map((f) => f.findingId).sort(),
      firstBody.findings.map((f) => f.findingId).sort(),
    );

    const runs = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal((runs.rows[0] as { n: number }).n, 1);
    const findings = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal((findings.rows[0] as { n: number }).n, firstBody.findings.length);
  });

  it('unavailable run may be followed by a later completed run for the same input', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    runner.simulateError('runner_error');
    const ai = await signIn(AI_COE);
    const unavailable = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal((unavailable.body as LaneQcRunResponse).status, 'unavailable');

    const completed = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(completed.statusCode, 200);
    const body = completed.body as LaneQcRunResponse;
    assert.equal(body.status, 'completed');
    assert.ok(body.runId);
    assert.notEqual(body.runId, (unavailable.body as LaneQcRunResponse).runId);

    const runs = await db.owner.execute(sql`
      SELECT status FROM qc_run WHERE version_id = ${version.versionId} ORDER BY completed_at ASC, id ASC
    `);
    assert.deepEqual(
      (runs.rows as Array<{ status: string }>).map((r) => r.status),
      ['unavailable', 'completed'],
    );
  });

  it('only an unbound runner replays an unbound unavailable run; a completed run replays for any runner', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const input = {
      caseId: VENDOR.caseId,
      versionId: version.versionId,
      lane: 'ai_coe' as const,
      correlationId: randomUUID(),
    };
    const unbound = { db: db.app, now };
    const timingOut: QcRunner = {
      identity: { runner: 'timeout-probe', runnerVersion: '1' },
      run: () =>
        Promise.resolve({
          status: 'unavailable',
          reason: 'timeout',
          detail: null,
          startedAt: now().toISOString(),
          finishedAt: now().toISOString(),
        }),
    };

    const first = await runAndPersistLaneQc(unbound, input);
    assert.equal(first.status === 'unavailable' && first.reason, 'not_configured');
    assert.deepEqual(await runAndPersistLaneQc(unbound, input), first);
    const timedOut = await runAndPersistLaneQc({ ...unbound, runner: timingOut }, input);
    assert.equal(timedOut.status === 'unavailable' && timedOut.reason, 'timeout');
    const again = await runAndPersistLaneQc(unbound, input);
    assert.equal(again.status === 'unavailable' && again.reason, 'not_configured');
    assert.notEqual(again.runId, first.runId);
    const completed = await runAndPersistLaneQc({ ...unbound, runner }, input);
    assert.equal(completed.status, 'completed');
    const replayed = await runAndPersistLaneQc(unbound, input);
    assert.deepEqual([replayed.status, replayed.runId], ['completed', completed.runId]);

    const runs = await db.owner.execute(sql`
      SELECT id, engine_id, unavailable_reason FROM qc_run
      WHERE version_id = ${version.versionId} ORDER BY completed_at ASC, id ASC
    `);
    assert.deepEqual(runs.rows, [
      { id: first.runId, engine_id: 'unbound', unavailable_reason: 'not_configured' },
      { id: timedOut.runId, engine_id: 'timeout-probe', unavailable_reason: 'timeout' },
      { id: again.runId, engine_id: 'unbound', unavailable_reason: 'not_configured' },
      { id: completed.runId, engine_id: runner.identity.runner, unavailable_reason: null },
    ]);
  });

  it('a lane-mismatched runner finding records the run unavailable runner_error plus the QC-UNAVAILABLE finding; slot 5 stores', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const cases = [
      // Order matters: a completed ai_coe run would replay for the next ai_coe case (W0-07 3.7); the refused
      // run is retried, so the slot-5 case still runs fresh.
      { lane: 'ai_coe', slot: 1, owningLane: 'dpo', stored: false }, // slot 1 belongs to ai_coe
      { lane: 'ai_coe', slot: 5, owningLane: 'ai_coe', stored: true }, // slot 5: the raising lane (W0-06 7.3, 2026-09-25)
      { lane: 'dpo', slot: 2, owningLane: 'dpo', stored: true }, // control: the same finding shape is valid
    ] as const;
    for (const { lane, slot, owningLane, stored } of cases) {
      const probe: QcRunner = {
        identity: { runner: 'finding-probe', runnerVersion: '1' },
        run: (request) => Promise.resolve(slotMissingResult(request, slot, owningLane)),
      };
      const outcome = await runAndPersistLaneQc(
        { db: db.app, runner: probe, now, ...diagnostics },
        { caseId: VENDOR.caseId, versionId: version.versionId, lane, correlationId: randomUUID() },
      );
      const run = await db.owner.execute(
        sql`SELECT status, unavailable_reason FROM qc_run WHERE id = ${outcome.runId}`,
      );
      const findings = await db.owner.execute(sql`SELECT id FROM qc_finding WHERE run_id = ${outcome.runId}`);
      if (stored) {
        assert.equal(outcome.status, 'completed');
        assert.equal(findings.rows.length, 1);
        continue;
      }
      assert.equal(outcome.status, 'unavailable');
      assert.equal(outcome.reason, 'runner_error');
      // W0-07 3.6: the refused run leaves the QC-UNAVAILABLE finding, owned by the approving lane.
      assert.equal(outcome.findings.length, 1);
      assert.equal(outcome.findings[0]!.ruleId, 'QC-UNAVAILABLE');
      assert.equal(outcome.findings[0]!.owningLane, lane);
      assert.deepEqual(run.rows, [{ status: 'unavailable', unavailable_reason: 'runner_error' }]);
      assert.equal(findings.rows.length, 1);
      const settled = capture
        .lines()
        .filter(
          (line) =>
            line.fields?.qcRunId === outcome.runId &&
            (line.event === 'qc.run.unavailable' || line.event === 'qc.run.completed'),
        );
      assert.deepEqual(
        settled.map((line) => [line.event, line.fields?.reason]),
        [['qc.run.unavailable', 'runner_error']],
      );
    }
  });

  it('an invalid finding that arrives after Ready is recorded late as unavailable with no refused findings', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const correlationId = randomUUID();
    const pending = runAndPersistLaneQc(
      {
        db: db.app,
        now,
        ...diagnostics,
        runner: {
          identity: { runner: 'finding-probe', runnerVersion: '1' },
          async run(request) {
            enter();
            await gate;
            return slotMissingResult(request, 1, 'dpo'); // slot 1 belongs to ai_coe: an owning-lane mismatch
          },
        },
      },
      { caseId: VENDOR.caseId, versionId: version.versionId, lane: 'ai_coe', correlationId },
    );
    const rejected = assert.rejects(pending, { code: 'stale_version' });
    await entered;
    try {
      await db.owner.execute(sql`UPDATE pack_version SET ready_at=now() WHERE id=${version.versionId}`);
    } finally {
      release();
    }
    await rejected;
    const late = await db.owner.execute(
      sql`SELECT status, refused_finding_count FROM qc_late_result WHERE version_id=${version.versionId}`,
    );
    assert.deepEqual(late.rows, [{ status: 'unavailable', refused_finding_count: 0 }]);
    // A late run writes nothing: not even the QC-UNAVAILABLE finding (W0-07 3.4 step 6).
    const lateFindings = await db.owner.execute(
      sql`SELECT id FROM qc_finding WHERE version_id = ${version.versionId} AND kind = 'unavailable'`,
    );
    assert.equal(lateFindings.rows.length, 0);
    const logged = capture
      .lines()
      .filter((line) => line.event === 'qc.run.late' && line.correlationId === correlationId);
    assert.deepEqual(
      logged.map((line) => [line.fields?.status, line.fields?.refusedFindingCount]),
      [['unavailable', 0]],
    );
  });

  it('lane QC is forbidden for owner, BU SPOC, Admin, and a different lane; no rows written', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);

    for (const [userId, lane] of [
      [OWNER_A, 'ai_coe'],
      [SPOC_CM, 'ai_coe'],
      [ADMIN, 'ai_coe'],
      [DPO, 'ai_coe'],
    ] as const) {
      const session = await signIn(userId);
      const qc = await runLaneQc(session, VENDOR.caseId, version.versionId, lane, revision);
      assert.equal(qc.statusCode, 403, `${userId} ${lane}`);
    }

    const runs = await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id = ${version.versionId}`);
    assert.equal(runs.rows.length, 0);
    const findings = await db.owner.execute(
      sql`SELECT id FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal(findings.rows.length, 0);
  });

  it('missing or unsubmitted target is not_found; Ready is version_closed', async () => {
    const owner = await signIn(OWNER_A);
    const draftRes = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/draft`,
      headers: asUser(owner),
    });
    const draft = draftRes.json<PackDraft>();
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);

    const missing = await runLaneQc(ai, VENDOR.caseId, randomUUID(), 'ai_coe', revision);
    assert.equal(missing.statusCode, 404);
    assert.equal((missing.body as ErrorResponse).error.code, 'not_found');

    const unsubmitted = await runLaneQc(ai, VENDOR.caseId, draft.draftId, 'ai_coe', revision);
    assert.equal(unsubmitted.statusCode, 404);
    assert.equal((unsubmitted.body as ErrorResponse).error.code, 'not_found');

    const version = await submitOk(owner, VENDOR.caseId);
    await db.owner.execute(sql`UPDATE pack_version SET ready_at = now() WHERE id = ${version.versionId}`);
    const ready = await runLaneQc(
      ai,
      VENDOR.caseId,
      version.versionId,
      'ai_coe',
      await caseRevision(VENDOR.caseId),
    );
    assert.equal(ready.statusCode, 409);
    assert.equal((ready.body as ErrorResponse).error.code, 'stale_version');
    assert.equal(
      (ready.body as { error: { details: { reason: string } } }).error.details.reason,
      'version_closed',
    );

    const runs = await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id = ${version.versionId}`);
    assert.equal(runs.rows.length, 0);
  });
});

describe('W3 hardening: disposition and lane QC answer malformed or unknown ids like the middleware', () => {
  const linesFor = (res: { headers: Record<string, unknown> }, event: string) =>
    capture.lines().filter((l) => l.event === event && l.correlationId === res.headers['x-correlation-id']);

  function assertNotFound(
    res: { statusCode: number; body: string; headers: Record<string, unknown> },
    resource: string,
  ) {
    assert.equal(res.statusCode, 404, res.body);
    const error = JSON.parse(res.body) as ErrorResponse;
    assert.equal(error.error.code, 'not_found');
    assert.deepEqual(error.error.details, { resource });
    assert.deepEqual(
      linesFor(res, 'error.captured').map((l) => l.fields?.code),
      ['not_found'],
    );
    assert.equal(linesFor(res, 'authz.denied').length, 0, 'no authz.denied line');
  }

  it("caseId 'not-a-uuid', findingId 'x' and qc-run versionId 'x' are 404, never 500", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'waived',
      reason: 'synthetic',
    };

    assertNotFound(await dispose(ai, 'not-a-uuid', randomUUID(), body), 'case');
    assertNotFound(await dispose(ai, VENDOR.caseId, 'x', body), 'finding');
    assertNotFound(
      await app.inject({
        method: 'POST',
        url: `/api/cases/${VENDOR.caseId}/versions/x/lanes/ai_coe/qc-run`,
        headers: { 'content-type': 'application/json', ...asUser(ai) },
        payload: { expectedVersion: { versionId: 'x', revision } },
      }),
      'version',
    );

    // Without all_cases the unresolved case is 403 scope, as the middleware answers it.
    const denied = await dispose(owner, 'not-a-uuid', randomUUID(), { ...body, kind: 'fixed_proposed' });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.deepEqual(
      linesFor(denied, 'error.captured').map((l) => l.fields?.code),
      ['forbidden'],
    );
    assert.equal(linesFor(denied, 'authz.denied')[0]?.fields?.reason, 'scope');
  });

  it('an unknown finding is 404 for every lane reviewer and 403 role for Admin', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'waived',
      reason: 'synthetic',
    };
    for (const reviewer of [DPO, IT_SECURITY, AI_COE]) {
      assertNotFound(await dispose(await signIn(reviewer), VENDOR.caseId, randomUUID(), body), 'finding');
    }
    const admin = await dispose(await signIn(ADMIN), VENDOR.caseId, randomUUID(), body);
    assert.equal(admin.statusCode, 403, admin.body);
    assert.equal(linesFor(admin, 'authz.denied')[0]?.fields?.reason, 'role');
  });
});

describe('W3-07a durable late-QC diagnostics', () => {
  it('actual QC HTTP race against Ready retains refusal without new QC evidence or audit', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed: QcRunner = {
      identity: { runner: 'synthetic-late', runnerVersion: '1' },
      async run() {
        entered();
        await gate;
        return {
          status: 'completed',
          rulesEvaluated: [],
          findings: [],
          startedAt: now().toISOString(),
          finishedAt: now().toISOString(),
        };
      },
    };
    await rebuildApp({ qcRunner: delayed });
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`);
    const pending = runLaneQc(
      ai,
      VENDOR.caseId,
      version.versionId,
      'ai_coe',
      await caseRevision(VENDOR.caseId),
    );
    await started;
    try {
      await db.owner.execute(sql`UPDATE pack_version SET ready_at=now() WHERE id=${version.versionId}`);
    } finally {
      release();
    }
    const response = await pending;
    assert.equal(response.statusCode, 409);
    const late = await db.owner.execute(
      sql`SELECT * FROM qc_late_result WHERE version_id=${version.versionId}`,
    );
    assert.equal(late.rows.length, 1);
    assert.equal(late.rows[0]!.correlation_id, response.correlationId);
    const logs = capture.lines().filter((line) => line.correlationId === response.correlationId);
    const begin = logs.find((line) => line.event === 'qc.run.started')!;
    const refused = logs.filter((line) => line.event === 'qc.run.late');
    assert.equal(refused.length, 1);
    assert.equal(begin.fields!.qcRunId, late.rows[0]!.qc_run_id);
    assert.equal(refused[0]!.fields!.qcRunId, late.rows[0]!.qc_run_id);
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id=${version.versionId}`)).rows.length,
      0,
    );
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_finding WHERE version_id=${version.versionId}`)).rows
        .length,
      0,
    );
    assert.deepEqual(
      (await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`)).rows,
      before.rows,
    );
    const admin = await signIn(ADMIN);
    const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
    assert.equal(view.statusCode, 200, view.body);
    assert.equal(view.json<DeskHealthReport>().lateQc[0]?.qcRunId, late.rows[0]!.qc_run_id);
  });
});

describe('W3-07a operator authorization and liveness', () => {
  it('operator.view uses real sessions: no session401, every non-admin including dual403, Admin200', async () => {
    assert.equal((await app.inject('/api/operator/desk-health')).statusCode, 401);
    for (const user of FIXTURE_USERS) {
      const session = await signIn(user.fixtureUserId);
      const response = await app.inject({ url: '/api/operator/desk-health', headers: asUser(session) });
      const admin = user.roles.some((grant) => grant.role === 'admin');
      assert.equal(response.statusCode, admin ? 200 : 403, user.fixtureUserId);
    }
  });
  it('healthz has no logs and readyz uses actual dependency probes', async () => {
    capture.clear();
    const health = await app.inject('/healthz');
    assert.equal(health.statusCode, 200);
    assert.deepEqual(capture.lines(), []);
    const ready = await app.inject('/readyz');
    assert.equal(ready.statusCode, 200, ready.body);
    assert.equal(ready.json<{ store: { migrations: string } }>().store.migrations, 'current');
  });
});
