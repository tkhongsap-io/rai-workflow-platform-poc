// The start sequence main.ts runs, as a function so ID-02 (S16) can drive it with an injected address resolver and
// exit function: config → identity adapter start() (never listens on a refusal, exit 78) → app → listen → post-listen
// loopback check (S16: close and exit 78 when the bound address is not loopback). main.ts never migrates (W0-04).

import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createScopeFactsSource } from './authz/facts.js';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from './cases/business-units.js';
import { createSubjectDirectory } from './cases/subject-directory.js';
import { ConfigError, EXIT_CONFIG, parseConfig, type Env } from './config.js';
import { createDb, type DbHandle } from './db/client.js';
import { currentRevision } from './configuration/store.js';
import { createIdentityAdapter, type Discovery, type GroupMappingSource } from './identity/adapter.js';
import { createFixtureIdentityProvider, type FixtureIdentity } from './identity/fixture.js';
import { openidClientDiscovery } from './identity/oidc.js';
import { createPgSessionStore } from './identity/session.js';
import { IdentityStartupError } from './identity/types.js';
import type { Emitter } from './observability/log.js';
import { startedFields } from './observability/started.js';

export interface StartOverrides {
  /** S16 seam: what the adapter reads after listen; defaults to fastify.server.address(). */
  addressOf?: (fastify: FastifyInstance) => AddressInfo | string | null;
  /** Exit seam for tests; defaults to process.exit. Must not return. */
  exit?: (code: number) => never;
  /** The fixture table (fixture mode only); defaults to a dynamic import of @rai/fixtures/data/users. */
  fixtureUsers?: readonly FixtureIdentity[];
  discovery?: Discovery;
  now?: () => Date;
}

export interface StartedServer {
  fastify: FastifyInstance;
  emitter: Emitter;
  close(): Promise<void>;
}

/** Fixture mode only: the eight W0-03 identities from @rai/fixtures, resolved at run time so the server never imports fixtures statically. */
export async function loadFixtureUsers(): Promise<readonly FixtureIdentity[] | undefined> {
  const specifier = '@rai/fixtures/data/users'; // a variable, so tsc does not resolve it (fixtures depends on server; no cycle)
  try {
    const mod = (await import(specifier)) as { FIXTURE_USERS?: unknown };
    const users = mod.FIXTURE_USERS;
    if (!Array.isArray(users)) return undefined;
    return users as readonly FixtureIdentity[]; // createFixtureIdentityProvider re-validates every invariant
  } catch {
    return undefined;
  }
}

/** process.refused (W0-10 3.3): the reason code only, never a value; written before any logger exists. */
function refuse(reason: string, exit: (code: number) => never): never {
  console.error(JSON.stringify({ event: 'process.refused', reason }));
  return exit(EXIT_CONFIG);
}

export async function startServer(env: Env, overrides: StartOverrides = {}): Promise<StartedServer> {
  const exit = overrides.exit ?? ((code: number): never => process.exit(code));
  let config;
  try {
    config = parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return refuse(err.reason, exit);
    throw err;
  }

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

  // W1-02: the configured BU keys are the `business_unit` grants the adapter can issue (slice 1: the fixture BU
  // list, W0-04 `case.business_unit_id`; the AD-group mapping arrives at W6/W8), and the subject directory knows the
  // fixture identities plus every subject that has signed in.
  const knownIdentities = fixtureUsers ?? [];
  const { fastify, emitter } = buildApp({
    config,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.db),
      facts: createScopeFactsSource(db.db),
      ...(fixtureUsers === undefined ? {} : { fixtureProvider: createFixtureIdentityProvider(fixtureUsers) }),
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
    cases: {
      db: db.db,
      businessUnits: createBusinessUnitDirectory(
        businessUnitsFromGrants(knownIdentities.flatMap((u) => [...u.roles])),
      ),
      subjects: createSubjectDirectory(db.db, { known: knownIdentities }),
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    },
  });
  const close = async () => {
    await fastify.close();
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
  return { fastify, emitter, close };
}
