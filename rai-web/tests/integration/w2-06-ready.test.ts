// W2-06 Done when (A09 / W0-06 §4.9 / §6): Ready is set only inside approve or disposition under the case
// lock when the current submitted version has three lane approvals and zero undispositioned findings. Desk
// completion only — not Council or ITSM. No POST /ready. Fixture set slice1-synthetic@1; real Postgres.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ErrorResponse } from '@rai/shared/errors';
import type {
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
} from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '../support/observed-app.js';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { auditStore } from '@rai/server/audit/store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { createSubjectDirectory } from '@rai/server/cases/subject-directory';
import { UPLOAD_LIMIT_DEFAULTS } from '@rai/server/config';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { sendBackRecipientsFromIdentities } from '@rai/server/workflow/send-back-notice';
import type { ReadyKnownIdentity } from '@rai/server/workflow/ready';
import { FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import type { VersionRef } from '@rai/shared/qc/types';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';
import { upload } from './w1-03-helpers.js';

const SET = fixtureSetLabel(readManifest());
const publicBaseUrl = new URL('http://127.0.0.1:8787');
const LIMITS = {
  maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
  maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
  maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
};
const LANE_OPEN_RECIPIENTS = laneOpenRecipientsFromIdentities(FIXTURE_USERS);
const ownerRecipients = (ownerSubjectId: string) =>
  sendBackRecipientsFromIdentities(FIXTURE_USERS, ownerSubjectId);

const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SEC = 'fx-user-it-security';
const SPOC_CM = 'fx-user-spoc-cm';
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const VENDOR = findFixtureCase('fx-case-vendor')!;
const emailOf = (id: string) => findFixtureUser(id)!.email;
const subjectOf = (id: string) => findFixtureUser(id)!.subjectId;

const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let runner: ScriptedQcRunner;
let clock = Date.parse('2026-09-22T07:00:00Z');
const now = () => new Date(clock);

async function rebuildApp(
  withQc: boolean,
  opts: { knownIdentities?: readonly ReadyKnownIdentity[] } = {},
): Promise<void> {
  if (app !== undefined) await app.close();
  const knownForReady = opts.knownIdentities ?? FIXTURE_USERS;
  runner = new ScriptedQcRunner({
    fixtureCaseIdOf: (version: VersionRef) => fixtureCaseIdByRowId.get(version.caseId),
    now,
  });
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12', RAI_SESSION_IDLE_MINUTES: '120' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const logStream = new Writable({
    write(_chunk: Buffer, _enc, cb) {
      cb();
    },
  });
  const built = buildApp({
    config: { nodeEnv: 'test', log: { level: 'info', pretty: false }, trustProxy: false, publicBaseUrl },
    logStream,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
      now,
    },
    cases: {
      db: db.app,
      businessUnits: createBusinessUnitDirectory(
        businessUnitsFromGrants(FIXTURE_USERS.flatMap((u) => [...u.roles])),
      ),
      subjects: createSubjectDirectory(db.app, { known: FIXTURE_USERS }),
      now,
    },
    artifacts: { store, db: db.app, limits: LIMITS },
    pack: { db: db.app, limits: { maxPackBytes: LIMITS.maxPackBytes }, now },
    versions: { db: db.app, now, laneOpenRecipients: LANE_OPEN_RECIPIENTS },
    decide: {
      db: db.app,
      now,
      sendBackRecipientsForOwner: ownerRecipients,
      knownIdentities: knownForReady,
    },
    findings: {
      db: db.app,
      now,
      readyRecipientsForOwner: ownerRecipients,
      knownIdentities: knownForReady,
      ...(withQc ? { qc: { runner, now } } : {}),
    },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-06-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-06-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  await rebuildApp(true);
});
beforeEach(async () => {
  clock = Date.parse('2026-09-22T07:00:00Z');
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await rm(path.join(blobDir, 'sha256'), { recursive: true, force: true });
  await store.init();
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: now(),
  });
  clock += 60_000;
  await rebuildApp(true);
});
after(async () => {
  await app.close();
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

const signIn = (id: string) => signInAsFixture(app, id);

async function submitOk(session: FixtureSession, caseId: string) {
  const draftRes = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: asUser(session),
  });
  assert.equal(draftRes.statusCode, 200, draftRes.body);
  const draft = draftRes.json<PackDraft>();
  const body: SubmitRequest = {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  };
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/draft/submit`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...asUser(session),
    },
    payload: body,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<SubmittedVersion>();
}

async function caseRevision(caseId: string): Promise<number> {
  const r = await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`);
  return Number((r.rows[0] as { row_version: number }).row_version);
}

async function approve(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
  key: string = randomUUID(),
  qcRunId: string = randomUUID(),
) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/approve`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: {
      expectedVersion: { versionId, revision },
      qcRunId,
    },
  });
}

async function sendBack(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/send-back`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...asUser(session),
    },
    payload: {
      expectedVersion: { versionId, revision },
      feedback: { items: [{ slot: 6, deficiency: 'needs fix before ready' }] },
    },
  });
}

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

async function approveAllThree(caseId: string, versionId: string, revision: number) {
  const dpo = await signIn(DPO);
  const ai = await signIn(AI_COE);
  const it = await signIn(IT_SEC);
  const r1 = await approve(dpo, caseId, versionId, 'dpo', revision);
  assert.equal(r1.statusCode, 201, r1.body);
  assert.equal(r1.json<LaneDecisionResponse>().ready, false);
  const r2 = await approve(ai, caseId, versionId, 'ai_coe', revision);
  assert.equal(r2.statusCode, 201, r2.body);
  assert.equal(r2.json<LaneDecisionResponse>().ready, false);
  const r3 = await approve(it, caseId, versionId, 'it_security', revision);
  assert.equal(r3.statusCode, 201, r3.body);
  return r3.json<LaneDecisionResponse>();
}

async function readyState(caseId: string, versionId: string) {
  const caseRow = (
    await db.owner.execute(sql`SELECT desk_status, ai_readiness_status FROM "case" WHERE id = ${caseId}`)
  ).rows[0] as { desk_status: string; ai_readiness_status: string };
  const version = (await db.owner.execute(sql`SELECT ready_at FROM pack_version WHERE id = ${versionId}`))
    .rows[0] as { ready_at: Date | null };
  const readyAudits = (await auditStore.read(db.owner, { caseId })).filter(
    (e) => e.action === 'case.ready_for_launch',
  );
  const readyNotices = await db.owner.execute(
    sql`SELECT event, lane, recipient, status FROM notification WHERE case_id = ${caseId} AND event = 'ready'`,
  );
  return { caseRow, version, readyAudits, readyNotices: readyNotices.rows };
}

describe(`W2-06 Ready predicate — ${SET}`, () => {
  it('three current-version approvals and no findings set Ready with one audit and one ready notification (no mail)', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const last = await approveAllThree(NONVENDOR.caseId, version.versionId, revision);
    assert.equal(last.ready, true);

    const state = await readyState(NONVENDOR.caseId, version.versionId);
    assert.ok(state.version.ready_at != null);
    assert.equal(state.caseRow.desk_status, 'ready');
    assert.equal(state.caseRow.ai_readiness_status, 'ready');
    assert.equal(state.readyAudits.length, 1);
    assert.equal(state.readyAudits[0]!.actorSubjectId, 'system');
    assert.equal((state.readyAudits[0]!.targetRef as { triggered_by: string }).triggered_by, last.decisionId);
    assert.equal(state.readyNotices.length, 1);
    const notice = state.readyNotices[0] as {
      event: string;
      lane: string;
      recipient: string;
      status: string;
    };
    assert.equal(notice.lane, '-');
    assert.equal(notice.recipient, emailOf(OWNER_A));
    assert.equal(notice.status, 'queued');
  });

  it('an undispositioned single-lane finding blocks Ready; waive in that transaction sets Ready', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    const finding = (qc.body as LaneQcRunResponse).findings.find((f) => f.slot === 1);
    assert.ok(finding);

    const last = await approveAllThree(VENDOR.caseId, version.versionId, revision);
    assert.equal(last.ready, false);
    let state = await readyState(VENDOR.caseId, version.versionId);
    assert.equal(state.version.ready_at, null);
    assert.equal(state.caseRow.desk_status, 'in_review');
    assert.equal(state.readyAudits.length, 0);

    // Extra findings from the script may remain; waive every undispositioned AI/COE finding.
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

    let readyBody: DispositionResponse | undefined;
    for (const row of openRows.rows as Array<{ id: string }>) {
      const waived = await dispose(ai, VENDOR.caseId, row.id, {
        expectedVersion: { versionId: version.versionId, revision },
        kind: 'waived',
        reason: 'accepted residual risk for desk Ready',
      });
      assert.equal(waived.statusCode, 201, waived.body);
      readyBody = waived.json<DispositionResponse>();
    }
    assert.ok(readyBody);
    assert.equal(readyBody.ready, true);

    state = await readyState(VENDOR.caseId, version.versionId);
    assert.ok(state.version.ready_at != null);
    assert.equal(state.caseRow.desk_status, 'ready');
    assert.equal(state.readyAudits.length, 1);
    assert.equal(state.readyNotices.length, 1);
  });

  it('fixed_proposed alone does not set Ready', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    const findings = (qc.body as LaneQcRunResponse).findings;
    assert.ok(findings.length >= 1);

    await approveAllThree(VENDOR.caseId, version.versionId, revision);

    for (const f of findings) {
      const proposed = await dispose(owner, VENDOR.caseId, f.findingId, {
        expectedVersion: { versionId: version.versionId, revision },
        kind: 'fixed_proposed',
      });
      assert.equal(proposed.statusCode, 201, proposed.body);
      assert.equal(proposed.json<DispositionResponse>().ready, false);
    }

    const state = await readyState(VENDOR.caseId, version.versionId);
    assert.equal(state.version.ready_at, null);
    assert.equal(state.readyAudits.length, 0);
  });

  it('approvals on N do not count after resubmit; N+1 needs its own three approvals', async () => {
    const owner = await signIn(OWNER_A);
    const v1 = await submitOk(owner, NONVENDOR.caseId);
    const rev1 = await caseRevision(NONVENDOR.caseId);

    // Two approvals on N, then send-back so Ready never fires; resubmit opens N+1.
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const it = await signIn(IT_SEC);
    assert.equal((await approve(dpo, NONVENDOR.caseId, v1.versionId, 'dpo', rev1)).statusCode, 201);
    assert.equal((await approve(ai, NONVENDOR.caseId, v1.versionId, 'ai_coe', rev1)).statusCode, 201);
    const sb = await sendBack(it, NONVENDOR.caseId, v1.versionId, 'it_security', rev1);
    assert.equal(sb.statusCode, 201, sb.body);
    const successorId = sb.json<LaneDecisionResponse>().successorDraftVersionId;
    assert.ok(successorId);

    const v2 = await submitOk(owner, NONVENDOR.caseId);
    assert.notEqual(v2.versionId, v1.versionId);
    const rev2 = await caseRevision(NONVENDOR.caseId);

    // One approval on N+1 is not enough even though N had two approvals.
    const one = await approve(dpo, NONVENDOR.caseId, v2.versionId, 'dpo', rev2);
    assert.equal(one.statusCode, 201, one.body);
    assert.equal(one.json<LaneDecisionResponse>().ready, false);
    let state = await readyState(NONVENDOR.caseId, v2.versionId);
    assert.equal(state.version.ready_at, null);
    assert.equal(state.readyAudits.length, 0);

    const two = await approve(ai, NONVENDOR.caseId, v2.versionId, 'ai_coe', rev2);
    assert.equal(two.json<LaneDecisionResponse>().ready, false);
    const three = await approve(it, NONVENDOR.caseId, v2.versionId, 'it_security', rev2);
    assert.equal(three.json<LaneDecisionResponse>().ready, true);
    state = await readyState(NONVENDOR.caseId, v2.versionId);
    assert.ok(state.version.ready_at != null);
    assert.equal(state.readyAudits.length, 1);
  });

  it('a second mutating approve after Ready is 409 version_closed and writes nothing', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    await approveAllThree(NONVENDOR.caseId, version.versionId, revision);

    const beforeDecisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const beforeAudits = (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).length;

    const dpo = await signIn(DPO);
    const again = await approve(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision);
    assert.equal(again.statusCode, 409, again.body);
    const err = again.json<ErrorResponse>();
    assert.equal(err.error.code, 'stale_version');
    assert.equal((err.error.details as { reason: string }).reason, 'version_closed');
    assert.equal(
      (err.error.details as { guidanceKey: string }).guidanceKey,
      'error.stale_version.guidance.ready',
    );

    const afterDecisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((afterDecisions.rows[0] as { n: number }).n, (beforeDecisions.rows[0] as { n: number }).n);
    const afterAudits = (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).length;
    assert.equal(afterAudits, beforeAudits);
  });

  it('replay of the approval that caused Ready returns the original success and does not write a second ready audit', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const it = await signIn(IT_SEC);
    assert.equal((await approve(dpo, NONVENDOR.caseId, version.versionId, 'dpo', revision)).statusCode, 201);
    assert.equal(
      (await approve(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision)).statusCode,
      201,
    );

    const key = randomUUID();
    const qcRunId = randomUUID();
    const first = await approve(
      it,
      NONVENDOR.caseId,
      version.versionId,
      'it_security',
      revision,
      key,
      qcRunId,
    );
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json<LaneDecisionResponse>().ready, true);
    const firstBody = first.body;

    const replay = await approve(
      it,
      NONVENDOR.caseId,
      version.versionId,
      'it_security',
      revision,
      key,
      qcRunId,
    );
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.body, firstBody);

    const state = await readyState(NONVENDOR.caseId, version.versionId);
    assert.equal(state.readyAudits.length, 1);
    assert.equal(state.readyNotices.length, 1);
  });

  it('a BU SPOC approval inserted by SQL (simulated policy bug) blocks Ready even with two real lane approvals', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);

    // Simulated policy bug: CM BU SPOC recorded as the DPO lane approver.
    await db.owner.execute(sql`
      INSERT INTO lane_decision (
        id, version_id, lane, decision, actor_subject_id, actor_role,
        feedback, observed_qc_run_id, decided_at, correlation_id
      ) VALUES (
        ${randomUUID()}::uuid, ${version.versionId}::uuid, 'dpo', 'approve',
        ${subjectOf(SPOC_CM)}, 'dpo', NULL, ${randomUUID()}::uuid,
        ${now()}, ${randomUUID()}
      )
    `);

    const ai = await signIn(AI_COE);
    const it = await signIn(IT_SEC);
    const a1 = await approve(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(a1.statusCode, 201, a1.body);
    assert.equal(a1.json<LaneDecisionResponse>().ready, false);
    const a2 = await approve(it, NONVENDOR.caseId, version.versionId, 'it_security', revision);
    assert.equal(a2.statusCode, 201, a2.body);
    assert.equal(a2.json<LaneDecisionResponse>().ready, false);

    const state = await readyState(NONVENDOR.caseId, version.versionId);
    assert.equal(state.version.ready_at, null);
    assert.equal(state.caseRow.desk_status, 'in_review');
    assert.equal(state.readyAudits.length, 0);
  });

  it('empty knownIdentities (local-google shape) still sets Ready when lane reviewers have sessions', async () => {
    await rebuildApp(true, { knownIdentities: [] });

    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    // Sign-ins create session.principal rows used when the known list is empty.
    const last = await approveAllThree(NONVENDOR.caseId, version.versionId, revision);
    assert.equal(last.ready, true);

    const state = await readyState(NONVENDOR.caseId, version.versionId);
    assert.ok(state.version.ready_at != null);
    assert.equal(state.caseRow.desk_status, 'ready');
    assert.equal(state.readyAudits.length, 1);
  });

  it('upload on a Ready case is 409 version_closed, not no_open_draft', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const last = await approveAllThree(NONVENDOR.caseId, version.versionId, revision);
    assert.equal(last.ready, true);

    const res = await upload(
      app,
      owner,
      NONVENDOR.caseId,
      'after-ready.pdf',
      Buffer.from('%PDF-1.4\n%%EOF\n'),
      'application/pdf',
    );
    assert.equal(res.statusCode, 409, res.body);
    const err = res.json<ErrorResponse>();
    assert.equal(err.error.code, 'stale_version');
    assert.equal((err.error.details as { reason: string }).reason, 'version_closed');
    assert.equal(
      (err.error.details as { guidanceKey: string }).guidanceKey,
      'error.stale_version.guidance.ready',
    );
  });
});
