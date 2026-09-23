// W0-06 5.3: an Idempotency-Key reused by one actor on two cases at the same moment is a client error. The case
// locks differ, so only the (actor, key) lock makes the second request see the first one's stored key and answer
// 422 `idempotency_key_reused` instead of failing on the primary key. Fixture set slice1-synthetic@1.

import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ErrorResponse } from '@rai/shared/errors';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { VersionRef } from '@rai/shared/qc/types';
import { buildApp } from '../support/observed-app.js';
import { assertNoLeak, createLogCapture } from '../support/log-capture.js';
import { createFilesystemBlobStore } from '@rai/server/artifacts/blob-store';
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
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const publicBaseUrl = new URL('http://127.0.0.1:8787');
const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const CASES = [findFixtureCase('fx-case-vendor')!.caseId, findFixtureCase('fx-case-nonvendor')!.caseId];
const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));
const now = () => new Date(Date.parse('2026-09-22T06:01:00Z'));

let db: TestDatabase;
let app: FastifyInstance;
let blobDir: string;
let outputDir: string;
const capture = createLogCapture();

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-idem-race-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-idem-race-out-'));
  const store = createFilesystemBlobStore(blobDir);
  await store.init();
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: new Date(Date.parse('2026-09-22T06:00:00Z')),
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
  const runner = new ScriptedQcRunner({
    fixtureCaseIdOf: (version: VersionRef) => fixtureCaseIdByRowId.get(version.caseId),
    now,
  });
  app = buildApp({
    config: { nodeEnv: 'test', log: { level: 'info', pretty: false }, trustProxy: false, publicBaseUrl },
    logStream: capture.stream,
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
    artifacts: {
      store,
      db: db.app,
      limits: {
        maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
        maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
        maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
      },
    },
    pack: { db: db.app, limits: { maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES }, now },
    versions: { db: db.app, now, laneOpenRecipients: laneOpenRecipientsFromIdentities(FIXTURE_USERS) },
    decide: {
      db: db.app,
      now,
      sendBackRecipientsForOwner: (owner) => sendBackRecipientsFromIdentities(FIXTURE_USERS, owner),
    },
    findings: { db: db.app, now, qc: { runner, now } },
  }).fastify;
  await app.ready();
});
afterEach(() => assertNoLeak(capture));
after(async () => {
  await app.close();
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

async function post(session: FixtureSession, url: string, payload: object, key?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...(key === undefined ? {} : { 'idempotency-key': key }),
      ...asUser(session),
    },
    payload,
  });
}

/** Submits the case's draft and runs the DPO lane QC on it; returns the approve body that names the real run. */
async function approvable(owner: FixtureSession, dpo: FixtureSession, caseId: string) {
  const draft = (
    await app.inject({ method: 'GET', url: `/api/cases/${caseId}/draft`, headers: asUser(owner) })
  ).json<PackDraft>();
  const submitted = await post(
    owner,
    `/api/cases/${caseId}/draft/submit`,
    { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
    randomUUID(),
  );
  assert.equal(submitted.statusCode, 201, submitted.body);
  const { versionId } = submitted.json<SubmittedVersion>();
  const revision = async () =>
    Number(
      (await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`)).rows[0]!.row_version,
    );
  const qc = await post(dpo, `/api/cases/${caseId}/versions/${versionId}/lanes/dpo/qc-run`, {
    expectedVersion: { versionId, revision: await revision() },
  });
  assert.equal(qc.statusCode, 200, qc.body);
  const { runId } = qc.json<LaneQcRunResponse>();
  assert.ok(runId !== null);
  return {
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/dpo/approve`,
    body: { expectedVersion: { versionId, revision: await revision() }, qcRunId: runId },
  };
}

describe(`idempotency key race — ${SET}`, () => {
  it('one key on two cases at once: one approval is 201, the other 422 idempotency_key_reused', async () => {
    const owner = await signInAsFixture(app, OWNER);
    const dpo = await signInAsFixture(app, DPO);
    const approvals = [];
    for (const caseId of CASES) approvals.push(await approvable(owner, dpo, caseId));
    capture.clear();

    const key = randomUUID();
    const responses = await Promise.all(approvals.map(({ url, body }) => post(dpo, url, body, key)));

    const statuses = responses.map((res) => res.statusCode).sort();
    assert.deepEqual(statuses, [201, 422], responses.map((res) => res.body).join('\n'));
    const refused = responses.find((res) => res.statusCode === 422)!.json<ErrorResponse<'invalid_input'>>();
    assert.deepEqual(refused.error.details?.fields, [
      { path: 'header.idempotency-key', messageKey: 'error.invalid_input.idempotency_key_reused' },
    ]);
    // The refusal is captured as the client error it is; nothing is captured as internal_error.
    const captured = capture.lines().filter((line) => line.event === 'error.captured');
    assert.deepEqual(
      captured.map((line) => line.fields?.category),
      ['invalid_input'],
    );
    const decisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal(decisions.rows[0]!.n, 1);
  });
});
