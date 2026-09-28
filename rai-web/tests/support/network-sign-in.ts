// W7-08 (W7 plan section 5.2): the desk in `network` mode, source `allow-list`, for the A01 network clause suite.
// `startNetworkDesk` builds the start.ts composition for `network` with MAIL_MODE=sink-file from its parts (the OBS15
// policy lets an integration file reach the app only through the audited `buildApp`, never through start.ts): the
// real `parseConfig`, the identity adapter with the two W7-05 seams (`discovery` returns a document for the synthetic
// issuer `https://idp.rai-desk.test`; `exchange` returns the claims of the synthetic account the callback `code` names,
// so no provider is contacted), the BU directory with the configured grants, the in-product file drop, the live
// recipient directory loaded before listen, the deterministic QC runner and the readiness reader. It listens on a
// loopback port (W7-D2: no non-loopback bind in any test) and every request goes over real HTTP with
// `X-Forwarded-Proto: https`, as a TLS-terminating proxy in front of `PUBLIC_BASE_URL=https://desk.rai-desk.test`
// would send it. Synthetic `@rai-desk.example` accounts only.

import assert from 'node:assert/strict';
import path from 'node:path';
import type { RoleScope } from '@rai/shared/schemas/auth';
import { createFilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { composeAppDeps } from '@rai/server/compose-app-deps';
import { isLoopbackHost, parseConfig, readEnv } from '@rai/server/config';
import type { Db } from '@rai/server/db/client';
import { migrationFileCount } from '@rai/server/db/migrate';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import type { Exchange } from '@rai/server/identity/oidc';
import { createRecipientDirectory } from '@rai/server/notifications/directory';
import { createFileDropMailSink } from '@rai/server/notifications/file-drop';
import { computeReadiness, createReadinessReader } from '@rai/server/observability/health';
import { createStoreProbes } from '@rai/server/observability/probes';
import { createDeterministicQcRunner } from '@rai/server/qc/deterministic/runner';
import { buildApp } from './observed-app.js';
import { freeLoopbackPort } from './process.js';

export const NETWORK_ISSUER = 'https://idp.rai-desk.test';
export const NETWORK_BASE_URL = 'https://desk.rai-desk.test';
export const SESSION_COOKIE = '__Host-rai_session';
export const TRANSACTION_COOKIE = '__Host-rai_signin';
/** What a TLS-terminating proxy adds; `TRUST_PROXY=true` lets the app read it. */
export const PROXY_HEADERS = { 'x-forwarded-proto': 'https' } as const;

export interface NetworkAccount {
  /** The provider subject (`sub`) and the callback `code` that selects this account in the exchange seam. */
  sub: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}

export interface AllowListEntry {
  email: string;
  roles: RoleScope[];
}

export function allowListJson(entries: readonly AllowListEntry[]): string {
  return JSON.stringify({ version: 1, entries });
}

/** The environment the suite runs under: the shell's database URLs plus the section 5.2 network configuration. */
export function networkEnv(
  root: string,
  allowList: readonly AllowListEntry[],
  overrides: Record<string, string> = {},
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(readEnv())) if (value !== undefined) inherited[key] = value;
  return {
    ...inherited,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '8787', // parsed only; the desk listens on a free loopback port
    PUBLIC_BASE_URL: NETWORK_BASE_URL,
    TRUST_PROXY: 'true',
    RAI_IDENTITY_MODE: 'network',
    RAI_IDENTITY_NETWORK_SOURCE: 'allow-list',
    RAI_IDENTITY_OIDC_ISSUER_URL: NETWORK_ISSUER,
    RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
    RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
    RAI_IDENTITY_ALLOW_LIST_JSON: allowListJson(allowList),
    RAI_SECRET_SOURCE: 'env',
    BLOB_DIR: path.join(root, 'blobs'),
    MAIL_MODE: 'sink-file',
    MAIL_SINK_DIR: path.join(root, 'mail'),
    QC_MODE: 'deterministic',
    LOG_LEVEL: 'info',
    LOG_PRETTY: 'false',
    BUILD_COMMIT: 'dev',
    ...overrides,
  };
}

/** The synthetic IdP's discovery document; the token endpoint is a closed loopback port, never reached. */
const discovery = () =>
  Promise.resolve({
    issuer: NETWORK_ISSUER,
    authorization_endpoint: `${NETWORK_ISSUER}/authorize`,
    token_endpoint: 'https://127.0.0.1:1/token',
  });

/** Claims for the account the callback `code` names; an unknown code is a failed exchange (401). */
function exchangeFor(accounts: readonly NetworkAccount[]): Exchange {
  return (input) => {
    const account = accounts.find((a) => a.sub === input.callbackUrl.searchParams.get('code'));
    if (account === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      iss: NETWORK_ISSUER,
      sub: account.sub,
      email: account.email,
      email_verified: account.emailVerified ?? true,
      name: account.name,
      nonce: input.expectedNonce,
    });
  };
}

export interface NetworkDesk {
  /** `http://127.0.0.1:<port>`: where the test reaches the listening desk. */
  origin: string;
  close(): Promise<void>;
}

/** The start.ts `network` / `allow-list` composition with MAIL_MODE=sink-file, listening on loopback. */
export async function startNetworkDesk(input: {
  db: Db;
  env: Record<string, string>;
  accounts: readonly NetworkAccount[];
}): Promise<NetworkDesk> {
  const config = parseConfig(input.env);
  assert.equal(config.identity.mode, 'network');
  const adapter = createIdentityAdapter({
    env: config.identity.env,
    nodeEnv: config.nodeEnv,
    discovery,
    groupMappingSource: () => Promise.resolve(null),
    exchange: exchangeFor(input.accounts),
  });
  const { host, port, publicBaseUrl, trustProxy } = config;
  await adapter.start({ host, port, publicBaseUrl, trustProxy });
  const businessUnits = createBusinessUnitDirectory([
    'CM',
    'HR', // the slice-1 BU keys start.ts adds when @rai/fixtures is installed
    ...businessUnitsFromGrants(adapter.configuredGrants()),
  ]);
  const blobDir = path.resolve(config.blobDir);
  const store = createFilesystemBlobStore(blobDir);
  await store.init();
  const mailSink = createFileDropMailSink({ dir: config.mail.sinkDir, publicBaseUrl });
  const recipients = createRecipientDirectory({ identityMode: 'network' });
  await recipients.load(input.db);
  const qcRunner = createDeterministicQcRunner({});
  const readiness = createReadinessReader(() =>
    computeReadiness(
      {
        identity: () => adapter.health(),
        loopbackBind: isLoopbackHost(config.host),
        mailKind: 'file',
        qcKind: 'deterministic',
        build: { commit: config.buildCommit, schemaVersion: String(migrationFileCount()) },
      },
      {
        ...createStoreProbes(config.database.url, blobDir),
        mailSink: () => mailSink.health(),
        qc: () => Promise.resolve('ok'),
      },
    ),
  );
  const { fastify, drain } = buildApp(
    composeAppDeps({
      config,
      db: input.db,
      adapter,
      businessUnits,
      store,
      qcRunner,
      mailSink,
      recipients,
      readiness,
    }),
  );
  await fastify.listen({ host: '127.0.0.1', port: await freeLoopbackPort() });
  adapter.verifyBoundAddress(fastify.server.address()); // `network` may bind any address; unchanged (W7-05)
  const address = fastify.server.address();
  assert.ok(address !== null && typeof address === 'object');
  return { origin: `http://127.0.0.1:${address.port}`, close: () => drain.close() };
}

/** `name=value` of the named cookie in a response's Set-Cookie list, and its full attribute string. */
export function cookieFrom(res: Response, name: string): { pair: string; raw: string } | undefined {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return raw === undefined ? undefined : { pair: raw.split(';')[0]!, raw };
}

export interface NetworkSignIn {
  /** The callback's status: 303 on success, 401 or 403 when refused. */
  status: number;
  body: string;
  /** `__Host-rai_session=<token>` when a session was issued. */
  cookie: string | undefined;
  setCookies: string[];
  /** The authorization URL `/auth/sign-in` returned. */
  redirectUrl: URL;
}

/** The browser round trip: POST /auth/sign-in, then GET /auth/callback with the transaction cookie. */
export async function signInNetwork(origin: string, code: string): Promise<NetworkSignIn> {
  const begin = await fetch(`${origin}/auth/sign-in`, {
    method: 'POST',
    headers: { ...PROXY_HEADERS, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: '{}',
  });
  assert.equal(begin.status, 200, await begin.clone().text());
  const redirectUrl = new URL(((await begin.json()) as { redirectUrl: string }).redirectUrl);
  const state = redirectUrl.searchParams.get('state');
  const transaction = cookieFrom(begin, TRANSACTION_COOKIE);
  assert.ok(state !== null && transaction !== undefined, 'a sign-in transaction was issued');
  const callback = await fetch(
    `${origin}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { headers: { ...PROXY_HEADERS, cookie: transaction.pair }, redirect: 'manual' },
  );
  return {
    status: callback.status,
    body: await callback.text(),
    cookie: cookieFrom(callback, SESSION_COOKIE)?.pair,
    setCookies: callback.headers.getSetCookie(),
    redirectUrl,
  };
}
