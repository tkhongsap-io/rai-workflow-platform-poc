// W2-09: GET …/versions/:versionId/findings (version.view) returns stored findings + latestDisposition
// without inserting a qc_run. Beside W2-05; proves the owner read path that makes every disposition kind
// reachable. Issue #35 stays open.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import type { ErrorResponse } from '@rai/shared/errors';
import type { DispositionKind, LaneQcRunResponse, VersionFindingsResponse } from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '../support/observed-app.js';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { createSubjectDirectory } from '@rai/server/cases/subject-directory';
import { UPLOAD_LIMIT_DEFAULTS } from '@rai/server/config';
import { createDb, schema } from '@rai/server/db/client';
import { dispositionEvent } from '@rai/server/db/schema/disposition-event';
import { qcFinding } from '@rai/server/db/schema/qc-finding';
import { listFindingsForVersion } from '@rai/server/findings/repository';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { sendBackRecipientsFromIdentities } from '@rai/server/workflow/send-back-notice';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import type { VersionRef } from '@rai/shared/qc/types';
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
const AI_COE = 'fx-user-ai-coe';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let runner: ScriptedQcRunner;
let clock = Date.parse('2026-09-22T06:00:00Z');
const now = () => new Date(clock);

async function rebuildApp(): Promise<void> {
  if (app !== undefined) await app.close();
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
    findings: { qc: { runner } },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-09-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-09-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  await rebuildApp();
});
beforeEach(async () => {
  clock = Date.parse('2026-09-22T06:00:00Z');
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

describe(`W2-09 version findings read — ${SET}`, () => {
  it('owner GET returns findings with latestDisposition null without another qc_run; propose then GET shows fixed_proposed', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/lanes/ai_coe/qc-run`,
      headers: { 'content-type': 'application/json', ...asUser(ai) },
      payload: { expectedVersion: { versionId: version.versionId, revision } },
    });
    assert.equal(qc.statusCode, 200, qc.body);
    const qcBody = qc.json<LaneQcRunResponse>();
    assert.ok(qcBody.findings.length >= 1);
    const findingId = qcBody.findings[0]!.findingId;

    const runsBefore = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    const runCountBefore = Number((runsBefore.rows[0] as { n: number }).n);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/findings`,
      headers: asUser(owner),
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const body = listed.json<VersionFindingsResponse>();
    const row = body.findings.find((f) => f.findingId === findingId);
    assert.ok(row, 'owner GET includes the qc-run finding');
    assert.equal(row.latestDisposition, null);

    const runsAfter = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal(
      Number((runsAfter.rows[0] as { n: number }).n),
      runCountBefore,
      'GET must not insert another qc_run',
    );

    const propose = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/findings/${findingId}/dispositions`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...asUser(owner),
      },
      payload: {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'fixed_proposed',
      },
    });
    assert.equal(propose.statusCode, 201, propose.body);

    const listed2 = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/findings`,
      headers: asUser(owner),
    });
    assert.equal(listed2.statusCode, 200, listed2.body);
    const after = listed2.json<VersionFindingsResponse>().findings.find((f) => f.findingId === findingId);
    assert.equal(after?.latestDisposition, 'fixed_proposed');

    const unknown = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/versions/${randomUUID()}/findings`,
      headers: asUser(owner),
    });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json<ErrorResponse>().error.code, 'not_found');

    const notUuid = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/versions/not-a-uuid/findings`,
      headers: asUser(owner),
    });
    assert.equal(notUuid.statusCode, 404);
    assert.equal(notUuid.json<ErrorResponse>().error.code, 'not_found');
  });

  it('lists every finding with its latest disposition (created_at DESC, id DESC) in one query', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/lanes/ai_coe/qc-run`,
      headers: { 'content-type': 'application/json', ...asUser(ai) },
      payload: {
        expectedVersion: { versionId: version.versionId, revision: await caseRevision(VENDOR.caseId) },
      },
    });
    assert.equal(qc.statusCode, 200, qc.body);
    const qcBody = qc.json<LaneQcRunResponse>();
    const disposed = qcBody.findings[0]!.findingId;
    const bare = randomUUID();
    await db.owner.insert(qcFinding).values({
      id: bare,
      runId: qcBody.runId!,
      versionId: version.versionId,
      kind: 'defect',
      ruleId: 'synthetic',
      ruleRevision: '1',
      severity: 'low',
      owningLane: 'ai_coe',
      evidence: [],
      messageKey: 'synthetic',
      messageParams: {},
      createdAt: now(),
    });
    const event = (id: string, kind: DispositionKind, at: number) => ({
      id,
      findingId: disposed,
      kind,
      reason: 'synthetic',
      actorSubjectId: OWNER_A,
      actorRole: 'owner',
      createdAt: new Date(at),
      correlationId: randomUUID(),
    });
    // The later stamp outranks a larger id; on equal stamps the larger id wins.
    await db.owner
      .insert(dispositionEvent)
      .values([
        event('ffffffff-ffff-7fff-bfff-ffffffffffff', 'waived', clock + 1),
        event('00000000-0000-7000-8000-000000000001', 'not_applicable', clock + 2),
        event('00000000-0000-7000-8000-000000000002', 'fixed', clock + 2),
      ]);

    const handle = createDb(db.urls.app, { max: 1 });
    let queries = 0;
    const counted = drizzle(handle.pool, { schema, logger: { logQuery: () => void (queries += 1) } });
    try {
      const findings = await listFindingsForVersion(counted, VENDOR.caseId, version.versionId);
      assert.equal(findings.length, qcBody.findings.length + 1);
      assert.equal(queries, 1, 'one query regardless of finding count');
      assert.equal(findings.find((f) => f.findingId === disposed)?.latestDisposition, 'fixed');
      assert.equal(findings.find((f) => f.findingId === bare)?.latestDisposition, null);
    } finally {
      await handle.close();
    }

    const listed = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/findings`,
      headers: asUser(owner),
    });
    assert.equal(listed.statusCode, 200, listed.body);
    // Same shape as the qc-run response: messageParams is present even when the finding stored none.
    const bareRow = listed.json<VersionFindingsResponse>().findings.find((f) => f.findingId === bare);
    assert.deepEqual(bareRow?.messageParams, {});
  });
});
