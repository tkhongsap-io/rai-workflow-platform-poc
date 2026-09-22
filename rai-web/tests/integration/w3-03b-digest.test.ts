import { readDeskHealth } from '@rai/server/observability/operator';
import { computeReadiness } from '@rai/server/observability/health';
import { createStoreProbes } from '@rai/server/observability/probes';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import { buildApp, type AppDeps } from '@rai/server/app';
import { createNotifications } from '@rai/server/notifications/service';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { createDigestProducer, loadCommittedDigestRequest } from '@rai/server/notifications/digest';
import { createDailyDigestSchedule } from '@rai/server/notifications/digest-runtime';
import { notification } from '@rai/server/db/schema/notification';
import { operatorJobRun, operatorJobNotification } from '@rai/server/db/schema/operator-job-run';
import { listSlaBreaches } from '@rai/server/sla/breach';
import { publishRevision } from '@rai/server/configuration/store';
import { MemoryMailSink, FileMailSink } from '@rai/fixtures/substitutes/mail-sink/index';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture } from '../support/sign-in.js';

const base = new URL('http://127.0.0.1:8787');
const opened = new Date('2026-09-22T04:00:00Z');
let clock = new Date('2026-10-01T04:00:00Z');
let db: TestDatabase;
let app: ReturnType<typeof buildApp>;
let appDeps: AppDeps;
let scratch: string;
const logs: string[] = [];
const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
before(async () => {
  db = await openTestDatabase();
  scratch = await mkdtemp(path.join(tmpdir(), 'rai-digest-'));
});
beforeEach(async () => {
  if (app) await app.fastify.close();
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE session, registry_counter'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir: path.join(scratch, 'blobs'),
    outputDir: path.join(scratch, 'fixtures'),
    now: opened,
  });
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('no network')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now: () => opened,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl: base, trustProxy: false });
  appDeps = {
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
      now: () => opened,
    },
    pack: { db: db.app, limits: { maxPackBytes: 157286400 }, now: () => opened },
    versions: {
      db: db.app,
      now: () => opened,
      laneOpenRecipients: laneOpenRecipientsFromIdentities(FIXTURE_USERS),
    },
  };
  app = buildApp(appDeps);
  await app.fastify.ready();
  logs.length = 0;
  clock = new Date('2026-10-01T04:00:00Z');
});
after(async () => {
  if (app) await app.fastify.close();
  await db.close();
  await rm(scratch, { recursive: true, force: true });
});
const deps = () => ({ db: db.app, publicBaseUrl: base, emitter: app.emitter, now: () => clock });
async function submit() {
  const owner = await signInAsFixture(app.fastify, 'fx-user-owner-cm');
  const draft = (
    await app.fastify.inject({ method: 'GET', url: `/api/cases/${caseId}/draft`, headers: asUser(owner) })
  ).json<PackDraft>();
  const r = await app.fastify.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/draft/submit`,
    headers: { ...asUser(owner), 'idempotency-key': randomUUID() },
    payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
  });
  assert.equal(r.statusCode, 201);
}
async function digestRows() {
  return db.owner.select().from(notification).where(eq(notification.event, 'sla_breach_digest'));
}
async function requestFor(id: string) {
  const [row] = await db.owner.select().from(notification).where(eq(notification.id, id));
  return db.app.transaction((tx) => loadCommittedDigestRequest(tx, row!, { publicBaseUrl: base }));
}

test('empty query persists completed zero and no mail/outbox/link', async () => {
  const result = await createDigestProducer(deps())();
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.notificationIds, []);
  const [job] = await db.owner.select().from(operatorJobRun);
  assert.equal(job!.breachCount, 0);
  assert.ok(job!.finishedAt);
  assert.equal((await digestRows()).length, 0);
  assert.equal((await db.owner.select().from(operatorJobNotification)).length, 0);
});
for (const locale of ['th', 'en'] as const)
  test(`${locale}: real overdue query, persisted proof, safe links and both local sinks`, async () => {
    await submit();
    const breaches = await listSlaBreaches(db.app, clock);
    assert.ok(breaches.length > 0);
    const result = await createDigestProducer({ ...deps(), locale })();
    assert.equal(result.status, 'completed');
    assert.equal(result.notificationIds.length, 1);
    const request = await requestFor(result.notificationIds[0]!);
    assert.equal(request.event.kind, 'sla_breach_digest');
    assert.equal(request.event.auditEventId, undefined);
    assert.deepEqual(
      request.digestCases!.map((b) => b.lane),
      breaches.map((b) => b.lane),
    );
    assert.equal(request.recipient.address, 'operator-digest@rai-desk.example');
    assert.equal(request.recipient.locale, locale);
    if (locale === 'th') assert.match(request.mail.subject, /[ก-๙]/);
    assert.ok(
      request.deepLinks.every((l) => l.requiresSignIn && l.url === `${base.origin}/cases/${l.caseId}`),
    );
    const memory = new MemoryMailSink({ publicBaseUrl: base });
    const file = new FileMailSink({ publicBaseUrl: base, dir: path.join(scratch, randomUUID()) });
    for (const sink of [memory, file]) {
      assert.equal((await sink.deliver(request)).status, 'delivered');
      const retry = await requestFor(result.notificationIds[0]!);
      assert.deepEqual(retry.event, request.event);
      assert.equal((await sink.deliver({ ...retry, attempt: 2 })).status, 'duplicate');
    }
    const [job] = await db.owner.select().from(operatorJobRun);
    const line = logs
      .map((l) => JSON.parse(l) as { event: string; correlationId: string; fields: { stage?: string } })
      .find((l) => l.event === 'sla.digest.completed');
    assert.equal(line!.correlationId, job!.correlationId);
    assert.doesNotMatch(JSON.stringify(line), /operator-digest@|http:|digestCases/);
  });
test('concurrent/restarted same-day runs own only their links; next day may send', async () => {
  await submit();
  const run = createDigestProducer(deps());
  const results = await Promise.all([run(), run()]);
  assert.ok(results.every((r) => r.status === 'completed'));
  assert.equal(results.flatMap((r) => r.notificationIds).length, 1);
  assert.equal((await digestRows()).length, 1);
  assert.deepEqual((await createDigestProducer(deps())()).notificationIds, []);
  clock = new Date('2026-10-02T04:00:00Z');
  assert.equal((await run()).notificationIds.length, 1);
  assert.equal((await digestRows()).length, 2);
});
test('cross-midnight enqueue retains the job-start Bangkok identity', async () => {
  await submit();
  clock = new Date('2026-10-01T16:59:59Z');
  const result = await createDigestProducer({
    ...deps(),
    beforeStage: (stage) => {
      if (stage === 'render') clock = new Date('2026-10-01T17:00:01Z');
    },
  })();
  const request = await requestFor(result.notificationIds[0]!);
  assert.equal(request.event.digestDay, '2026-10-01');
  assert.equal(request.event.committedAt, '2026-10-01T17:00:01.000Z');
});
for (const stage of ['query', 'render', 'enqueue'] as const)
  test(`safe ${stage} failure persists/logs same correlation; enqueue rolls back orphan`, async () => {
    await submit();
    const result = await createDigestProducer({
      ...deps(),
      beforeStage: (current) => {
        if (current === stage) throw new Error('private@real.com SECRET');
      },
    })();
    assert.equal(result.status, 'failed');
    assert.equal((await digestRows()).length, 0);
    const [job] = await db.owner.select().from(operatorJobRun);
    assert.equal(job!.errorStage, stage);
    assert.equal(job!.errorCode, `${stage}_failed`);
    assert.ok(job!.finishedAt);
    const line = logs
      .map((l) => JSON.parse(l) as { event: string; correlationId: string; fields: { stage?: string } })
      .find((l) => l.event === 'sla.digest.failed');
    assert.equal(line!.correlationId, job!.correlationId);
    assert.equal(line!.fields.stage, stage);
    assert.doesNotMatch(JSON.stringify(line), /SECRET|private@/);
    const readiness = await computeReadiness(
      {
        identity: () => ({ mode: 'fixture', ready: true }),
        loopbackBind: true,
        mailKind: 'memory',
        qcKind: 'substitute',
        build: { commit: 'dev', schemaVersion: 'unknown' },
      },
      {
        ...createStoreProbes(db.urls.app, path.join(scratch, 'blobs')),
        mailSink: () => Promise.resolve('ok'),
        qc: () => Promise.resolve('disabled'),
      },
    );
    const view = await readDeskHealth(db.app, readiness, app.errors.counters());
    assert.equal(view.slaDigest.lastRun?.correlationId, job!.correlationId);
    assert.equal(view.slaDigest.lastRun?.errorCode, `${stage}_failed`);
    assert.equal(view.slaDigest.recentFailures.filter((failure) => failure.jobRunId === job!.id).length, 1);
    assert.equal(
      logs.filter((raw) => (JSON.parse(raw) as { event: string }).event === 'sla.digest.failed').length,
      1,
    );
    assert.doesNotMatch(logs.join(''), /SECRET|private@/);
  });
test('configuration recipient, not role, authorizes digest; invalid synthetic address fails render', async () => {
  await submit();
  await db.app.transaction((tx) =>
    publishRevision(tx, {
      kind: 'operator_recipients',
      body: { addresses: ['no-role@rai-desk.example'] },
      publishedBy: 'fx-user-admin',
      publishedRole: 'admin',
      correlationId: randomUUID(),
      publishedAt: new Date('2026-09-30T00:00:00Z'),
    }),
  );
  const result = await createDigestProducer(deps())();
  assert.equal((await requestFor(result.notificationIds[0]!)).recipient.address, 'no-role@rai-desk.example');
  await db.app.transaction((tx) =>
    publishRevision(tx, {
      kind: 'operator_recipients',
      body: { addresses: ['external@real.com'] },
      publishedBy: 'fx-user-admin',
      publishedRole: 'admin',
      correlationId: randomUUID(),
      publishedAt: new Date('2026-10-01T01:00:00Z'),
    }),
  );
  assert.equal((await createDigestProducer(deps())()).status, 'failed');
});
test('loader ignores caller-forged proof and refuses missing persisted row; DB refuses orphan', async () => {
  await submit();
  const result = await createDigestProducer(deps())();
  const [row] = await digestRows();
  await assert.rejects(
    db.app.transaction((tx) =>
      loadCommittedDigestRequest(tx, { ...row!, id: randomUUID() }, { publicBaseUrl: base }),
    ),
  );
  const real = await db.app.transaction((tx) =>
    loadCommittedDigestRequest(
      tx,
      { ...row!, correlationId: randomUUID(), recipient: 'forged@rai-desk.example' },
      { publicBaseUrl: base },
    ),
  );
  assert.equal(real.recipient.address, row!.recipient);
  assert.equal(real.event.correlationId, row!.correlationId);
  await assert.rejects(db.app.insert(notification).values({ ...row!, id: randomUUID() }));
  assert.equal((await digestRows()).length, 1);
  assert.equal(result.notificationIds.length, 1);
});

for (const invalid of ['configuration', 'day', 'due', 'recipient'] as const)
  test(`loader refuses persisted linked rows with invalid ${invalid} proof`, async () => {
    await submit();
    const valid = await createDigestProducer(deps())();
    const [source] = await digestRows();
    const id = randomUUID(),
      jobRunId = randomUUID(),
      correlationId = randomUUID();
    const digestDay = invalid === 'day' ? '2026-10-03' : '2026-10-02';
    const startedAt = new Date('2026-10-02T04:00:00Z');
    const snapshot = structuredClone(source!.templateParams) as {
      configurationRevisionId: string;
      breaches: { dueOn: string }[];
    };
    if (invalid === 'configuration') snapshot.configurationRevisionId = randomUUID();
    if (invalid === 'due') snapshot.breaches[0]!.dueOn = '2026-09-23';
    const recipient = invalid === 'recipient' ? 'forged@rai-desk.example' : source!.recipient;
    await db.app.transaction(async (tx) => {
      await tx
        .insert(operatorJobRun)
        .values({ id: jobRunId, job: 'sla_digest', digestDay, correlationId, startedAt, status: 'running' });
      await tx
        .insert(notification)
        .values({ ...source!, id, recipient, correlationId, createdAt: startedAt, templateParams: snapshot });
      await tx.insert(operatorJobNotification).values({ jobRunId, notificationId: id, recipient, digestDay });
    });
    await assert.rejects(requestFor(id), /invalid persisted digest/);
    assert.equal(valid.notificationIds.length, 1);
  });

test('SQL link guard rejects correlation mismatch and leaves no orphan after rollback', async () => {
  await submit();
  await createDigestProducer(deps())();
  const [source] = await digestRows();
  const id = randomUUID(),
    jobRunId = randomUUID();
  await assert.rejects(
    db.app.transaction(async (tx) => {
      await tx.insert(operatorJobRun).values({
        id: jobRunId,
        job: 'sla_digest',
        digestDay: '2026-10-02',
        correlationId: randomUUID(),
        startedAt: new Date('2026-10-02T04:00:00Z'),
        status: 'running',
      });
      await tx.insert(notification).values({ ...source!, id, correlationId: randomUUID() });
      await tx
        .insert(operatorJobNotification)
        .values({ jobRunId, notificationId: id, recipient: source!.recipient, digestDay: '2026-10-02' });
    }),
  );
  assert.equal((await digestRows()).length, 1);
  assert.equal((await db.owner.select().from(operatorJobRun)).length, 1);
});

test('local scheduler drives real startup/restart/day-change jobs without a delivery runner', async () => {
  await submit();
  const controller = new AbortController();
  const tasks: Promise<void>[] = [];
  let fire: (() => void) | undefined;
  let delay = 0;
  let cancelled = false;
  const options = {
    signal: controller.signal,
    run: createDigestProducer(deps()),
    track: (task: Promise<void>) => {
      tasks.push(task);
    },
    onError: () => assert.fail('unexpected producer infrastructure failure'),
    clock: {
      now: () => clock,
      schedule: (fn: () => void, ms: number) => {
        fire = fn;
        delay = ms;
        return 1;
      },
      cancel: () => {
        cancelled = true;
      },
    },
  };
  try {
    await createDailyDigestSchedule(options).start();
    assert.equal((await digestRows()).length, 1);
    assert.equal(delay, 13 * 60 * 60 * 1000, '11am Bangkok schedules the next midnight');
    await createDailyDigestSchedule(options).start();
    assert.equal((await digestRows()).length, 1, 'restart preserves day/recipient identity');
    clock = new Date('2026-10-01T17:00:00Z');
    fire!();
    await tasks.at(-1);
    const rows = await digestRows();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.attempts === 0 && row.status === 'queued'));
    const jobs = await db.owner.select().from(operatorJobRun);
    assert.equal(jobs.length, 3);
    assert.ok(jobs.every((job) => job.status === 'completed'));
    assert.deepEqual([...new Set(jobs.map((job) => job.digestDay))].sort(), ['2026-10-01', '2026-10-02']);
    controller.abort();
    assert.equal(cancelled, true);
    fire!();
    await Promise.resolve();
    assert.equal((await db.owner.select().from(operatorJobRun)).length, 3);
  } finally {
    controller.abort();
  }
});

test('shutdown abort during enqueue rolls back notification and link before failing the job', async () => {
  await submit();
  const controller = new AbortController();
  const result = await createDigestProducer({
    ...deps(),
    beforeStage: (stage) => {
      if (stage === 'enqueue') controller.abort();
    },
  })(controller.signal);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.notificationIds, []);
  assert.equal((await digestRows()).length, 0);
  assert.equal((await db.owner.select().from(operatorJobNotification)).length, 0);
  const [job] = await db.owner.select().from(operatorJobRun);
  assert.equal(job!.status, 'failed');
  assert.equal(job!.errorStage, 'enqueue');
  assert.ok(job!.finishedAt);
});

test('bound app startup produces then uses the single dispatcher; restart does not resend', async () => {
  await submit();
  const sink = new MemoryMailSink({ publicBaseUrl: base });
  const start = async () => {
    await app.fastify.close();
    app = buildApp({
      ...appDeps,
      digest: { db: db.app, publicBaseUrl: base, now: () => clock },
      notifications: { db: db.app, publicBaseUrl: base, identities: FIXTURE_USERS, sink, now: () => clock },
    });
    await app.fastify.ready();
  };
  await start();
  const digests = sink.sent.filter((request) => request.event.kind === 'sla_breach_digest');
  assert.equal(digests.length, 1);
  assert.equal(sink.sent.filter((request) => request.event.kind === 'lane_opened').length, 4);
  const [row] = await digestRows();
  assert.equal(row!.status, 'sent');
  assert.equal(row!.attempts, 1);
  await start();
  assert.equal(sink.sent.filter((request) => request.event.kind === 'sla_breach_digest').length, 1);
  assert.equal((await db.owner.select().from(operatorJobRun)).length, 2);
  await app.drain.close(1000);
});

test('digest attempts use W3-04 four-result policy and retain original persisted provenance', async () => {
  await submit();
  const produced = await createDigestProducer(deps())();
  const sink = new MemoryMailSink({ publicBaseUrl: base });
  sink.failAlways(true);
  const seen: unknown[] = [];
  const dispatcher = createNotifications({
    ...deps(),
    identities: FIXTURE_USERS,
    sink: {
      identity: sink.identity,
      deliver: (request) => {
        seen.push(request.event);
        return sink.deliver(request);
      },
    },
  });
  const id = produced.notificationIds[0]!;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = await dispatcher.deliverInitial(id);
    assert.equal(result!.attempt, attempt);
    const [row] = await db.owner.select().from(notification).where(eq(notification.id, id));
    assert.equal(row!.attempts, attempt);
    if (attempt < 4) {
      assert.equal(row!.status, 'queued');
      assert.equal(await dispatcher.deliverInitial(id), undefined, 'not due yet');
      clock = row!.nextAttemptAt!;
    } else {
      assert.equal(row!.status, 'failed');
      assert.equal(row!.nextAttemptAt, null);
    }
  }
  assert.equal(await dispatcher.deliverInitial(id), undefined);
  assert.equal(seen.length, 4);
  assert.ok(seen.every((event) => JSON.stringify(event) === JSON.stringify(seen[0])));
  const terminal = logs
    .map((line) => JSON.parse(line) as { event: string; correlationId: string })
    .filter((line) => line.event === 'mail.failed');
  assert.equal(terminal.length, 1);
  const [job] = await db.owner.select().from(operatorJobRun);
  assert.equal(terminal[0]!.correlationId, job!.correlationId);
  assert.equal(job!.status, 'completed', 'delivery failures do not rewrite the producer result');
});

test('two recipients recover a partial enqueue failure without stealing the first job provenance', async () => {
  await submit();
  const addresses = ['first@rai-desk.example', 'second@rai-desk.example'];
  await db.app.transaction((tx) =>
    publishRevision(tx, {
      kind: 'operator_recipients',
      body: { addresses },
      publishedBy: 'fx-user-admin',
      publishedRole: 'admin',
      correlationId: randomUUID(),
      publishedAt: new Date('2026-09-30T00:00:00Z'),
    }),
  );
  let enqueues = 0;
  const first = await createDigestProducer({
    ...deps(),
    beforeStage: (stage) => {
      if (stage === 'enqueue' && ++enqueues === 2) throw new Error('synthetic second-recipient failure');
    },
  })();
  assert.equal(first.status, 'failed');
  assert.equal(first.notificationIds.length, 1);
  const partialRows = await digestRows();
  assert.equal(partialRows.length, 1);
  assert.equal(partialRows[0]!.recipient, addresses[0]);
  const original = await requestFor(first.notificationIds[0]!);
  const second = await createDigestProducer(deps())();
  assert.equal(second.status, 'completed');
  assert.equal(second.notificationIds.length, 1);
  assert.notEqual(first.notificationIds[0], second.notificationIds[0]);
  const rows = await digestRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.recipient).sort(), addresses);
  const links = await db.owner.select().from(operatorJobNotification);
  assert.equal(links.length, 2);
  assert.equal(
    links.find((link) => link.notificationId === first.notificationIds[0])!.jobRunId,
    first.jobRunId,
  );
  assert.equal(
    links.find((link) => link.notificationId === second.notificationIds[0])!.jobRunId,
    second.jobRunId,
  );
  assert.deepEqual((await requestFor(first.notificationIds[0]!)).event, original.event);
  const sink = new MemoryMailSink({ publicBaseUrl: base });
  const dispatcher = createNotifications({ ...deps(), sink, identities: FIXTURE_USERS });
  for (const row of rows) await dispatcher.deliverInitial(row.id);
  assert.equal(sink.sent.length, 2);
  assert.deepEqual(sink.sent.map((request) => request.recipient.address).sort(), addresses);
  assert.equal(new Set(sink.sent.map((request) => request.event.correlationId)).size, 2);
  for (const row of rows) assert.equal(await dispatcher.deliverInitial(row.id), undefined);
  assert.equal(sink.sent.length, 2);
});
