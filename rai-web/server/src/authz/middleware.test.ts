// The authorization middleware (W0-05 section 6, W1-01b): the only place scope is enforced. Table over routes that
// declare {action, target}: no cookie → 401 before anything else (also before a body validation 422); a wrong role →
// 403 from `authorize`, with the plain W0-06 envelope and one authz.denied line; an out-of-scope owner → 403 whether
// or not the case exists; an all_cases holder on an unresolvable id → 404 not_found with details.resource; a route
// without config.auth cannot be registered. In-memory session store and facts: no Postgres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';
import type { Principal } from '@rai/shared/schemas/auth';
import { buildApp } from '../app.js';
import { createIdentityAdapter } from '../identity/adapter.js';
import { createMemorySessionStore } from '../identity/session.memory.js';
import { RouteWithoutAuthDeclaration, type ScopeFactsSource } from './middleware.js';
import type { CaseScopeFacts } from './policy.js';

const publicBaseUrl = new URL('http://127.0.0.1:8787');
const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  trustProxy: false,
  publicBaseUrl,
};
const CASE_CM = '00000000-0000-7000-8000-000000000001';
const CASE_HR = '00000000-0000-7000-8000-000000000002';
const ARTIFACT_CM = '00000000-0000-7000-8000-0000000000a1';
const MISSING = '00000000-0000-7000-8000-0000000000ff';

const owner: Principal = {
  subjectId: 'fixture:fx-user-owner-cm',
  displayName: 'ณัฐพร ส.',
  email: 'owner.cm@rai-desk.example',
  roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
};
const ownerB: Principal = {
  ...owner,
  subjectId: 'fixture:fx-user-owner-cm-2',
  email: 'owner.cm2@rai-desk.example',
};
const spocCm: Principal = {
  subjectId: 'fixture:fx-user-spoc-cm',
  displayName: 'Suchada P.',
  email: 'spoc.cm@rai-desk.example',
  roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
};
const dpo: Principal = {
  subjectId: 'fixture:fx-user-dpo',
  displayName: 'Pimchanok R.',
  email: 'dpo@rai-desk.example',
  roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }],
};
const admin: Principal = {
  subjectId: 'fixture:fx-user-admin',
  displayName: 'Desk Admin (fixture)',
  email: 'admin@rai-desk.example',
  roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
};
const dual: Principal = {
  subjectId: 'fixture:fx-user-dpo-spoc-hr',
  displayName: 'Rattanaporn C.',
  email: 'dpo.spoc.hr@rai-desk.example',
  roles: [
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
  ],
};

const facts: ScopeFactsSource = {
  byCaseId: (id) =>
    Promise.resolve(
      (
        {
          [CASE_CM]: { caseId: CASE_CM, ownerSubjectId: owner.subjectId, businessUnitId: 'CM' },
          [CASE_HR]: {
            caseId: CASE_HR,
            ownerSubjectId: 'fixture:fx-user-someone-else',
            businessUnitId: 'HR',
          },
        } as Record<string, CaseScopeFacts>
      )[id],
    ),
  byArtifactId: (id) =>
    Promise.resolve(
      id === ARTIFACT_CM
        ? { caseId: CASE_CM, ownerSubjectId: owner.subjectId, businessUnitId: 'CM' }
        : undefined,
    ),
};

async function harness() {
  const store = createMemorySessionStore();
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: [
      {
        fixtureUserId: 'fx-user-admin',
        subjectId: 'fixture:fx-user-admin',
        displayName: 'Desk Admin (fixture)',
        email: 'admin@rai-desk.example',
        roles: admin.roles,
      },
    ],
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const { fastify, emitter } = buildApp({
    config,
    identity: {
      adapter,
      sessionStore: store,
      facts,
      fixtureProvider: { mode: 'fixture', listUsers: () => [], resolve: () => undefined },
    },
  });
  const denied: unknown[] = [];
  const original = emitter.log.bind(emitter);
  emitter.log = (event: never, fields: never, level?: never) => {
    if ((event as string) === 'authz.denied') denied.push(fields);
    return original(event, fields, level);
  };

  // Probe routes standing in for the W1-02 / W1-03 routes: they only echo the decision the middleware attached.
  fastify.get(
    '/probe/revisions',
    { config: { auth: { kind: 'action', action: 'config.read_revisions', target: 'none' } } },
    (req) => ({ via: req.authz?.decision.via }),
  );
  fastify.get(
    '/probe/cases/:caseId',
    { config: { auth: { kind: 'action', action: 'case.view', target: 'case' } } },
    (req) => ({ facts: req.authz?.facts }),
  );
  fastify.post(
    '/probe/cases/:caseId/submit',
    {
      config: { auth: { kind: 'action', action: 'case.submit', target: 'case' } },
      schema: { body: Type.Object({ expected: Type.Integer() }) },
    },
    () => ({ ok: true }),
  );
  fastify.get(
    '/probe/artifacts/:artifactId',
    { config: { auth: { kind: 'action', action: 'artifact.download', target: 'artifact' } } },
    (req) => ({ facts: req.authz?.facts }),
  );
  await fastify.ready();

  const cookieFor = async (principal: Principal) => {
    const { token } = await store.create({
      principal,
      identityMode: 'fixture',
      absoluteHours: 12,
      correlationId: 'test',
    });
    return `rai_session=${token}`;
  };
  return { app: fastify, cookieFor, denied };
}

function expectEnvelope(res: { statusCode: number; json: <T>() => T }, status: number, code: string) {
  assert.equal(res.statusCode, status);
  const body = res.json<{ error: Record<string, unknown> }>();
  assert.equal(body.error.code, code);
  assert.equal(body.error.messageKey, `error.${code}`);
  assert.equal(typeof body.error.correlationId, 'string');
  if (code === 'forbidden' || code === 'unauthenticated')
    assert.deepEqual(
      Object.keys(body.error).sort(),
      ['code', 'correlationId', 'messageKey'],
      'no details, no reason',
    );
  return body;
}

test('ID-08 no cookie, an unknown cookie, or a garbage cookie → 401 on every declared route, before validation', async () => {
  const h = await harness();
  for (const headers of [{}, { cookie: 'rai_session=not-a-token' }, { cookie: 'other=1' }]) {
    expectEnvelope(
      await h.app.inject({ method: 'GET', url: '/probe/revisions', headers }),
      401,
      'unauthenticated',
    );
    expectEnvelope(
      await h.app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers }),
      401,
      'unauthenticated',
    );
    expectEnvelope(
      await h.app.inject({ method: 'GET', url: '/api/session', headers }),
      401,
      'unauthenticated',
    );
  }
  // a body that would fail validation still answers 401 (session before validation, W0-06 section 4)
  expectEnvelope(
    await h.app.inject({
      method: 'POST',
      url: `/probe/cases/${CASE_CM}/submit`,
      payload: { expected: 'no' },
    }),
    401,
    'unauthenticated',
  );
  assert.equal(h.denied.length, 0, 'a 401 never reaches authorize');
});

test('ID-08 wrong role → 403 forbidden from the policy, plain envelope, one authz.denied line with reason role', async () => {
  const h = await harness();
  const cookie = await h.cookieFor(dpo);
  expectEnvelope(
    await h.app.inject({ method: 'GET', url: '/probe/revisions', headers: { cookie } }),
    403,
    'forbidden',
  );
  assert.deepEqual(h.denied, [
    {
      action: 'config.read_revisions',
      targetType: 'none',
      targetId: undefined,
      actorSubjectId: dpo.subjectId,
      actorRole: 'dpo',
      reason: 'role',
    },
  ]);
  const allowed = await h.app.inject({
    method: 'GET',
    url: '/probe/revisions',
    headers: { cookie: await h.cookieFor(admin) },
  });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.json<{ via: { role: string } }>().via.role, 'admin');
});

test('a reviewer sending an invalid body to a write route is 403 role, never 422 (authorization before validation)', async () => {
  const h = await harness();
  const res = await h.app.inject({
    method: 'POST',
    url: `/probe/cases/${CASE_CM}/submit`,
    headers: { cookie: await h.cookieFor(dpo) },
    payload: { expected: 'no' },
  });
  expectEnvelope(res, 403, 'forbidden');
  const ownerRes = await h.app.inject({
    method: 'POST',
    url: `/probe/cases/${CASE_CM}/submit`,
    headers: { cookie: await h.cookieFor(owner) },
    payload: { expected: 'no' },
  });
  expectEnvelope(ownerRes, 422, 'invalid_input');
});

test("scope: an owner sees its own case and is 403 on another owner's case, whether or not the case exists", async () => {
  const h = await harness();
  const cookie = await h.cookieFor(ownerB);
  expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers: { cookie } }),
    403,
    'forbidden',
  );
  expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/cases/${MISSING}`, headers: { cookie } }),
    403,
    'forbidden',
  );
  expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/cases/not-a-uuid`, headers: { cookie } }),
    403,
    'forbidden',
  );
  assert.deepEqual(
    h.denied.map((d) => (d as { reason: string; targetId: string }).reason),
    ['scope', 'scope', 'scope'],
  );
  const own = await h.app.inject({
    method: 'GET',
    url: `/probe/cases/${CASE_CM}`,
    headers: { cookie: await h.cookieFor(owner) },
  });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(own.json<{ facts: CaseScopeFacts }>().facts, {
    caseId: CASE_CM,
    ownerSubjectId: owner.subjectId,
    businessUnitId: 'CM',
  });
});

test('scope: a BU SPOC sees its BU and is 403 outside it; the dual-role identity sees HR as SPOC and everything as DPO', async () => {
  const h = await harness();
  const spoc = await h.cookieFor(spocCm);
  assert.equal(
    (await h.app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers: { cookie: spoc } }))
      .statusCode,
    200,
  );
  expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/cases/${CASE_HR}`, headers: { cookie: spoc } }),
    403,
    'forbidden',
  );
  const dualCookie = await h.cookieFor(dual);
  assert.equal(
    (await h.app.inject({ method: 'GET', url: `/probe/cases/${CASE_HR}`, headers: { cookie: dualCookie } }))
      .statusCode,
    200,
  );
  assert.equal(
    (await h.app.inject({ method: 'GET', url: `/probe/cases/${CASE_CM}`, headers: { cookie: dualCookie } }))
      .statusCode,
    200,
  );
  // a write on the HR case is allowed through the SPOC grant; on the CM case the dual identity has no write grant
  const hrWrite = await h.app.inject({
    method: 'POST',
    url: `/probe/cases/${CASE_HR}/submit`,
    headers: { cookie: dualCookie },
    payload: { expected: 1 },
  });
  assert.equal(hrWrite.statusCode, 200);
  expectEnvelope(
    await h.app.inject({
      method: 'POST',
      url: `/probe/cases/${CASE_CM}/submit`,
      headers: { cookie: dualCookie },
      payload: { expected: 1 },
    }),
    403,
    'forbidden',
  );
});

test('existence after authorization: an all_cases holder gets 404 not_found with details.resource on an unresolvable id', async () => {
  const h = await harness();
  const cookie = await h.cookieFor(dpo);
  const missingCase = expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/cases/${MISSING}`, headers: { cookie } }),
    404,
    'not_found',
  );
  assert.deepEqual(missingCase.error.details, { resource: 'case' });
  const missingArtifact = expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/artifacts/${MISSING}`, headers: { cookie } }),
    404,
    'not_found',
  );
  assert.deepEqual(missingArtifact.error.details, { resource: 'artifact' });
  assert.equal(h.denied.length, 0, 'a 404 is not a denial');
  // the same probes for an owner: 403 (T33 both halves)
  const ownerB2 = await h.cookieFor(ownerB);
  expectEnvelope(
    await h.app.inject({ method: 'GET', url: `/probe/artifacts/${MISSING}`, headers: { cookie: ownerB2 } }),
    403,
    'forbidden',
  );
  expectEnvelope(
    await h.app.inject({
      method: 'GET',
      url: `/probe/artifacts/${ARTIFACT_CM}`,
      headers: { cookie: ownerB2 },
    }),
    403,
    'forbidden',
  );
  assert.equal(
    (
      await h.app.inject({
        method: 'GET',
        url: `/probe/artifacts/${ARTIFACT_CM}`,
        headers: { cookie: await h.cookieFor(owner) },
      })
    ).statusCode,
    200,
  );
});

test('a route registered without config.auth is rejected at start-up', async () => {
  const store = createMemorySessionStore();
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: [
      {
        fixtureUserId: 'fx-user-admin',
        subjectId: 'fixture:fx-user-admin',
        displayName: 'Desk Admin (fixture)',
        email: 'admin@rai-desk.example',
        roles: admin.roles,
      },
    ],
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const { fastify } = buildApp({
    config,
    identity: {
      adapter,
      sessionStore: store,
      facts,
      fixtureProvider: { mode: 'fixture', listUsers: () => [], resolve: () => undefined },
    },
  });
  assert.throws(() => fastify.get('/undeclared', () => ({})), RouteWithoutAuthDeclaration);
});
