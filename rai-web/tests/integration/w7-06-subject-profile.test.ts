// W7-06 (W7 plan section 4.1, section 9 row W7-06), against the real Postgres: a `local-google`-shaped sign-in through
// the adapter's `discovery` and `exchange` seams (no provider, no network) upserts one `subject_profile` row inside
// the session store's create transaction; a second sign-in updates `last_sign_in_at` and the role snapshot and keeps
// `first_seen_at`; rai_app cannot delete a profile; a failing upsert rolls back the session and audit rows with it;
// and the case subject directory still names the subject after its session rows are swept by the operator.
// Synthetic accounts only (`@rai-desk.example`).

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { buildApp } from '../support/observed-app.js';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { createSubjectDirectory } from '@rai/server/cases/subject-directory';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { GOOGLE_ISSUER } from '@rai/server/identity/oidc';
import { createPgSessionStore, sweepSessions, type SubjectProfile } from '@rai/server/identity/session';
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
const SUBJECT = 'google:w7-06-synthetic-subject';
const EMAIL = 'profile.owner@rai-desk.example';

let db: TestDatabase;
let clock = Date.parse('2026-09-28T01:00:00Z');
const now = () => new Date(clock);
let claims: { email: string; name: string } = { email: EMAIL, name: 'Profile Owner (synthetic)' };
const recorded: SubjectProfile[] = [];
const apps: ReturnType<typeof buildApp>['fastify'][] = [];

/** A local-google app; `roleMap` (an allow-list JSON) is read at adapter start, so a changed map needs a new app. */
async function localGoogleApp(roleMap?: string) {
  const adapter = createIdentityAdapter({
    env: {
      RAI_IDENTITY_MODE: 'local-google',
      RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
      RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
      RAI_SESSION_ABSOLUTE_HOURS: '12',
      RAI_SESSION_IDLE_MINUTES: '120',
      ...(roleMap === undefined ? {} : { RAI_IDENTITY_LOCAL_ROLE_MAP: 'synthetic-role-map.json' }),
    },
    nodeEnv: 'test',
    discovery: () =>
      Promise.resolve({
        issuer: GOOGLE_ISSUER,
        authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
        token_endpoint: 'https://127.0.0.1:1/token', // never reached: the exchange seam answers
      }),
    groupMappingSource: () => Promise.resolve(null),
    ...(roleMap === undefined ? {} : { readLocalRoleMap: () => Promise.resolve(roleMap) }),
    exchange: (input) =>
      Promise.resolve({
        iss: GOOGLE_ISSUER,
        sub: 'w7-06-synthetic-subject',
        email: claims.email,
        email_verified: true,
        name: claims.name,
        nonce: input.expectedNonce,
      }),
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const { fastify } = buildApp({
    db: db.app,
    now,
    config,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      profiles: { recorded: (p) => recorded.push(p) },
    },
  });
  await fastify.ready();
  apps.push(fastify);
  return fastify;
}

function cookieValue(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string | string[] | undefined;
  const list: string[] = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
}

async function signIn(app: ReturnType<typeof buildApp>['fastify']) {
  const begin = await app.inject({ method: 'POST', url: '/auth/sign-in', payload: {} });
  assert.equal(begin.statusCode, 200);
  const state = new URL(begin.json<{ redirectUrl: string }>().redirectUrl).searchParams.get('state');
  const transaction = cookieValue(begin, 'rai_signin');
  assert.ok(state && transaction);
  const res = await app.inject({
    method: 'GET',
    url: `/auth/callback?code=synthetic-code&state=${state}`,
    headers: { cookie: transaction },
  });
  assert.equal(res.statusCode, 303, res.body);
  const session = cookieValue(res, 'rai_session');
  assert.ok(session, 'a session cookie is set');
  return session;
}

interface ProfileRow {
  subject_id: string;
  identity_mode: string;
  email: string;
  display_name: string;
  roles: unknown;
  first_seen_at: Date;
  last_sign_in_at: Date;
}

async function profiles(): Promise<ProfileRow[]> {
  return db.raw(
    'owner',
    async (c) => (await c.query<ProfileRow>('SELECT * FROM subject_profile ORDER BY subject_id')).rows,
  );
}

async function count(table: string, where = 'true'): Promise<number> {
  return db.raw('owner', async (c) =>
    Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)).rows[0]!.n),
  );
}

before(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session"'));
  clock = Date.parse('2026-09-28T01:00:00Z');
  claims = { email: EMAIL, name: 'Profile Owner (synthetic)' };
  recorded.length = 0;
});
after(async () => {
  for (const app of apps) await app.close();
  await db.close();
});

test('W7-06: a local-google sign-in upserts one subject_profile row with the session; a second updates last_sign_in_at and roles', async () => {
  const first = await localGoogleApp();
  await signIn(first);
  let rows = await profiles();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    subject_id: SUBJECT,
    identity_mode: 'local-google',
    email: EMAIL,
    display_name: 'Profile Owner (synthetic)',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
    first_seen_at: new Date('2026-09-28T01:00:00Z'),
    last_sign_in_at: new Date('2026-09-28T01:00:00Z'),
  });
  assert.equal(await count('session', `subject_id = '${SUBJECT}'`), 1);
  assert.equal(recorded.length, 1, 'the hook saw the written row');
  assert.equal(recorded[0]?.subjectId, SUBJECT);
  assert.deepEqual(recorded[0]?.firstSeenAt, new Date('2026-09-28T01:00:00Z'));

  // The role map now lists the account as Admin; roles change at the next sign-in (W0-03 section 6.3).
  clock = Date.parse('2026-09-28T04:30:00Z');
  claims = { email: EMAIL, name: 'Profile Owner Renamed (synthetic)' };
  const second = await localGoogleApp(
    JSON.stringify({
      version: 1,
      entries: [{ email: EMAIL, roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] }],
    }),
  );
  await signIn(second);
  rows = await profiles();
  assert.equal(rows.length, 1, 'still one row per subject');
  assert.deepEqual(rows[0], {
    subject_id: SUBJECT,
    identity_mode: 'local-google',
    email: EMAIL,
    display_name: 'Profile Owner Renamed (synthetic)',
    roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
    first_seen_at: new Date('2026-09-28T01:00:00Z'),
    last_sign_in_at: new Date('2026-09-28T04:30:00Z'),
  });
  assert.equal(await count('session', `subject_id = '${SUBJECT}'`), 2);
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded[1]?.roles, [{ role: 'admin', scope: { kind: 'all_cases' } }]);
});

test('W7-06: rai_app may read, insert and update subject_profile but never delete it', async () => {
  await signIn(await localGoogleApp());
  const appDelete = await expectSqlError(db, 'app', 'DELETE FROM subject_profile');
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
  const operatorDelete = await expectSqlError(db, 'operator', 'DELETE FROM subject_profile');
  assert.equal(operatorDelete?.code, INSUFFICIENT_PRIVILEGE);
  assert.equal((await profiles()).length, 1);
});

test('W7-06: the profile upsert commits or rolls back with the session insert and the identity.signed_in audit row', async () => {
  const store = createPgSessionStore(db.app);
  const principal = {
    subjectId: 'fixture:w7-06-rollback',
    displayName: 'Rollback Probe (synthetic)',
    email: 'rollback.probe@rai-desk.example',
    roles: [{ role: 'owner' as const, scope: { kind: 'own_cases' as const } }],
  };
  // The session CHECK accepts `fixture`; the profile CHECK does not. The upsert runs last in the transaction, so its
  // failure must take the session row and the audit row with it.
  await assert.rejects(
    store.create({
      principal,
      identityMode: 'fixture',
      absoluteHours: 12,
      correlationId: 'w7-06-rollback',
      now: now(),
      profile: { email: principal.email, displayName: principal.displayName },
    }),
  );
  assert.equal(await count('session', `subject_id = '${principal.subjectId}'`), 0, 'no session row');
  assert.equal(await count('subject_profile'), 0, 'no profile row');
  assert.equal(
    await count(
      'audit_event',
      `action = 'identity.signed_in' AND actor_subject_id = '${principal.subjectId}'`,
    ),
    0,
    'no audit row',
  );

  const created = await store.create({
    principal: { ...principal, subjectId: 'google:w7-06-commit' },
    identityMode: 'local-google',
    absoluteHours: 12,
    correlationId: 'w7-06-commit',
    now: now(),
    profile: { email: principal.email, displayName: principal.displayName },
  });
  assert.equal(created.profile?.subjectId, 'google:w7-06-commit');
  assert.equal(await count('session', `subject_id = 'google:w7-06-commit'`), 1);
  assert.equal(await count('subject_profile', `subject_id = 'google:w7-06-commit'`), 1);
  assert.equal(
    await count('audit_event', `action = 'identity.signed_in' AND actor_subject_id = 'google:w7-06-commit'`),
    1,
  );

  // Without a profile (the fixture sign-in) the store writes no profile row and returns none.
  const fixture = await store.create({
    principal,
    identityMode: 'fixture',
    absoluteHours: 12,
    correlationId: 'w7-06-fixture',
    now: now(),
  });
  assert.equal(fixture.profile, undefined);
  assert.equal(await count('subject_profile', `subject_id = '${principal.subjectId}'`), 0);
});

test('W7-06: the subject directory resolves the display name from subject_profile after the session rows are swept', async () => {
  const app = await localGoogleApp();
  const cookie = await signIn(app);
  const signOut = await app.inject({
    method: 'POST',
    url: '/auth/sign-out',
    headers: { cookie, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(signOut.statusCode, 204);
  assert.equal(await sweepSessions(db.operator, now()), 1, 'the revoked row is swept');
  assert.equal(await count('session', `subject_id = '${SUBJECT}'`), 0);

  const directory = createSubjectDirectory(db.app); // no start-up table: the profile is the only source left
  assert.deepEqual(await directory.resolve(SUBJECT), {
    subjectId: SUBJECT,
    displayName: 'Profile Owner (synthetic)',
  });
  assert.equal(await directory.resolve('google:never-signed-in'), undefined);
});
