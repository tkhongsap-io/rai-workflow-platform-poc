// W2-02 Done when: a reviewer decides only their lane; stale expected version rejected; repeated Idempotency-Key
// changes nothing; send-back without a named artifact rejected; Admin forbidden; dual-role DPO/SPOC cannot decide
// the DPO lane on an HR case and may on a CM case (D05); audit carries actor, version, lane and correlation ID.
// Fixture set slice1-synthetic@1; real Postgres harness.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import type { LaneDecision, LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { auditStore } from '@rai/server/audit/store';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { app, capture, caseRevision, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());

const OWNER_A = 'fx-user-owner-cm';
const OWNER_B = 'fx-user-owner-cm-2';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SEC = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
const DUAL = 'fx-user-dpo-spoc-hr';
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const HR_DUAL = findFixtureCase('fx-case-hr-dualrole')!;
const subjectOf = (id: string) => findFixtureUser(id)!.subjectId;
const emailOf = (id: string) => findFixtureUser(id)!.email;

let runner: ScriptedQcRunner;
const START = Date.parse('2026-09-22T04:01:00Z');
let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
// Unscripted: lane QC completes clean unless a test simulates an error.
openFixtureApp({ now, qcRunner: () => (runner = new ScriptedQcRunner({ now })) });

type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json<T>(): T };

async function laneQc(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
): Promise<LaneQcRunResponse> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision } },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<LaneQcRunResponse>();
}

async function rowCounts() {
  const r = await db.owner.execute(sql`
    SELECT (SELECT count(*)::int FROM lane_decision) AS decisions,
           (SELECT count(*)::int FROM audit_event) AS audits,
           (SELECT count(*)::int FROM notification) AS notices
  `);
  return r.rows[0];
}

function decide(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  kind: 'approve' | 'send-back',
  body: unknown,
  key: string = randomUUID(),
): Promise<Res> {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/${kind}`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: body as object,
  });
}

describe(`W2-02 lane decision — ${SET}`, () => {
  it('DPO approves own lane on a CM case; audit carries actor, version, lane and correlation ID', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const { runId: qcRunId } = await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);
    const res = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId,
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json<LaneDecisionResponse>();
    assert.equal(body.lane, 'dpo');
    assert.equal(body.decision, 'approve');
    assert.equal(body.versionId, version.versionId);
    assert.equal(body.successorDraftVersionId, null);

    const events = (await auditStore.read(db.owner)).filter((e) => e.action === 'lane.approved');
    assert.equal(events.length, 1);
    const ev = events[0]!;
    assert.equal(ev.actorSubjectId, subjectOf(DPO));
    assert.equal(ev.actorRole, 'dpo');
    assert.equal(ev.targetVersionId, version.versionId);
    assert.equal(ev.correlationId, res.headers['x-correlation-id']);
    assert.equal((ev.targetRef as { lane: string }).lane, 'dpo');
    assert.equal((ev.targetRef as { qc_run_id: string }).qc_run_id, qcRunId);

    const c = await db.owner.execute(
      sql`SELECT privacy_status, security_status, rai_status FROM "case" WHERE id = ${NONVENDOR.caseId}`,
    );
    const row = c.rows[0] as {
      privacy_status: string;
      security_status: string;
      rai_status: string;
    };
    assert.equal(row.privacy_status, 'approved');
    assert.equal(row.security_status, 'pending');
    assert.equal(row.rai_status, 'pending');
  });

  it('reviewer cannot decide another lane (403); Admin cannot decide any lane (403)', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const payload = {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: (await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision)).runId,
    };
    const wrong = await decide(dpo, NONVENDOR.caseId, version.versionId, 'it_security', 'approve', payload);
    assert.equal(wrong.statusCode, 403, wrong.body);
    assert.equal(wrong.json<{ error: { code: string } }>().error.code, 'forbidden');

    const admin = await signIn(ADMIN);
    const adminRes = await decide(admin, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', payload);
    assert.equal(adminRes.statusCode, 403, adminRes.body);

    const decisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((decisions.rows[0] as { n: number }).n, 0);
  });

  it('unknown versionId is not_found; missing qcRunId hits lane_qc_not_run in the service', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const { runId } = await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);

    // Path and body must agree; a UUID that was never a version is not_found (not version_superseded).
    const otherVersionId = randomUUID();
    const missing = await decide(dpo, NONVENDOR.caseId, otherVersionId, 'dpo', 'approve', {
      expectedVersion: { versionId: otherVersionId, revision },
      qcRunId: runId,
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json<{ error: { code: string } }>().error.code, 'not_found');

    // Omit qcRunId so Ajv accepts the body and requireQcRunId throws lane_qc_not_run.
    const noQc = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
    });
    assert.equal(noQc.statusCode, 422, noQc.body);
    const err = noQc.json<{
      error: { code: string; details: { fields: Array<{ path: string; messageKey: string }> } };
    }>();
    assert.equal(err.error.code, 'invalid_input');
    assert.ok(
      err.error.details.fields.some(
        (f) => f.path === 'body.qcRunId' && f.messageKey === 'error.invalid_input.lane_qc_not_run',
      ),
      noQc.body,
    );
  });

  it('repeated Idempotency-Key returns the same body and writes no second decision', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const key = randomUUID();
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: (await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision)).runId,
    };
    const first = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', body, key);
    assert.equal(first.statusCode, 201, first.body);
    const firstBody = first.body;
    const second = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', body, key);
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(second.body, firstBody);
    const n = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((n.rows[0] as { n: number }).n, 1);
    const approved = (await auditStore.read(db.owner)).filter((e) => e.action === 'lane.approved');
    assert.equal(approved.length, 1);
  });

  it('a second approve of the same lane with a new Idempotency-Key is 409 lane_already_decided', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: (await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision)).runId,
    };
    const first = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', body);
    assert.equal(first.statusCode, 201, first.body);
    const again = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', body);
    assert.equal(again.statusCode, 409, again.body);
    assert.equal(
      again.json<{ error: { details: { reason: string } } }>().error.details.reason,
      'lane_already_decided',
    );
    const n = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((n.rows[0] as { n: number }).n, 1);
  });

  it('approve must name the latest lane-QC run: none is 422, an earlier one is 409; nothing written', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const expectedVersion = { versionId: version.versionId, revision };
    // A run for another lane is not a DPO lane-QC run.
    const aiRun = await laneQc(await signIn(AI_COE), NONVENDOR.caseId, version.versionId, 'ai_coe', revision);
    const counts = await rowCounts();

    const notRun = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion,
      qcRunId: aiRun.runId,
    });
    assert.equal(notRun.statusCode, 422, notRun.body);
    const invalid = notRun.json<ErrorResponse>().error;
    assert.equal(invalid.code, 'invalid_input');
    assert.deepEqual(invalid.details, {
      fields: [{ path: 'body.qcRunId', messageKey: 'error.invalid_input.lane_qc_not_run' }],
    });
    assert.deepEqual(await rowCounts(), counts);

    runner.simulateError('runner_error');
    const earlier = await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);
    assert.equal(earlier.status, 'unavailable');
    const latest = await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);
    assert.notEqual(latest.runId, earlier.runId);
    const afterRuns = await rowCounts();

    const superseded = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion,
      qcRunId: earlier.runId,
    });
    assert.equal(superseded.statusCode, 409, superseded.body);
    const stale = superseded.json<ErrorResponse>().error;
    assert.equal(stale.code, 'stale_version');
    assert.deepEqual(stale.details, {
      reason: 'qc_run_superseded',
      guidanceKey: 'error.stale_version.guidance.qc_run_superseded',
      current: {
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        revision,
        state: 'submitted',
        ready: false,
      },
      refreshPath: `/cases/${NONVENDOR.caseId}/versions/${version.versionId}`,
    });
    assert.deepEqual(await rowCounts(), afterRuns);

    const ok = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion,
      qcRunId: latest.runId,
    });
    assert.equal(ok.statusCode, 201, ok.body);
  });

  it('an unavailable latest lane-QC run is a valid run to approve on', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    runner.simulateError('runner_error');
    const run = await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);
    assert.equal(run.status, 'unavailable');
    const res = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: run.runId,
    });
    assert.equal(res.statusCode, 201, res.body);
    const stored = await db.owner.execute(sql`SELECT observed_qc_run_id FROM lane_decision`);
    assert.deepEqual(stored.rows, [{ observed_qc_run_id: run.runId }]);
  });

  it('send-back without named artifact is rejected; with feedback creates successor copying stage, template and slots', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);

    const parentMeta = (
      await db.owner.execute(
        sql`SELECT stage_context, checklist_template_version FROM pack_version WHERE id = ${version.versionId}`,
      )
    ).rows[0] as { stage_context: string; checklist_template_version: string };
    const parentSlots = (
      await db.owner.execute(
        sql`SELECT slot, state, reason, artifact_id FROM artifact_slot
            WHERE version_id = ${version.versionId} ORDER BY slot`,
      )
    ).rows as Array<{
      slot: number;
      state: string;
      reason: string | null;
      artifact_id: string | null;
    }>;
    assert.equal(parentSlots.length, 9);

    const empty = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'send-back', {
      expectedVersion: { versionId: version.versionId, revision },
      feedback: { items: [] },
    });
    assert.equal(empty.statusCode, 422, empty.body);

    const ok = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'send-back', {
      expectedVersion: { versionId: version.versionId, revision },
      feedback: { items: [{ slot: 2, deficiency: 'DPIA incomplete on scope' }] },
    });
    assert.equal(ok.statusCode, 201, ok.body);
    const body = ok.json<LaneDecisionResponse>();
    assert.equal(body.decision, 'send_back');
    assert.ok(body.successorDraftVersionId);

    const drafts = await db.owner.execute(
      sql`SELECT id, parent_version_id, version_number, stage_context, checklist_template_version,
                 submitted_at IS NULL AS is_draft
          FROM pack_version WHERE id = ${body.successorDraftVersionId}`,
    );
    const draft = drafts.rows[0] as {
      id: string;
      parent_version_id: string;
      version_number: number;
      stage_context: string;
      checklist_template_version: string;
      is_draft: boolean;
    };
    assert.equal(draft.parent_version_id, version.versionId);
    assert.equal(draft.version_number, version.versionNumber + 1);
    assert.equal(draft.is_draft, true);
    assert.equal(draft.stage_context, parentMeta.stage_context);
    assert.equal(draft.checklist_template_version, parentMeta.checklist_template_version);

    const childSlots = (
      await db.owner.execute(
        sql`SELECT slot, state, reason, artifact_id FROM artifact_slot
            WHERE version_id = ${body.successorDraftVersionId} ORDER BY slot`,
      )
    ).rows as Array<{
      slot: number;
      state: string;
      reason: string | null;
      artifact_id: string | null;
    }>;
    assert.equal(childSlots.length, 9);
    assert.deepEqual(
      childSlots.map((s) => ({
        slot: s.slot,
        state: s.state,
        reason: s.reason,
        artifact_id: s.artifact_id,
      })),
      parentSlots.map((s) => ({
        slot: s.slot,
        state: s.state,
        reason: s.reason,
        artifact_id: s.artifact_id,
      })),
    );

    // Version N stays readable and frozen
    const frozen = await app.inject({
      method: 'GET',
      url: `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}`,
      headers: asUser(owner),
    });
    assert.equal(frozen.statusCode, 200, frozen.body);
    assert.equal(frozen.json<SubmittedVersion>().versionId, version.versionId);

    const notices = await db.owner.execute(
      sql`SELECT event, lane, recipient FROM notification WHERE event = 'send_back' AND case_id = ${NONVENDOR.caseId}`,
    );
    assert.equal(notices.rows.length, 1);
    assert.equal((notices.rows[0] as { recipient: string }).recipient, emailOf(OWNER_A));
    assert.equal((notices.rows[0] as { lane: string }).lane, 'dpo');

    const sent = (await auditStore.read(db.owner)).filter((e) => e.action === 'lane.sent_back');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.correlationId, ok.headers['x-correlation-id']);
    assert.equal((sent[0]!.targetRef as { lane: string }).lane, 'dpo');
    const created = (await auditStore.read(db.owner)).filter((e) => e.action === 'draft.successor_created');
    assert.equal(created.length, 1);
  });

  it('the version read carries its decisions: none before, approve without feedback, send-back with it; scope unchanged', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const read = (session: FixtureSession, path: string) =>
      app.inject({
        method: 'GET',
        url: `/api/cases/${NONVENDOR.caseId}/versions/${path}`,
        headers: asUser(session),
      });
    const decisionsOf = async (session: FixtureSession, path: string): Promise<LaneDecision[]> => {
      const res = await read(session, path);
      assert.equal(res.statusCode, 200, res.body);
      return res.json<SubmittedVersion>().decisions;
    };
    assert.deepEqual(await decisionsOf(owner, version.versionId), []);

    const dpo = await signIn(DPO);
    const approved = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: (await laneQc(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision)).runId,
    });
    assert.equal(approved.statusCode, 201, approved.body);
    clock += 60_000;
    const feedback = {
      items: [{ slot: 1, deficiency: 'Synthetic brief omits the model owner' }],
      summary: 'Synthetic: add the owner and resubmit',
    };
    const ai = await signIn(AI_COE);
    const sentBack = await decide(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', 'send-back', {
      expectedVersion: { versionId: version.versionId, revision },
      feedback,
    });
    assert.equal(sentBack.statusCode, 201, sentBack.body);

    const expected = [
      {
        lane: 'dpo',
        decision: 'approve',
        decidedBy: subjectOf(DPO),
        decidedAt: approved.json<LaneDecisionResponse>().decidedAt,
        feedback: null,
      },
      {
        lane: 'ai_coe',
        decision: 'send_back',
        decidedBy: subjectOf(AI_COE),
        decidedAt: sentBack.json<LaneDecisionResponse>().decidedAt,
        feedback,
      },
    ];
    assert.deepEqual(await decisionsOf(owner, version.versionId), expected);
    assert.deepEqual(await decisionsOf(owner, 'latest'), expected); // the successor is a draft, N stays latest
    assert.equal(capture.text().includes('Synthetic brief omits'), false, 'feedback is never logged');
    const ownerB = await signIn(OWNER_B);
    for (const path of [version.versionId, 'latest'])
      assert.equal((await read(ownerB, path)).statusCode, 403);
  });

  it('D05: fx-user-dpo-spoc-hr cannot decide DPO on HR case; may decide DPO on CM case', async () => {
    const owner = await signIn(OWNER_A);
    const hrVersion = await submitOk(owner, HR_DUAL.caseId);
    const hrRevision = await caseRevision(HR_DUAL.caseId);
    const dual = await signIn(DUAL);
    // A real latest run (seen by the DPO reviewer) does not lift D05 self-exclusion.
    const hrRun = await laneQc(await signIn(DPO), HR_DUAL.caseId, hrVersion.versionId, 'dpo', hrRevision);
    const hrDeny = await decide(dual, HR_DUAL.caseId, hrVersion.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: hrVersion.versionId, revision: hrRevision },
      qcRunId: hrRun.runId,
    });
    assert.equal(hrDeny.statusCode, 403, hrDeny.body);

    const cmVersion = await submitOk(owner, NONVENDOR.caseId);
    const cmRevision = await caseRevision(NONVENDOR.caseId);
    const cmOk = await decide(dual, NONVENDOR.caseId, cmVersion.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: cmVersion.versionId, revision: cmRevision },
      qcRunId: (await laneQc(dual, NONVENDOR.caseId, cmVersion.versionId, 'dpo', cmRevision)).runId,
    });
    assert.equal(cmOk.statusCode, 201, cmOk.body);

    // send-back also forbidden on HR
    const hrSend = await decide(dual, HR_DUAL.caseId, hrVersion.versionId, 'dpo', 'send-back', {
      expectedVersion: { versionId: hrVersion.versionId, revision: hrRevision },
      feedback: { items: [{ slot: 2, deficiency: 'fix me' }] },
    });
    assert.equal(hrSend.statusCode, 403, hrSend.body);
  });

  it('AI/COE and IT/Security each decide only their own lane; sibling decide does not change case.row_version', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const ai = await signIn(AI_COE);
    const aiOk = await decide(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: (await laneQc(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision)).runId,
    });
    assert.equal(aiOk.statusCode, 201, aiOk.body);
    assert.equal(await caseRevision(NONVENDOR.caseId), revision, 'lane decide must not bump row_version');
    const it = await signIn(IT_SEC);
    const itOk = await decide(it, NONVENDOR.caseId, version.versionId, 'it_security', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: (await laneQc(it, NONVENDOR.caseId, version.versionId, 'it_security', revision)).runId,
    });
    assert.equal(itOk.statusCode, 201, itOk.body);
    assert.equal(await caseRevision(NONVENDOR.caseId), revision);
    const c = await db.owner.execute(
      sql`SELECT privacy_status, security_status, rai_status FROM "case" WHERE id = ${NONVENDOR.caseId}`,
    );
    const row = c.rows[0] as {
      privacy_status: string;
      security_status: string;
      rai_status: string;
    };
    assert.equal(row.rai_status, 'approved');
    assert.equal(row.security_status, 'approved');
    assert.equal(row.privacy_status, 'pending');
  });
});
