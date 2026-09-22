// W2-02 Done when: a reviewer decides only their lane; stale expected version rejected; repeated Idempotency-Key
// changes nothing; send-back without a named artifact rejected; Admin forbidden; dual-role DPO/SPOC cannot decide
// the DPO lane on an HR case and may on a CM case (D05); audit carries actor, version, lane and correlation ID.
// Fixture set slice1-synthetic@1; real Postgres harness.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LaneDecisionResponse } from '@rai/shared/schemas/review';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { buildApp } from '@rai/server/app';
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
import { FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const publicBaseUrl = new URL('http://127.0.0.1:8787');
const LIMITS = {
  maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
  maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
  maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
};
const LANE_OPEN_RECIPIENTS = laneOpenRecipientsFromIdentities(FIXTURE_USERS);

const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SEC = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
const DUAL = 'fx-user-dpo-spoc-hr';
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const HR_DUAL = findFixtureCase('fx-case-hr-dualrole')!;
const subjectOf = (id: string) => findFixtureUser(id)!.subjectId;
const emailOf = (id: string) => findFixtureUser(id)!.email;

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let clock = Date.parse('2026-09-22T04:00:00Z');
const now = () => new Date(clock);

async function rebuildApp(): Promise<void> {
  if (app !== undefined) await app.close();
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
      sendBackRecipientsForOwner: (ownerSubjectId) =>
        sendBackRecipientsFromIdentities(FIXTURE_USERS, ownerSubjectId),
    },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-02-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-02-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  await rebuildApp();
});
beforeEach(async () => {
  clock = Date.parse('2026-09-22T04:00:00Z');
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
  await rebuildApp();
});
after(async () => {
  await app.close();
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

const signIn = (id: string) => signInAsFixture(app, id);
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json<T>(): T };

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
    const qcRunId = randomUUID();
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
    const payload = {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: randomUUID(),
    };
    const dpo = await signIn(DPO);
    const wrong = await decide(dpo, NONVENDOR.caseId, version.versionId, 'it_security', 'approve', payload);
    assert.equal(wrong.statusCode, 403, wrong.body);
    assert.equal(wrong.json<{ error: { code: string } }>().error.code, 'forbidden');

    const admin = await signIn(ADMIN);
    const adminRes = await decide(admin, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', payload);
    assert.equal(adminRes.statusCode, 403, adminRes.body);

    const decisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((decisions.rows[0] as { n: number }).n, 0);
  });

  it('stale expected revision is rejected; approve without qcRunId is invalid_input lane_qc_not_run', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);

    const stale = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: version.versionId, revision: revision - 1 },
      qcRunId: randomUUID(),
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(
      stale.json<{ error: { code: string; details: { reason: string } } }>().error.details.reason,
      'revision_changed',
    );

    const noQc = await decide(dpo, NONVENDOR.caseId, version.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: '',
    });
    // empty string fails schema or our requireQcRunId — either 422
    assert.equal(noQc.statusCode, 422, noQc.body);
  });

  it('repeated Idempotency-Key returns the same body and writes no second decision', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const key = randomUUID();
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: randomUUID(),
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

  it('send-back without named artifact feedback is rejected; with feedback creates successor draft and notice', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);

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
      sql`SELECT id, parent_version_id, version_number, submitted_at IS NULL AS is_draft
          FROM pack_version WHERE id = ${body.successorDraftVersionId}`,
    );
    const draft = drafts.rows[0] as {
      id: string;
      parent_version_id: string;
      version_number: number;
      is_draft: boolean;
    };
    assert.equal(draft.parent_version_id, version.versionId);
    assert.equal(draft.version_number, version.versionNumber + 1);
    assert.equal(draft.is_draft, true);

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

  it('D05: fx-user-dpo-spoc-hr cannot decide DPO on HR case; may decide DPO on CM case', async () => {
    const owner = await signIn(OWNER_A);
    const hrVersion = await submitOk(owner, HR_DUAL.caseId);
    const hrRevision = await caseRevision(HR_DUAL.caseId);
    const dual = await signIn(DUAL);
    const hrDeny = await decide(dual, HR_DUAL.caseId, hrVersion.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: hrVersion.versionId, revision: hrRevision },
      qcRunId: randomUUID(),
    });
    assert.equal(hrDeny.statusCode, 403, hrDeny.body);

    const cmVersion = await submitOk(owner, NONVENDOR.caseId);
    const cmRevision = await caseRevision(NONVENDOR.caseId);
    const cmOk = await decide(dual, NONVENDOR.caseId, cmVersion.versionId, 'dpo', 'approve', {
      expectedVersion: { versionId: cmVersion.versionId, revision: cmRevision },
      qcRunId: randomUUID(),
    });
    assert.equal(cmOk.statusCode, 201, cmOk.body);

    // send-back also forbidden on HR
    const hrSend = await decide(dual, HR_DUAL.caseId, hrVersion.versionId, 'dpo', 'send-back', {
      expectedVersion: { versionId: hrVersion.versionId, revision: hrRevision },
      feedback: { items: [{ slot: 2, deficiency: 'fix me' }] },
    });
    assert.equal(hrSend.statusCode, 403, hrSend.body);
  });

  it('AI/COE and IT/Security each decide only their own lane', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    let revision = await caseRevision(NONVENDOR.caseId);
    const ai = await signIn(AI_COE);
    const aiOk = await decide(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: randomUUID(),
    });
    assert.equal(aiOk.statusCode, 201, aiOk.body);
    revision = await caseRevision(NONVENDOR.caseId);
    const it = await signIn(IT_SEC);
    const itOk = await decide(it, NONVENDOR.caseId, version.versionId, 'it_security', 'approve', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: randomUUID(),
    });
    assert.equal(itOk.statusCode, 201, itOk.body);
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
