// W2-05 Done when (A09 / D05 / W0-06 §7.4 single-lane only): synthetic single-lane defect from the W1-10
// substitute can be dispositioned append-only. Reason required for waived/N/A; non-owning lane 403; owner's
// fixed stays proposed until owning lane confirms; finding bytes unchanged after disposition; second event
// appends; unavailable stores qc_run status=unavailable with zero findings. #35 stays open (slot-5 / pack /
// unavailable owning lane blocked until §7.3). Ready is W2-06. Fixture set slice1-synthetic@1.

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogCapture, assertNoLeak, type LogCapture } from '../support/log-capture.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { StaleVersionError, type ErrorResponse } from '@rai/shared/errors';
import type { DispositionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '../support/observed-app.js';
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
import type { QcRunner, VersionRef } from '@rai/shared/qc/types';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { computeReadiness } from '@rai/server/observability/health';
import { createStoreProbes } from '@rai/server/observability/probes';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
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
const IT_SECURITY = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
const SPOC_CM = 'fx-user-spoc-cm';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));

let db: TestDatabase;
let app: FastifyInstance;
let diagnostics: Pick<ReturnType<typeof buildApp>, 'emitter' | 'errors'>;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
let runner: ScriptedQcRunner;
let capture: LogCapture;
let clock = Date.parse('2026-09-22T06:00:00Z');
const now = () => new Date(clock);

async function rebuildApp(runnerOverride?: QcRunner): Promise<void> {
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
  capture = createLogCapture();
  const logStream = capture.stream;
  const built = buildApp({
    config: { nodeEnv: 'test', log: { level: 'info', pretty: false }, trustProxy: false, publicBaseUrl },
    logStream,
    observability: {
      db: db.app,
      readiness: () =>
        computeReadiness(
          {
            identity: () => adapter.health(),
            loopbackBind: true,
            mailKind: 'memory',
            qcKind: 'substitute',
            build: { commit: 'dev', schemaVersion: '8' },
          },
          {
            ...createStoreProbes(db.urls.app, blobDir),
            mailSink: () => Promise.resolve('ok'),
            qc: () => runner.probe(),
          },
        ),
    },
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
      knownIdentities: FIXTURE_USERS,
    },
    findings: {
      db: db.app,
      now,
      qc: { runner: runnerOverride ?? runner, now },
      knownIdentities: FIXTURE_USERS,
    },
  });
  diagnostics = built;
  app = built.fastify;
  await app.ready();
}

afterEach(() => {
  assertNoLeak(capture);
});

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
  const version = res.json<SubmittedVersion>();
  const audit = await db.owner.execute(
    sql`SELECT id, correlation_id FROM audit_event WHERE action = 'version.submitted' AND target_version_id = ${version.versionId}`,
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]!.correlation_id, res.headers['x-correlation-id']);
  assert.ok(
    capture
      .lines()
      .some(
        (line) =>
          line.event === 'request.completed' && line.correlationId === res.headers['x-correlation-id'],
      ),
  );
  return version;
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
): Promise<{ statusCode: number; body: LaneQcRunResponse | ErrorResponse; correlationId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision } },
  });
  return {
    statusCode: res.statusCode,
    body: res.json(),
    correlationId: String(res.headers['x-correlation-id']),
  };
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
  it('submit API coalesces concurrent calls and replays one unavailable outcome with original audit correlation', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const submitted = await db.owner.execute(
      sql`SELECT correlation_id FROM audit_event WHERE action = 'version.submitted' AND target_version_id = ${version.versionId}`,
    );
    const correlationId = String(submitted.rows[0]!.correlation_id);
    const input = { caseId: VENDOR.caseId, versionId: version.versionId, correlationId };
    let calls = 0;
    const runner: QcRunner = {
      identity: { runner: 'submit-probe', runnerVersion: '1' },
      run(request) {
        calls++;
        assert.equal(request.trigger, 'submit');
        assert.equal(request.lane, null);
        assert.equal(request.correlationId, correlationId);
        return Promise.resolve({
          status: 'unavailable',
          reason: 'timeout',
          detail: null,
          startedAt: now().toISOString(),
          finishedAt: now().toISOString(),
        });
      },
    };
    const deps = { db: db.app, runner, now, ...diagnostics };
    const [first, concurrent] = await Promise.all([
      runAndPersistSubmitQc(deps, input),
      runAndPersistSubmitQc(deps, input),
    ]);
    assert.deepEqual(concurrent, first);
    assert.deepEqual(await runAndPersistSubmitQc(deps, input), first);
    assert.equal(calls, 1);
    assert.equal(first.status, 'unavailable');
    assert.deepEqual(first.findings, []);
    const rows = await db.owner.execute(
      sql`SELECT trigger, lane, unavailable_reason, correlation_id FROM qc_run WHERE id = ${first.runId}`,
    );
    assert.deepEqual(rows.rows, [
      { trigger: 'submit', lane: null, unavailable_reason: 'timeout', correlation_id: correlationId },
    ]);
    const audits = await db.owner.execute(
      sql`SELECT correlation_id FROM audit_event WHERE action = 'qc.run_recorded' AND target_ref->>'run_id' = ${first.runId}`,
    );
    assert.deepEqual(audits.rows, [{ correlation_id: correlationId }]);
    const logs = capture.lines().filter((line) => line.fields?.qcRunId === first.runId);
    assert.equal(logs.filter((line) => line.event === 'qc.run.unavailable').length, 1);
    assert.equal(logs.filter((line) => line.event === 'error.captured').length, 1);
    assert.ok(logs.every((line) => line.correlationId === correlationId));
  });

  it('submit API refuses a result that arrives after Ready without a QC run, finding or audit', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const correlationId = randomUUID();
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`);
    const pending = runAndPersistSubmitQc(
      {
        db: db.app,
        now,
        ...diagnostics,
        runner: {
          identity: { runner: 'submit-late', runnerVersion: '1' },
          async run() {
            enter();
            await gate;
            return {
              status: 'completed',
              rulesEvaluated: [],
              findings: [],
              startedAt: now().toISOString(),
              finishedAt: now().toISOString(),
            };
          },
        },
      },
      { caseId: VENDOR.caseId, versionId: version.versionId, correlationId },
    );
    const rejected = assert.rejects(pending, { code: 'stale_version' });
    await entered;
    try {
      await db.owner.execute(sql`UPDATE pack_version SET ready_at=now() WHERE id=${version.versionId}`);
    } finally {
      release();
    }
    await rejected;
    const late = await db.owner.execute(
      sql`SELECT trigger, lane, correlation_id FROM qc_late_result WHERE version_id=${version.versionId}`,
    );
    assert.deepEqual(late.rows, [{ trigger: 'submit', lane: null, correlation_id: correlationId }]);
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id=${version.versionId}`)).rows.length,
      0,
    );
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_finding WHERE version_id=${version.versionId}`)).rows
        .length,
      0,
    );
    assert.deepEqual(
      (await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`)).rows,
      before.rows,
    );
    assert.equal(
      capture.lines().filter((line) => line.event === 'qc.run.late' && line.correlationId === correlationId)
        .length,
      1,
    );
  });

  it('releases the case row lock before the QC runner returns', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let markEntered: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const runner: QcRunner = {
      identity: { runner: 'lock-probe', runnerVersion: '1' },
      async run() {
        markEntered();
        await runGate;
        return {
          status: 'unavailable',
          reason: 'timeout',
          detail: null,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
        };
      },
    };
    const pending = runAndPersistLaneQc(
      { db: db.app, runner, now, timeoutMs: 30_000 },
      {
        caseId: VENDOR.caseId,
        versionId: version.versionId,
        lane: 'ai_coe',
        correlationId: randomUUID(),
      },
    );
    try {
      await entered;
      const started = Date.now();
      await db.raw('app', async (client) => {
        await client.query('BEGIN');
        try {
          await client.query("SET LOCAL lock_timeout = '750ms'");
          await client.query('SELECT id FROM "case" WHERE id = $1 FOR UPDATE', [VENDOR.caseId]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
      const waited = Date.now() - started;
      assert.ok(waited < 750, `case lock held during QC for ${waited}ms`);
    } finally {
      releaseRun();
      await pending.catch(() => undefined);
    }
    const outcome = await pending;
    assert.equal(outcome.status, 'unavailable');
  });

  it('does not persist lane QC when a send-back opens a successor draft during the run', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let markEntered: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const runner: QcRunner = {
      identity: { runner: 'lock-probe', runnerVersion: '1' },
      async run() {
        markEntered();
        await runGate;
        return {
          status: 'completed',
          rulesEvaluated: [],
          findings: [],
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(0).toISOString(),
        };
      },
    };
    const pending = runAndPersistLaneQc(
      { db: db.app, runner, now, timeoutMs: 30_000 },
      {
        caseId: VENDOR.caseId,
        versionId: version.versionId,
        lane: 'ai_coe',
        correlationId: randomUUID(),
      },
    );
    try {
      await entered;
      const dpo = await signIn(DPO);
      const sent = await app.inject({
        method: 'POST',
        url: `/api/cases/${VENDOR.caseId}/versions/${version.versionId}/lanes/dpo/send-back`,
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          ...asUser(dpo),
        },
        payload: {
          expectedVersion: { versionId: version.versionId, revision },
          feedback: { items: [{ slot: 2, deficiency: 'purpose is missing' }] },
        },
      });
      assert.equal(sent.statusCode, 201, sent.body);
    } finally {
      releaseRun();
      await pending.catch(() => undefined);
    }
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof StaleVersionError);
      assert.equal(err.details?.reason, 'version_closed');
      return true;
    });
    const runs = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${version.versionId} AND lane = 'ai_coe'`,
    );
    assert.equal(Number((runs.rows[0] as { n: number }).n), 0);
  });

  it('records a single-lane AI/COE defect on fx-case-vendor slot 1 via the injected substitute', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    const body = qc.body as LaneQcRunResponse;
    assert.equal(body.status, 'completed');
    assert.ok(body.runId);
    assert.ok(body.findings.length >= 1);
    const slot1 = body.findings.find((f) => f.slot === 1);
    assert.ok(slot1, 'slot 1 defect expected');
    assert.equal(slot1.owningLane, 'ai_coe');
    assert.ok(slot1.messageParams, 'qc-run finding must carry messageParams for t()');
    assert.equal(slot1.messageParams.slot, 1);
    const withMetric = body.findings.find(
      (f) => f.messageKey === 'qc.finding.acc_extraction_not_hallucination',
    );
    assert.ok(withMetric?.messageParams, 'scripted finding with metric params');
    assert.equal(withMetric.messageParams.metric, 'extraction_accuracy');

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
    const body = qc.body as LaneQcRunResponse;
    const findingId = body.findings[0]!.findingId;

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
    const body = qc.body as LaneQcRunResponse;
    const findingId = body.findings.find((f) => f.owningLane === 'ai_coe')!.findingId;
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

  it('a disposition on a finding of N after N+1 is submitted is 409 version_superseded; nothing written', async () => {
    const owner = await signIn(OWNER_A);
    const n = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, n.versionId, 'ai_coe', revision);
    const findingId = (qc.body as LaneQcRunResponse).findings[0]!.findingId;

    const dpo = await signIn(DPO);
    const sent = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${n.versionId}/lanes/dpo/send-back`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(dpo) },
      payload: {
        expectedVersion: { versionId: n.versionId, revision },
        feedback: { items: [{ slot: 2, deficiency: 'purpose is missing' }] },
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const draft = (
      await app.inject({ method: 'GET', url: `/api/cases/${VENDOR.caseId}/draft`, headers: asUser(owner) })
    ).json<PackDraft>();
    const resubmitted = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/draft/submit`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(owner) },
      payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
    });
    assert.equal(resubmitted.statusCode, 201, resubmitted.body);
    const n1 = resubmitted.json<SubmittedVersion>();

    const finding = await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`);
    const audits = await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`);
    const stale = await dispose(ai, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: n.versionId, revision },
      kind: 'waived',
      reason: 'accepted residual risk',
    });
    assert.equal(stale.statusCode, 409, stale.body);
    const err = stale.json<ErrorResponse>().error;
    assert.equal(err.code, 'stale_version');
    const details = err.details as { reason: string; current: { versionId: string } };
    assert.equal(details.reason, 'version_superseded');
    assert.equal(details.current.versionId, n1.versionId);

    assert.deepEqual(
      (await db.owner.execute(sql`SELECT * FROM qc_finding WHERE id = ${findingId}`)).rows,
      finding.rows,
    );
    assert.equal((await db.owner.execute(sql`SELECT id FROM disposition_event`)).rows.length, 0);
    assert.deepEqual(
      (await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`)).rows,
      audits.rows,
    );
  });

  it("owner's fixed stays proposed until the owning lane confirms; second disposition appends", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const body = qc.body as LaneQcRunResponse;
    const findingId = body.findings[0]!.findingId;
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

  it('latest disposition uses a monotonic stamp when the application clock is frozen', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    const findingId = (qc.body as LaneQcRunResponse).findings[0]!.findingId;

    // Freeze the app clock across both inserts; monotonic stamp still orders them.
    clock = Date.parse('2026-09-22T07:00:00.000Z');
    await rebuildApp();
    const ownerFrozen = await signIn(OWNER_A);
    const aiFrozen = await signIn(AI_COE);
    const proposed = await dispose(ownerFrozen, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed_proposed',
    });
    assert.equal(proposed.statusCode, 201, proposed.body);

    const confirmed = await dispose(aiFrozen, VENDOR.caseId, findingId, {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'fixed_confirmed',
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);

    const latest = await db.owner.execute(sql`
      SELECT kind, created_at FROM disposition_event
      WHERE finding_id = ${findingId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    assert.equal((latest.rows[0] as { kind: string }).kind, 'fixed_confirmed');
    const createdAt = (latest.rows[0] as { created_at: Date }).created_at;

    const audit = await db.owner.execute(sql`
      SELECT occurred_at FROM audit_event
      WHERE action = 'disposition.confirmed'
        AND target_ref->>'disposition_id' = ${confirmed.json<DispositionResponse>().dispositionId}
      ORDER BY seq DESC
      LIMIT 1
    `);
    assert.equal(audit.rows.length, 1);
    assert.equal(
      new Date((audit.rows[0] as { occurred_at: Date }).occurred_at).toISOString(),
      new Date(createdAt).toISOString(),
    );
  });

  it('unavailable not_configured stores one unbound run; a second call returns the same id', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);

    // Rebuild without a QC runner (production posture).
    if (app !== undefined) await app.close();
    const adapter = createIdentityAdapter({
      env: {
        RAI_IDENTITY_MODE: 'fixture',
        RAI_SESSION_ABSOLUTE_HOURS: '12',
        RAI_SESSION_IDLE_MINUTES: '120',
      },
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
      versions: { db: db.app, now, laneOpenRecipients: LANE_OPEN_RECIPIENTS },
      decide: {
        db: db.app,
        now,
        sendBackRecipientsForOwner: (ownerSubjectId) =>
          sendBackRecipientsFromIdentities(FIXTURE_USERS, ownerSubjectId),
        knownIdentities: FIXTURE_USERS,
      },
      findings: { db: db.app, now, knownIdentities: FIXTURE_USERS },
    });
    diagnostics = built;
    app = built.fastify;
    await app.ready();

    const ai = await signIn(AI_COE);
    const first = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    const firstBody = first.body as LaneQcRunResponse;
    assert.equal(firstBody.status, 'unavailable');
    assert.equal(firstBody.reason, 'not_configured');
    assert.ok(firstBody.runId);
    assert.equal(firstBody.findings.length, 0);

    const second = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(second.statusCode, 200);
    const secondBody = second.body as LaneQcRunResponse;
    assert.equal(secondBody.status, 'unavailable');
    assert.equal(secondBody.runId, firstBody.runId);
    assert.equal(
      capture
        .lines()
        .filter((line) => line.event === 'qc.run.unavailable' && line.fields?.qcRunId === firstBody.runId)
        .length,
      1,
    );
    assert.equal(
      capture
        .lines()
        .filter((line) => line.correlationId === second.correlationId && line.event?.startsWith('qc.run.'))
        .length,
      0,
    );

    const runs = await db.owner.execute(
      sql`SELECT id, status, engine_id FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal(runs.rows.length, 1);
    assert.equal((runs.rows[0] as { status: string }).status, 'unavailable');
    assert.equal((runs.rows[0] as { engine_id: string }).engine_id, 'unbound');
    const findings = await db.owner.execute(
      sql`SELECT id FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal(findings.rows.length, 0);
    const audits = await db.owner.execute(sql`
      SELECT target_ref->>'finding_count' AS finding_count
      FROM audit_event
      WHERE action = 'qc.run_recorded' AND target_version_id = ${version.versionId}
    `);
    assert.equal(audits.rows.length, 1);
    assert.equal((audits.rows[0] as { finding_count: string }).finding_count, '0');

    await rebuildApp();
  });

  it('unavailable result stores qc_run status=unavailable with zero findings and returns runId', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    runner.simulateError('runner_error');
    const ai = await signIn(AI_COE);
    const qc = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(qc.statusCode, 200, JSON.stringify(qc.body));
    const body = qc.body as LaneQcRunResponse;
    assert.equal(body.status, 'unavailable');
    assert.ok(body.runId);
    assert.equal(body.findings.length, 0);

    const findings = await db.owner.execute(
      sql`SELECT id FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal(findings.rows.length, 0);
    const runs = await db.owner.execute(
      sql`SELECT id, status FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal(runs.rows.length, 1);
    assert.equal((runs.rows[0] as { status: string }).status, 'unavailable');
    assert.equal((runs.rows[0] as { id: string }).id, body.runId);
    const stored = await db.owner.execute(
      sql`SELECT unavailable_reason, correlation_id FROM qc_run WHERE id = ${body.runId}`,
    );
    assert.equal(stored.rows[0]!.unavailable_reason, 'runner_error');
    assert.equal(stored.rows[0]!.correlation_id, qc.correlationId);
    const audit = await db.owner.execute(
      sql`SELECT id, correlation_id, target_ref FROM audit_event WHERE action='qc.run_recorded' AND target_version_id=${version.versionId}`,
    );
    assert.equal(audit.rows.length, 1);
    assert.equal((audit.rows[0]!.target_ref as { run_id: string }).run_id, body.runId);
    assert.equal(audit.rows[0]!.correlation_id, qc.correlationId);
    const diagnostics = capture.lines().filter((line) => line.correlationId === qc.correlationId);
    assert.equal(diagnostics.filter((line) => line.event === 'qc.run.unavailable').length, 1);
    assert.equal(
      diagnostics.filter(
        (line) => line.event === 'error.captured' && line.fields?.category === 'qc_unavailable',
      ).length,
      1,
    );
  });

  it('replaying a completed approve_attempt returns the same run and appends nothing', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const first = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(first.statusCode, 200);
    const firstBody = first.body as LaneQcRunResponse;
    assert.equal(firstBody.status, 'completed');

    const second = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(second.statusCode, 200);
    const secondBody = second.body as LaneQcRunResponse;
    assert.equal(secondBody.status, 'completed');
    assert.equal(secondBody.runId, firstBody.runId);
    assert.equal(
      capture
        .lines()
        .filter((line) => line.event === 'qc.run.completed' && line.fields?.qcRunId === firstBody.runId)
        .length,
      1,
    );
    assert.equal(
      capture
        .lines()
        .filter((line) => line.correlationId === second.correlationId && line.event?.startsWith('qc.run.'))
        .length,
      0,
    );
    assert.deepEqual(
      secondBody.findings.map((f) => f.findingId).sort(),
      firstBody.findings.map((f) => f.findingId).sort(),
    );

    const runs = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${version.versionId}`,
    );
    assert.equal((runs.rows[0] as { n: number }).n, 1);
    const findings = await db.owner.execute(
      sql`SELECT count(*)::int AS n FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal((findings.rows[0] as { n: number }).n, firstBody.findings.length);
  });

  it('unavailable run may be followed by a later completed run for the same input', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    runner.simulateError('runner_error');
    const ai = await signIn(AI_COE);
    const unavailable = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal((unavailable.body as LaneQcRunResponse).status, 'unavailable');

    const completed = await runLaneQc(ai, VENDOR.caseId, version.versionId, 'ai_coe', revision);
    assert.equal(completed.statusCode, 200);
    const body = completed.body as LaneQcRunResponse;
    assert.equal(body.status, 'completed');
    assert.ok(body.runId);
    assert.notEqual(body.runId, (unavailable.body as LaneQcRunResponse).runId);

    const runs = await db.owner.execute(sql`
      SELECT status FROM qc_run WHERE version_id = ${version.versionId} ORDER BY completed_at ASC, id ASC
    `);
    assert.deepEqual(
      (runs.rows as Array<{ status: string }>).map((r) => r.status),
      ['unavailable', 'completed'],
    );
  });

  it('lane QC is forbidden for owner, BU SPOC, Admin, and a different lane; no rows written', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);

    for (const [userId, lane] of [
      [OWNER_A, 'ai_coe'],
      [SPOC_CM, 'ai_coe'],
      [ADMIN, 'ai_coe'],
      [DPO, 'ai_coe'],
    ] as const) {
      const session = await signIn(userId);
      const qc = await runLaneQc(session, VENDOR.caseId, version.versionId, lane, revision);
      assert.equal(qc.statusCode, 403, `${userId} ${lane}`);
    }

    const runs = await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id = ${version.versionId}`);
    assert.equal(runs.rows.length, 0);
    const findings = await db.owner.execute(
      sql`SELECT id FROM qc_finding WHERE version_id = ${version.versionId}`,
    );
    assert.equal(findings.rows.length, 0);
  });

  it('missing or unsubmitted target is not_found; Ready is version_closed', async () => {
    const owner = await signIn(OWNER_A);
    const draftRes = await app.inject({
      method: 'GET',
      url: `/api/cases/${VENDOR.caseId}/draft`,
      headers: asUser(owner),
    });
    const draft = draftRes.json<PackDraft>();
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);

    const missing = await runLaneQc(ai, VENDOR.caseId, randomUUID(), 'ai_coe', revision);
    assert.equal(missing.statusCode, 404);
    assert.equal((missing.body as ErrorResponse).error.code, 'not_found');

    const unsubmitted = await runLaneQc(ai, VENDOR.caseId, draft.draftId, 'ai_coe', revision);
    assert.equal(unsubmitted.statusCode, 404);
    assert.equal((unsubmitted.body as ErrorResponse).error.code, 'not_found');

    const version = await submitOk(owner, VENDOR.caseId);
    await db.owner.execute(sql`UPDATE pack_version SET ready_at = now() WHERE id = ${version.versionId}`);
    const ready = await runLaneQc(
      ai,
      VENDOR.caseId,
      version.versionId,
      'ai_coe',
      await caseRevision(VENDOR.caseId),
    );
    assert.equal(ready.statusCode, 409);
    assert.equal((ready.body as ErrorResponse).error.code, 'stale_version');
    assert.equal(
      (ready.body as { error: { details: { reason: string } } }).error.details.reason,
      'version_closed',
    );

    const runs = await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id = ${version.versionId}`);
    assert.equal(runs.rows.length, 0);
  });
});

describe('W3 hardening: disposition and lane QC answer malformed or unknown ids like the middleware', () => {
  const linesFor = (res: { headers: Record<string, unknown> }, event: string) =>
    capture.lines().filter((l) => l.event === event && l.correlationId === res.headers['x-correlation-id']);

  function assertNotFound(
    res: { statusCode: number; body: string; headers: Record<string, unknown> },
    resource: string,
  ) {
    assert.equal(res.statusCode, 404, res.body);
    const error = JSON.parse(res.body) as ErrorResponse;
    assert.equal(error.error.code, 'not_found');
    assert.deepEqual(error.error.details, { resource });
    assert.deepEqual(
      linesFor(res, 'error.captured').map((l) => l.fields?.code),
      ['not_found'],
    );
    assert.equal(linesFor(res, 'authz.denied').length, 0, 'no authz.denied line');
  }

  it("caseId 'not-a-uuid', findingId 'x' and qc-run versionId 'x' are 404, never 500", async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'waived',
      reason: 'synthetic',
    };

    assertNotFound(await dispose(ai, 'not-a-uuid', randomUUID(), body), 'case');
    assertNotFound(await dispose(ai, VENDOR.caseId, 'x', body), 'finding');
    assertNotFound(
      await app.inject({
        method: 'POST',
        url: `/api/cases/${VENDOR.caseId}/versions/x/lanes/ai_coe/qc-run`,
        headers: { 'content-type': 'application/json', ...asUser(ai) },
        payload: { expectedVersion: { versionId: 'x', revision } },
      }),
      'version',
    );

    // Without all_cases the unresolved case is 403 scope, as the middleware answers it.
    const denied = await dispose(owner, 'not-a-uuid', randomUUID(), { ...body, kind: 'fixed_proposed' });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.deepEqual(
      linesFor(denied, 'error.captured').map((l) => l.fields?.code),
      ['forbidden'],
    );
    assert.equal(linesFor(denied, 'authz.denied')[0]?.fields?.reason, 'scope');
  });

  it('an unknown finding is 404 for every lane reviewer and 403 role for Admin', async () => {
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const revision = await caseRevision(VENDOR.caseId);
    const body = {
      expectedVersion: { versionId: version.versionId, revision },
      kind: 'waived',
      reason: 'synthetic',
    };
    for (const reviewer of [DPO, IT_SECURITY, AI_COE]) {
      assertNotFound(await dispose(await signIn(reviewer), VENDOR.caseId, randomUUID(), body), 'finding');
    }
    const admin = await dispose(await signIn(ADMIN), VENDOR.caseId, randomUUID(), body);
    assert.equal(admin.statusCode, 403, admin.body);
    assert.equal(linesFor(admin, 'authz.denied')[0]?.fields?.reason, 'role');
  });
});

describe('W3-07a durable late-QC diagnostics', () => {
  it('actual QC HTTP race against Ready retains refusal without new QC evidence or audit', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed: QcRunner = {
      identity: { runner: 'synthetic-late', runnerVersion: '1' },
      async run() {
        entered();
        await gate;
        return {
          status: 'completed',
          rulesEvaluated: [],
          findings: [],
          startedAt: now().toISOString(),
          finishedAt: now().toISOString(),
        };
      },
    };
    await rebuildApp(delayed);
    const owner = await signIn(OWNER_A);
    const version = await submitOk(owner, VENDOR.caseId);
    const ai = await signIn(AI_COE);
    const before = await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`);
    const pending = runLaneQc(
      ai,
      VENDOR.caseId,
      version.versionId,
      'ai_coe',
      await caseRevision(VENDOR.caseId),
    );
    await started;
    try {
      await db.owner.execute(sql`UPDATE pack_version SET ready_at=now() WHERE id=${version.versionId}`);
    } finally {
      release();
    }
    const response = await pending;
    assert.equal(response.statusCode, 409);
    const late = await db.owner.execute(
      sql`SELECT * FROM qc_late_result WHERE version_id=${version.versionId}`,
    );
    assert.equal(late.rows.length, 1);
    assert.equal(late.rows[0]!.correlation_id, response.correlationId);
    const logs = capture.lines().filter((line) => line.correlationId === response.correlationId);
    const begin = logs.find((line) => line.event === 'qc.run.started')!;
    const refused = logs.filter((line) => line.event === 'qc.run.late');
    assert.equal(refused.length, 1);
    assert.equal(begin.fields!.qcRunId, late.rows[0]!.qc_run_id);
    assert.equal(refused[0]!.fields!.qcRunId, late.rows[0]!.qc_run_id);
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_run WHERE version_id=${version.versionId}`)).rows.length,
      0,
    );
    assert.equal(
      (await db.owner.execute(sql`SELECT id FROM qc_finding WHERE version_id=${version.versionId}`)).rows
        .length,
      0,
    );
    assert.deepEqual(
      (await db.owner.execute(sql`SELECT count(*)::int AS n FROM audit_event`)).rows,
      before.rows,
    );
    const admin = await signIn(ADMIN);
    const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
    assert.equal(view.statusCode, 200, view.body);
    assert.equal(view.json<DeskHealthReport>().lateQc[0]?.qcRunId, late.rows[0]!.qc_run_id);
  });
});

describe('W3-07a operator authorization and liveness', () => {
  it('operator.view uses real sessions: no session401, every non-admin including dual403, Admin200', async () => {
    assert.equal((await app.inject('/api/operator/desk-health')).statusCode, 401);
    for (const user of FIXTURE_USERS) {
      const session = await signIn(user.fixtureUserId);
      const response = await app.inject({ url: '/api/operator/desk-health', headers: asUser(session) });
      const admin = user.roles.some((grant) => grant.role === 'admin');
      assert.equal(response.statusCode, admin ? 200 : 403, user.fixtureUserId);
    }
  });
  it('healthz has no logs and readyz uses actual dependency probes', async () => {
    capture.clear();
    const health = await app.inject('/healthz');
    assert.equal(health.statusCode, 200);
    assert.deepEqual(capture.lines(), []);
    const ready = await app.inject('/readyz');
    assert.equal(ready.statusCode, 200, ready.body);
    assert.equal(ready.json<{ store: { migrations: string } }>().store.migrations, 'current');
  });
});
