// W2-01 Done when: submit opens exactly three lanes (D02 slots via CURRENT_LANE_MAPPING / slotsForLane) and three
// lane_open notification rows in the same transaction as the freeze; an injected failure on the third lane rolls
// the whole submit back (draft unsubmitted, zero lane.opened, zero notification); risk_tier = high still opens all
// three (no routing); Idempotency-Key replay returns the original 201 and writes no second set. Fixture set
// slice1-synthetic@1; identities from W0-03 section 7.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CURRENT_LANE_MAPPING, LANES, slotsForLane, type Lane } from '@rai/shared/constants';
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
import {
  LANE_OPEN_RECIPIENTS,
  laneOpenDeepLinkPath,
} from '@rai/server/versions/open-lanes';
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

const OWNER_A = 'fx-user-owner-cm';
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const subjectOf = (id: string) => findFixtureUser(id)!.subjectId;

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let clock = Date.parse('2026-09-22T03:00:00Z');
const now = () => new Date(clock);
/** Test-only: when set, the next submit throws inside the transaction before the third lane.opened. */
let failBeforeThirdLaneOpen: (() => void) | undefined;

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
      ...(failBeforeThirdLaneOpen === undefined ? {} : { failBeforeThirdLaneOpen }),
    },
  });
  app = built.fastify;
  await app.ready();
}

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-01-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w2-01-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  await rebuildApp();
});
beforeEach(async () => {
  clock = Date.parse('2026-09-22T03:00:00Z');
  failBeforeThirdLaneOpen = undefined;
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

function submit(
  session: FixtureSession,
  caseId: string,
  body: unknown,
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
    payload: body as object,
  });
}
async function current(session: FixtureSession, caseId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: asUser(session),
  });
  assert.equal(res.statusCode, 200, res.body);
  const draft = res.json<PackDraft>();
  const body: SubmitRequest = {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  };
  return { draft, body };
}
async function submitOk(session: FixtureSession, caseId: string, key = randomUUID()) {
  const { draft, body } = await current(session, caseId);
  const res = await submit(session, caseId, body, key);
  assert.equal(res.statusCode, 201, res.body);
  return { draft, body, key, res, version: res.json<SubmittedVersion>() };
}
async function audit(action?: string) {
  const all = await auditStore.read(db.owner);
  return action === undefined ? all : all.filter((e) => e.action === action);
}
async function notificationsFor(caseId: string) {
  const r = await db.owner.execute(
    sql`SELECT event, version_id, case_id, lane, recipient, deep_link_path, template_key, template_params,
               status, attempts, correlation_id
        FROM notification WHERE case_id = ${caseId} ORDER BY lane`,
  );
  return r.rows as Array<{
    event: string;
    version_id: string;
    case_id: string;
    lane: string;
    recipient: string;
    deep_link_path: string;
    template_key: string;
    template_params: { lane: string; version_id: string };
    status: string;
    attempts: number;
    correlation_id: string;
  }>;
}
async function caseRow(caseId: string) {
  const r = await db.owner.execute(sql`SELECT * FROM "case" WHERE id = ${caseId}`);
  return r.rows[0] as Record<string, unknown>;
}

describe(`W2-01 submit opens three lanes atomically — ${SET}, fx-case-nonvendor`, () => {
  it('writes exactly three lane.opened audits (ai_coe, dpo, it_security) with slotsForLane and three lane_open notifications to the single-role recipients', async () => {
    const owner = await signIn(OWNER_A);
    const { version, key, res } = await submitOk(owner, NONVENDOR.caseId);
    const opened = await audit('lane.opened');
    assert.equal(opened.length, 3);
    assert.deepEqual(
      opened.map((e) => (e.targetRef as { lane: Lane }).lane),
      [...LANES],
    );
    for (const event of opened) {
      assert.equal(event.targetVersionId, version.versionId);
      assert.equal(event.targetCaseId, NONVENDOR.caseId);
      assert.equal(event.correlationId, res.headers['x-correlation-id']);
      assert.equal(event.actorSubjectId, subjectOf(OWNER_A));
      const ref = event.targetRef as {
        lane: Lane;
        slots: number[];
        idempotency_key: string;
        lane_mapping_version: string;
      };
      assert.deepEqual(ref.slots, slotsForLane(ref.lane, CURRENT_LANE_MAPPING));
      assert.equal(ref.idempotency_key, key);
      assert.equal(ref.lane_mapping_version, CURRENT_LANE_MAPPING.version);
    }
    const submitted = await audit('version.submitted');
    assert.equal(submitted.length, 1);
    assert.ok(submitted[0]!.seq < opened[0]!.seq, 'version.submitted precedes lane.opened');

    const rows = await notificationsFor(NONVENDOR.caseId);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.lane),
      [...LANES].sort(), // SQL ORDER BY lane
    );
    for (const lane of LANES) {
      const row = rows.find((r) => r.lane === lane)!;
      assert.equal(row.event, 'lane_open');
      assert.equal(row.recipient, LANE_OPEN_RECIPIENTS[lane]);
      assert.equal(row.status, 'queued');
      assert.equal(row.attempts, 0);
      assert.equal(row.template_key, 'mail.lane_opened');
      assert.equal(row.version_id, version.versionId);
      assert.equal(row.deep_link_path, laneOpenDeepLinkPath(NONVENDOR.caseId, version.versionId));
      assert.deepEqual(row.template_params, { lane, version_id: version.versionId });
      assert.equal(row.correlation_id, res.headers['x-correlation-id']);
    }
    // Dual-role, owners, SPOC and admin are never recipients of these three rows.
    assert.equal(
      rows.filter((r) =>
        ['dpo.spoc.hr@rai-desk.example', 'owner.cm@rai-desk.example', 'spoc.cm@rai-desk.example', 'admin@rai-desk.example'].includes(
          r.recipient,
        ),
      ).length,
      0,
    );
  });

  it('injected failure on the third lane rolls back the submit: draft stays open, zero lane.opened, zero notification', async () => {
    failBeforeThirdLaneOpen = () => {
      throw new Error('w2-01 injected failure before third lane.opened');
    };
    await rebuildApp();
    const owner = await signIn(OWNER_A);
    const { draft, body } = await current(owner, NONVENDOR.caseId);
    const before = await caseRow(NONVENDOR.caseId);
    const res = await submit(owner, NONVENDOR.caseId, body);
    assert.ok(res.statusCode >= 500, `expected server error, got ${res.statusCode}: ${res.body}`);
    const after = await caseRow(NONVENDOR.caseId);
    assert.equal(after.draft_version_id, draft.draftId);
    assert.equal(after.draft_version_id, before.draft_version_id);
    assert.equal(after.desk_status, 'draft');
    assert.equal(after.current_version_id, before.current_version_id);
    const version = await db.owner.execute(
      sql`SELECT submitted_at FROM pack_version WHERE id = ${draft.draftId}`,
    );
    assert.equal((version.rows[0] as { submitted_at: string | null }).submitted_at, null);
    assert.equal((await audit('lane.opened')).length, 0);
    assert.equal((await audit('version.submitted')).length, 0);
    assert.equal((await notificationsFor(NONVENDOR.caseId)).length, 0);
  });

  it('risk_tier = high still opens all three lanes (no routing or skip)', async () => {
    await db.raw('app', async (client) => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL rai.workflow_write = 'on'`);
      await client.query(`UPDATE "case" SET risk_tier = 'high' WHERE id = $1`, [NONVENDOR.caseId]);
      await client.query('COMMIT');
    });
    assert.equal((await caseRow(NONVENDOR.caseId)).risk_tier, 'high');
    const owner = await signIn(OWNER_A);
    const { version } = await submitOk(owner, NONVENDOR.caseId);
    const opened = (await audit('lane.opened')).filter((e) => e.targetVersionId === version.versionId);
    assert.equal(opened.length, 3);
    assert.deepEqual(
      opened.map((e) => (e.targetRef as { lane: Lane }).lane),
      [...LANES],
    );
    assert.equal((await notificationsFor(NONVENDOR.caseId)).length, 3);
    assert.equal((await caseRow(NONVENDOR.caseId)).risk_tier, 'high');
  });

  it('replaying the same Idempotency-Key returns the original 201 and writes no second lane.opened or notification rows', async () => {
    const owner = await signIn(OWNER_A);
    const { body, key, res } = await submitOk(owner, NONVENDOR.caseId);
    assert.equal((await audit('lane.opened')).length, 3);
    assert.equal((await notificationsFor(NONVENDOR.caseId)).length, 3);
    clock += 5_000;
    const replay = await submit(owner, NONVENDOR.caseId, body, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.body, res.body);
    assert.equal((await audit('lane.opened')).length, 3);
    assert.equal((await audit('version.submitted')).length, 1);
    assert.equal((await notificationsFor(NONVENDOR.caseId)).length, 3);
  });
});
