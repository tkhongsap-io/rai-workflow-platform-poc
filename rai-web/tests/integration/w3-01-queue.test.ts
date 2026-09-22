// W3-01 / A06: real Postgres, synthetic fixtures, actual authenticated HTTP handlers.

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogCapture, assertNoLeak, type LogCapture } from '../support/log-capture.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '@rai/server/app';
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
import { readQueue } from '@rai/server/queue/repository';
import type { QueueResponse, QueueQuery } from '@rai/shared/schemas/queue';
import { createDb } from '@rai/server/db/client';
import type pg from 'pg';
import type { ErrorResponse } from '@rai/shared/errors';
import type { Actor } from '@rai/server/authz/policy';
import { cases } from '@rai/server/db/schema/case';
import { qcRun } from '@rai/server/db/schema/qc-run';
import { qcFinding } from '@rai/server/db/schema/qc-finding';
import { dispositionEvent } from '@rai/server/db/schema/disposition-event';
import { setWorkflowWrite } from '@rai/server/db/transaction';
import { eq } from 'drizzle-orm';
import { laneDueDates } from '@rai/server/sla/due-dates';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { sendBackRecipientsFromIdentities } from '@rai/server/workflow/send-back-notice';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
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
const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const VENDOR = findFixtureCase('fx-case-vendor')!;
const OPEN = new Date('2026-04-09T02:00:00.000Z'); // Thursday 09:00 Bangkok, before Songkran

let capture: LogCapture;
afterEach(() => {
  assertNoLeak(capture);
});
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
  capture = createLogCapture();
  const logStream = capture.stream;
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
      knownIdentities: FIXTURE_USERS,
    },
    findings: { db: db.app, now, knownIdentities: FIXTURE_USERS },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w3-01-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w3-01-out-'));
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

async function queue(session: FixtureSession, query: QueueQuery = {}): Promise<QueueResponse> {
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const res = await app.inject({ method: 'GET', url: `/api/queue?${params}`, headers: asUser(session) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<QueueResponse>();
}
const actorFor = (id: string): Actor => {
  const user = FIXTURE_USERS.find((u) => u.fixtureUserId === id)!;
  return { subjectId: user.subjectId, roles: [...user.roles] };
};

describe(`W3-01 scoped queue — ${SET}`, () => {
  it('enforces session before query validation, validates query, and preserves case list/deep-link checks', async () => {
    assert.equal((await app.inject('/api/queue?page=0')).statusCode, 401);
    const owner = await signIn(OWNER_A);
    for (const query of [
      'page=0',
      'page=1.2',
      'page=1000001',
      'pageSize=101',
      'searchBy=name',
      'status=ready',
      'extra=1',
      'owner=',
      `search=${'a'.repeat(201)}`,
    ]) {
      const res = await app.inject({ url: `/api/queue?${query}`, headers: asUser(owner) });
      assert.equal(res.statusCode, 422, res.body);
      assert.equal(res.json<ErrorResponse>().error.code, 'invalid_input');
    }
    assert.equal((await app.inject({ url: '/api/cases', headers: asUser(owner) })).statusCode, 200);
    const other = await signIn('fx-user-owner-cm-2');
    assert.equal(
      (await app.inject({ url: `/api/cases/${VENDOR.caseId}`, headers: asUser(other) })).statusCode,
      403,
    );
  });

  it('applies every role scope, union of grants, and no grants before pages/counts/options', async () => {
    // Owner still sees their HR cases; BU scope uses the ID, not descriptive business_unit.
    await db.owner
      .update(cases)
      .set({ businessUnitId: 'HR', businessUnit: 'Consumer Mobile' })
      .where(eq(cases.id, VENDOR.caseId));
    for (const user of FIXTURE_USERS) {
      const result = await queue(await signIn(user.fixtureUserId), { pageSize: 1 });
      const expected =
        user.fixtureUserId === 'fx-user-owner-cm-2' ? 0 : user.fixtureUserId === 'fx-user-spoc-cm' ? 2 : 5;
      assert.equal(result.total, expected, user.fixtureUserId);
      assert.equal(
        Object.values(result.statusCounts).reduce((a, b) => a + b, 0),
        expected,
      );
      assert.equal(result.items.length, Math.min(1, expected));
    }
    const none = await readQueue(db.app, { subjectId: 'synthetic:no-grants', roles: [] }, {});
    const empty = await queue(await signIn('fx-user-owner-cm-2'));
    assert.deepEqual(none, empty);
    const spoc = await signIn('fx-user-spoc-cm');
    const before = await queue(spoc);
    await db.owner
      .update(cases)
      .set({ ownerSubjectId: 'synthetic:hidden', businessOwner: 'ชื่อซ่อน', useCaseGroup: 'hidden-group' })
      .where(eq(cases.id, VENDOR.caseId));
    assert.deepEqual(await queue(spoc), before);
    for (const [searchBy, search] of [
      ['all', 'ชื่อซ่อน'],
      ['owner', 'synthetic:hidden'],
      ['useCaseGroup', 'hidden-group'],
      ['sourceRecordId', 'Unknown'],
      ['status', 'draft'],
    ] as const) {
      const result = await queue(spoc, { searchBy, search, pageSize: 1 });
      assert.ok(result.items.every((item) => item.caseId !== VENDOR.caseId));
      assert.deepEqual(result.filterOptions, before.filterOptions);
      assert.deepEqual(result.statusCounts, before.statusCounts);
      const emptyOwner = await queue(await signIn('fx-user-owner-cm-2'), { searchBy, search });
      assert.equal(emptyOwner.total, 0);
      assert.deepEqual(emptyOwner.filterOptions, empty.filterOptions);
      assert.deepEqual(emptyOwner.statusCounts, empty.statusCounts);
    }
    const filtered = await queue(spoc, { owner: 'synthetic:hidden', useCaseGroup: 'hidden-group' });
    assert.equal(filtered.total, 0);
    assert.deepEqual(filtered.filterOptions, before.filterOptions);
    assert.deepEqual(filtered.statusCounts, before.statusCounts);
    assert.deepEqual(await queue(spoc, { owner: 'nonexistent', useCaseGroup: 'nonexistent' }), filtered);
  });

  it('searches each field, Thai owner names separately from IDs, NFC on both sides and literal wildcards', async () => {
    await db.owner
      .update(cases)
      .set({
        useCaseName: 'ทดสอบ cafe\u0301 50% a_b c\\d wow!',
        businessOwner: 'ชื่อทดสอบ',
        sourceRecordId: 'VRO-SPECIAL',
        useCaseGroup: 'queue-special',
      })
      .where(eq(cases.id, VENDOR.caseId));
    const owner = await signIn(OWNER_A);
    for (const [searchBy, search] of [
      ['all', 'ทดสอบ'],
      ['sourceRecordId', 'vro-special'],
      ['owner', 'ชื่อทดสอบ'],
      ['owner', 'fixture:fx-user-owner-cm'],
      ['useCaseGroup', 'queue-special'],
      ['status', 'DRAFT'],
    ] as const) {
      const r = await queue(owner, { searchBy, search });
      assert.ok(
        r.items.some((x) => x.caseId === VENDOR.caseId),
        `${searchBy}:${search}`,
      );
    }
    for (const search of ['CAFÉ', 'café', ' cafe\u0301 ', '50%', 'a_b', 'c\\d', 'wow!']) {
      const r = await queue(owner, { search });
      assert.equal(r.total, 1, search);
    }
    for (const search of ['%', '_', '\\', '!'])
      assert.equal((await queue(owner, { search })).total, 1, search);
    assert.equal((await queue(owner, { searchBy: 'sourceRecordId', search: 'ชื่อทดสอบ' })).total, 0);
    const combined = await queue(owner, {
      searchBy: 'owner',
      search: 'ชื่อทดสอบ',
      owner: 'fixture:fx-user-owner-cm',
      status: 'draft',
      useCaseGroup: 'queue-special',
    });
    assert.equal(combined.total, 1);
    assert.equal(combined.items[0]!.ownerDisplayName, 'ชื่อทดสอบ');
    assert.equal(combined.items[0]!.businessOwner, 'fixture:fx-user-owner-cm');
    assert.equal((await queue(owner, { search: '   ' })).total, 5);
    const unknown = FIXTURE_CASES.find((c) => c.caseId !== VENDOR.caseId)!;
    await db.owner.update(cases).set({ sourceRecordId: 'Unknown' }).where(eq(cases.id, unknown.caseId));
    assert.ok(
      (await queue(owner, { searchBy: 'sourceRecordId', search: 'unknown' })).items.some(
        (x) => x.caseId === unknown.caseId,
      ),
    );
    const vendor = (await queue(owner, { search: 'VRO-SPECIAL' })).items[0]!;
    assert.equal((await queue(owner, { search: vendor.registryId })).items[0]?.caseId, VENDOR.caseId);
  });

  it('paginates with deterministic updatedAt/id order; totals/facets survive empty and filtered pages', async () => {
    const owner = await signIn(OWNER_A);
    await db.owner.update(cases).set({ updatedAt: OPEN });
    const all = await queue(owner);
    assert.deepEqual(
      all.items.map((x) => x.caseId),
      all.items
        .map((x) => x.caseId)
        .sort()
        .reverse(),
    );
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await queue(owner, { page, pageSize: 2 });
      assert.equal(r.total, 5);
      ids.push(...r.items.map((x) => x.caseId));
      assert.deepEqual(r.filterOptions, all.filterOptions);
    }
    assert.deepEqual(
      ids,
      all.items.map((x) => x.caseId),
    );
    const empty = await queue(owner, { page: 1000000, pageSize: 100 });
    assert.equal(empty.total, 5);
    assert.deepEqual(empty.items, []);
    assert.deepEqual(empty.statusCounts, all.statusCounts);
    assert.deepEqual(all.filterOptions.owners, [...new Set(all.items.map((x) => x.businessOwner))].sort());
    assert.deepEqual(
      all.filterOptions.useCaseGroups,
      [...new Set(all.items.map((x) => x.useCaseGroup))].sort(),
    );
  });

  it('returns draft, submitted and successor states with frozen dates and nextAction', async () => {
    const owner = await signIn(OWNER_A);
    // Read by ID locally so this assertion does not depend on fixture external-ID encoding.
    const card = async () => (await queue(owner)).items.find((x) => x.caseId === VENDOR.caseId)!;
    assert.equal((await card()).status, 'draft');
    assert.deepEqual((await card()).lanes, []);
    assert.equal((await card()).latestVersionNumber, 1);
    assert.equal((await card()).nextAction, 'prepare_pack');
    const v1 = await submitOk(owner, VENDOR.caseId);
    const first = await card();
    assert.equal(first.status, 'in_review');
    assert.equal(first.nextAction, 'review_lanes');
    assert.deepEqual(
      first.lanes.map((x) => x.due),
      await laneDueDates(db.app, v1.versionId),
    );
    assert.equal(first.lanes.find((x) => x.lane === 'dpo')?.due.dueOn, '2026-04-17');
    await withTransaction(db.app, (tx) =>
      publishRevision(tx, {
        kind: 'sla',
        body: { dpo: 1, ai_coe: 1, it_security: 1 },
        publishedBy: 'system',
        publishedRole: 'system',
        correlationId: randomUUID(),
        publishedAt: new Date('2026-04-09T03:00:00Z'),
      }),
    );
    assert.deepEqual((await card()).lanes, first.lanes);
    const dpo = await signIn(DPO);
    const sent = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${v1.versionId}/lanes/dpo/send-back`,
      headers: { ...asUser(dpo), 'idempotency-key': randomUUID() },
      payload: {
        expectedVersion: { versionId: v1.versionId, revision: await caseRevision(VENDOR.caseId) },
        feedback: { items: [{ slot: 2, deficiency: 'synthetic missing purpose' }] },
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const successor = await card();
    assert.equal(successor.status, 'sent_back');
    assert.equal(successor.nextAction, 'correct_pack');
    assert.equal(successor.currentVersionNumber, 1);
    assert.equal(successor.latestVersionNumber, 2);
    assert.equal(successor.lanes.find((x) => x.lane === 'dpo')?.status, 'sent_back');
    assert.deepEqual(
      successor.lanes.map((x) => x.due),
      first.lanes.map((x) => x.due),
    );
    clock = Date.parse('2026-04-20T02:00:00Z');
    const fresh = await signIn(OWNER_A);
    await submitOk(fresh, VENDOR.caseId);
    const second = (await queue(fresh)).items.find((x) => x.caseId === VENDOR.caseId)!;
    assert.equal(second.currentVersionNumber, 2);
    assert.equal(second.latestVersionNumber, 2);
    assert.equal(second.lanes.find((x) => x.lane === 'dpo')?.due.dueOn, '2026-04-21');
    assert.ok(second.lanes.every((x) => x.status === 'pending'));
  });

  it('derives awaiting_disposition using the latest event, then ready takes precedence', async () => {
    const owner = await signIn(OWNER_A);
    const v = await submitOk(owner, VENDOR.caseId);
    // Seed workflow rows under the same projection gate; this test targets read derivation, not transition authorization.
    const runId = randomUUID(),
      findingId = randomUUID();
    await db.owner.insert(qcRun).values({
      id: runId,
      versionId: v.versionId,
      trigger: 'submit',
      engineId: 'synthetic',
      ruleRevision: '1',
      status: 'completed',
      requestedAt: now(),
      completedAt: now(),
      correlationId: randomUUID(),
    });
    await db.owner.insert(qcFinding).values({
      id: findingId,
      runId,
      versionId: v.versionId,
      kind: 'defect',
      ruleId: 'synthetic',
      ruleRevision: '1',
      severity: 'low',
      owningLane: 'dpo',
      evidence: [],
      messageKey: 'synthetic',
      messageParams: {},
      createdAt: now(),
    });
    const card = async () => (await queue(owner)).items.find((x) => x.caseId === VENDOR.caseId)!;
    assert.equal((await card()).status, 'in_review');
    await db.owner.transaction(async (tx) => {
      await setWorkflowWrite(tx);
      await tx
        .update(cases)
        .set({ raiStatus: 'approved', privacyStatus: 'approved', securityStatus: 'approved' })
        .where(eq(cases.id, VENDOR.caseId));
    });
    assert.equal((await card()).status, 'awaiting_disposition');
    assert.equal((await card()).nextAction, 'resolve_findings');
    assert.equal((await queue(owner, { status: 'awaiting_disposition' })).total, 1);
    assert.equal((await queue(owner, { searchBy: 'status', search: 'awaiting_disposition' })).total, 1);
    assert.equal((await queue(owner)).statusCounts.awaiting_disposition, 1);
    const event = async (kind: string, id: string) =>
      db.owner.insert(dispositionEvent).values({
        id,
        findingId,
        kind,
        reason: 'synthetic',
        actorSubjectId: 'synthetic',
        actorRole: 'dpo',
        createdAt: now(),
        correlationId: randomUUID(),
      });
    await event('fixed_proposed', '00000000-0000-4000-8000-000000000001');
    assert.equal((await card()).status, 'awaiting_disposition');
    await event('fixed_confirmed', '00000000-0000-4000-8000-000000000002');
    assert.equal((await card()).status, 'in_review'); // same timestamp: ID breaks the tie
    await db.owner.execute(sql`UPDATE pack_version SET ready_at=${now()} WHERE id=${v.versionId}`);
    assert.equal((await card()).status, 'ready_for_launch');
    assert.equal((await card()).nextAction, 'review_complete');
    const ready = await queue(owner, { status: 'ready_for_launch' });
    assert.equal(ready.total, 1);
    assert.equal(ready.statusCounts.ready_for_launch, 1);
  });
  it('keeps facets, total, page and lane data on one snapshot across a committed write', async (t) => {
    const owner = await signIn(OWNER_A);
    await submitOk(owner, VENDOR.caseId);
    await db.owner.update(cases).set({ useCaseGroup: 'snapshot-only' }).where(eq(cases.id, VENDOR.caseId));
    const actor = actorFor(OWNER_A);
    const baseline = await readQueue(db.app, actor, {});
    const handle = createDb(db.urls.app, { max: 1 });
    let intervened = false;
    // Instrument only this test connection, after the first actual SQL result. No production test hook.
    handle.pool.on('connect', (client) => {
      const original = client.query.bind(client) as unknown as (
        config: string | pg.QueryConfig,
        values?: unknown[],
      ) => Promise<pg.QueryResult>;
      t.mock.method(client, 'query', async (config: string | pg.QueryConfig, values?: unknown[]) => {
        const result = await original(config, values);
        const text = typeof config === 'string' ? config : config.text;
        if (!intervened && text.includes('group by')) {
          intervened = true;
          await db.owner.transaction(async (tx) => {
            await setWorkflowWrite(tx);
            await tx
              .update(cases)
              .set({
                ownerSubjectId: 'synthetic:moved',
                useCaseGroup: 'changed-group',
                privacyStatus: 'sent_back',
              })
              .where(eq(cases.id, VENDOR.caseId));
          });
        }
        return result;
      });
    });
    try {
      assert.deepEqual(await readQueue(handle.db, actor, {}), baseline);
      assert.equal(intervened, true);
      const after = await readQueue(db.app, actor, {});
      assert.equal(after.total, baseline.total - 1);
      assert.ok(!after.filterOptions.useCaseGroups.includes('snapshot-only'));
    } finally {
      await handle.close();
    }
  });
});
