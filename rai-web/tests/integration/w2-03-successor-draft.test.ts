// W2-03 Done when (A07 / D05): version N stays readable after send-back; exactly one pack_version N+1 draft
// exists after two concurrent send-backs (both lane decisions recorded); a stale action returns 409 with
// refresh guidance and writes nothing. Also the W2-02 review regression: a deliberately wrong revision on
// decide/send-back still succeeds while the version is the latest submitted; a second-lane send-back after
// the owner edits the successor draft (row_version may bump) still succeeds and does not create a second draft.
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
import type { ErrorDetails, ErrorResponse } from '@rai/shared/errors';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { PackDraft, PackDraftUpdateRequest } from '@rai/shared/schemas/pack';
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
    db: db.app,
    now,
    config: { nodeEnv: 'test', log: { level: 'info', pretty: false }, trustProxy: false, publicBaseUrl },
    logStream,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
    },
    cases: {
      businessUnits: createBusinessUnitDirectory(
        businessUnitsFromGrants(FIXTURE_USERS.flatMap((u) => [...u.roles])),
      ),
      subjects: createSubjectDirectory(db.app, { known: FIXTURE_USERS }),
    },
    artifacts: { store, limits: LIMITS },
    pack: { limits: { maxPackBytes: LIMITS.maxPackBytes } },
    versions: { laneOpenRecipients: LANE_OPEN_RECIPIENTS },
    decide: {
      sendBackRecipientsForOwner: (ownerSubjectId) =>
        sendBackRecipientsFromIdentities(FIXTURE_USERS, ownerSubjectId),
    },
    findings: {},
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-03-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-03-out-'));
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

async function nSnapshot(versionId: string) {
  const version = (
    await db.owner.execute(
      sql`SELECT id, version_number, submitted_at, stage_context, checklist_template_version, parent_version_id
          FROM pack_version WHERE id = ${versionId}`,
    )
  ).rows[0] as {
    id: string;
    version_number: number;
    submitted_at: Date | string;
    stage_context: string;
    checklist_template_version: string;
    parent_version_id: string | null;
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

function staleOf(res: Res): ErrorDetails['stale_version'] {
  const err = res.json<ErrorResponse>().error;
  assert.equal(err.code, 'stale_version', res.body);
  assert.ok(err.details, res.body);
  return err.details as ErrorDetails['stale_version'];
}

describe(`W2-03 successor draft concurrency and stale actions — ${SET}`, () => {
  it('two concurrent send-backs share one N+1 draft; both decisions and audits recorded; N frozen', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revisionAtSubmit = await caseRevision(NONVENDOR.caseId);
    const before = await nSnapshot(version.versionId);

    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const [dpoRes, aiRes] = await Promise.all([
      sendBack(dpo, NONVENDOR.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: revisionAtSubmit },
        feedback: { items: [{ slot: 2, deficiency: 'DPIA incomplete on scope' }] },
      }),
      sendBack(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: revisionAtSubmit },
        feedback: { items: [{ slot: 1, deficiency: 'Use-case brief missing risk note' }] },
      }),
    ]);
    assert.equal(dpoRes.statusCode, 201, dpoRes.body);
    assert.equal(aiRes.statusCode, 201, aiRes.body);
    const dpoBody = dpoRes.json<LaneDecisionResponse>();
    const aiBody = aiRes.json<LaneDecisionResponse>();
    assert.ok(dpoBody.successorDraftVersionId);
    assert.equal(dpoBody.successorDraftVersionId, aiBody.successorDraftVersionId);

    const drafts = await db.owner.execute(
      sql`SELECT id, version_number, parent_version_id, submitted_at IS NULL AS is_draft
          FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND parent_version_id = ${version.versionId}`,
    );
    assert.equal(drafts.rows.length, 1);
    const draft = drafts.rows[0] as {
      id: string;
      version_number: number;
      parent_version_id: string;
      is_draft: boolean;
    };
    assert.equal(draft.is_draft, true);
    assert.equal(draft.version_number, version.versionNumber + 1);
    assert.equal(draft.id, dpoBody.successorDraftVersionId);

    const decisions = await db.owner.execute(
      sql`SELECT lane, decision, actor_scopes FROM lane_decision
          WHERE version_id = ${version.versionId} ORDER BY lane`,
    );
    assert.deepEqual(decisions.rows, [
      { lane: 'ai_coe', decision: 'send_back', actor_scopes: findFixtureUser(AI_COE)!.roles },
      { lane: 'dpo', decision: 'send_back', actor_scopes: findFixtureUser(DPO)!.roles },
    ]);

    const after = await nSnapshot(version.versionId);
    assert.equal(String(after.version.submitted_at), String(before.version.submitted_at));
    assert.deepEqual(after.slots, before.slots);

    const frozen = await app.inject({
      method: 'GET',
      url: `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}`,
      headers: asUser(owner),
    });
    assert.equal(frozen.statusCode, 200, frozen.body);
    assert.equal(frozen.json<SubmittedVersion>().versionId, version.versionId);

    const sent = (await auditStore.read(db.owner)).filter((e) => e.action === 'lane.sent_back');
    assert.equal(sent.length, 2);
    const created = (await auditStore.read(db.owner)).filter((e) => e.action === 'draft.successor_created');
    assert.equal(created.length, 1);

    const notices = await db.owner.execute(
      sql`SELECT lane FROM notification WHERE event = 'send_back' AND case_id = ${NONVENDOR.caseId} ORDER BY lane`,
    );
    assert.deepEqual(
      notices.rows.map((r) => (r as { lane: string }).lane),
      ['ai_coe', 'dpo'],
    );
  });

  it('wrong revision still succeeds; second send-back after owner edits draft reuses N+1', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revisionAtSubmit = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const it = await signIn(IT_SEC);

    const first = await sendBack(dpo, NONVENDOR.caseId, version.versionId, 'dpo', {
      // Deliberately wrong revision: §5.2 does not require revision match for send-back.
      expectedVersion: { versionId: version.versionId, revision: revisionAtSubmit + 99 },
      feedback: { items: [{ slot: 2, deficiency: 'DPIA incomplete' }] },
    });
    assert.equal(first.statusCode, 201, first.body);
    const firstBody = first.json<LaneDecisionResponse>();
    assert.ok(firstBody.successorDraftVersionId);
    const draftId = firstBody.successorDraftVersionId;

    const draftGet = await app.inject({
      method: 'GET',
      url: `/api/cases/${NONVENDOR.caseId}/draft`,
      headers: asUser(owner),
    });
    assert.equal(draftGet.statusCode, 200, draftGet.body);
    const draft = draftGet.json<PackDraft>();
    assert.equal(draft.draftId, draftId);
    const revisionBeforeEdit = await caseRevision(NONVENDOR.caseId);

    const putBody: PackDraftUpdateRequest = {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
      stageContext: 'pre_build',
    };
    const put = await app.inject({
      method: 'PUT',
      url: `/api/cases/${NONVENDOR.caseId}/draft`,
      headers: { 'content-type': 'application/json', ...asUser(owner) },
      payload: putBody,
    });
    assert.equal(put.statusCode, 200, put.body);
    const revisionAfterEdit = await caseRevision(NONVENDOR.caseId);
    assert.equal(revisionAfterEdit, revisionBeforeEdit + 1);

    const second = await sendBack(it, NONVENDOR.caseId, version.versionId, 'it_security', {
      // Original expected version from the submitted page — including the pre-edit revision.
      expectedVersion: { versionId: version.versionId, revision: revisionAtSubmit },
      feedback: { items: [{ slot: 6, deficiency: 'Security assessment missing controls' }] },
    });
    assert.equal(second.statusCode, 201, second.body);
    const secondBody = second.json<LaneDecisionResponse>();
    assert.equal(secondBody.successorDraftVersionId, draftId);

    const draftCount = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version
          WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NULL`,
    );
    assert.equal((draftCount.rows[0] as { n: number }).n, 1);

    const decisions = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM lane_decision WHERE version_id = ${version.versionId}`,
    );
    assert.equal((decisions.rows[0] as { n: number }).n, 2);

    const created = (await auditStore.read(db.owner)).filter((e) => e.action === 'draft.successor_created');
    assert.equal(created.length, 1);
  });

  it('unknown versionId is not_found; Ready version is version_closed; both write nothing', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const it = await signIn(IT_SEC);

    const beforeDecisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const beforeAudit = (await auditStore.read(db.owner)).length;

    // A UUID that was never a version is not_found, not version_superseded (W2-04 covers a real older submitted).
    const otherId = randomUUID();
    const missing = await sendBack(dpo, NONVENDOR.caseId, otherId, 'dpo', {
      expectedVersion: { versionId: otherId, revision },
      feedback: { items: [{ slot: 2, deficiency: 'unknown target' }] },
    });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json<ErrorResponse>().error.code, 'not_found');
    assert.equal(
      (missing.json<ErrorResponse>().error.details as ErrorDetails['not_found'] | undefined)?.resource,
      'version',
    );

    // Close N by Ready (W2-06 applies ready_at; here we set it under the owner role to prove the gate).
    await db.owner.execute(sql`UPDATE pack_version SET ready_at = ${now()} WHERE id = ${version.versionId}`);

    // Existence (check 3) still wins after Ready: unknown UUID → not_found, not version_closed.
    const unknownAfterReady = await sendBack(it, NONVENDOR.caseId, otherId, 'it_security', {
      expectedVersion: { versionId: otherId, revision },
      feedback: { items: [{ slot: 6, deficiency: 'unknown after ready' }] },
    });
    assert.equal(unknownAfterReady.statusCode, 404, unknownAfterReady.body);
    assert.equal(unknownAfterReady.json<ErrorResponse>().error.code, 'not_found');
    assert.equal(
      (unknownAfterReady.json<ErrorResponse>().error.details as ErrorDetails['not_found'] | undefined)
        ?.resource,
      'version',
    );

    const closed = await sendBack(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', {
      expectedVersion: { versionId: version.versionId, revision },
      feedback: { items: [{ slot: 1, deficiency: 'should not write' }] },
    });
    assert.equal(closed.statusCode, 409, closed.body);
    const closedDetails = staleOf(closed);
    assert.equal(closedDetails.reason, 'version_closed');
    assert.equal(closedDetails.guidanceKey, 'error.stale_version.guidance.ready');

    const afterDecisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((afterDecisions.rows[0] as { n: number }).n, (beforeDecisions.rows[0] as { n: number }).n);
    assert.equal((await auditStore.read(db.owner)).length, beforeAudit);

    const drafts = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NULL`,
    );
    assert.equal((drafts.rows[0] as { n: number }).n, 0);
  });

  it('Ready + naming a real non-current version is version_closed (guidance ready), not version_superseded', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const aiRunId = await laneQcRunId(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision);

    const sent = await sendBack(dpo, NONVENDOR.caseId, version.versionId, 'dpo', {
      expectedVersion: { versionId: version.versionId, revision },
      feedback: { items: [{ slot: 2, deficiency: 'open successor' }] },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const draftId = sent.json<LaneDecisionResponse>().successorDraftVersionId;
    assert.ok(draftId);

    const beforeDecisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const beforeAudit = (await auditStore.read(db.owner)).length;
    const beforeDrafts = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NULL`,
    );

    await db.owner.execute(sql`UPDATE pack_version SET ready_at = ${now()} WHERE id = ${version.versionId}`);

    // Name the successor draft (exists on this case, not current) — Ready wins over version_superseded.
    const closed = await approve(ai, NONVENDOR.caseId, draftId, 'ai_coe', {
      expectedVersion: { versionId: draftId, revision },
      qcRunId: aiRunId,
    });
    assert.equal(closed.statusCode, 409, closed.body);
    const details = staleOf(closed);
    assert.equal(details.reason, 'version_closed');
    assert.equal(details.guidanceKey, 'error.stale_version.guidance.ready');

    const afterDecisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((afterDecisions.rows[0] as { n: number }).n, (beforeDecisions.rows[0] as { n: number }).n);
    assert.equal((await auditStore.read(db.owner)).length, beforeAudit);
    const afterDrafts = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM pack_version WHERE case_id = ${NONVENDOR.caseId} AND submitted_at IS NULL`,
    );
    assert.equal((afterDrafts.rows[0] as { n: number }).n, (beforeDrafts.rows[0] as { n: number }).n);
  });

  it('approve after a successor draft exists is version_closed; N stays readable', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const revision = await caseRevision(NONVENDOR.caseId);
    const dpo = await signIn(DPO);
    const ai = await signIn(AI_COE);
    const aiRunId = await laneQcRunId(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', revision);

    const sent = await sendBack(dpo, NONVENDOR.caseId, version.versionId, 'dpo', {
      expectedVersion: { versionId: version.versionId, revision },
      feedback: { items: [{ slot: 2, deficiency: 'fix slot 2' }] },
    });
    assert.equal(sent.statusCode, 201, sent.body);

    const beforeCount = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    const deny = await approve(ai, NONVENDOR.caseId, version.versionId, 'ai_coe', {
      expectedVersion: { versionId: version.versionId, revision },
      qcRunId: aiRunId,
    });
    assert.equal(deny.statusCode, 409, deny.body);
    const details = staleOf(deny);
    assert.equal(details.reason, 'version_closed');
    assert.equal(details.guidanceKey, 'error.stale_version.guidance.version_closed');

    const afterCount = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal((afterCount.rows[0] as { n: number }).n, (beforeCount.rows[0] as { n: number }).n);

    const frozen = await app.inject({
      method: 'GET',
      url: `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}`,
      headers: asUser(owner),
    });
    assert.equal(frozen.statusCode, 200, frozen.body);
  });
});
