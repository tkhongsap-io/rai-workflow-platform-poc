// W2-INT: the W2 exit negatives as direct-API tests against the REAL server process (W0-02 8.2: negatives for
// authorization and concurrency are direct-API; W2-08 list: concurrent send-back, stale approval, undispositioned
// finding, Admin-approval and self-approval). The server is the one deployable spawned as its own process on
// loopback in test mode (tests/support/process.ts) against this ticket's Postgres with fixture set
// slice1-synthetic@1 loaded; every request goes over HTTP with a session cookie from POST /auth/fixture/sign-in.
// Proves A04, A07, A09 for the package exit. Single-lane findings only. Fixture ids: fx-case-nonvendor,
// fx-case-hr-dualrole; users fx-user-owner-cm, fx-user-dpo, fx-user-ai-coe, fx-user-it-security, fx-user-admin,
// fx-user-dpo-spoc-hr.

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import type {
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
} from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { RAI_WEB_ROOT, startTestServer, type TestServerProcess } from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, firstCookie } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const BLOB_DIR = path.join(RAI_WEB_ROOT, '.local', 'test', 'blobs');

const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SEC = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
const DUAL = 'fx-user-dpo-spoc-hr';

const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const HR_DUAL = findFixtureCase('fx-case-hr-dualrole')!;

interface Session {
  cookie: string;
}

let db: TestDatabase;
let outputDir: string;
let server: TestServerProcess;

before(async () => {
  db = await openTestDatabase();
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-int-negatives-'));
});
beforeEach(async () => {
  // Drain background submit QC/mail before taking TRUNCATE's exclusive locks.
  await server?.stop();
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await rm(path.join(BLOB_DIR, 'sha256'), { recursive: true, force: true });
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir: BLOB_DIR,
    outputDir,
  });
  server = await startTestServer();
});
afterEach(async () => {
  // Includes failed test bodies; stop() drains the child and audits its captured logs.
  if (server !== undefined) assert.deepEqual(await server.stop(), { code: 0, signal: null });
});
after(async () => {
  await server?.stop();
  await db.close();
  await rm(outputDir, { recursive: true, force: true });
});

async function signIn(fixtureUserId: string): Promise<Session> {
  const res = await fetch(`${server.baseUrl}${FIXTURE_SIGN_IN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ fixtureUserId }),
  });
  assert.equal(res.status, 200, await res.text());
  const cookie = firstCookie(res.headers.get('set-cookie') ?? undefined);
  assert.ok(cookie !== undefined, 'no session cookie');
  return { cookie };
}

function headersFor(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: session.cookie,
    'sec-fetch-site': 'same-origin',
    ...extra,
  };
}

async function call(
  session: Session,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; text: string; headers: Headers; json<T>(): T }> {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: headersFor(session, {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    headers: res.headers,
    json<T>() {
      return JSON.parse(text) as T;
    },
  };
}

async function submitOk(session: Session, caseId: string): Promise<SubmittedVersion> {
  const draftRes = await call(session, 'GET', `/api/cases/${caseId}/draft`);
  assert.equal(draftRes.status, 200, draftRes.text);
  const draft = draftRes.json<PackDraft>();
  const submit = await call(session, 'POST', `/api/cases/${caseId}/draft/submit`, {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  });
  assert.equal(submit.status, 201, submit.text);
  return submit.json<SubmittedVersion>();
}

async function caseRevision(caseId: string): Promise<number> {
  const r = await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`);
  return Number((r.rows[0] as { row_version: number }).row_version);
}

/** Approves on the lane-QC run the reviewer just saw, unless the caller names one. */
async function approve(
  session: Session,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
  qcRunId?: string,
) {
  qcRunId ??= await laneQcRunId(session, caseId, versionId, lane, revision);
  return call(session, 'POST', `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/approve`, {
    expectedVersion: { versionId, revision },
    qcRunId,
  });
}

async function sendBack(
  session: Session,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
  slot: number,
  deficiency: string,
) {
  return call(session, 'POST', `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/send-back`, {
    expectedVersion: { versionId, revision },
    feedback: { items: [{ slot, deficiency }] },
  });
}

async function runLaneQc(
  session: Session,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
) {
  // qc-run has no idempotency-key requirement; call without forcing one on every request.
  const res = await fetch(
    `${server.baseUrl}/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    {
      method: 'POST',
      headers: headersFor(session, { 'content-type': 'application/json' }),
      body: JSON.stringify({ expectedVersion: { versionId, revision } }),
    },
  );
  const text = await res.text();
  return {
    status: res.status,
    text,
    json<T>() {
      return JSON.parse(text) as T;
    },
  };
}

async function laneQcRunId(
  session: Session,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
): Promise<string> {
  const qc = await runLaneQc(session, caseId, versionId, lane, revision);
  assert.equal(qc.status, 200, qc.text);
  const { runId } = qc.json<LaneQcRunResponse>();
  assert.ok(runId);
  return runId;
}

function dispose(session: Session, caseId: string, findingId: string, body: unknown) {
  return call(session, 'POST', `/api/cases/${caseId}/findings/${findingId}/dispositions`, body);
}

describe(`W2-INT exit negatives over HTTP against the real server process — ${SET}`, () => {
  it('two concurrent send-backs yield one successor draft; both decisions recorded; N stays readable', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);

    const [dpoRes, aiRes] = await Promise.all([
      sendBack(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision, 2, 'DPIA incomplete on scope'),
      sendBack(
        ai,
        NONVENDOR.caseId,
        version.versionId,
        'ai_coe',
        revision,
        1,
        'Use-case brief missing risk note',
      ),
    ]);
    assert.equal(dpoRes.status, 201, dpoRes.text);
    assert.equal(aiRes.status, 201, aiRes.text);
    const dpoBody = dpoRes.json<LaneDecisionResponse>();
    const aiBody = aiRes.json<LaneDecisionResponse>();
    assert.ok(dpoBody.successorDraftVersionId);
    assert.equal(dpoBody.successorDraftVersionId, aiBody.successorDraftVersionId);

    const drafts = await db.owner.execute(
      sql`SELECT id FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND parent_version_id = ${version.versionId}
            AND submitted_at IS NULL`,
    );
    assert.equal(drafts.rows.length, 1);
    assert.equal((drafts.rows[0] as { id: string }).id, dpoBody.successorDraftVersionId);

    const decisions = await db.owner.execute(
      sql`SELECT lane, decision FROM lane_decision WHERE version_id = ${version.versionId} ORDER BY lane`,
    );
    assert.deepEqual(
      (decisions.rows as Array<{ lane: string; decision: string }>).map((r) => r.lane),
      ['ai_coe', 'dpo'],
    );
    assert.ok((decisions.rows as Array<{ decision: string }>).every((r) => r.decision === 'send_back'));

    const frozen = await call(owner, 'GET', `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}`);
    assert.equal(frozen.status, 200, frozen.text);
    assert.equal(frozen.json<SubmittedVersion>().versionId, version.versionId);
  });

  it('a stale approval of a superseded version is 409 and changes nothing', async () => {
    const owner = await signIn(OWNER);
    const v1 = await submitOk(owner, NONVENDOR.caseId);
    const revisionAtV1 = await caseRevision(NONVENDOR.caseId);
    const it = await signIn(IT_SEC);
    const itRunId = await laneQcRunId(it, NONVENDOR.caseId, v1.versionId, 'it_security', revisionAtV1);
    const dpo = await signIn(DPO);
    const sent = await sendBack(
      dpo,
      NONVENDOR.caseId,
      v1.versionId,
      'dpo',
      revisionAtV1,
      2,
      'DPIA incomplete',
    );
    assert.equal(sent.status, 201, sent.text);

    const draftRes = await call(owner, 'GET', `/api/cases/${NONVENDOR.caseId}/draft`);
    assert.equal(draftRes.status, 200, draftRes.text);
    const draft = draftRes.json<PackDraft>();
    const v2 = await call(owner, 'POST', `/api/cases/${NONVENDOR.caseId}/draft/submit`, {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
    });
    assert.equal(v2.status, 201, v2.text);
    const v2Body = v2.json<SubmittedVersion>();
    assert.equal(v2Body.versionNumber, 2);

    const beforeCount = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const deny = await approve(
      it,
      NONVENDOR.caseId,
      v1.versionId,
      'it_security',
      await caseRevision(NONVENDOR.caseId),
      itRunId,
    );
    assert.equal(deny.status, 409, deny.text);
    const err = deny.json<ErrorResponse>().error;
    assert.equal(err.code, 'stale_version');
    assert.equal((err.details as { reason: string }).reason, 'version_superseded');

    const afterCount = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((afterCount.rows[0] as { n: number }).n, (beforeCount.rows[0] as { n: number }).n);
    const caseRow = (
      await db.owner.execute(sql`SELECT current_version_id FROM "case" WHERE id = ${NONVENDOR.caseId}`)
    ).rows[0] as { current_version_id: string };
    assert.equal(caseRow.current_version_id, v2Body.versionId);
  });

  it('an undispositioned single-lane finding blocks Ready', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.status, 200, qc.text);
    const findings = qc.json<LaneQcRunResponse>().findings;
    assert.ok(findings.length >= 1);

    const dpo = await signIn(DPO);
    const it = await signIn(IT_SEC);
    const r1 = await approve(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);
    assert.equal(r1.status, 201, r1.text);
    assert.equal(r1.json<LaneDecisionResponse>().ready, false);
    const r2 = await approve(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(r2.status, 201, r2.text);
    assert.equal(r2.json<LaneDecisionResponse>().ready, false);
    const r3 = await approve(it, NONVENDOR.caseId, version.versionId, 'it_security', revision);
    assert.equal(r3.status, 201, r3.text);
    assert.equal(r3.json<LaneDecisionResponse>().ready, false);

    const caseRow = (
      await db.owner.execute(
        sql`SELECT desk_status, ai_readiness_status FROM "case" WHERE id = ${NONVENDOR.caseId}`,
      )
    ).rows[0] as { desk_status: string; ai_readiness_status: string };
    assert.equal(caseRow.desk_status, 'in_review');
    assert.equal(caseRow.ai_readiness_status, 'not_ready');
    const versionRow = (
      await db.owner.execute(sql`SELECT ready_at FROM pack_version WHERE id = ${version.versionId}`)
    ).rows[0] as { ready_at: Date | null };
    assert.equal(versionRow.ready_at, null);

    // Control: waive the open finding in the same harness and Ready is set (proves the block was the finding).
    const openRows = await db.owner.execute(sql`
      SELECT f.id
      FROM qc_finding f
      LEFT JOIN LATERAL (
        SELECT kind FROM disposition_event d WHERE d.finding_id = f.id
        ORDER BY d.created_at DESC, d.id DESC LIMIT 1
      ) latest ON true
      WHERE f.version_id = ${version.versionId}
        AND (latest.kind IS NULL OR latest.kind = 'fixed_proposed')
    `);
    assert.ok(openRows.rows.length >= 1);
    let last: DispositionResponse | undefined;
    for (const row of openRows.rows as Array<{ id: string }>) {
      const waived = await dispose(ai, NONVENDOR.caseId, row.id, {
        expectedVersion: { versionId: version.versionId, revision },
        kind: 'waived',
        reason: 'accepted residual risk for desk Ready',
      });
      assert.equal(waived.status, 201, waived.text);
      last = waived.json<DispositionResponse>();
    }
    assert.ok(last);
    assert.equal(last.ready, true);
  });

  it('Admin cannot approve a lane (403) and writes nothing', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const admin = await signIn(ADMIN);
    const dpoRunId = await laneQcRunId(
      await signIn(DPO),
      NONVENDOR.caseId,
      version.versionId,
      'dpo',
      revision,
    );
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const deny = await approve(admin, NONVENDOR.caseId, version.versionId, 'dpo', revision, dpoRunId);
    assert.equal(deny.status, 403, deny.text);
    assert.equal(deny.json<ErrorResponse>().error.code, 'forbidden');
    const after = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((after.rows[0] as { n: number }).n, (before.rows[0] as { n: number }).n);
  });

  it('the case owner cannot approve a lane on their own case (403) and writes nothing', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const aiRunId = await laneQcRunId(
      await signIn(AI_COE),
      NONVENDOR.caseId,
      version.versionId,
      'ai_coe',
      revision,
    );
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const deny = await approve(owner, NONVENDOR.caseId, version.versionId, 'ai_coe', revision, aiRunId);
    assert.equal(deny.status, 403, deny.text);
    assert.equal(deny.json<ErrorResponse>().error.code, 'forbidden');
    const after = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((after.rows[0] as { n: number }).n, (before.rows[0] as { n: number }).n);
  });

  it('a reviewer who is the BU SPOC of the case cannot approve that lane (403)', async () => {
    const owner = await signIn(OWNER);
    const hrVersion = await submitOk(owner, HR_DUAL.caseId);
    const hrRevision = await caseRevision(HR_DUAL.caseId);
    const dual = await signIn(DUAL);
    const dpoRunId = await laneQcRunId(
      await signIn(DPO),
      HR_DUAL.caseId,
      hrVersion.versionId,
      'dpo',
      hrRevision,
    );
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const deny = await approve(dual, HR_DUAL.caseId, hrVersion.versionId, 'dpo', hrRevision, dpoRunId);
    assert.equal(deny.status, 403, deny.text);
    assert.equal(deny.json<ErrorResponse>().error.code, 'forbidden');
    const after = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((after.rows[0] as { n: number }).n, (before.rows[0] as { n: number }).n);
  });
});
