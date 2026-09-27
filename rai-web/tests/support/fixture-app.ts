// The in-process app of the integration suites: the production composition (composeAppDeps) over the fixture
// identities, the test database and a private blob directory, reset to the loaded fixture set and rebuilt before
// every test. A suite passes only what differs (its clock, its QC runner, its mail sink) and reads the live `app`,
// `db`, `capture` and `diagnostics` bindings. Each test file runs in its own process, so one app per module is enough.

import { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { App } from '@rai/server/app';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { composeAppDeps } from '@rai/server/compose-app-deps';
import { UPLOAD_LIMIT_DEFAULTS } from '@rai/server/config';
import { migrationFileCount } from '@rai/server/db/migrate';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { computeReadiness, createReadinessReader } from '@rai/server/observability/health';
import { createStoreProbes } from '@rai/server/observability/probes';
import { qcKindOf } from '@rai/server/qc/kind';
import type { LaneOpenRecipients } from '@rai/server/versions/open-lanes';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { loadFixtures } from '@rai/fixtures/load';
import type { MailSink } from '@rai/shared/mail/types';
import type { QcRunner } from '@rai/shared/qc/types';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { openTestDatabase, type TestDatabase } from './db.js';
import { createLogCapture, type LogCapture } from './log-capture.js';
import { buildApp } from './observed-app.js';
import { asUser, signInAsFixture, type FixtureSession } from './sign-in.js';

/** A runner with the scripted substitute's health probe, when it has one. */
export type FixtureQcRunner = QcRunner & { probe?(): Promise<'ok' | 'unavailable' | 'disabled'> };

export interface FixtureAppOptions {
  now: () => Date;
  /** Called on every rebuild, so scripted runner state never outlives a test. Absent: no runner is bound. */
  qcRunner?: () => FixtureQcRunner;
  /** Called on every rebuild. Absent: no case mail and no digest. */
  mailSink?: () => MailSink;
}

/** One rebuild's departures from the suite's options; `null` binds no runner or no sink. */
export interface RebuildOverrides {
  qcRunner?: FixtureQcRunner | null;
  mailSink?: MailSink | null;
  /** Replaces the recipients composeAppDeps derives from the fixture identities. */
  laneOpenRecipients?: LaneOpenRecipients;
}

const publicBaseUrl = new URL('http://127.0.0.1:8787');
const config = {
  nodeEnv: 'test',
  log: { level: 'info', pretty: false },
  trustProxy: false,
  publicBaseUrl,
  upload: {
    maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
    maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
    maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
  },
} as const;

export let db: TestDatabase;
export let app: FastifyInstance;
/**
 * The current app's emitter and error capture, for suites that call a service directly, and its drain: closing it
 * waits for the app's background work (W4-04: upload-trigger QC runs) before the app stops.
 */
export let diagnostics: Pick<App, 'emitter' | 'errors' | 'drain'>;
/** Every log line the current test's apps wrote. */
export let capture: LogCapture;

let options: FixtureAppOptions;
let blobDir: string;
let outputDir: string;
let store: FilesystemBlobStore;

/** Installs the shared lifecycle; call once at the top of a suite, after any hook that resets its clock. */
export function openFixtureApp(suiteOptions: FixtureAppOptions): void {
  options = suiteOptions;
  before(async () => {
    db = await openTestDatabase();
    blobDir = await mkdtemp(path.join(tmpdir(), 'rai-fixture-app-blobs-'));
    outputDir = await mkdtemp(path.join(tmpdir(), 'rai-fixture-app-out-'));
    store = createFilesystemBlobStore(blobDir);
  });
  beforeEach(async () => {
    // Close first: the previous test's app may still be delivering mail or running upload QC against the rows the
    // reset removes; the drain waits for that tracked background work.
    if (app !== undefined) await closeCurrent();
    capture = createLogCapture();
    await db.reset();
    await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
    await rm(path.join(blobDir, 'sha256'), { recursive: true, force: true });
    await store.init();
    // A minute before the app clock, so every row a test writes is later than the loaded fixture set.
    const loadedAt = new Date(options.now().getTime() - 60_000);
    await loadFixtures(db.operator, {
      nodeEnv: 'test',
      identityMode: 'fixture',
      blobDir,
      outputDir,
      now: loadedAt,
    });
    await rebuildApp();
  });
  after(async () => {
    await closeCurrent();
    await db.close();
    await rm(blobDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });
}

/** Closes the current app through its drain (a second close of the same app is a no-op). */
async function closeCurrent(): Promise<void> {
  const current = diagnostics;
  if (closed.has(current)) return;
  closed.add(current);
  await current.drain.close();
}
const closed = new WeakSet<object>();

/** Replaces the app on the same database. */
export async function rebuildApp({
  qcRunner = options.qcRunner?.() ?? null,
  mailSink = options.mailSink?.() ?? null,
  laneOpenRecipients,
}: RebuildOverrides = {}) {
  if (app !== undefined) await closeCurrent();
  const { now } = options;
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12', RAI_SESSION_IDLE_MINUTES: '120' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const readiness = createReadinessReader(() =>
    computeReadiness(
      {
        identity: () => adapter.health(),
        loopbackBind: true,
        mailKind: 'memory',
        qcKind: qcRunner === null ? 'substitute' : qcKindOf(qcRunner.identity), // W4a plan section 2
        build: { commit: 'dev', schemaVersion: String(migrationFileCount()) },
      },
      {
        ...createStoreProbes(db.urls.app, blobDir),
        // The suites assert mail rows and sink contents, never mail readiness, so the sink always reports up.
        mailSink: () => Promise.resolve('ok'),
        qc: () => qcRunner?.probe?.() ?? Promise.resolve('disabled'),
      },
    ),
  );
  const { versions, ...deps } = composeAppDeps({
    config,
    db: db.app,
    adapter,
    fixtureUsers: FIXTURE_USERS,
    businessUnits: createBusinessUnitDirectory(
      businessUnitsFromGrants(FIXTURE_USERS.flatMap((u) => [...u.roles])),
    ),
    store,
    qcRunner: qcRunner ?? undefined,
    mailSink: mailSink ?? undefined,
    readiness,
    now,
  });
  // Suites run submit QC by hand (runAndPersistSubmitQc) to control its timing; the background run start.ts binds
  // would race their qc_run assertions. Every other group is exactly the production composition.
  const { qc: _submitQc, ...versionRoutes } = versions!;
  const built = buildApp({
    ...deps,
    versions: laneOpenRecipients === undefined ? versionRoutes : { ...versionRoutes, laneOpenRecipients },
    logStream: capture.stream,
  });
  diagnostics = built;
  app = built.fastify;
  await app.ready();
}

export const signIn = (fixtureUserId: string) => signInAsFixture(app, fixtureUserId);

/** The suite's private BLOB_DIR (read-only use: W7-01 backs it up next to the database). */
export const fixtureBlobDir = (): string => blobDir;

/** Submits the case's draft at its current revision; asserts 201. */
export async function submit(session: FixtureSession, caseId: string) {
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
  return { version: res.json<SubmittedVersion>(), correlationId: String(res.headers['x-correlation-id']) };
}

export const submitOk = async (session: FixtureSession, caseId: string) =>
  (await submit(session, caseId)).version;

export async function caseRevision(caseId: string): Promise<number> {
  const r = await db.owner.execute(sql`SELECT row_version FROM "case" WHERE id = ${caseId}`);
  return Number((r.rows[0] as { row_version: number }).row_version);
}
