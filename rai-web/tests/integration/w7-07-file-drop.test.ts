// W7-07 (W7 plan section 5.3, section 9 row W7-07), against the real Postgres, in `local-google` shape: the production
// composition (composeAppDeps) with a live recipient directory and the in-product mail file drop, a local-google
// adapter whose sign-ins go through the `discovery` and `exchange` seams (no provider, no network), and a synthetic
// role map. A lane reviewer who signed in before the directory loaded (from `subject_profile`) and one who signs in
// after it (the W7-06 `recorded` hook) each receive a lane-opened file when an owner submits; a lane holder who never
// signed in gets nothing. Readiness is `ready` with mailSink `file` / `ok`. Synthetic accounts only.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DeliveryReceipt, DeliveryRequest } from '@rai/shared/mail/types';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { ReadinessReport } from '@rai/shared/schemas/observability';
import { createFilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { composeAppDeps } from '@rai/server/compose-app-deps';
import { UPLOAD_LIMIT_DEFAULTS, readEnv, parseDatabaseConfig } from '@rai/server/config';
import { migrationFileCount } from '@rai/server/db/migrate';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { GOOGLE_ISSUER } from '@rai/server/identity/oidc';
import { createRecipientDirectory } from '@rai/server/notifications/directory';
import { createFileDropMailSink } from '@rai/server/notifications/file-drop';
import { computeReadiness, createReadinessReader } from '@rai/server/observability/health';
import { createStoreProbes } from '@rai/server/observability/probes';
import { loadFixtures } from '@rai/fixtures/load';
import { buildApp } from '../support/observed-app.js';
import { openTestDatabase, type TestDatabase } from '../support/db.js';

const publicBaseUrl = new URL('http://127.0.0.1:8787');
const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  trustProxy: false,
  publicBaseUrl,
  upload: {
    maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
    maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
    maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
  },
  mail: { mode: 'sink-file' as const, sinkDir: '' },
};

const AI_COE = {
  sub: 'w7-07-ai-coe',
  email: 'ai-coe.reviewer@rai-desk.example',
  name: 'AI CoE reviewer (synthetic)',
};
const DPO = { sub: 'w7-07-dpo', email: 'dpo.reviewer@rai-desk.example', name: 'DPO reviewer (synthetic)' };
const SECURITY = {
  sub: 'w7-07-sec',
  email: 'security.reviewer@rai-desk.example',
  name: 'Security (synthetic)',
};
const OWNER = { sub: 'w7-07-owner', email: 'owner.w707@rai-desk.example', name: 'Owner (synthetic)' };
const ROLE_MAP = JSON.stringify({
  version: 1,
  entries: [
    { email: AI_COE.email, roles: [{ role: 'ai_coe', scope: { kind: 'all_cases', lane: 'ai_coe' } }] },
    { email: DPO.email, roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }] },
    {
      email: SECURITY.email,
      roles: [{ role: 'it_security', scope: { kind: 'all_cases', lane: 'it_security' } }],
    },
  ],
});

let db: TestDatabase;
let root: string;
let mailDir: string;
let blobDir: string;
let who = OWNER;
const now = () => new Date();

async function localGoogleAdapter() {
  const adapter = createIdentityAdapter({
    env: {
      RAI_IDENTITY_MODE: 'local-google',
      RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
      RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
      RAI_IDENTITY_LOCAL_ROLE_MAP: 'synthetic-role-map.json',
      RAI_SESSION_ABSOLUTE_HOURS: '12',
      RAI_SESSION_IDLE_MINUTES: '120',
    },
    nodeEnv: 'test',
    discovery: () =>
      Promise.resolve({
        issuer: GOOGLE_ISSUER,
        authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
        token_endpoint: 'https://127.0.0.1:1/token', // never reached: the exchange seam answers
      }),
    groupMappingSource: () => Promise.resolve(null),
    readLocalRoleMap: () => Promise.resolve(ROLE_MAP),
    exchange: (input) =>
      Promise.resolve({
        iss: GOOGLE_ISSUER,
        sub: who.sub,
        email: who.email,
        email_verified: true,
        name: who.name,
        nonce: input.expectedNonce,
      }),
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  return adapter;
}

/** The start.ts composition for local-google with MAIL_MODE=sink-file, over the test database. */
async function localGoogleDesk() {
  const adapter = await localGoogleAdapter();
  const recipients = createRecipientDirectory({ identityMode: 'local-google' });
  await recipients.load(db.app);
  const mailSink = createFileDropMailSink({ dir: mailDir, publicBaseUrl });
  const store = createFilesystemBlobStore(blobDir);
  await store.init();
  const { url } = parseDatabaseConfig(readEnv());
  const readiness = createReadinessReader(() =>
    computeReadiness(
      {
        identity: () => adapter.health(),
        loopbackBind: true,
        mailKind: 'file',
        qcKind: 'deterministic',
        build: { commit: 'test', schemaVersion: String(migrationFileCount()) },
      },
      {
        ...createStoreProbes(url, blobDir),
        mailSink: () => mailSink.health(),
        qc: () => Promise.resolve('disabled'),
      },
    ),
  );
  const { fastify } = buildApp(
    composeAppDeps({
      config: { ...config, mail: { mode: 'sink-file', sinkDir: mailDir } },
      db: db.app,
      adapter,
      businessUnits: createBusinessUnitDirectory(['CM', 'HR']),
      store,
      mailSink,
      recipients,
      readiness,
      now,
    }),
  );
  await fastify.ready();
  return { fastify, recipients };
}

function cookieOf(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string | string[] | undefined;
  const list: string[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
}

async function signIn(app: FastifyInstance, account: typeof OWNER): Promise<string> {
  who = account;
  const begin = await app.inject({ method: 'POST', url: '/auth/sign-in', payload: {} });
  assert.equal(begin.statusCode, 200, begin.body);
  const state = new URL(begin.json<{ redirectUrl: string }>().redirectUrl).searchParams.get('state');
  const transaction = cookieOf(begin, 'rai_signin');
  assert.ok(state && transaction);
  const res = await app.inject({
    method: 'GET',
    url: `/auth/callback?code=synthetic-code&state=${state}`,
    headers: { cookie: transaction },
  });
  assert.equal(res.statusCode, 303, res.body);
  const session = cookieOf(res, 'rai_session');
  assert.ok(session, 'a session cookie is set');
  return session;
}

const asUser = (cookie: string) => ({ cookie, 'sec-fetch-site': 'same-origin' });

async function droppedFiles(): Promise<{ request: DeliveryRequest; receipt: DeliveryReceipt }[]> {
  const names = (await readdir(mailDir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
  return Promise.all(
    names.map(
      async (n) =>
        JSON.parse(await readFile(path.join(mailDir, n), 'utf8')) as {
          request: DeliveryRequest;
          receipt: DeliveryReceipt;
        },
    ),
  );
}

before(async () => {
  db = await openTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), 'rai-w7-07-'));
  mailDir = path.join(root, 'mail');
  blobDir = path.join(root, 'blobs');
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir: path.join(root, 'out'),
    now: now(),
  });
});
after(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

test('W7-07: in local-google shape a submit writes lane-opened files to profile holders, including one who signed in after start; readiness is ready with mail file', async () => {
  // Before "start": the AI CoE reviewer signs in once on an earlier desk, leaving only a subject_profile row.
  const earlier = await localGoogleDesk();
  await signIn(earlier.fastify, AI_COE);
  await earlier.fastify.close();

  const desk = await localGoogleDesk();
  assert.deepEqual(
    desk.recipients.identities().map((u) => u.email),
    [AI_COE.email],
    'the directory loaded the profile written before start',
  );
  const ready = await desk.fastify.inject({ method: 'GET', url: '/readyz' });
  assert.equal(ready.statusCode, 200, ready.body);
  const report = ready.json<ReadinessReport>();
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.mailSink, { kind: 'file', status: 'ok' });

  // After start: the DPO reviewer signs in; the recorded hook refreshes the directory.
  await signIn(desk.fastify, DPO);
  assert.deepEqual(desk.recipients.laneOpenRecipients(), {
    ai_coe: [AI_COE.email],
    dpo: [DPO.email],
    it_security: [],
  });

  const owner = await signIn(desk.fastify, OWNER);
  const created = await desk.fastify.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { ...asUser(owner), 'idempotency-key': randomUUID() },
    payload: {
      useCaseName: 'W7-07 synthetic lane-open case',
      businessUnitId: 'CM',
      businessUnit: 'Consumer Mobile',
      businessOwner: `google:${OWNER.sub}`,
      technicalOwner: 'Tech (synthetic)',
      sourceRecordId: { kind: 'unknown' },
      useCaseGroup: 'customer-analytics',
      vendorInvolved: false,
      modelType: 'llm',
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const caseId = created.json<CaseView>().caseId;
  const draft = (
    await desk.fastify.inject({ method: 'GET', url: `/api/cases/${caseId}/draft`, headers: asUser(owner) })
  ).json<PackDraft>();
  const submitted = await desk.fastify.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/draft/submit`,
    headers: { ...asUser(owner), 'idempotency-key': randomUUID() },
    payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
  });
  assert.equal(submitted.statusCode, 201, submitted.body);

  // The app's delivery worker runs after the response; observe (never drive) until the rows and files settle.
  const sentRows = () =>
    db.raw(
      'owner',
      async (c) =>
        (
          await c.query<{ recipient: string; status: string }>(
            'SELECT recipient, status FROM notification WHERE case_id = $1 ORDER BY recipient',
            [caseId],
          )
        ).rows,
    );
  const deadline = performance.now() + 10_000;
  let files = await droppedFiles();
  let rows = await sentRows();
  while (
    (files.length < 2 || rows.length < 2 || rows.some((r) => r.status !== 'sent')) &&
    performance.now() < deadline
  ) {
    await delay(25);
    files = await droppedFiles();
    rows = await sentRows();
  }
  assert.deepEqual(
    files
      .map((f) => [f.request.event.kind, f.request.event.lane, f.request.recipient.address, f.receipt.status])
      .sort(),
    [
      ['lane_opened', 'ai_coe', AI_COE.email, 'delivered'],
      ['lane_opened', 'dpo', DPO.email, 'delivered'],
    ],
  );
  for (const f of files) {
    assert.equal(f.request.event.caseId, caseId);
    assert.equal(f.request.recipient.basis, 'case_view_scope');
  }
  assert.deepEqual(rows, [
    { recipient: AI_COE.email, status: 'sent' },
    { recipient: DPO.email, status: 'sent' },
  ]);
  assert.ok(
    !files.some((f) => f.request.recipient.address === SECURITY.email),
    'a lane holder who never signed in gets no mail',
  );
});
