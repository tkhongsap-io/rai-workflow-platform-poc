import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql, eq } from 'drizzle-orm';
import { notification } from '@rai/server/db/schema/notification';
import type { FastifyInstance } from 'fastify';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildApp } from '@rai/server/app';
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
import { MemoryMailSink } from '@rai/fixtures/substitutes/mail-sink/index';
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
    ...(options.auto === false ? {} : { notifications: deps }),
  });
  emitter = built.emitter;
  notifications = createNotifications({ ...deps, emitter });
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
async function decide(
  user: FixtureSession,
  versionId: string,
  lane: string,
  kind: string,
  feedback?: object,
) {
  const r = await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`);
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/${kind}`,
    headers: { ...asUser(user), 'idempotency-key': randomUUID() },
    payload: {
      expectedVersion: { versionId, revision: (r.rows[0] as { row_version: number }).row_version },
      ...(feedback ? { feedback } : { qcRunId: randomUUID() }),
    },
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

test('send-back mail goes only to owner, with deciding lane and bounded reviewer feedback', async () => {
  const { version } = await submit();
  const dpo = await signIn('fx-user-dpo');
  const res = await decide(dpo, version.versionId, 'dpo', 'send-back', {
    items: [{ slot: 2, deficiency: 'Please correct the synthetic privacy checklist.' }],
    summary: 'ก'.repeat(700),
  });
  assert.equal(res.statusCode, 201, res.body);
  await notifications.deliverPending();
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

test('digest rows remain untouched for W3-03b', async () => {
  const id = randomUUID();
  await db.owner.insert(notification).values({
    id,
    event: 'sla_breach_digest',
    lane: '-',
    recipient: 'operator@rai-desk.example',
    deepLinkPath: '/queue',
    templateKey: 'mail.sla_breach_digest',
    templateParams: {},
    correlationId: randomUUID(),
    createdAt: now(),
  });
  await notifications.deliverPending();
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
