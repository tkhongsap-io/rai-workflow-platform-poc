import { setTimeout as delay } from 'node:timers/promises';
import type { ErrorCapture } from '@rai/server/observability/errors';
import { computeReadiness } from '@rai/server/observability/health';
import { createStoreProbes } from '@rai/server/observability/probes';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql, eq } from 'drizzle-orm';
import { notification } from '@rai/server/db/schema/notification';
import { operatorJobRun, operatorJobNotification } from '@rai/server/db/schema/operator-job-run';
import type { FastifyInstance } from 'fastify';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '../support/observed-app.js';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { sendBackRecipientsFromIdentities } from '@rai/server/workflow/send-back-notice';
import type { Emitter } from '@rai/server/observability/log';
import {
  createNotifications,
  loadCommittedCaseRequest,
  type Notifications,
} from '@rai/server/notifications/service';
import { laneDueDates } from '@rai/server/sla/due-dates';
import { createDb } from '@rai/server/db/client';
import type { QueryConfig, QueryResult } from 'pg';
import type { MailSink } from '@rai/shared/mail/types';
import { FileMailSink, MemoryMailSink } from '@rai/fixtures/substitutes/mail-sink/index';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';

const base = new URL('http://127.0.0.1:8787');
const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
const now = () => new Date('2026-09-22T04:00:00Z');
const ownerId = 'fx-user-owner-cm';
const emailOf = (id: string) => FIXTURE_USERS.find((u) => u.fixtureUserId === id)!.email;
let db: TestDatabase;
let app: FastifyInstance;
let sink: MemoryMailSink;
let notifications: Notifications;
let emitter: Emitter;
let errors: ErrorCapture;
let scratch: string;
const logs: string[] = [];

async function build(options: { auto?: boolean; rollback?: boolean } = {}) {
  if (app) await app.close();
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('no network')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl: base, trustProxy: false });
  const deps = { db: db.app, sink, identities: FIXTURE_USERS, publicBaseUrl: base };
  const built = buildApp({
    observability: {
      db: db.app,
      readiness: () =>
        computeReadiness(
          {
            identity: () => adapter.health(),
            loopbackBind: true,
            mailKind: 'memory',
            qcKind: 'substitute',
            build: { commit: 'dev', schemaVersion: 'unknown' },
          },
          {
            ...createStoreProbes(db.urls.app, path.join(scratch, 'blobs')),
            mailSink: () => sink.health(),
            qc: () => Promise.resolve('disabled'),
          },
        ),
    },
    config: {
      nodeEnv: 'test',
      log: { level: 'info', pretty: false },
      trustProxy: false,
      publicBaseUrl: base,
    },
    logStream: new Writable({
      write(chunk: Buffer, _enc, cb) {
        logs.push(chunk.toString());
        cb();
      },
    }),
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
      now,
    },
    pack: { db: db.app, limits: { maxPackBytes: 157286400 }, now },
    versions: {
      db: db.app,
      now,
      laneOpenRecipients: laneOpenRecipientsFromIdentities(FIXTURE_USERS),
      ...(options.rollback
        ? {
            failAfterFirstLaneOpenNotification: () => {
              throw new Error('synthetic rollback');
            },
          }
        : {}),
    },
    decide: {
      db: db.app,
      now,
      knownIdentities: FIXTURE_USERS,
      sendBackRecipientsForOwner: (subject) => sendBackRecipientsFromIdentities(FIXTURE_USERS, subject),
    },
    // Unscripted substitute QC: every lane-QC run completes clean.
    findings: { db: db.app, now, qc: { runner: new ScriptedQcRunner({ now }) } },
    ...(options.auto === false ? {} : { notifications: deps }),
  });
  emitter = built.emitter;
  errors = built.errors;
  notifications = createNotifications({ ...deps, emitter, errors });
  app = built.fastify;
  await app.ready();
}
before(async () => {
  db = await openTestDatabase();
  scratch = await mkdtemp(path.join(tmpdir(), 'rai-w3-03a-'));
});
beforeEach(async () => {
  if (app) await app.close();
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE session, registry_counter'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir: path.join(scratch, 'blobs'),
    outputDir: path.join(scratch, 'fixtures'),
    now: now(),
  });
  sink = new MemoryMailSink({ publicBaseUrl: base });
  logs.length = 0;
  await build();
});
after(async () => {
  if (app) await app.close();
  await db.close();
  await rm(scratch, { recursive: true, force: true });
});
const signIn = (id: string) => signInAsFixture(app, id);
async function submit() {
  const owner = await signIn(ownerId);
  const draft = (
    await app.inject({ method: 'GET', url: `/api/cases/${caseId}/draft`, headers: asUser(owner) })
  ).json<PackDraft>();
  const body = { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } };
  const headers = { ...asUser(owner), 'idempotency-key': randomUUID() };
  const response = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/draft/submit`,
    headers,
    payload: body,
  });
  return { response, body, headers, version: response.json<SubmittedVersion>() };
}
// A SKIP LOCKED sweep is not a completion barrier for the app's automatic worker.
async function settledDeliveries(versionId: string, expected: Record<string, number>) {
  const deadline = performance.now() + 5_000;
  const kinds: Record<string, string> = { lane_open: 'lane_opened', send_back: 'sent_back' };
  while (true) {
    const result = await db.owner.execute(sql`
      SELECT id, event, status, attempts, next_attempt_at, last_error_code
      FROM notification WHERE case_id = ${caseId} AND version_id = ${versionId}`);
    const rows = result.rows as {
      id: string;
      event: string;
      status: string;
      attempts: number;
      next_attempt_at: unknown;
      last_error_code: unknown;
    }[];
    const sent = sink.sent.filter((r) => r.event.caseId === caseId && r.event.versionId === versionId);
    const emitted = logs
      .join('')
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            event: string;
            fields?: { notificationId?: string };
          },
      );
    const count = Object.values(expected).reduce((a, b) => a + b, 0);
    const settled =
      rows.length === count &&
      sent.length === count &&
      Object.entries(expected).every(
        ([event, n]) =>
          rows.filter((r) => r.event === event).length === n &&
          sent.filter((r) => r.event.kind === kinds[event]).length === n,
      ) &&
      rows.every(
        (r) =>
          r.status === 'sent' &&
          r.attempts === 1 &&
          r.next_attempt_at === null &&
          r.last_error_code === null &&
          emitted.filter((l) => l.event === 'mail.sent' && l.fields?.notificationId === r.id).length === 1,
      );
    if (settled) return;
    assert.ok(performance.now() < deadline, 'exact committed notification/sink/log state did not settle');
    await delay(10); // bounded read-only observation; never retries delivery
  }
}

async function decide(
  user: FixtureSession,
  versionId: string,
  lane: string,
  kind: string,
  feedback?: object,
) {
  const r = await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`);
  const expectedVersion = { versionId, revision: (r.rows[0] as { row_version: number }).row_version };
  const lanePath = `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}`;
  let decision: object = { feedback };
  if (feedback === undefined) {
    const qc = await app.inject({
      method: 'POST',
      url: `${lanePath}/qc-run`,
      headers: asUser(user),
      payload: { expectedVersion },
    });
    assert.equal(qc.statusCode, 200, qc.body);
    decision = { qcRunId: qc.json<LaneQcRunResponse>().runId };
  }
  return app.inject({
    method: 'POST',
    url: `${lanePath}/${kind}`,
    headers: { ...asUser(user), 'idempotency-key': randomUUID() },
    payload: { expectedVersion, ...decision },
  });
}

test(`W3-03a committed lane opens: contents, locale, auth, idempotency — ${fixtureSetLabel(readManifest())}`, async () => {
  const dpo = await signIn('fx-user-dpo');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/session/locale',
        headers: asUser(dpo),
        payload: { locale: 'en' },
      })
    ).statusCode,
    204,
  );
  const { response, version, headers, body } = await submit();
  assert.equal(response.statusCode, 201, response.body);
  await notifications.deliverPending();
  await settledDeliveries(version.versionId, { lane_open: 4 });
  assert.equal(sink.sent.length, 4);
  const due = await laneDueDates(db.app, version.versionId);
  for (const request of sink.sent) {
    assert.equal(request.event.kind, 'lane_opened');
    assert.equal(request.event.correlationId, response.headers['x-correlation-id']);
    assert.ok(request.mail.templateParams.caseName);
    assert.equal(request.mail.templateParams.defectCount, 0);
    assert.ok(due.some((d) => d.lane === request.event.lane));
    assert.ok(request.mail.templateParams.dueDate);
    assert.ok(request.mail.textBody.includes(request.deepLinks[0]!.url));
    const api = `/api${new URL(request.deepLinks[0]!.url).pathname}`;
    assert.equal((await app.inject({ url: api })).statusCode, 401);
    const outside = await signIn('fx-user-owner-cm-2');
    assert.equal((await app.inject({ url: api, headers: asUser(outside) })).statusCode, 403);
  }
  assert.equal(sink.sent.find((r) => r.recipient.address === emailOf('fx-user-dpo'))!.recipient.locale, 'en');
  assert.match(
    sink.sent.find((r) => r.recipient.address === emailOf('fx-user-ai-coe'))!.mail.subject,
    /[ก-๙]/,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: `/api/cases/${caseId}/draft/submit`, headers, payload: body }))
      .statusCode,
    201,
  );
  await notifications.deliverPending();
  await settledDeliveries(version.versionId, { lane_open: 4 });
  assert.equal(sink.sent.length, 4);
  const allLogs = logs.join('');
  assert.ok(allLogs.includes('mail.sent'));
  const enqueued = allLogs
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { event: string; correlationId: string })
    .filter((line) => line.event === 'mail.enqueued');
  assert.equal(enqueued.length, 4);
  assert.ok(enqueued.every((line) => line.correlationId === response.headers['x-correlation-id']));
  assert.ok(!allLogs.includes('@rai-desk.example'));
  assert.ok(!allLogs.includes(sink.sent[0]!.deepLinks[0]!.url));
});

test('manual sweep skips the automatic worker held sink row; settlement requires its commit', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = sink.deliver.bind(sink);
  let held = false;
  sink.deliver = async (request) => {
    if (!held) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return original(request);
  };
  const submitted = submit();
  const bounded = async <T>(pending: Promise<T>): Promise<T> => {
    const controller = new AbortController();
    try {
      return await Promise.race([
        pending,
        delay(5_000, undefined, { signal: controller.signal }).then(() => {
          throw new Error('held notification control exceeded deadline');
        }),
      ]);
    } finally {
      controller.abort();
    }
  };
  try {
    await bounded(entered.promise);
    const { response, version } = await bounded(submitted);
    assert.equal(response.statusCode, 201);
    await bounded(notifications.deliverPending());
    const rows = await db.owner.execute(sql`
      SELECT status, attempts FROM notification
      WHERE case_id = ${caseId} AND version_id = ${version.versionId}`);
    assert.equal(rows.rows.length, 4);
    assert.equal(rows.rows.filter((r) => r.status === 'queued' && r.attempts === 0).length, 1);
    assert.equal(rows.rows.filter((r) => r.status === 'sent' && r.attempts === 1).length, 3);
    assert.equal(sink.sent.length, 3);
    release.resolve();
    await settledDeliveries(version.versionId, { lane_open: 4 });
  } finally {
    release.resolve();
    try {
      await submitted;
    } finally {
      await app.close();
    }
  }
});

test('send-back mail goes only to owner, with deciding lane and bounded reviewer feedback', async () => {
  const { version } = await submit();
  const dpo = await signIn('fx-user-dpo');
  const res = await decide(dpo, version.versionId, 'dpo', 'send-back', {
    items: [{ slot: 2, deficiency: 'Please correct the synthetic privacy checklist.' }],
    summary: 'ก'.repeat(700),
  });
  assert.equal(res.statusCode, 201, res.body);
  await notifications.deliverPending();
  await settledDeliveries(version.versionId, { lane_open: 4, send_back: 1 });
  const messages = sink.sent.filter((r) => r.event.kind === 'sent_back');
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.recipient.address, emailOf(ownerId));
  assert.equal(messages[0]!.event.lane, 'dpo');
  assert.equal(String(messages[0]!.mail.templateParams.feedback).length, 500);
});

for (const fail of [false, true])
  test(`Ready: owner only; failure=${fail} never undoes decisions and no retry runs`, async () => {
    const { version } = await submit();
    for (const [id, lane] of [
      ['fx-user-dpo', 'dpo'],
      ['fx-user-ai-coe', 'ai_coe'],
      ['fx-user-it-security', 'it_security'],
    ]) {
      if (fail && lane === 'it_security') sink.failAlways(true);
      const res = await decide(await signIn(id!), version.versionId, lane!, 'approve');
      assert.equal(res.statusCode, 201, res.body);
    }
    // SKIP LOCKED is not a completion barrier for another post-response worker.
    await app.close();
    await notifications.deliverPending();
    const result = await db.owner.execute(
      sql`SELECT n.status, n.attempts, n.last_error_code, c.ai_readiness_status FROM notification n JOIN "case" c ON c.id = n.case_id WHERE n.event = 'ready'`,
    );
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      status: fail ? 'queued' : 'sent',
      attempts: 1,
      last_error_code: fail ? 'sink_failure' : null,
      ai_readiness_status: 'ready',
    });
    const ready = sink.sent.filter((r) => r.event.kind === 'ready_for_launch');
    assert.equal(ready.length, fail ? 0 : 1);
    if (!fail) assert.equal(ready[0]!.recipient.address, emailOf(ownerId));
    const count = sink.receipts.length;
    await notifications.deliverPending();
    assert.equal(sink.receipts.length, count);
  });

test('rollback after first outbox insert produces no mail or committed notification', async () => {
  await build({ rollback: true });
  const { response } = await submit();
  assert.equal(response.statusCode, 500);
  await notifications.deliverPending();
  assert.equal(sink.sent.length, 0);
  assert.equal((await db.owner.execute(sql`SELECT id FROM notification`)).rows.length, 0);
});

test('concurrent initial consumers and startup recovery send each committed row once', async () => {
  await build({ auto: false });
  assert.equal((await submit()).response.statusCode, 201);
  assert.equal(sink.sent.length, 0);
  const rows = (await db.owner.execute(sql`SELECT id FROM notification`)).rows as { id: string }[];
  await Promise.all(
    rows.flatMap((r) => [notifications.deliverInitial(r.id), notifications.deliverInitial(r.id)]),
  );
  assert.equal(sink.sent.length, 4);
  assert.equal(sink.receipts.length, 4);
  await build();
  assert.equal(sink.sent.length, 4);
});

test('startup consumes unattempted committed backlog', async () => {
  await build({ auto: false });
  assert.equal((await submit()).response.statusCode, 201);
  assert.equal(sink.sent.length, 0);
  await build();
  assert.equal(sink.sent.length, 4);
});

test('a row visible only inside an uncommitted transaction cannot reach the sink', async () => {
  await build({ auto: false });
  await submit();
  await notifications.deliverPending();
  const [original] = await db.owner.select().from(notification);
  const inserted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const id = randomUUID();
  const transaction = db.owner.transaction(async (tx) => {
    await tx
      .insert(notification)
      .values({ ...original!, id, recipient: 'uncommitted@rai-desk.example', status: 'queued', attempts: 0 });
    inserted.resolve();
    await release.promise;
    throw new Error('rollback');
  });
  const rolledBack = assert.rejects(transaction, /rollback/);
  await inserted.promise;
  try {
    assert.equal(await notifications.deliverInitial(id), undefined);
    assert.equal(sink.sent.length, 4);
  } finally {
    release.resolve();
  }
  await rolledBack;
  assert.equal(await notifications.deliverInitial(id), undefined);
});

for (const invalid of ['missing_audit', 'unauthorized', 'external', 'unsafe_link'] as const)
  test(`committed outbox rejected safely: ${invalid}`, async () => {
    await build({ auto: false });
    await submit();
    const [original] = await db.owner.select().from(notification).where(eq(notification.lane, 'dpo'));
    const id = randomUUID();
    await db.owner.insert(notification).values({
      ...original!,
      id,
      recipient: invalid === 'external' ? 'someone@real-mail.com' : emailOf(ownerId),
      ...(invalid === 'missing_audit' ? { correlationId: randomUUID() } : {}),
      ...(invalid === 'unsafe_link'
        ? { recipient: emailOf('fx-user-ai-coe'), deepLinkPath: '/cases/wrong?token=secret' }
        : {}),
    });
    // For unsafe-link, use an authorized lane holder with a different address to avoid the existing unique key.
    const identities =
      invalid === 'unsafe_link'
        ? FIXTURE_USERS.map((u) =>
            u.fixtureUserId === 'fx-user-ai-coe'
              ? { ...u, roles: FIXTURE_USERS.find((v) => v.fixtureUserId === 'fx-user-dpo')!.roles }
              : u,
          )
        : FIXTURE_USERS;
    const isolated = createNotifications({
      db: db.app,
      sink,
      identities,
      publicBaseUrl: base,
      emitter,
    });
    const receipt = await isolated.deliverInitial(id);
    assert.equal(receipt?.status, 'failed');
    const expected =
      invalid === 'missing_audit'
        ? 'malformed_request'
        : invalid === 'unsafe_link'
          ? 'unsafe_link'
          : 'rejected_recipient';
    assert.equal(receipt?.error?.code, expected);
    assert.equal(sink.sent.length, 0);
    const [stored] = await db.owner.select().from(notification).where(eq(notification.id, id));
    assert.equal(stored!.lastErrorCode, expected);
    assert.equal(stored!.attempts, 1);
  });

test('case-only loader refuses a digest without modifying its delivery state', async () => {
  const id = randomUUID();
  const jobRunId = randomUUID();
  const correlationId = randomUUID();
  const digestDay = '2026-09-22';
  const recipient = 'operator-digest@rai-desk.example';
  // The merged observability contract requires real job linkage even for an undelivered digest fixture.
  await db.owner.transaction(async (tx) => {
    await tx.insert(operatorJobRun).values({
      id: jobRunId,
      job: 'sla_digest',
      digestDay,
      correlationId,
      startedAt: now(),
      status: 'running',
    });
    await tx.insert(notification).values({
      id,
      event: 'sla_breach_digest',
      lane: '-',
      recipient,
      deepLinkPath: '/queue',
      templateKey: 'mail.sla_breach_digest',
      templateParams: {},
      correlationId,
      createdAt: now(),
    });
    await tx.insert(operatorJobNotification).values({ jobRunId, notificationId: id, digestDay, recipient });
  });
  const [row] = await db.owner.select().from(notification).where(eq(notification.id, id));
  await assert.rejects(
    db.app.transaction((tx) =>
      loadCommittedCaseRequest(tx, row!, { identities: FIXTURE_USERS, publicBaseUrl: base }),
    ),
  );
  const [stored] = await db.owner.select().from(notification).where(eq(notification.id, id));
  assert.equal(stored!.attempts, 0);
  assert.equal(stored!.status, 'queued');
  assert.equal(sink.sent.length, 0);
});

test('the post-response hook delivers without an explicit consumer call', async () => {
  assert.equal((await submit()).response.statusCode, 201);
  await app.close();
  assert.equal(sink.sent.length, 4);
});

test('exported committed loader is reusable without a delivery or status write', async () => {
  await build({ auto: false });
  await submit();
  const [row] = await db.owner.select().from(notification);
  const request = await db.app.transaction((tx) =>
    loadCommittedCaseRequest(tx, row!, { identities: FIXTURE_USERS, publicBaseUrl: base }),
  );
  assert.equal(request.attempt, 1);
  assert.equal(request.event.versionId, row!.versionId);
  assert.ok(request.event.auditEventId);
  assert.equal(sink.sent.length, 0);
  const [unchanged] = await db.owner.select().from(notification).where(eq(notification.id, row!.id));
  assert.equal(unchanged!.attempts, 0);
  assert.equal(unchanged!.status, 'queued');
});

// W3-04 reuses the committed workflow harness; no duplicate composer/fixture setup.
const retryWorker = (mail: MailSink, clock: () => Date, database = db.app) =>
  createNotifications({
    db: database,
    sink: mail,
    now: clock,
    errors,
    identities: FIXTURE_USERS,
    publicBaseUrl: base,
    emitter,
  });

test('W3-04 four failed results persist deadlines and leave Ready decisions unchanged', async () => {
  await build({ auto: false });
  const { version } = await submit();
  for (const [id, lane] of [
    ['fx-user-dpo', 'dpo'],
    ['fx-user-ai-coe', 'ai_coe'],
    ['fx-user-it-security', 'it_security'],
  ]) {
    assert.equal((await decide(await signIn(id!), version.versionId, lane!, 'approve')).statusCode, 201);
  }
  const snapshot = () =>
    db.owner.execute(sql`SELECT row_to_json(c) AS c,
    (SELECT jsonb_agg(d ORDER BY d.id) FROM lane_decision d) AS decisions FROM "case" c WHERE c.id=${caseId}`);
  const before = (await snapshot()).rows;
  const [row] = await db.owner.select().from(notification).where(eq(notification.event, 'ready'));
  sink.failAlways(true);
  let time = now().getTime();
  for (const [i, delta] of [0, 1000, 5000, 25000].entries()) {
    time += delta;
    const worker = retryWorker(sink, () => new Date(time));
    if (i > 0)
      assert.equal(await retryWorker(sink, () => new Date(time - 1)).deliverInitial(row!.id), undefined);
    assert.equal((await worker.deliverInitial(row!.id))?.attempt, i + 1);
  }
  assert.equal(await retryWorker(sink, () => new Date(time + 99999)).deliverInitial(row!.id), undefined);
  const [stored] = await db.owner.select().from(notification).where(eq(notification.id, row!.id));
  assert.equal(stored!.status, 'failed');
  assert.equal(stored!.attempts, 4);
  assert.equal(stored!.nextAttemptAt, null);
  assert.deepEqual((await snapshot()).rows, before);
  const events = logs
    .join('')
    .trim()
    .split('\n')
    .map(
      (s) => JSON.parse(s) as { event: string; correlationId: string; fields?: { notificationId?: string } },
    )
    .filter((e) => e.fields?.notificationId === row!.id);
  assert.equal(events.filter((e) => e.event === 'mail.attempt_failed').length, 3);
  assert.equal(events.filter((e) => e.event === 'mail.failed').length, 1);
  const failures = events.filter((e) => e.event === 'error.captured');
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0]!.fields, {
    category: 'mail_delivery_failed',
    notificationId: row!.id,
    attempts: 4,
    errorCode: stored!.lastErrorCode,
    code: 'mail_delivery_failed',
    httpStatus: 502,
  });
  const admin = await signIn('fx-user-admin');
  const view = await app.inject({ url: '/api/operator/desk-health', headers: asUser(admin) });
  assert.equal(view.statusCode, 200);
  const report = view.json<DeskHealthReport>();
  assert.ok(JSON.stringify(report).includes(row!.id));
  assert.ok(
    report.errorCounters.some((counter) => counter.code === 'mail_delivery_failed' && counter.count === 1),
  );
  for (const user of FIXTURE_USERS) {
    assert.equal(logs.join('').includes(user.email), false);
    assert.equal(logs.join('').includes(user.displayName), false);
  }

  assert.ok(events.every((e) => e.correlationId === row!.correlationId));
});

test('W3-04 adopts legacy deadline once; reconnect preserves it and successful retry stops', async () => {
  await build({ auto: false });
  await submit();
  const [row] = await db.owner.select().from(notification);
  await db.owner
    .update(notification)
    .set({ attempts: 1, lastErrorCode: 'sink_failure' })
    .where(eq(notification.id, row!.id));
  const time = now().getTime();
  await retryWorker(sink, now).deliverInitial(row!.id);
  const connection = createDb(db.urls.app);
  try {
    assert.equal(
      await retryWorker(sink, () => new Date(time + 999), connection.db).deliverInitial(row!.id),
      undefined,
    );
    assert.equal(
      (await retryWorker(sink, () => new Date(time + 1000), connection.db).deliverInitial(row!.id))?.status,
      'delivered',
    );
    assert.equal(await retryWorker(sink, () => new Date(time + 99999)).deliverInitial(row!.id), undefined);
    assert.equal(sink.receipts.length, 1);
    assert.equal(sink.receipts[0]!.attempt, 2);
  } finally {
    await connection.close();
  }
});

test('W3-04 independent workers skip a held row while another notification progresses', async () => {
  await build({ auto: false });
  await submit();
  const rows = await db.owner.select().from(notification);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const gated: MailSink = {
    identity: sink.identity,
    deliver: async (r) => {
      entered.resolve();
      await release.promise;
      return sink.deliver(r);
    },
  };
  const connection = createDb(db.urls.app);
  const otherSink = new MemoryMailSink({ publicBaseUrl: base });
  const first = retryWorker(gated, now).deliverInitial(rows[0]!.id);
  try {
    await entered.promise;
    const other = retryWorker(otherSink, now, connection.db);
    assert.equal(await other.deliverInitial(rows[0]!.id), undefined);
    assert.equal((await other.deliverInitial(rows[1]!.id))?.status, 'delivered');
  } finally {
    release.resolve();
    await first;
    await connection.close();
  }
  assert.equal(sink.sent.length, 1);
  assert.equal(otherSink.sent.length, 1);
});

test('W3-04 accepted file then DB rollback: fresh sink deduplicates replay; no precommit success log', async (t) => {
  await build({ auto: false });
  await submit();
  const [row] = await db.owner.select().from(notification);
  const dir = await mkdtemp(path.join(scratch, 'replay-'));
  const connection = createDb(db.urls.app, { max: 1 });
  connection.pool.on('connect', (client) => {
    const original = client.query.bind(client) as unknown as (
      config: string | QueryConfig,
      values?: unknown[],
    ) => Promise<QueryResult>;
    let fail = true;
    t.mock.method(client, 'query', async (query: string | QueryConfig, values?: unknown[]) => {
      if (fail && (typeof query === 'string' ? query : query.text)?.toLowerCase() === 'commit') {
        fail = false;
        throw new Error('synthetic commit failure');
      }
      return await original(query, values);
    });
  });
  try {
    const first = new FileMailSink({ publicBaseUrl: base, dir });
    await assert.rejects(retryWorker(first, now, connection.db).deliverInitial(row!.id));
    assert.equal(first.sent.length, 1);
    const [pending] = await db.owner.select().from(notification).where(eq(notification.id, row!.id));
    assert.equal(pending!.attempts, 0);
    assert.ok(!logs.join('').includes('mail.sent'));
    const restarted = new FileMailSink({ publicBaseUrl: base, dir });
    assert.equal((await retryWorker(restarted, now).deliverInitial(row!.id))?.status, 'duplicate');
    assert.equal(restarted.sent.length, 0);
    const [sent] = await db.owner.select().from(notification).where(eq(notification.id, row!.id));
    assert.equal(sent!.status, 'sent');
    assert.equal(sent!.attempts, 1); // two sink invocations, one committed result
  } finally {
    await connection.close();
  }
});

test('W3-04 selects at most 25 due rows per scan and leaves future retries alone', async () => {
  await build({ auto: false });
  await submit();
  const [row] = await db.owner.select().from(notification).where(eq(notification.lane, 'dpo'));
  const reviewer = FIXTURE_USERS.find((u) => u.fixtureUserId === 'fx-user-dpo')!;
  const extra = Array.from({ length: 26 }, (_, i) => ({
    ...reviewer,
    subjectId: `retry-${i}`,
    email: `retry-${i}@rai-desk.example`,
  }));
  for (const user of extra)
    await db.owner.insert(notification).values({ ...row!, id: randomUUID(), recipient: user.email });
  const worker = createNotifications({
    db: db.app,
    sink,
    now,
    identities: [...FIXTURE_USERS, ...extra],
    publicBaseUrl: base,
    emitter,
  });
  sink.failAlways(true);
  await worker.deliverPending();
  assert.equal(sink.receipts.length, 25);
  await worker.deliverPending();
  assert.equal(sink.receipts.length, 30);
  await worker.deliverPending();
  assert.equal(sink.receipts.length, 30);
});

test('shutdown cancellation keeps the notification lock until the sink settles, then rolls back', async () => {
  await build({ auto: false });
  await submit();
  const [row] = await db.owner.select().from(notification);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const consumer = createNotifications({
    db: db.app,
    identities: FIXTURE_USERS,
    publicBaseUrl: base,
    emitter,
    sink: {
      identity: sink.identity,
      deliver: async (request) => {
        entered.resolve();
        await release.promise;
        return sink.deliver(request);
      },
    },
  });
  const delivery = consumer.deliverInitial(row!.id, controller.signal);
  const rejected = assert.rejects(delivery, { name: 'AbortError' });
  try {
    await entered.promise;
    controller.abort();
    const locked = await db.owner.transaction((tx) =>
      tx.select().from(notification).where(eq(notification.id, row!.id)).for('update', { skipLocked: true }),
    );
    assert.equal(locked.length, 0, 'cancellation must not release the active sink lock');
  } finally {
    release.resolve();
  }
  await rejected;
  const [unchanged] = await db.owner.select().from(notification).where(eq(notification.id, row!.id));
  assert.equal(unchanged!.attempts, 0);
  assert.equal(unchanged!.status, 'queued');
  assert.equal(sink.sent.length, 1, 'sink may have accepted before rollback; replay remains explicit');
  await consumer.deliverInitial(row!.id);
  assert.equal(sink.sent.length, 1, 'same live sink deduplicates the replay');
});

test('request completion and response latency do not wait for a stalled notification sink', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const originalDeliver = sink.deliver.bind(sink);
  sink.deliver = async (request) => {
    entered.resolve();
    await release.promise;
    return originalDeliver(request);
  };
  const started = performance.now();
  const submitted = submit();
  try {
    await entered.promise;
    const completion = () =>
      logs
        .join('')
        .split('\n')
        .filter(Boolean)
        .map(
          (raw) =>
            JSON.parse(raw) as {
              event: string;
              fields: { route?: string; durationMs?: number; status?: number };
            },
        )
        .filter(
          (line) =>
            line.event === 'request.completed' && line.fields.route === '/api/cases/:caseId/draft/submit',
        );
    assert.equal(completion().length, 1, 'completion must be logged before delivery settles');
    const duration = completion()[0]!.fields.durationMs!;
    assert.equal(completion()[0]!.fields.status, 201);
    // A deadline is only a hang guard; the correctness assertions precede releasing the sink.
    const response = await Promise.race([
      submitted,
      delay(2000).then(() => {
        throw new Error('response waited for sink');
      }),
    ]);
    assert.equal(response.response.statusCode, 201);
    await delay(100);
    assert.ok(duration < performance.now() - started);
    assert.equal(completion().length, 1);
    assert.equal(completion()[0]!.fields.durationMs, duration);
  } finally {
    release.resolve();
    await submitted;
    await app.close();
  }
});
