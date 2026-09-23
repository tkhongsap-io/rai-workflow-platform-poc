// W2-04 Done when (A07 / D05): resubmit of successor draft N+1 freezes it, opens all three lanes pending,
// writes version.resubmitted (not version.submitted), does not reuse N's approvals; N stays GET-readable and
// frozen; approve of N after resubmit is 409 version_superseded; idempotent replay; reviewer/Admin 403;
// stale revision 409. Doc wins: W0-06 §4.6 / §4.10, persistence Resubmit row. Fixture set slice1-synthetic@1.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ErrorDetails, ErrorResponse } from '@rai/shared/errors';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
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
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
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
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let clock = Date.parse('2026-09-22T05:00:00Z');
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
    findings: { db: db.app, now },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-04-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-04-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  await rebuildApp();
});
beforeEach(async () => {
  clock = Date.parse('2026-09-22T05:00:00Z');
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

async function submitOk(session: FixtureSession, caseId: string, key: string = randomUUID()) {
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
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: body,
  });
  assert.equal(res.statusCode, 201, res.body);
  return { version: res.json<SubmittedVersion>(), body, key, res };
}

async function caseRevision(caseId: string): Promise<number> {
  const r = await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`);
  return Number((r.rows[0] as { row_version: number }).row_version);
}

async function nSnapshot(versionId: string) {
  const version = (
    await db.owner.execute(
      sql`SELECT id, version_number, submitted_at, stage_context, checklist_template_version, parent_version_id,
                 lane_mapping_version, manifest_hash
          FROM pack_version WHERE id = ${versionId}`,
    )
  ).rows[0] as {
    id: string;
    version_number: number;
    submitted_at: Date | string;
    stage_context: string;
    checklist_template_version: string;
    parent_version_id: string | null;
    lane_mapping_version: string | null;
    manifest_hash: string | null;
  };
  const slots = (
    await db.owner.execute(
      sql`SELECT slot, state, reason, artifact_id FROM artifact_slot
          WHERE version_id = ${versionId} ORDER BY slot`,
    )
  ).rows as Array<{
    slot: number;
    state: string;
    reason: string | null;
    artifact_id: string | null;
  }>;
  return { version, slots };
}

function sendBack(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  body: unknown,
  key: string = randomUUID(),
): Promise<Res> {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/send-back`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: body as object,
  });
}

async function laneQcRunId(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision } },
  });
  assert.equal(res.statusCode, 200, res.body);
  const { runId } = res.json<LaneQcRunResponse>();
  assert.ok(runId);
  return runId;
}

function approve(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  body: unknown,
  key: string = randomUUID(),
): Promise<Res> {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/approve`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: body as object,
  });
}

function submit(
  session: FixtureSession,
  caseId: string,
  body: SubmitRequest,
  key: string = randomUUID(),
): Promise<Res> {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/draft/submit`,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      ...asUser(session),
    },
    payload: body,
  });
}

function staleOf(res: Res): ErrorDetails['stale_version'] {
  const err = res.json<ErrorResponse>().error;
  assert.equal(err.code, 'stale_version', res.body);
  assert.ok(err.details, res.body);
  return err.details as ErrorDetails['stale_version'];
}

/**
 * Submit N, DPO approves, IT/Security runs lane QC without deciding, AI/COE send-back creates N+1; returns N,
 * the open successor draft and IT/Security's run on N.
 */
async function reachSuccessorDraft() {
  const owner = await signIn(OWNER_A);
  const { version: n } = await submitOk(owner, NONVENDOR.caseId);
  const revisionAtSubmit = await caseRevision(NONVENDOR.caseId);
  const dpo = await signIn(DPO);
  const ai = await signIn(AI_COE);

  const approved = await approve(dpo, NONVENDOR.caseId, n.versionId, 'dpo', {
    expectedVersion: { versionId: n.versionId, revision: revisionAtSubmit },
    qcRunId: await laneQcRunId(dpo, NONVENDOR.caseId, n.versionId, 'dpo', revisionAtSubmit),
  });
  assert.equal(approved.statusCode, 201, approved.body);
  const itQcRunId = await laneQcRunId(
    await signIn(IT_SEC),
    NONVENDOR.caseId,
    n.versionId,
    'it_security',
    revisionAtSubmit,
  );

  const sent = await sendBack(ai, NONVENDOR.caseId, n.versionId, 'ai_coe', {
    expectedVersion: { versionId: n.versionId, revision: revisionAtSubmit },
    feedback: { items: [{ slot: 1, deficiency: 'Use-case brief missing risk note' }] },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  const draftId = sent.json<LaneDecisionResponse>().successorDraftVersionId;
  assert.ok(draftId);

  const draftGet = await app.inject({
    method: 'GET',
    url: `/api/cases/${NONVENDOR.caseId}/draft`,
    headers: asUser(owner),
  });
  assert.equal(draftGet.statusCode, 200, draftGet.body);
  const draft = draftGet.json<PackDraft>();
  assert.equal(draft.draftId, draftId);
  assert.equal(draft.parentVersionId, n.versionId);

  return { owner, n, draft, revisionAtSubmit, itQcRunId };
}

describe(`W2-04 resubmit N+1 under D05 — ${SET}`, () => {
  it('owner resubmits N+1: version.resubmitted, three lane.opened, projections pending, N frozen and GET-readable; approve N is version_superseded', async () => {
    const { owner, n, draft, itQcRunId } = await reachSuccessorDraft();
    const beforeN = await nSnapshot(n.versionId);
    const nApprovals = await db.owner.execute(
      sql`SELECT lane, decision FROM lane_decision WHERE version_id = ${n.versionId} ORDER BY lane`,
    );
    assert.deepEqual(
      (nApprovals.rows as Array<{ lane: string; decision: string }>).map((r) => [r.lane, r.decision]),
      [
        ['ai_coe', 'send_back'],
        ['dpo', 'approve'],
      ],
    );

    const key = randomUUID();
    const body: SubmitRequest = {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
    };
    const res = await submit(owner, NONVENDOR.caseId, body, key);
    assert.equal(res.statusCode, 201, res.body);
    const n1 = res.json<SubmittedVersion>();
    assert.equal(n1.versionId, draft.draftId);
    assert.equal(n1.parentVersionId, n.versionId);
    assert.equal(n1.versionNumber, n.versionNumber + 1);
    assert.equal(n1.isLatest, true);

    const audits = await auditStore.read(db.owner);
    const resubmitted = audits.filter((e) => e.action === 'version.resubmitted');
    assert.equal(resubmitted.length, 1);
    assert.equal(resubmitted[0]!.targetVersionId, n1.versionId);
    assert.equal((resubmitted[0]!.targetRef as { parent_version_id: string }).parent_version_id, n.versionId);
    assert.equal(
      (resubmitted[0]!.beforeRef as { current_version_id: string }).current_version_id,
      n.versionId,
    );
    assert.equal(
      audits.filter((e) => e.action === 'version.submitted' && e.targetVersionId === n1.versionId).length,
      0,
    );
    // First submit of v1 still wrote version.submitted.
    assert.equal(
      audits.filter((e) => e.action === 'version.submitted' && e.targetVersionId === n.versionId).length,
      1,
    );

    const opened = audits.filter((e) => e.action === 'lane.opened' && e.targetVersionId === n1.versionId);
    assert.equal(opened.length, 3);
    assert.deepEqual(opened.map((e) => (e.targetRef as { lane: string }).lane).sort(), [
      'ai_coe',
      'dpo',
      'it_security',
    ]);

    const caseRow = (
      await db.owner.execute(
        sql`SELECT privacy_status, security_status, rai_status, ai_readiness_status, current_version_id,
                   draft_version_id FROM "case" WHERE id = ${NONVENDOR.caseId}`,
      )
    ).rows[0] as {
      privacy_status: string;
      security_status: string;
      rai_status: string;
      ai_readiness_status: string;
      current_version_id: string;
      draft_version_id: string | null;
    };
    assert.equal(caseRow.privacy_status, 'pending');
    assert.equal(caseRow.security_status, 'pending');
    assert.equal(caseRow.rai_status, 'pending');
    assert.equal(caseRow.ai_readiness_status, 'not_ready');
    assert.equal(caseRow.current_version_id, n1.versionId);
    assert.equal(caseRow.draft_version_id, null);

    const n1Decisions = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM lane_decision WHERE version_id = ${n1.versionId}`,
    );
    assert.equal((n1Decisions.rows[0] as { n: number }).n, 0);

    const afterNApprovals = await db.owner.execute(
      sql`SELECT lane, decision FROM lane_decision WHERE version_id = ${n.versionId} ORDER BY lane`,
    );
    assert.deepEqual(afterNApprovals.rows, nApprovals.rows);

    const afterN = await nSnapshot(n.versionId);
    assert.equal(String(afterN.version.submitted_at), String(beforeN.version.submitted_at));
    assert.equal(afterN.version.lane_mapping_version, beforeN.version.lane_mapping_version);
    assert.equal(afterN.version.manifest_hash, beforeN.version.manifest_hash);
    assert.deepEqual(afterN.slots, beforeN.slots);

    const frozen = await app.inject({
      method: 'GET',
      url: `/api/cases/${NONVENDOR.caseId}/versions/${n.versionId}`,
      headers: asUser(owner),
    });
    assert.equal(frozen.statusCode, 200, frozen.body);
    const frozenBody = frozen.json<SubmittedVersion>();
    assert.equal(frozenBody.versionId, n.versionId);
    assert.equal(frozenBody.isLatest, false);

    const latest = await app.inject({
      method: 'GET',
      url: `/api/cases/${NONVENDOR.caseId}/versions/latest`,
      headers: asUser(owner),
    });
    assert.equal(latest.statusCode, 200, latest.body);
    assert.equal(latest.json<SubmittedVersion>().versionId, n1.versionId);

    const it = await signIn(IT_SEC);
    const beforeDecideAudit = (await auditStore.read(db.owner)).length;
    const beforeDecideCount = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const deny = await approve(it, NONVENDOR.caseId, n.versionId, 'it_security', {
      expectedVersion: { versionId: n.versionId, revision: await caseRevision(NONVENDOR.caseId) },
      qcRunId: itQcRunId,
    });
    assert.equal(deny.statusCode, 409, deny.body);
    const details = staleOf(deny);
    assert.equal(details.reason, 'version_superseded');
    assert.equal(details.guidanceKey, 'error.stale_version.guidance.version_superseded');
    assert.equal(details.current.versionId, n1.versionId);

    const afterDecideCount = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal(
      (afterDecideCount.rows[0] as { n: number }).n,
      (beforeDecideCount.rows[0] as { n: number }).n,
    );
    assert.equal((await auditStore.read(db.owner)).length, beforeDecideAudit);

    const idem = await db.owner.execute(
      sql`SELECT action FROM idempotency_key
          WHERE key = ${key} AND actor_subject_id = ${owner.session.principal.subjectId}`,
    );
    assert.equal((idem.rows[0] as { action: string }).action, 'case.resubmit');
  });

  it('idempotency replay of resubmit returns the original 201; no second freeze, audit, or notification', async () => {
    const { owner, draft } = await reachSuccessorDraft();
    const body: SubmitRequest = {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
    };
    const key = randomUUID();
    const first = await submit(owner, NONVENDOR.caseId, body, key);
    assert.equal(first.statusCode, 201, first.body);

    const beforeAudit = (await auditStore.read(db.owner)).length;
    const beforeOpened = (await auditStore.read(db.owner)).filter((e) => e.action === 'lane.opened').length;
    const beforeNotices = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM notification WHERE event = 'lane_open' AND version_id = ${draft.draftId}`,
    );
    const beforeVersions = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NOT NULL`,
    );

    clock += 5_000;
    const replay = await submit(owner, NONVENDOR.caseId, body, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.body, first.body);
    assert.notEqual(replay.headers['x-correlation-id'], first.headers['x-correlation-id']);

    assert.equal((await auditStore.read(db.owner)).length, beforeAudit);
    assert.equal(
      (await auditStore.read(db.owner)).filter((e) => e.action === 'lane.opened').length,
      beforeOpened,
    );
    assert.equal(
      (await auditStore.read(db.owner)).filter((e) => e.action === 'version.resubmitted').length,
      1,
    );
    const afterNotices = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM notification WHERE event = 'lane_open' AND version_id = ${draft.draftId}`,
    );
    assert.equal((afterNotices.rows[0] as { n: number }).n, (beforeNotices.rows[0] as { n: number }).n);
    const afterVersions = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NOT NULL`,
    );
    assert.equal((afterVersions.rows[0] as { n: number }).n, (beforeVersions.rows[0] as { n: number }).n);
  });

  it('reviewer and Admin on the successor draft get 403 and write nothing', async () => {
    const { draft } = await reachSuccessorDraft();
    const body: SubmitRequest = {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
    };
    const sessions = {
      dpo: await signIn(DPO),
      admin: await signIn(ADMIN),
      it: await signIn(IT_SEC),
    };
    const beforeAudit = (await auditStore.read(db.owner)).length;
    const beforeSubmitted = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NOT NULL`,
    );
    const beforeIdem = await db.owner.execute(sql`SELECT count(*)::int AS n FROM idempotency_key`);

    for (const session of [sessions.dpo, sessions.admin, sessions.it]) {
      const res = await submit(session, NONVENDOR.caseId, body);
      assert.equal(res.statusCode, 403, res.body);
      const err = res.json<ErrorResponse>().error;
      assert.equal(err.code, 'forbidden');
    }

    assert.equal((await auditStore.read(db.owner)).length, beforeAudit);
    assert.equal(
      (await auditStore.read(db.owner)).filter((e) => e.action === 'version.resubmitted').length,
      0,
    );
    const afterSubmitted = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NOT NULL`,
    );
    assert.equal((afterSubmitted.rows[0] as { n: number }).n, (beforeSubmitted.rows[0] as { n: number }).n);
    const afterIdem = await db.owner.execute(sql`SELECT count(*)::int AS n FROM idempotency_key`);
    assert.equal((afterIdem.rows[0] as { n: number }).n, (beforeIdem.rows[0] as { n: number }).n);

    const open = await db.owner.execute(
      sql`SELECT draft_version_id FROM "case" WHERE id = ${NONVENDOR.caseId}`,
    );
    assert.equal((open.rows[0] as { draft_version_id: string }).draft_version_id, draft.draftId);
  });

  it('stale revision on the successor draft is 409 revision_changed and writes nothing', async () => {
    const { owner, draft } = await reachSuccessorDraft();
    const beforeAudit = (await auditStore.read(db.owner)).length;
    const beforeSubmitted = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NOT NULL`,
    );

    const res = await submit(owner, NONVENDOR.caseId, {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision + 99 },
    });
    assert.equal(res.statusCode, 409, res.body);
    const details = staleOf(res);
    assert.equal(details.reason, 'revision_changed');
    assert.equal(details.guidanceKey, 'error.stale_version.guidance.revision_changed');
    assert.equal(details.current.versionId, draft.draftId);
    assert.equal(details.current.state, 'draft');

    assert.equal((await auditStore.read(db.owner)).length, beforeAudit);
    assert.equal(
      (await auditStore.read(db.owner)).filter((e) => e.action === 'version.resubmitted').length,
      0,
    );
    const afterSubmitted = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NOT NULL`,
    );
    assert.equal((afterSubmitted.rows[0] as { n: number }).n, (beforeSubmitted.rows[0] as { n: number }).n);
  });
});
