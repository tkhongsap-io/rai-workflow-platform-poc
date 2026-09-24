// W1-01 Done when, against the real Postgres: each fixture user, including the dual-role identity, signs in through
// the fixture identity provider (POST /auth/fixture/sign-in) and receives its (role, scope) pairs (ID-03); a request
// without a session is unauthenticated and a wrong-role request is forbidden by the middleware (ID-08); sessions
// expire absolutely and on idle, sign-out revokes, re-sign-in replaces, lastSeenAt is throttled (ID-09); the audit
// store carries identity.signed_in / signed_out / sign_in_refused; the session sweep is an operator action.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { FIXTURE_USERS, DUAL_ROLE_FIXTURE_USER_ID } from '@rai/fixtures/data/users';
import type { Principal, SessionInfo } from '@rai/shared/schemas/auth';
import { buildApp } from '../support/observed-app.js';
import { auditStore } from '@rai/server/audit/store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore, sweepSessions } from '@rai/server/identity/session';
import {
  INSUFFICIENT_PRIVILEGE,
  expectSqlError,
  openTestDatabase,
  type TestDatabase,
} from '../support/db.js';

const publicBaseUrl = new URL('http://127.0.0.1:8787');
const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  trustProxy: false,
  publicBaseUrl,
};

let db: TestDatabase;
let clock = Date.parse('2026-09-21T03:00:00Z');
const now = () => new Date(clock);
let app: ReturnType<typeof buildApp>['fastify'];
const CASE_CM = '00000000-0000-7000-8000-00000000c001';

before(async () => {
  db = await openTestDatabase();
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12', RAI_SESSION_IDLE_MINUTES: '120' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const built = buildApp({
    db: db.app,
    now,
    config,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
    },
  });
  app = built.fastify;
  // Probe routes standing in for W1-02's: the middleware decides, the handler only echoes.
  app.get(
    '/probe/revisions',
    { config: { auth: { kind: 'action', action: 'config.read_revisions', target: 'none' } } },
    () => ({ ok: true }),
  );
  app.get(
    '/probe/cases/:caseId',
    { config: { auth: { kind: 'action', action: 'case.view', target: 'case' } } },
    (req) => ({ facts: req.authz?.facts }),
  );
  await app.ready();
});
beforeEach(async () => {
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session"'));
  clock = Date.parse('2026-09-21T03:00:00Z');
});
after(async () => {
  await app.close();
  await db.close();
});

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw.map((c) => String(c)) : [String(raw)];
  const found = list.find((c) => c.startsWith('rai_session='));
  assert.ok(found, 'rai_session cookie set');
  return found.split(';')[0]!;
}

async function signIn(fixtureUserId: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/fixture/sign-in', payload: { fixtureUserId } });
  assert.equal(res.statusCode, 200, `sign-in ${fixtureUserId}: ${res.body}`);
  return { info: res.json<SessionInfo>(), cookie: cookieOf(res), raw: res };
}

test('ID-03 every fixture user signs in through the fixture provider and receives exactly its (role, scope) pairs', async () => {
  assert.equal(FIXTURE_USERS.length, 8);
  const picker = await app.inject({ method: 'GET', url: '/auth/fixture/users' });
  assert.equal(picker.statusCode, 200);
  assert.deepEqual(
    picker.json<{ users: { fixtureUserId: string }[] }>().users.map((u) => u.fixtureUserId),
    FIXTURE_USERS.map((u) => u.fixtureUserId),
  );
  for (const user of FIXTURE_USERS) {
    const { info, cookie } = await signIn(user.fixtureUserId);
    const expected: Principal = {
      subjectId: user.subjectId,
      displayName: user.displayName,
      email: user.email,
      roles: [...user.roles],
    };
    assert.deepEqual(info.principal, expected, user.fixtureUserId);
    assert.equal(info.identityMode, 'fixture');
    assert.equal(info.locale, 'th');
    assert.equal(info.expiresAt, new Date(clock + 12 * 3_600_000).toISOString());
    const me = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json<SessionInfo>().principal, expected);
  }
  const dual = await signIn(DUAL_ROLE_FIXTURE_USER_ID);
  assert.deepEqual(dual.info.principal.roles, [
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
  ]);
  const secondOwner = await signIn('fx-user-owner-cm-2');
  assert.deepEqual(secondOwner.info.principal.roles, [{ role: 'owner', scope: { kind: 'own_cases' } }]);
  const events = await auditStore.read(db.app, {});
  assert.equal(events.filter((e) => e.action === 'identity.signed_in').length, 10);
  const dualEvent = events.find((e) => e.actorSubjectId === 'fixture:fx-user-dpo-spoc-hr');
  assert.deepEqual((dualEvent?.targetRef as { roles: string[] }).roles, [
    'dpo:all_cases',
    'bu_spoc:business_unit:HR',
  ]);
  assert.ok(!JSON.stringify(events).includes('@'), 'no email in any audit row');
});

test('an unknown fixture user id is 404 not_found and creates no session', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/fixture/sign-in',
    payload: { fixtureUserId: 'fx-user-nobody' },
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(Object.keys(res.json<{ error: object }>().error).sort(), [
    'code',
    'correlationId',
    'messageKey',
  ]);
  assert.equal(res.headers['set-cookie'], undefined);
  const rows = await db.app.execute(sql`SELECT count(*)::int AS n FROM "session"`);
  assert.equal((rows.rows[0] as { n: number }).n, 0);
  const missing = await app.inject({ method: 'POST', url: '/auth/fixture/sign-in', payload: {} });
  assert.equal(missing.statusCode, 422);
});

test('ID-08 a request without a session is unauthenticated; a wrong-role request is forbidden by the middleware, not the adapter', async () => {
  await db.owner
    .execute(sql`INSERT INTO "case" (id, registry_id, source_record_id, use_case_name, business_unit, business_owner, technical_owner, use_case_group, vendor_involved, model_type, owner_subject_id, business_unit_id, created_by)
    VALUES (${CASE_CM}, 'RAI-2000-0001', 'Unknown', 'synthetic case', 'Consumer Mobile', 'ณัฐพร ส.', 'tech', 'group', false, 'llm', 'fixture:fx-user-owner-cm', 'CM', 'fixture:fx-user-owner-cm')`);
  for (const url of ['/api/session', '/probe/revisions', `/probe/cases/${CASE_CM}`]) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 401, url);
    assert.equal(res.json<{ error: { code: string } }>().error.code, 'unauthenticated');
  }
  const dpo = await signIn('fx-user-dpo');
  const forbidden = await app.inject({
    method: 'GET',
    url: '/probe/revisions',
    headers: { cookie: dpo.cookie },
  });
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(forbidden.json<{ error: object }>().error, {
    code: 'forbidden',
    messageKey: 'error.forbidden',
    correlationId: forbidden.headers['x-correlation-id'],
  });
  const admin = await signIn('fx-user-admin');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/probe/revisions', headers: { cookie: admin.cookie } }))
      .statusCode,
    200,
  );

  const ownerB = await signIn('fx-user-owner-cm-2');
  assert.equal(
    (await app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers: { cookie: ownerB.cookie } }))
      .statusCode,
    403,
    'another owner in CM is out of scope',
  );
  const owner = await signIn('fx-user-owner-cm');
  const seen = await app.inject({
    method: 'GET',
    url: `/probe/cases/${CASE_CM}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(seen.statusCode, 200);
  assert.deepEqual(seen.json<{ facts: object }>().facts, {
    caseId: CASE_CM,
    ownerSubjectId: 'fixture:fx-user-owner-cm',
    businessUnitId: 'CM',
  });
  const spoc = await signIn('fx-user-spoc-cm');
  assert.equal(
    (await app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers: { cookie: spoc.cookie } }))
      .statusCode,
    200,
  );
  const dual = await signIn(DUAL_ROLE_FIXTURE_USER_ID);
  assert.equal(
    (await app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers: { cookie: dual.cookie } }))
      .statusCode,
    200,
    'DPO all_cases covers CM',
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/probe/cases/${randomUUID()}`,
        headers: { cookie: dual.cookie },
      })
    ).statusCode,
    404,
    'all_cases holder learns not_found',
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/probe/cases/${randomUUID()}`,
        headers: { cookie: ownerB.cookie },
      })
    ).statusCode,
    403,
    'own_cases holder learns nothing',
  );
  const denied = await auditStore.read(db.app, {});
  assert.equal(
    denied.filter((e) => !e.action.startsWith('identity.')).length,
    0,
    'a denial writes no audit row',
  );
});

test('ID-09 sessions: absolute expiry, idle expiry, sign-out revokes, re-sign-in replaces, lastSeenAt is throttled', async () => {
  const first = await signIn('fx-user-owner-cm');
  const rowOf = async (cookie: string) => {
    const hash = (await import('node:crypto'))
      .createHash('sha256')
      .update(cookie.slice('rai_session='.length))
      .digest('hex');
    const r = await db.owner.execute(
      sql`SELECT last_seen_at, revoked_at, expires_at FROM "session" WHERE token_hash = ${hash}`,
    );
    const row = r.rows[0] as {
      last_seen_at: string | Date;
      revoked_at: string | Date | null;
      expires_at: string | Date;
    };
    return {
      last_seen_at: new Date(row.last_seen_at),
      revoked_at: row.revoked_at === null ? null : new Date(row.revoked_at),
      expires_at: new Date(row.expires_at),
    };
  };
  const me = () => app.inject({ method: 'GET', url: '/api/session', headers: { cookie: first.cookie } });

  // throttle: a request 30 s later does not write lastSeenAt; one 61 s later does
  clock += 30_000;
  assert.equal((await me()).statusCode, 200);
  assert.equal((await rowOf(first.cookie)).last_seen_at.toISOString(), '2026-09-21T03:00:00.000Z');
  clock += 31_000;
  assert.equal((await me()).statusCode, 200);
  assert.equal((await rowOf(first.cookie)).last_seen_at.toISOString(), '2026-09-21T03:01:01.000Z');

  // idle expiry: 120 min without a request
  clock += 121 * 60_000;
  assert.equal((await me()).statusCode, 401, 'idle-expired');

  // re-sign-in creates a new row; the old cookie is ignored and replaced
  const second = await signIn('fx-user-owner-cm');
  assert.notEqual(second.cookie, first.cookie);
  const count = await db.owner.execute(sql`SELECT count(*)::int AS n FROM "session"`);
  assert.equal((count.rows[0] as { n: number }).n, 2);
  const me2 = () => app.inject({ method: 'GET', url: '/api/session', headers: { cookie: second.cookie } });
  assert.equal((await me2()).statusCode, 200);

  // absolute expiry: 12 h after creation even with steady activity
  const createdAt = clock;
  while (clock + 3_600_000 < createdAt + 12 * 3_600_000) {
    clock += 60 * 60_000;
    assert.equal((await me2()).statusCode, 200, new Date(clock).toISOString());
  }
  clock = createdAt + 12 * 3_600_000;
  assert.equal((await me2()).statusCode, 401, 'absolute expiry');

  // sign-out revokes
  const third = await signIn('fx-user-admin');
  const out = await app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    headers: { cookie: third.cookie, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(out.statusCode, 204);
  assert.notEqual((await rowOf(third.cookie)).revoked_at, null);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: third.cookie } })).statusCode,
    401,
  );
  const events = await auditStore.read(db.app, {});
  assert.deepEqual(
    events.map((e) => e.action).filter((a) => a === 'identity.signed_out'),
    ['identity.signed_out'],
  );
});

test('POST /api/session/locale persists the viewer locale on the row (D12)', async () => {
  const { cookie } = await signIn('fx-user-owner-cm');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/session/locale',
        headers: { cookie },
        payload: { locale: 'en' },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } })).json<SessionInfo>()
      .locale,
    'en',
  );
});

test('session rows are operational data: rai_app cannot delete them; the operator sweep removes expired and revoked rows only', async () => {
  const live = await signIn('fx-user-owner-cm');
  const revoked = await signIn('fx-user-admin');
  await app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    headers: { cookie: revoked.cookie, 'sec-fetch-site': 'same-origin' },
  });
  clock += 13 * 3_600_000;
  const fresh = await signIn('fx-user-dpo');
  const appDelete = await expectSqlError(db, 'app', 'DELETE FROM "session"');
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
  const removed = await sweepSessions(db.operator, now());
  assert.equal(removed, 2, 'the expired live row and the revoked row');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: fresh.cookie } })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: live.cookie } })).statusCode,
    401,
  );
});
