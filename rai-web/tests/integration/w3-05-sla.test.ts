// W3-05 done-when: a lane opened before a weekend and a holiday gets the frozen calendar's due date;
// resubmit restarts the clock; a later SLA revision does not change an already-frozen version; the breach
// query returns only pending lanes on the current review target that are past due. Issue #35 stays open.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { SlaBreach } from '@rai/shared/schemas/sla';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '../support/observed-app.js';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { createSubjectDirectory } from '@rai/server/cases/subject-directory';
import { UPLOAD_LIMIT_DEFAULTS } from '@rai/server/config';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { listSlaBreaches } from '@rai/server/sla/breach';
import { laneDueDates } from '@rai/server/sla/due-dates';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { sendBackRecipientsFromIdentities } from '@rai/server/workflow/send-back-notice';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const publicBaseUrl = new URL('http://127.0.0.1:8787');
const LIMITS = {
  maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
  maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
  maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
};
const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const VENDOR = findFixtureCase('fx-case-vendor')!;
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const REVIEWER = { dpo: DPO, ai_coe: 'fx-user-ai-coe', it_security: 'fx-user-it-security' } as const;
const OPEN = new Date('2026-04-09T02:00:00.000Z'); // Thursday 09:00 Bangkok, before Songkran

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let clock = OPEN.getTime();
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
    versions: {
      db: db.app,
      now,
      laneOpenRecipients: laneOpenRecipientsFromIdentities(FIXTURE_USERS),
    },
    decide: {
      db: db.app,
      now,
      sendBackRecipientsForOwner: (ownerSubjectId) =>
        sendBackRecipientsFromIdentities(FIXTURE_USERS, ownerSubjectId),
    },
    findings: {
      db: db.app,
      now,
      qc: { runner: new ScriptedQcRunner({ fixtureCaseIdOf: () => undefined, now }), now }, // clean lane QC
    },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w3-05-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w3-05-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  await rebuildApp();
});
beforeEach(async () => {
  clock = OPEN.getTime();
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

/** Runs the lane QC the reviewer sees, then approves on that run (H2: approve needs the latest lane-QC run). */
async function approve(caseId: string, versionId: string, lane: keyof typeof REVIEWER) {
  const reviewer = await signIn(REVIEWER[lane]);
  const expectedVersion = { versionId, revision: await caseRevision(caseId) };
  const base = `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}`;
  const qc = await app.inject({
    method: 'POST',
    url: `${base}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(reviewer) },
    payload: { expectedVersion },
  });
  assert.equal(qc.statusCode, 200, qc.body);
  const res = await app.inject({
    method: 'POST',
    url: `${base}/approve`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(reviewer) },
    payload: { expectedVersion, qcRunId: qc.json<LaneQcRunResponse>().runId },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<LaneDecisionResponse>();
}

describe(`W3-05 working-day SLA — ${SET}`, () => {
  it('freezes the due date across a later SLA revision, a holiday, and a resubmit', async () => {
    const owner = await signIn(OWNER_A);
    const v1 = await submitOk(owner, VENDOR.caseId);
    const first = await laneDueDates(db.app, v1.versionId);
    const byLane = Object.fromEntries(first.map((row) => [row.lane, row.dueOn]));
    assert.equal(byLane.dpo, '2026-04-17');
    assert.equal(byLane.ai_coe, '2026-04-21');
    assert.equal(byLane.it_security, '2026-04-21');

    const onDueDay = await listSlaBreaches(db.app, new Date('2026-04-17T02:00:00.000Z'));
    assert.equal(onDueDay.filter((row) => row.caseId === VENDOR.caseId).length, 0);
    const dayAfter = await listSlaBreaches(db.app, new Date('2026-04-18T02:00:00.000Z'));
    assert.deepEqual(
      dayAfter.filter((row) => row.caseId === VENDOR.caseId).map((row) => row.lane),
      ['dpo'],
    );

    await withTransaction(db.app, (tx) =>
      publishRevision(tx, {
        kind: 'sla',
        body: { dpo: 1, ai_coe: 1, it_security: 1 },
        publishedBy: 'system',
        publishedRole: 'system',
        correlationId: randomUUID(),
        publishedAt: new Date('2026-04-09T03:00:00.000Z'),
      }),
    );
    const stillFrozen = await laneDueDates(db.app, v1.versionId);
    assert.equal(stillFrozen.find((row) => row.lane === 'dpo')?.dueOn, '2026-04-17');

    const revision = await caseRevision(VENDOR.caseId);
    const dpo = await signIn(DPO);
    const sent = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${v1.versionId}/lanes/dpo/send-back`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...asUser(dpo),
      },
      payload: {
        expectedVersion: { versionId: v1.versionId, revision },
        feedback: { items: [{ slot: 2, deficiency: 'purpose is missing' }] },
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const whileDraftOpen = await listSlaBreaches(db.app, new Date('2026-04-22T02:00:00.000Z'));
    assert.equal(whileDraftOpen.filter((row) => row.caseId === VENDOR.caseId).length, 0);

    clock = Date.parse('2026-04-20T02:00:00.000Z');
    const ownerAgain = await signIn(OWNER_A);
    const v2 = await submitOk(ownerAgain, VENDOR.caseId);
    assert.notEqual(v2.versionId, v1.versionId);
    const restarted = await laneDueDates(db.app, v2.versionId);
    assert.equal(restarted.find((row) => row.lane === 'dpo')?.dueOn, '2026-04-21');
    assert.equal(
      (await laneDueDates(db.app, v1.versionId)).find((row) => row.lane === 'dpo')?.dueOn,
      '2026-04-17',
    );
    const afterRestart = await listSlaBreaches(db.app, new Date('2026-04-21T02:00:00.000Z'));
    assert.equal(afterRestart.filter((row) => row.caseId === VENDOR.caseId).length, 0);
  });

  it('lists only pending lanes of open review targets, sorted by due date, case and lane', async () => {
    const owner = await signIn(OWNER_A);
    const vendor = await submitOk(owner, VENDOR.caseId);
    const nonvendor = await submitOk(owner, NONVENDOR.caseId);
    await approve(NONVENDOR.caseId, nonvendor.versionId, 'dpo');

    const asOf = new Date('2026-04-22T02:00:00.000Z'); // every lane of both versions is past due
    const dpoLate: SlaBreach = {
      caseId: VENDOR.caseId,
      versionId: vendor.versionId,
      lane: 'dpo',
      dueOn: '2026-04-17',
    };
    const late = (caseId: string, v: SubmittedVersion): SlaBreach[] =>
      (['ai_coe', 'it_security'] as const).map((lane) => ({
        caseId,
        versionId: v.versionId,
        lane,
        dueOn: '2026-04-21',
      }));
    const vendorLate = late(VENDOR.caseId, vendor);
    const nonvendorLate = late(NONVENDOR.caseId, nonvendor); // its dpo lane is approved, so absent
    const byCase =
      VENDOR.caseId < NONVENDOR.caseId
        ? [...vendorLate, ...nonvendorLate]
        : [...nonvendorLate, ...vendorLate];
    assert.deepEqual(await listSlaBreaches(db.app, asOf), [dpoLate, ...byCase]);

    await approve(NONVENDOR.caseId, nonvendor.versionId, 'ai_coe');
    assert.equal((await approve(NONVENDOR.caseId, nonvendor.versionId, 'it_security')).ready, true);
    assert.deepEqual(await listSlaBreaches(db.app, asOf), [dpoLate, ...vendorLate]); // Ready drops out
  });
});
