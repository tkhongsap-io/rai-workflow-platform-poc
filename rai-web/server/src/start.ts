// The start sequence main.ts runs, as a function so tests can inject the address resolver and exit: config →
// fixture inputs → identity adapter start() (never listens on a refusal, exit 78) → app → listen → post-listen
// loopback check (W0-03 S16: close and exit 78 when the bound address is not loopback). main.ts never migrates (W0-04).

import { createReadinessReader, computeReadiness } from './observability/health.js';
import { createStoreProbes } from './observability/probes.js';
import { loadMailSink } from './notifications/runtime.js';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { composeAppDeps } from './compose-app-deps.js';
import { createFilesystemBlobStore } from './artifacts/blob-store.js';
import {
  businessUnitsFromGrants,
  createBusinessUnitDirectory,
  type BusinessUnitDirectory,
} from './cases/business-units.js';
import { ConfigError, EXIT_CONFIG, isLoopbackHost, parseConfig, type Env } from './config.js';
import { createDb, type DbHandle } from './db/client.js';
import { currentRevision } from './configuration/store.js';
import { createIdentityAdapter, type Discovery, type GroupMappingSource } from './identity/adapter.js';
import type { FixtureIdentity } from './identity/fixture.js';
import { openidClientDiscovery } from './identity/oidc.js';
import { IdentityStartupError } from './identity/types.js';
import type { Emitter } from './observability/log.js';
import { startedFields } from './observability/started.js';
import { WEB_DIST_DIR, webDistPresent } from './static.js';
import { migrationFileCount } from './db/migrate.js';
import type { QcRunner, VersionRef } from '@rai/shared/qc/types';
import { createDeterministicQcRunner } from './qc/deterministic/runner.js';
import { qcKindOf } from './qc/kind.js';

type ConfiguredQcRunner = QcRunner & { probe(): Promise<'ok' | 'unavailable' | 'disabled'> };
type ImportFixture = (specifier: string) => Promise<unknown>;

export interface StartOverrides {
  /** Synthetic journey only; shared runner instance, never a runtime configuration option. */
  qcRunner?: ConfiguredQcRunner;
  /** S16 seam: what the adapter reads after listen; defaults to fastify.server.address(). */
  addressOf?: (fastify: FastifyInstance) => AddressInfo | string | null;
  /** Exit seam for tests; defaults to process.exit. Must not return. */
  exit?: (code: number) => never;
  /** The fixture table (fixture mode only); defaults to FIXTURE_USERS from @rai/fixtures/data/users. */
  fixtureUsers?: readonly FixtureIdentity[];
  /** The slice-1 BU key list (every mode); defaults to FIXTURE_BUSINESS_UNITS from the same module. */
  fixtureBusinessUnits?: readonly string[];
  /** Test seam for the run-time `@rai/fixtures` import. */
  importFixture?: ImportFixture;
  discovery?: Discovery;
  now?: () => Date;
  /** The built SPA directory to serve; defaults to rai-web/web/dist. */
  webDistDir?: string;
  /** How long in-flight requests get after close() before their sockets are destroyed (W0-04). */
  drainMs?: number;
}

export interface StartedServer {
  fastify: FastifyInstance;
  emitter: Emitter;
  /** The configured BU keys the case routes accept (W0-04 `case.business_unit_id`), observable by tests. */
  businessUnits: BusinessUnitDirectory;
  /** The bounded W0-04 drain (shutdown.ts), then the database pool closes. */
  close(): Promise<void>;
}

/** Only an absent package degrades; a present but broken fixtures build must refuse to start, not start empty. */
function isMissingFixtures(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes("'@rai/fixtures'");
}

/**
 * `@rai/fixtures/<path>` resolved at run time: the server never imports fixtures statically, so the production
 * build cannot contain them (`check:substitute-absent`). Undefined when the package is not installed.
 */
async function importFixtureModule<T>(importFixture: ImportFixture, path: string): Promise<T | undefined> {
  try {
    return (await importFixture(`@rai/fixtures/${path}`)) as T;
  } catch (err) {
    if (isMissingFixtures(err)) return undefined;
    throw err;
  }
}

/** The eight W0-03 identities (fixture mode) and the slice-1 BU list (`CM`, `HR`; W0-03 section 7, every mode). */
interface FixtureUsersModule {
  FIXTURE_USERS: readonly FixtureIdentity[];
  FIXTURE_BUSINESS_UNITS: readonly { businessUnitId: string }[];
}

/** The slice-1 QC substitute (`QC_MODE=substitute`), so findings and dispositions work against the deployable. */
async function loadQcSubstituteRunner(
  importFixture: ImportFixture,
  clock: { now?: () => Date },
): Promise<ConfiguredQcRunner | undefined> {
  const qc = await importFixtureModule<{
    ScriptedQcRunner: new (options: {
      fixtureCaseIdOf: (version: VersionRef) => string | undefined;
      now?: () => Date;
    }) => ConfiguredQcRunner;
  }>(importFixture, 'substitutes/qc/index');
  const cases = await importFixtureModule<{
    FIXTURE_CASES: readonly { caseId: string; fixtureCaseId: string }[];
  }>(importFixture, 'data/cases/index');
  if (qc === undefined || cases === undefined) return undefined;
  const byCaseId = new Map(cases.FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));
  return new qc.ScriptedQcRunner({ fixtureCaseIdOf: (version) => byCaseId.get(version.caseId), ...clock });
}

/** The W4a runner (W4-03); in-process and storage-free, so its probe is always ok. */
function deterministicRunner(clock: { now?: () => Date }): ConfiguredQcRunner {
  return { ...createDeterministicQcRunner(clock), probe: () => Promise.resolve('ok') };
}

/** process.refused (W0-10 3.3): the reason code only, never a value; written before any logger exists. */
function refuse(reason: string, exit: (code: number) => never): never {
  console.error(JSON.stringify({ event: 'process.refused', reason }));
  return exit(EXIT_CONFIG);
}

export async function startServer(env: Env, overrides: StartOverrides = {}): Promise<StartedServer> {
  const exit = overrides.exit ?? ((code: number): never => process.exit(code));
  if (
    overrides.qcRunner !== undefined &&
    (env.NODE_ENV !== 'test' || env.RAI_IDENTITY_MODE !== 'fixture' || !isLoopbackHost(env.HOST ?? ''))
  )
    return refuse('test_qc_override_forbidden', exit);
  let config;
  try {
    config = parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return refuse(err.reason, exit);
    throw err;
  }

  // Without a web build the process serves the API alone (the integration suites spawn main.ts through tsx); in
  // production a missing bundle is a misconfiguration, not a reason to answer 404 on every page.
  const webDistDir = overrides.webDistDir ?? WEB_DIST_DIR;
  const serveWeb = webDistPresent(webDistDir);
  if (!serveWeb && config.nodeEnv === 'production') return refuse('missing:web/dist', exit);

  const clock = overrides.now === undefined ? {} : { now: overrides.now };
  const importFixture = overrides.importFixture ?? ((specifier: string) => import(specifier));
  const fixtures = await Promise.all([
    importFixtureModule<FixtureUsersModule>(importFixture, 'data/users'),
    // W4a plan section 2: QC_MODE selects the runner and neither falls back to the other. config.ts refuses
    // `substitute` under production or a non-local identity mode; without the fixtures package it stays unbound.
    overrides.qcRunner ??
      (config.qc.mode === 'deterministic'
        ? deterministicRunner(clock)
        : loadQcSubstituteRunner(importFixture, clock)),
  ]).catch(() => undefined);
  if (fixtures === undefined) return refuse('fixtures_import_failed', exit);
  const [usersModule, qcRunner] = fixtures;
  const fixtureUsers =
    config.identity.mode === 'fixture' ? (overrides.fixtureUsers ?? usersModule?.FIXTURE_USERS) : undefined;

  const db: DbHandle = createDb(config.database.url);
  const groupMappingSource: GroupMappingSource = async () =>
    (await currentRevision(db.db, 'group_role_mapping'))?.body ?? null;
  const adapter = createIdentityAdapter({
    env: config.identity.env,
    nodeEnv: config.nodeEnv,
    discovery: overrides.discovery ?? openidClientDiscovery,
    groupMappingSource,
    ...(fixtureUsers === undefined ? {} : { fixtureUsers }),
    ...clock,
  });
  try {
    // Level 1 of the fail-closed rule: refused means never listening.
    const { host, port, publicBaseUrl, trustProxy } = config;
    await adapter.start({ host, port, publicBaseUrl, trustProxy });
  } catch (err) {
    await db.close();
    if (err instanceof IdentityStartupError) return refuse(err.reason, exit);
    throw err;
  }

  // The fixture BU keys apply in every identity mode, so a local-google owner (W0-03 4.1) can file a case; the W6/W8
  // group mapping replaces them.
  const knownIdentities = fixtureUsers ?? [];
  const businessUnits = createBusinessUnitDirectory([
    ...(overrides.fixtureBusinessUnits ??
      usersModule?.FIXTURE_BUSINESS_UNITS.map((u) => u.businessUnitId) ??
      []),
    ...businessUnitsFromGrants(knownIdentities.flatMap((u) => [...u.roles])),
  ]);
  const store = createFilesystemBlobStore(path.resolve(config.blobDir));
  await store.init(); // root 0700, tmp/ emptied at process start (W0-08 section 6)
  // Only fixture identities can be synthetic mail recipients in this slice. No live directory or transport.
  const mailSink = config.identity.mode === 'fixture' ? await loadMailSink(config) : undefined;
  const schemaVersion = String(migrationFileCount());
  // Readiness observes the exact runner and sink injected into the existing consumers.
  const readiness = createReadinessReader(() =>
    computeReadiness(
      {
        identity: () => adapter.health(),
        loopbackBind: isLoopbackHost(config.host),
        mailKind: config.mail.mode === 'sink-memory' ? 'memory' : 'file',
        qcKind: qcRunner === undefined ? config.qc.mode : qcKindOf(qcRunner.identity), // W4a plan section 2
        build: { commit: config.buildCommit, schemaVersion },
      },
      {
        ...createStoreProbes(config.database.url, path.resolve(config.blobDir)),
        mailSink: () => mailSink?.health() ?? Promise.resolve('unavailable'),
        qc: () => qcRunner?.probe() ?? Promise.resolve('disabled'),
      },
    ),
  );
  const { fastify, emitter, errors, drain } = buildApp(
    composeAppDeps({
      config,
      db: db.db,
      adapter,
      fixtureUsers,
      businessUnits,
      store,
      qcRunner,
      mailSink,
      readiness,
      now: overrides.now,
      webDistDir: serveWeb ? webDistDir : undefined,
    }),
  );
  db.pool.on('error', (err) => errors.internal(err));
  const close = async () => {
    await drain.close(overrides.drainMs);
    await db.close();
  };
  await fastify.listen({ host: config.host, port: config.port });
  try {
    adapter.verifyBoundAddress((overrides.addressOf ?? ((f) => f.server.address()))(fastify)); // S16
  } catch (err) {
    await close();
    if (err instanceof IdentityStartupError) return refuse(err.reason, exit);
    throw err;
  }
  emitter.log('process.started', startedFields(config, schemaVersion));
  return { fastify, emitter, businessUnits, close };
}
