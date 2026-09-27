// ID-11 (W0-03 section 11): the callback error branches (state, nonce, transaction cookie missing, email not
// verified, no role) answer 401 auth failures with the W0-06 envelope and create no session; the happy path with a
// synthetic claims object creates one. Also the sign-in transaction, returnTo rule, sign-out CSRF rule and the
// locale route. Fastify inject, the in-memory session store, an injected discovery and exchange: no network, no
// Postgres, never Google.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createIdentityAdapter } from './adapter.js';
import { GOOGLE_ISSUER, type IdClaims } from './oidc.js';
import { createFixtureIdentityProvider, type FixtureIdentity } from './fixture.js';
import { createMemorySessionStore } from './session.memory.js';
import type { SubjectProfile } from './session.js';

const publicBaseUrl = new URL('http://127.0.0.1:8787');
const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  trustProxy: false,
  publicBaseUrl,
};
const google = {
  RAI_IDENTITY_MODE: 'local-google',
  RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
};
const facts = { byCaseId: () => Promise.resolve(undefined), byArtifactId: () => Promise.resolve(undefined) };

interface Harness {
  app: ReturnType<typeof buildApp>['fastify'];
  store: ReturnType<typeof createMemorySessionStore>;
  claims: (over: Partial<IdClaims>) => void;
  exchangeCalls: number;
}

async function harness(
  options: {
    exchangeThrows?: boolean;
    now?: () => Date;
    appNow?: () => Date; // the app clock (session and profile timestamps); W7-06
    profiles?: { recorded(profile: SubjectProfile): void };
  } = {},
): Promise<Harness> {
  const store = createMemorySessionStore();
  let nextClaims: Partial<IdClaims> = {};
  const state = { exchangeCalls: 0 };
  const adapter = createIdentityAdapter({
    env: google,
    nodeEnv: 'test',
    discovery: () =>
      Promise.resolve({
        issuer: GOOGLE_ISSUER,
        authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
        token_endpoint: 'https://oauth2.googleapis.com/token',
      }),
    groupMappingSource: () => Promise.resolve(null),
    exchange: (input) => {
      state.exchangeCalls += 1;
      if (options.exchangeThrows === true) return Promise.reject(new Error('provider said no'));
      return Promise.resolve({
        iss: GOOGLE_ISSUER,
        sub: '1234567890',
        email: 'dev@example.test',
        email_verified: true,
        name: 'Dev Person',
        nonce: input.expectedNonce,
        ...nextClaims,
      });
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const { fastify } = buildApp({
    config,
    ...(options.appNow === undefined ? {} : { now: options.appNow }),
    identity: {
      adapter,
      sessionStore: store,
      facts,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
    },
  });
  await fastify.ready();
  return {
    app: fastify,
    store,
    claims: (over) => {
      nextClaims = over;
    },
    get exchangeCalls() {
      return state.exchangeCalls;
    },
  };
}

function cookieOf(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string | string[] | undefined;
  const list: string[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const found = list.find((c) => c.startsWith(`${name}=`));
  return found?.split(';')[0]?.slice(name.length + 1);
}

async function beginSignIn(h: Harness, returnTo?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/auth/sign-in',
    payload: returnTo === undefined ? {} : { returnTo },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ redirectUrl: string }>();
  const redirect = new URL(body.redirectUrl);
  const transaction = cookieOf(res, 'rai_signin');
  assert.ok(transaction, 'a transaction cookie is set');
  return { redirect, transaction, cookieHeader: `rai_signin=${transaction}` };
}

test('POST /auth/sign-in answers the provider URL with PKCE, state, nonce, select_account and the derived callback URI', async () => {
  const h = await harness();
  const { redirect, transaction } = await beginSignIn(h);
  assert.equal(redirect.origin, GOOGLE_ISSUER);
  const q = redirect.searchParams;
  assert.equal(q.get('redirect_uri'), 'http://127.0.0.1:8787/auth/callback');
  assert.equal(q.get('scope'), 'openid email profile');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('prompt'), 'select_account');
  assert.equal(q.get('client_id'), google.RAI_IDENTITY_GOOGLE_CLIENT_ID);
  assert.ok(q.get('state') && q.get('nonce') && q.get('code_challenge'));
  const tx = JSON.parse(decodeURIComponent(transaction)) as {
    state: string;
    nonce: string;
    codeVerifier: string;
  };
  assert.equal(tx.state, q.get('state'));
  assert.equal(tx.nonce, q.get('nonce'));
  assert.ok(tx.codeVerifier.length >= 43);
  assert.equal(h.store.rows.size, 0, 'no session before the callback');
});

test('POST /auth/sign-in keeps a same-origin path as returnTo and refuses anything else with 422 invalid_input', async () => {
  const h = await harness();
  const ok = await beginSignIn(h, '/cases/abc');
  assert.equal(
    (JSON.parse(decodeURIComponent(ok.transaction)) as { returnTo?: string }).returnTo,
    '/cases/abc',
  );
  for (const bad of [
    'https://evil.example/x',
    '//evil.example',
    'cases/abc',
    '/\\evil.example',
    'javascript:alert(1)',
  ]) {
    const res = await h.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { returnTo: bad } });
    assert.equal(res.statusCode, 422, bad);
    assert.equal(res.json<{ error: { code: string } }>().error.code, 'invalid_input');
  }
});

test('GET /auth/callback with a valid state, nonce and verified email creates a session and 303-redirects to returnTo', async () => {
  const h = await harness();
  const { redirect, cookieHeader } = await beginSignIn(h, '/cases/xyz');
  const res = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=synthetic-code&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/cases/xyz');
  const session = cookieOf(res, 'rai_session');
  assert.ok(session, 'session cookie set');
  assert.ok(
    String(res.headers['set-cookie']).includes('rai_signin=;') ||
      String(res.headers['set-cookie']).includes('Expires=Thu, 01 Jan 1970'),
    'transaction cookie cleared',
  );
  assert.equal(h.store.rows.size, 1);
  assert.equal(h.exchangeCalls, 1);

  const me = await h.app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { cookie: `rai_session=${session}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.headers['cache-control'], 'no-store');
  const info = me.json<{
    principal: { subjectId: string; email: string; roles: unknown[] };
    identityMode: string;
    locale: string;
  }>();
  assert.equal(info.principal.subjectId, 'google:1234567890');
  assert.equal(info.principal.email, 'dev@example.test');
  assert.deepEqual(info.principal.roles, [{ role: 'owner', scope: { kind: 'own_cases' } }]);
  assert.equal(info.identityMode, 'local-google');
  assert.equal(info.locale, 'th');
});

const unauthenticatedBody = (res: { statusCode: number; json: <T>() => T }) => {
  assert.equal(res.statusCode, 401);
  const body = res.json<{ error: Record<string, unknown> }>();
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'correlationId', 'messageKey']);
  assert.equal(body.error.code, 'unauthenticated');
  assert.equal(body.error.messageKey, 'error.unauthenticated');
};

test('ID-11 callback with a mismatched state is 401, no session, no exchange, audited as state_mismatch', async () => {
  const h = await harness();
  const { cookieHeader } = await beginSignIn(h);
  const res = await h.app.inject({
    method: 'GET',
    url: '/auth/callback?code=c&state=not-the-state',
    headers: { cookie: cookieHeader },
  });
  unauthenticatedBody(res);
  assert.equal(cookieOf(res, 'rai_session'), undefined);
  assert.equal(h.store.rows.size, 0);
  assert.equal(h.exchangeCalls, 0);
  assert.deepEqual(h.store.refusals, [
    { reason: 'state_mismatch', issuerKey: 'google', subjectHashed: false },
  ]);
});

test('ID-11 callback without the transaction cookie is 401 transaction_missing and no session', async () => {
  const h = await harness();
  const { redirect } = await beginSignIn(h);
  const res = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${redirect.searchParams.get('state')}`,
  });
  unauthenticatedBody(res);
  assert.equal(h.store.rows.size, 0);
  assert.equal(h.store.refusals[0]?.reason, 'transaction_missing');
  const garbage = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=x`,
    headers: { cookie: 'rai_signin=%7Bnot-json' },
  });
  unauthenticatedBody(garbage);
});

test('ID-11 callback with a nonce mismatch in the claims is 401 nonce_mismatch and no session', async () => {
  const h = await harness();
  h.claims({ nonce: 'someone-elses-nonce' });
  const { redirect, cookieHeader } = await beginSignIn(h);
  const res = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
  unauthenticatedBody(res);
  assert.equal(h.store.rows.size, 0);
  assert.equal(h.store.refusals[0]?.reason, 'nonce_mismatch');
});

test('ID-11 callback with an unverified email is 401 email_not_verified and no session', async () => {
  const h = await harness();
  h.claims({ email_verified: false });
  const { redirect, cookieHeader } = await beginSignIn(h);
  const res = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
  unauthenticatedBody(res);
  assert.equal(h.store.rows.size, 0);
  assert.equal(h.store.refusals[0]?.reason, 'email_not_verified');
  assert.equal(
    h.store.refusals[0]?.subjectHashed,
    true,
    'the refusal audit carries a subject hash, not the email',
  );
});

test('ID-11 callback whose issuer is not Google is 401 issuer_mismatch; a failed code exchange is 401 code_exchange_failed', async () => {
  const h = await harness();
  h.claims({ iss: 'https://accounts.example.test' });
  const first = await beginSignIn(h);
  const res = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${first.redirect.searchParams.get('state')}`,
    headers: { cookie: first.cookieHeader },
  });
  unauthenticatedBody(res);
  assert.equal(h.store.refusals[0]?.reason, 'issuer_mismatch');

  const failing = await harness({ exchangeThrows: true });
  const second = await beginSignIn(failing);
  const res2 = await failing.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${second.redirect.searchParams.get('state')}`,
    headers: { cookie: second.cookieHeader },
  });
  unauthenticatedBody(res2);
  assert.equal(failing.store.refusals[0]?.reason, 'code_exchange_failed');
  assert.equal(failing.store.rows.size, 0);
});

test('a transaction older than 10 minutes is refused (transaction_missing)', async () => {
  let t = Date.parse('2026-09-21T03:00:00Z');
  const h = await harness({ now: () => new Date(t) });
  const { redirect, cookieHeader } = await beginSignIn(h);
  t += 11 * 60 * 1000;
  const res = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
  unauthenticatedBody(res);
  assert.equal(h.store.refusals[0]?.reason, 'transaction_missing');
});

test('POST /auth/sign-out revokes the session (204) and requires Sec-Fetch-Site same-origin or none; without a session 401', async () => {
  const h = await harness();
  const { redirect, cookieHeader } = await beginSignIn(h);
  const cb = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
  const session = cookieOf(cb, 'rai_session')!;
  const cookie = `rai_session=${session}`;

  const crossSite = await h.app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    headers: { cookie, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.statusCode, 403);
  assert.equal(crossSite.json<{ error: { code: string } }>().error.code, 'forbidden');
  const missing = await h.app.inject({ method: 'POST', url: '/auth/sign-out', headers: { cookie } });
  assert.equal(missing.statusCode, 403);
  assert.equal(
    (await h.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } })).statusCode,
    200,
    'still signed in',
  );

  const ok = await h.app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    headers: { cookie, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(ok.statusCode, 204);
  assert.equal(cookieOf(ok, 'rai_session'), '', 'cookie cleared');
  unauthenticatedBody(await h.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } }));
  unauthenticatedBody(
    await h.app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: { cookie, 'sec-fetch-site': 'none' },
    }),
  );
  assert.deepEqual(h.store.audit, ['identity.signed_in', 'identity.signed_out']);
});

test('POST /api/session/locale stores the viewer locale (204); an unknown value is 422; without a session 401', async () => {
  const h = await harness();
  unauthenticatedBody(
    await h.app.inject({ method: 'POST', url: '/api/session/locale', payload: { locale: 'en' } }),
  );
  const { redirect, cookieHeader } = await beginSignIn(h);
  const cb = await h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=c&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
  const cookie = `rai_session=${cookieOf(cb, 'rai_session')}`;
  const bad = await h.app.inject({
    method: 'POST',
    url: '/api/session/locale',
    headers: { cookie },
    payload: { locale: 'fr' },
  });
  assert.equal(bad.statusCode, 422);
  assert.equal(
    bad.json<{ error: { code: string; details: { fields: { path: string }[] } } }>().error.details.fields[0]
      ?.path,
    'body.locale',
  );
  const ok = await h.app.inject({
    method: 'POST',
    url: '/api/session/locale',
    headers: { cookie },
    payload: { locale: 'en' },
  });
  assert.equal(ok.statusCode, 204);
  assert.equal(
    (await h.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } })).json<{
      locale: string;
    }>().locale,
    'en',
  );
});

test('ID-10 (unit half): the fixture routes do not exist in local-google mode (404 not_found)', async () => {
  const h = await harness();
  for (const req of [
    { method: 'GET' as const, url: '/auth/fixture/users' },
    { method: 'POST' as const, url: '/auth/fixture/sign-in', payload: { fixtureUserId: 'fx-user-admin' } },
  ]) {
    const res = await h.app.inject(req);
    assert.equal(res.statusCode, 404, req.url);
    assert.equal(res.json<{ error: { code: string } }>().error.code, 'not_found');
  }
});

const FX_ADMIN: FixtureIdentity = {
  fixtureUserId: 'fx-user-admin',
  subjectId: 'fixture:fx-user-admin',
  displayName: 'Desk Admin (fixture)',
  email: 'admin@rai-desk.example',
  roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
};

// W7-06 (W7 plan section 4.1): every non-fixture sign-in upserts the subject profile in the session store's create,
// and establishSession then calls the optional `profiles.recorded` hook (bound by W7-07) once with the written row.
async function completeCallback(h: Harness) {
  const { redirect, cookieHeader } = await beginSignIn(h);
  return h.app.inject({
    method: 'GET',
    url: `/auth/callback?code=synthetic-code&state=${redirect.searchParams.get('state')}`,
    headers: { cookie: cookieHeader },
  });
}

test('W7-06: a local-google callback records the subject profile from the principal and calls profiles.recorded once with it', async () => {
  let clock = Date.parse('2026-09-28T01:00:00Z');
  const recorded: SubjectProfile[] = [];
  const h = await harness({ appNow: () => new Date(clock), profiles: { recorded: (p) => recorded.push(p) } });
  h.claims({ email: 'Dev@Example.test', name: 'Dev Person' });
  const res = await completeCallback(h);
  assert.equal(res.statusCode, 303);
  assert.equal(h.store.profiles.size, 1);
  const profile = h.store.profiles.get('google:1234567890');
  assert.deepEqual(profile, {
    subjectId: 'google:1234567890',
    identityMode: 'local-google',
    email: 'dev@example.test',
    displayName: 'Dev Person',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
    firstSeenAt: new Date('2026-09-28T01:00:00Z'),
    lastSignInAt: new Date('2026-09-28T01:00:00Z'),
  });
  assert.deepEqual(recorded, [profile]);

  clock = Date.parse('2026-09-28T05:00:00Z');
  h.claims({ email: 'dev@example.test', name: 'Dev Renamed' });
  assert.equal((await completeCallback(h)).statusCode, 303);
  assert.equal(h.store.profiles.size, 1, 'the second sign-in updates the one row');
  const second = h.store.profiles.get('google:1234567890');
  assert.equal(second?.displayName, 'Dev Renamed');
  assert.deepEqual(second?.firstSeenAt, new Date('2026-09-28T01:00:00Z'), 'first seen is kept');
  assert.deepEqual(second?.lastSignInAt, new Date('2026-09-28T05:00:00Z'));
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded[1], second);
});

test('W7-06: a refused callback records no profile and does not call the hook', async () => {
  const recorded: SubjectProfile[] = [];
  const h = await harness({ profiles: { recorded: (p) => recorded.push(p) } });
  h.claims({ email_verified: false });
  const res = await completeCallback(h);
  assert.equal(res.statusCode, 401);
  assert.equal(h.store.profiles.size, 0);
  assert.deepEqual(recorded, []);
});

test('W7-06: a throwing profiles.recorded hook does not undo or fail the committed sign-in', async () => {
  const h = await harness({
    profiles: {
      recorded: () => {
        throw new Error('synthetic hook failure');
      },
    },
  });
  const res = await completeCallback(h);
  assert.equal(res.statusCode, 303);
  assert.ok(cookieOf(res, 'rai_session'), 'the session cookie is still set');
  assert.equal(h.store.rows.size, 1);
  assert.equal(h.store.profiles.size, 1);
});

test('W7-06: a fixture sign-in records no subject profile and never calls the hook', async () => {
  const store = createMemorySessionStore();
  const recorded: SubjectProfile[] = [];
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: [FX_ADMIN],
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const { fastify } = buildApp({
    config,
    identity: {
      adapter,
      sessionStore: store,
      facts,
      fixtureProvider: createFixtureIdentityProvider([FX_ADMIN]),
      profiles: { recorded: (p) => recorded.push(p) },
    },
  });
  await fastify.ready();
  const res = await fastify.inject({
    method: 'POST',
    url: '/auth/fixture/sign-in',
    payload: { fixtureUserId: 'fx-user-admin' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(store.rows.size, 1);
  assert.equal(store.profiles.size, 0);
  assert.deepEqual(recorded, []);
});

test('W7-06: the memory store refuses a profile in fixture mode, as the Postgres CHECK does, and writes nothing', async () => {
  const store = createMemorySessionStore();
  await assert.rejects(
    store.create({
      principal: {
        subjectId: 'fixture:fx-user-admin',
        displayName: 'Desk Admin (fixture)',
        email: 'admin@rai-desk.example',
        roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
      },
      identityMode: 'fixture',
      absoluteHours: 12,
      correlationId: 'synthetic',
      profile: { email: 'admin@rai-desk.example', displayName: 'Desk Admin (fixture)' },
    }),
  );
  assert.equal(store.rows.size, 0);
  assert.equal(store.profiles.size, 0);
  assert.deepEqual(store.audit, []);
});

// W7-09 (W7 plan section 6): GET /auth/sign-in-method is public in every mode and answers the method only, so the
// sign-in screen can label its provider button without learning any issuer, client, tenant or allow-list value.
function assertMethodAnswer(
  res: { statusCode: number; headers: Record<string, unknown>; body: string },
  method: string,
  secrets: readonly string[],
): void {
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { method });
  for (const secret of secrets) assert.ok(!res.body.includes(secret), `the body never carries ${secret}`);
}

test('W7-09: GET /auth/sign-in-method in local-google mode is public and answers { method: "google" } only', async () => {
  const h = await harness();
  const res = await h.app.inject({ method: 'GET', url: '/auth/sign-in-method' });
  assertMethodAnswer(res, 'google', [
    google.RAI_IDENTITY_GOOGLE_CLIENT_ID,
    google.RAI_IDENTITY_GOOGLE_CLIENT_SECRET,
    GOOGLE_ISSUER,
  ]);
  assert.equal(h.store.rows.size, 0, 'no session is created or needed');
});

test('W7-09: GET /auth/sign-in-method in fixture mode answers { method: "fixture" }', async () => {
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: [FX_ADMIN],
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const { fastify } = buildApp({
    config,
    identity: {
      adapter,
      sessionStore: createMemorySessionStore(),
      facts,
      fixtureProvider: createFixtureIdentityProvider([FX_ADMIN]),
    },
  });
  await fastify.ready();
  const res = await fastify.inject({ method: 'GET', url: '/auth/sign-in-method' });
  assertMethodAnswer(res, 'fixture', [FX_ADMIN.email]);
});

test('W7-09: GET /auth/sign-in-method in network allow-list mode answers { method: "organization" } with no issuer, client or allow-list value', async () => {
  const issuer = 'https://issuer.example.test';
  const listedEmail = 'dpo@rai-desk.example';
  const env = {
    RAI_IDENTITY_MODE: 'network',
    RAI_IDENTITY_NETWORK_SOURCE: 'allow-list',
    RAI_IDENTITY_OIDC_ISSUER_URL: issuer,
    RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
    RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
    RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
      version: 1,
      entries: [{ email: listedEmail, roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }] }],
    }),
  };
  const httpsBase = new URL('https://desk.example.test');
  const adapter = createIdentityAdapter({
    env,
    nodeEnv: 'test',
    discovery: () =>
      Promise.resolve({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
      }),
    groupMappingSource: () => Promise.resolve(null),
  });
  // Loopback bind (W7-D2): only the public base URL is https, as network mode requires.
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl: httpsBase, trustProxy: false });
  const { fastify } = buildApp({
    config: { ...config, publicBaseUrl: httpsBase },
    identity: { adapter, sessionStore: createMemorySessionStore(), facts },
  });
  await fastify.ready();
  const res = await fastify.inject({ method: 'GET', url: '/auth/sign-in-method' });
  assertMethodAnswer(res, 'organization', [
    issuer,
    'issuer.example.test',
    env.RAI_IDENTITY_OIDC_CLIENT_ID,
    env.RAI_IDENTITY_OIDC_CLIENT_SECRET,
    listedEmail,
  ]);
});
