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
import { createMemorySessionStore } from './session.memory.js';

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

async function harness(options: { exchangeThrows?: boolean; now?: () => Date } = {}): Promise<Harness> {
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
    identity: {
      adapter,
      sessionStore: store,
      facts,
      ...(options.now === undefined ? {} : { now: options.now }),
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
