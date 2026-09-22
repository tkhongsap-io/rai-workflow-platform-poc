// The start sequence main.ts runs, as a function so ID-02 (S16) can drive it with an injected address resolver and
// exit function: config → identity adapter start() (never listens on a refusal, exit 78) → app → listen → post-listen
// loopback check (S16: close and exit 78 when the bound address is not loopback). main.ts never migrates (W0-04).

import { createReadinessReader, computeReadiness } from './observability/health.js';
import { createStoreProbes } from './observability/probes.js';
import { isLoopbackHost } from './config.js';
import { loadMailSink } from './notifications/runtime.js';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createFilesystemBlobStore } from './artifacts/blob-store.js';
import { createScopeFactsSource } from './authz/facts.js';
import {
  businessUnitsFromGrants,
  createBusinessUnitDirectory,
  type BusinessUnitDirectory,
} from './cases/business-units.js';
import { createSubjectDirectory } from './cases/subject-directory.js';
import { ConfigError, EXIT_CONFIG, isLoopbackHost, parseConfig, type Env } from './config.js';
import { createDb, type DbHandle } from './db/client.js';
import { currentRevision } from './configuration/store.js';
import { createIdentityAdapter, type Discovery, type GroupMappingSource } from './identity/adapter.js';
import { createFixtureIdentityProvider, type FixtureIdentity } from './identity/fixture.js';
import { openidClientDiscovery } from './identity/oidc.js';
import { createPgSessionStore } from './identity/session.js';
import { IdentityStartupError } from './identity/types.js';
import type { Emitter } from './observability/log.js';
import { noopUploadTrigger } from './pack/qc-trigger.js';
import { startedFields } from './observability/started.js';
import { WEB_DIST_DIR, webDistPresent } from './static.js';
import type { QcRunner, VersionRef } from '@rai/shared/qc/types';
import { laneOpenRecipientsFromIdentities } from './versions/open-lanes.js';
import { sendBackRecipientsFromIdentities } from './workflow/send-back-notice.js';

export interface StartOverrides {
  /** Synthetic journey only; shared runner instance, never a runtime configuration option. */
  qcRunner?: QcRunner & { probe(): Promise<'ok' | 'disabled' | 'unavailable'> };
  /** S16 seam: what the adapter reads after listen; defaults to fastify.server.address(). */
  addressOf?: (fastify: FastifyInstance) => AddressInfo | string | null;
  /** Exit seam for tests; defaults to process.exit. Must not return. */
  exit?: (code: number) => never;
  /** The fixture table (fixture mode only); defaults to a dynamic import of @rai/fixtures/data/users. */
  fixtureUsers?: readonly FixtureIdentity[];
  /** The slice-1 BU key list (every mode); defaults to FIXTURE_BUSINESS_UNITS from the same dynamic import. */
  fixtureBusinessUnits?: readonly string[];
  discovery?: Discovery;
  now?: () => Date;
  /** The built SPA directory to serve (W1-INT static.ts); defaults to rai-web/web/dist. */
  webDistDir?: string;
  /** W0-04 graceful shutdown: how long in-flight requests get after close() before their sockets are destroyed. */
  drainMs?: number;
}

export interface StartedServer {
  fastify: FastifyInstance;
  emitter: Emitter;
  /** The configured BU keys the case routes accept (W0-04 `case.business_unit_id`), observable by tests. */
  businessUnits: BusinessUnitDirectory;
  /**
   * W0-04 graceful shutdown (shutdown.ts): no new connections, in-flight requests answered within `drainMs`
   * (SHUTDOWN_DRAIN_MS, 10 s), every remaining socket destroyed, then the database pool closed. Bounded: a socket
   * that never sent a byte (a browser's speculative pre-connect) cannot hold the process open.
   */
  close(): Promise<void>;
}

/** @rai/fixtures/data/users resolved at run time, so the server never imports fixtures statically (absent in a production install). */
async function loadFixtureUsersModule(): Promise<Record<string, unknown> | undefined> {
  const specifier = '@rai/fixtures/data/users'; // a variable, so tsc does not resolve it (fixtures depends on server; no cycle)
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Fixture mode only: the eight W0-03 identities from @rai/fixtures. */
export async function loadFixtureUsers(): Promise<readonly FixtureIdentity[] | undefined> {
  const users = (await loadFixtureUsersModule())?.FIXTURE_USERS;
  if (!Array.isArray(users)) return undefined;
  return users as readonly FixtureIdentity[]; // createFixtureIdentityProvider re-validates every invariant
}

/**
 * W1-10 / W2-INT: the slice-1 QC substitute (`QC_MODE=substitute`) bound on the real server so W2 findings and
 * dispositions work against the deployable. Dynamic import only — never a static `@rai/fixtures` import — so
 * `check:substitute-absent` still passes and a production install without the fixtures package starts unbound.
 */
type ConfiguredQcRunner = QcRunner & { probe(): Promise<'ok' | 'unavailable' | 'disabled'> };
export async function loadQcSubstituteRunner(now?: () => Date): Promise<ConfiguredQcRunner | undefined> {
  const qcSpecifier = '@rai/fixtures/substitutes/qc/index';
  const casesSpecifier = '@rai/fixtures/data/cases/index';
  try {
    const qcMod = (await import(qcSpecifier)) as {
      ScriptedQcRunner: new (options?: {
        fixtureCaseIdOf?: (version: VersionRef) => string | undefined;
        now?: () => Date;
      }) => ConfiguredQcRunner;
    };
    const casesMod = (await import(casesSpecifier)) as Record<string, unknown>;
    const rawCases = casesMod.FIXTURE_CASES;
    if (!Array.isArray(rawCases)) return undefined;
    const byCaseId = new Map<string, string>();
    for (const entry of rawCases as unknown[]) {
      const row = entry as { caseId?: unknown; fixtureCaseId?: unknown } | null;
      if (typeof row?.caseId === 'string' && typeof row.fixtureCaseId === 'string')
        byCaseId.set(row.caseId, row.fixtureCaseId);
    }
    return new qcMod.ScriptedQcRunner({
      fixtureCaseIdOf: (version) => byCaseId.get(version.caseId),
      ...(now === undefined ? {} : { now }),
    });
  } catch {
    return undefined;
  }
}

/**
 * Every mode: the slice-1 BU key list (`CM`, `HR`; W0-03 section 7) that W0-04 `case.business_unit_id` names, read
 * from `FIXTURE_BUSINESS_UNITS`. Only the keys are taken; the identities stay fixture-mode only. Undefined when the
 * fixtures package is absent (a production install), where the W6/W8 group mapping will supply the keys.
 */
export async function loadFixtureBusinessUnits(): Promise<readonly string[] | undefined> {
  const units = (await loadFixtureUsersModule())?.FIXTURE_BUSINESS_UNITS;
  if (!Array.isArray(units)) return undefined;
  const keys: string[] = [];
  for (const unit of units as unknown[]) {
    const id = (unit as { businessUnitId?: unknown } | null)?.businessUnitId;
    if (typeof id === 'string') keys.push(id);
  }
  return keys;
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

  // W1-INT: the one deployable serves web/dist (W0-02 section 1, static.ts). Without a web build the process
  // serves the API alone (the integration suites spawn main.ts through tsx); in production a missing bundle is
  // a misconfiguration and the process refuses to start rather than answer 404 on every page.
  const webDistDir = overrides.webDistDir ?? WEB_DIST_DIR;
  const serveWeb = webDistPresent(webDistDir);
  if (!serveWeb && config.nodeEnv === 'production') return refuse('missing:web/dist', exit);

  const db: DbHandle = createDb(config.database.url);
  const groupMappingSource: GroupMappingSource = async () =>
    (await currentRevision(db.db, 'group_role_mapping'))?.body ?? null;
  const fixtureUsers =
    config.identity.mode === 'fixture' ? (overrides.fixtureUsers ?? (await loadFixtureUsers())) : undefined;
  const adapter = createIdentityAdapter({
    env: config.identity.env,
    nodeEnv: config.nodeEnv,
    discovery: overrides.discovery ?? openidClientDiscovery,
    groupMappingSource,
    ...(fixtureUsers === undefined ? {} : { fixtureUsers }),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  });
  const bind = {
    host: config.host,
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    trustProxy: config.trustProxy,
  };
  try {
    await adapter.start(bind); // level 1 of the fail-closed rule: refused means never listening
  } catch (err) {
    await db.close();
    if (err instanceof IdentityStartupError) return refuse(err.reason, exit);
    throw err;
  }

  // W1-02: the configured BU keys are the slice-1 fixture BU list (W0-04 `case.business_unit_id`: "a key from the
  // fixture BU list (CM, HR; W0-03 section 7) in slice 1; the AD-group mapping arrives at W6/W8") in every identity
  // mode, so a local-google account (W0-03 4.1: an unmapped account is owner and "sees nothing until it creates a
  // case") can file a case; the `business_unit` grants of an injected fixture table are added. The subject
  // directory knows the fixture identities plus every subject that has signed in.
  const knownIdentities = fixtureUsers ?? [];
  const businessUnits = createBusinessUnitDirectory([
    ...(overrides.fixtureBusinessUnits ?? (await loadFixtureBusinessUnits()) ?? []),
    ...businessUnitsFromGrants(knownIdentities.flatMap((u) => [...u.roles])),
  ]);
  const store = createFilesystemBlobStore(path.resolve(config.blobDir));
  await store.init(); // root 0700, tmp/ emptied at process start (W0-08 section 6)
  // Bind the QC substitute only outside production: a production process stays unbound even if fixtures can import.
  const qcRunner =
    config.qc.mode === 'substitute' && config.nodeEnv !== 'production'
      ? (overrides.qcRunner ?? (await loadQcSubstituteRunner(overrides.now)))
      : undefined;
  // Only fixture identities can be synthetic mail recipients in this slice. No live directory or transport.
  const mailSink = config.identity.mode === 'fixture' ? await loadMailSink(config) : undefined;
  // Readiness observes the exact runner and sink injected into the existing consumers.
  const readiness = createReadinessReader(() =>
    computeReadiness(
      {
        identity: () => adapter.health(),
        loopbackBind: isLoopbackHost(config.host),
        mailKind: config.mail.mode === 'sink-memory' ? 'memory' : 'file',
        qcKind: 'substitute',
        build: { commit: config.buildCommit, schemaVersion: 'unknown' },
      },
      {
        ...createStoreProbes(config.database.url, path.resolve(config.blobDir)),
        mailSink: () => mailSink?.health() ?? Promise.resolve('unavailable'),
        qc: () => qcRunner?.probe() ?? Promise.resolve('disabled'),
      },
    ),
  );
  const { fastify, emitter, drain } = buildApp({
    observability: { db: db.db, readiness },
    ...(mailSink === undefined
      ? {}
      : {
          digest: {
            db: db.db,
            publicBaseUrl: config.publicBaseUrl,
            ...(overrides.now === undefined ? {} : { now: overrides.now }),
          },
          notifications: {
            db: db.db,
            sink: mailSink,
            identities: knownIdentities,
            publicBaseUrl: config.publicBaseUrl,
          },
        }),
    config,
    artifacts: { store, db: db.db, limits: config.upload },
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.db),
      facts: createScopeFactsSource(db.db),
      ...(fixtureUsers === undefined ? {} : { fixtureProvider: createFixtureIdentityProvider(fixtureUsers) }),
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
    cases: {
      db: db.db,
      businessUnits,
      subjects: createSubjectDirectory(db.db, { known: knownIdentities }),
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
    // W1-04: the W0-07 `upload` hook point stays the no-op until the QC orchestrator is bound (W2-05 / W4).
    pack: {
      db: db.db,
      limits: config.upload,
      uploadTrigger: noopUploadTrigger,
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
    // W1-05 / W2-01: submit/freeze, lane open, and version navigation (W0-02 7.6). Recipients are the fixture
    // identities that hold each lane (slice 1); AD resolution is W8.
    versions: {
      db: db.db,
      laneOpenRecipients: laneOpenRecipientsFromIdentities(knownIdentities),
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
    // W2-02: lane approve / send-back; owner email for send_back notices from identity data.
    decide: {
      db: db.db,
      sendBackRecipientsForOwner: (ownerSubjectId) =>
        sendBackRecipientsFromIdentities(knownIdentities, ownerSubjectId),
      knownIdentities,
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
    // W2-05 / W2-06 / W2-INT: disposition + lane QC. QC_MODE=substitute binds ScriptedQcRunner outside
    // production when fixtures are installed (slice-1 evidence path); production stays unbound.
    findings: {
      db: db.db,
      readyRecipientsForOwner: (ownerSubjectId) =>
        sendBackRecipientsFromIdentities(knownIdentities, ownerSubjectId),
      knownIdentities,
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
      ...(qcRunner === undefined ? {} : { qc: { runner: qcRunner } }),
    },
    ...(serveWeb ? { static: { root: webDistDir } } : {}),
  });
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
  emitter.log('process.started', startedFields(config));
  return { fastify, emitter, businessUnits, close };
}
