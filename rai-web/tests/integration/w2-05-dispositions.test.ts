// W2-05 Done when (A09 / D05 / W0-06 §7.4 single-lane only): synthetic single-lane defect from the W1-10
// substitute can be dispositioned append-only. Reason required for waived/N/A; non-owning lane 403; owner's
// fixed stays proposed until owning lane confirms; finding bytes unchanged after disposition; second event
// appends; unavailable substitute result does not become a qc_finding row. #35 stays open (slot-5 / pack /
// unavailable owning lane blocked until §7.3). Ready is W2-06. Fixture set slice1-synthetic@1.

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
import type { DispositionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '@rai/server/app';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
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
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const ADMIN = 'fx-user-admin';
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
    findings: { db: db.app, now, qc: { runner, now } },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-05-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-05-out-'));
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

async function runLaneQc(
  session: FixtureSession,
  caseId: string,
  versionId: string,
  lane: string,
  revision: number,
): Promise<{ statusCode: number; body: LaneQcRunResponse }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision } },
  });
  return { statusCode: res.statusCode, body: res.json<LaneQcRunResponse>() };
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

describe(`W2-05 findings and dispositions — ${SET}`, () => {
  it('records a single-lane AI/COE defect on fx-case-vendor slot 1 via the injected substitute', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    assert.equal(qc.body.status, 'completed');
    assert.ok(qc.body.runId);
    assert.ok(qc.body.findings.length >= 1);
    const slot1 = qc.body.findings.find((f) => f.slot === 1);
    assert.ok(slot1, 'slot 1 defect expected');
    assert.equal(slot1.owningLane, 'ai_coe');

    const rows = await db.owner.execute(
      sql`SELECT owning_lane, kind, slot FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.ok(rows.rows.length >= 1);
    for (const row of rows.rows as Array<{ owning_lane: string; kind: string; slot: number }>) {
      assert.equal(row.kind, 'defect');
      assert.notEqual(row.owning_lane, 'refinement_pending');
      assert.ok([1, 2, 3, 4, 6, 7, 8].includes(row.slot));
    }
  });

  it('waived / N/A without a reason is 422; finding unchanged', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const findingId = qc.body.findings[0]!.findingId;

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
    const findingId = qc.body.findings.find((f) => f.owningLane === 'ai_coe')!.findingId;
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

  it("owner's fixed stays proposed until the owning lane confirms; second disposition appends", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const findingId = qc.body.findings[0]!.findingId;
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

  it('unavailable substitute result does not become a qc_finding row', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    runner.simulateError('runner_error');
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    assert.equal(qc.body.status, 'unavailable');
    assert.equal(qc.body.runId, null);
    assert.equal(qc.body.findings.length, 0);

    const findings = await db.owner.execute(
      sql`SELECT id FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal(findings.rows.length, 0);
    const runs = await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id = ${version.versionId}`);
    assert.equal(runs.rows.length, 0, 'prefer not recording unavailable as a qc_run (W0-06 §7.4)');
  });
});
