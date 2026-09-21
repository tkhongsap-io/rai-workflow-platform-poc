// W1-13: W0-02 section 7.2 sign-in shapes as the substitute serves them in fixture mode, and the response
// conventions every substitute answer carries (server-minted correlation id, no-store, the marker).

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Value } from 'typebox/value';
import { FixtureUsersResponseSchema, SessionInfoSchema, type SessionInfo } from '@rai/shared/schemas/auth';
import { FIXTURE_USERS } from '../../data/users.js';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import { SUBSTITUTE_HEADER } from './support.js';
import { call, signIn } from './testing.js';

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: unknown };
}

describe('W1-13 substitute: sign-in surface (7.2)', () => {
  let substitute: ApiSubstitute;
  let clock = new Date('2026-09-22T01:00:00Z');
  beforeEach(() => {
    clock = new Date('2026-09-22T01:00:00Z');
    substitute = createApiSubstitute({ now: () => clock });
  });

  it('every answer carries a server-minted X-Correlation-Id, Cache-Control: no-store and the substitute marker', async () => {
    const response = await call(substitute, 'GET', '/auth/fixture/users', {
      headers: { 'x-correlation-id': 'client-supplied-must-be-ignored' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers['x-correlation-id'] ?? '', /^[0-9a-f-]{36}$/);
    assert.notEqual(response.headers['x-correlation-id'], 'client-supplied-must-be-ignored');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers[SUBSTITUTE_HEADER], SUBSTITUTE_MARKER);
    assert.equal(substitute.marker, SUBSTITUTE_MARKER);
  });

  it('GET /auth/fixture/users lists the eight W0-03 fixture identities with their (role, scope) pairs', async () => {
    const response = await call(substitute, 'GET', '/auth/fixture/users');
    assert.equal(response.status, 200);
    const body = response.json<{ users: Array<{ fixtureUserId: string; roles: unknown[] }> }>();
    assert.ok(Value.Check(FixtureUsersResponseSchema, body));
    assert.deepEqual(
      body.users.map((u) => u.fixtureUserId),
      FIXTURE_USERS.map((u) => u.fixtureUserId),
    );
    assert.equal(body.users.find((u) => u.fixtureUserId === 'fx-user-dpo-spoc-hr')?.roles.length, 2);
  });

  it('POST /auth/fixture/sign-in answers 200 SessionInfo and sets the session cookie', async () => {
    const response = await call(substitute, 'POST', '/auth/fixture/sign-in', {
      json: { fixtureUserId: 'fx-user-owner-cm' },
    });
    assert.equal(response.status, 200);
    const info = response.json<SessionInfo>();
    assert.ok(Value.Check(SessionInfoSchema, info), JSON.stringify(info));
    assert.equal(info.principal.subjectId, 'fixture:fx-user-owner-cm');
    assert.equal(info.identityMode, 'fixture');
    assert.equal(info.locale, 'th'); // D12 default
    assert.equal(info.expiresAt, new Date(clock.getTime() + 12 * 3600 * 1000).toISOString());
    assert.match(
      response.headers['set-cookie'] ?? '',
      /^rai_session=[A-Za-z0-9_-]+; Path=\/; .*HttpOnly; SameSite=Lax$/,
    );
  });

  it('an unknown fixture user is 404 not_found with the plain envelope; a bad body is 422', async () => {
    const unknown = await call(substitute, 'POST', '/auth/fixture/sign-in', {
      json: { fixtureUserId: 'fx-user-nobody' },
    });
    assert.equal(unknown.status, 404);
    const body = unknown.json<Envelope>();
    assert.equal(body.error.code, 'not_found');
    assert.equal(body.error.messageKey, 'error.not_found');
    assert.equal(body.error.details, undefined);
    assert.equal(body.error.correlationId, unknown.headers['x-correlation-id']);
    const bad = await call(substitute, 'POST', '/auth/fixture/sign-in', { json: { user: 'x' } });
    assert.equal(bad.status, 422);
    assert.equal(bad.json<Envelope>().error.code, 'invalid_input');
    assert.deepEqual(bad.json<Envelope>().error.details, {
      fields: [{ path: 'body.fixtureUserId', messageKey: 'validation.required' }],
    });
    const notJson = await call(substitute, 'POST', '/auth/fixture/sign-in', {
      body: new TextEncoder().encode('{'),
    });
    assert.equal(notJson.status, 422);
  });

  it('GET /api/session is 401 without a session (no details) and 200 with one', async () => {
    const anonymous = await call(substitute, 'GET', '/api/session');
    assert.equal(anonymous.status, 401);
    assert.deepEqual(Object.keys(anonymous.json<Envelope>().error).sort(), [
      'code',
      'correlationId',
      'messageKey',
    ]);
    assert.equal(anonymous.json<Envelope>().error.messageKey, 'error.unauthenticated');
    const cookie = await signIn(substitute, 'fx-user-dpo-spoc-hr');
    const session = await call(substitute, 'GET', '/api/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.json<SessionInfo>().principal.roles.length, 2); // the dual-role identity keeps both
    const forged = await call(substitute, 'GET', '/api/session', { cookie: 'rai_session=not-a-real-token' });
    assert.equal(forged.status, 401);
  });

  it('a session past its absolute lifetime is 401', async () => {
    const cookie = await signIn(substitute, 'fx-user-owner-cm');
    clock = new Date(clock.getTime() + 12 * 3600 * 1000 + 1);
    assert.equal((await call(substitute, 'GET', '/api/session', { cookie })).status, 401);
  });

  it('POST /api/session/locale is 204 and the session reflects it; a bad locale is 422', async () => {
    const cookie = await signIn(substitute, 'fx-user-owner-cm');
    assert.equal(
      (await call(substitute, 'POST', '/api/session/locale', { cookie, json: { locale: 'en' } })).status,
      204,
    );
    assert.equal(
      (await call(substitute, 'GET', '/api/session', { cookie })).json<SessionInfo>().locale,
      'en',
    );
    const bad = await call(substitute, 'POST', '/api/session/locale', { cookie, json: { locale: 'fr' } });
    assert.equal(bad.status, 422);
    assert.equal(bad.json<Envelope>().error.code, 'invalid_input');
    assert.equal(
      (await call(substitute, 'POST', '/api/session/locale', { json: { locale: 'en' } })).status,
      401,
    );
  });

  it('POST /auth/sign-out is 204 and revokes; 401 without a session; 403 on a cross-site request', async () => {
    const cookie = await signIn(substitute, 'fx-user-owner-cm');
    const crossSite = await call(substitute, 'POST', '/auth/sign-out', {
      cookie,
      sameOrigin: false,
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.json<Envelope>().error.details, undefined);
    const out = await call(substitute, 'POST', '/auth/sign-out', { cookie });
    assert.equal(out.status, 204);
    assert.match(out.headers['set-cookie'] ?? '', /^rai_session=; /);
    assert.equal((await call(substitute, 'GET', '/api/session', { cookie })).status, 401);
    assert.equal((await call(substitute, 'POST', '/auth/sign-out')).status, 401);
  });

  it('the OIDC routes do not exist in fixture mode (404), like any unknown route', async () => {
    for (const [method, url] of [
      ['POST', '/auth/sign-in'],
      ['GET', '/auth/callback?code=x&state=y'],
      ['GET', '/api/w1-13-probe'],
      ['DELETE', '/api/cases'],
    ] as const) {
      const response = await call(substitute, method, url, { json: method === 'POST' ? {} : undefined });
      assert.equal(response.status, 404, `${method} ${url}`);
      const body = response.json<Envelope>();
      assert.equal(body.error.code, 'not_found');
      assert.equal(body.error.details, undefined);
    }
  });

  it('reset() forgets every session', async () => {
    const cookie = await signIn(substitute, 'fx-user-owner-cm');
    substitute.reset();
    assert.equal((await call(substitute, 'GET', '/api/session', { cookie })).status, 401);
  });
});
