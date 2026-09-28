// W7-08 (W7 plan section 5.2, section 9 row W7-08; W0-03 ID-16): the A01 network clause, against the real Postgres
// and the real HTTP stack. The desk runs in `network` mode, source `allow-list`, on loopback (W7-D2: no non-loopback
// bind in any test) with `PUBLIC_BASE_URL=https://desk.rai-desk.test` and `TRUST_PROXY=true`; sign-in goes through
// the W7-05 seams (a discovery document for the synthetic issuer `https://idp.rai-desk.test`, an exchange that returns
// the claims of the synthetic account the callback `code` names), so no provider or other host is contacted. Every
// request carries `X-Forwarded-Proto: https`. Items: (1) readiness and no fixture routes; (2) allow-listed sign-in;
// (3) unlisted and unverified refusals; (4) the per-role direct-URL and API negatives of the fixture-mode suites;
// (5) an allow-list change applies at the next sign-in, not to a live session; (6) the cross-site guard; (7) an http
// base URL refuses start. Synthetic `@rai-desk.example` accounts only.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { RoleScope, SessionInfo } from '@rai/shared/schemas/auth';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseListResponse, CaseView } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { ReadinessReport } from '@rai/shared/schemas/observability';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { applyConfigurationSeed } from '@rai/server/configuration/seed';
import { withTransaction } from '@rai/server/db/transaction';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import {
  NETWORK_BASE_URL,
  NETWORK_ISSUER,
  PROXY_HEADERS,
  SESSION_COOKIE,
  networkEnv,
  signInNetwork,
  startNetworkDesk,
  type AllowListEntry,
  type NetworkAccount,
  type NetworkDesk,
} from '../support/network-sign-in.js';
import { RAI_WEB_ROOT, freeLoopbackPort } from '../support/process.js';

const account = (key: string, name: string): NetworkAccount => ({
  sub: `w708-${key}`,
  email: `w708.${key}@rai-desk.example`,
  name: `${name} (synthetic)`,
});
const OWNER_A = account('owner-a', 'Owner A');
const OWNER_B = account('owner-b', 'Owner B');
const SPOC_CM = account('spoc-cm', 'BU SPOC CM');
const SPOC_HR = account('spoc-hr', 'BU SPOC HR');
const AI_COE = account('ai-coe', 'AI CoE reviewer');
const DPO = account('dpo', 'DPO reviewer');
const IT_SEC = account('it-security', 'IT Security reviewer');
const ADMIN = account('admin', 'Desk Admin');
/** Provider-verified, but on no allow-list. */
const UNLISTED = account('unlisted', 'Unlisted person');
/** The DPO's listed address, from a provider that has not verified it. */
const DPO_UNVERIFIED: NetworkAccount = {
  ...account('dpo-unverified', 'DPO'),
  email: DPO.email,
  emailVerified: false,
};
const ACCOUNTS = [OWNER_A, OWNER_B, SPOC_CM, SPOC_HR, AI_COE, DPO, IT_SEC, ADMIN, UNLISTED, DPO_UNVERIFIED];

const ROLES = new Map<NetworkAccount, RoleScope[]>([
  [OWNER_A, [{ role: 'owner', scope: { kind: 'own_cases' } }]],
  [OWNER_B, [{ role: 'owner', scope: { kind: 'own_cases' } }]],
  [SPOC_CM, [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }]],
  [SPOC_HR, [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } }]],
  [AI_COE, [{ role: 'ai_coe', scope: { kind: 'all_cases', lane: 'ai_coe' } }]],
  [DPO, [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }]],
  [IT_SEC, [{ role: 'it_security', scope: { kind: 'all_cases', lane: 'it_security' } }]],
  [ADMIN, [{ role: 'admin', scope: { kind: 'all_cases' } }]],
]);
const LISTED = [...ROLES.keys()];
const ALLOW_LIST: AllowListEntry[] = LISTED.map((a) => ({ email: a.email, roles: ROLES.get(a)! }));

const ISSUER_HASH = createHash('sha256').update(NETWORK_ISSUER).digest('hex').slice(0, 12);
const subjectOf = (a: NetworkAccount) => `oidc:${ISSUER_HASH}:${a.sub}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

let db: TestDatabase;
let root: string;
let desk: NetworkDesk;
const sessions = new Map<NetworkAccount, string>();
const world = {} as {
  cmCase: CaseView;
  hrCase: CaseView;
  cmArtifact: ArtifactRef;
  hrArtifact: ArtifactRef;
  cmVersion: SubmittedVersion;
};

before(async () => {
  db = await openTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), 'rai-w7-08-'));
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  // The published W1-00 configuration seed (use-case groups, templates, SLA, QC rules) and no fixture case: the
  // fixture loader refuses `network` mode (W0-08 8.1 rule 5), and every case here is filed through the API.
  await withTransaction(db.app, (tx) =>
    applyConfigurationSeed(tx, { correlationId: randomUUID(), publishedAt: new Date(Date.now() - 1000) }),
  );
  desk = await startNetworkDesk({ db: db.app, env: networkEnv(root, ALLOW_LIST), accounts: ACCOUNTS });
});
after(async () => {
  await desk?.close();
  await db.close();
  await rm(root, { recursive: true, force: true });
});

interface Answer {
  status: number;
  text: string;
  headers: Headers;
  json<T>(): T;
}

function headersFor(cookie: string | undefined, extra: Record<string, string> = {}) {
  return {
    ...PROXY_HEADERS,
    ...(cookie === undefined ? {} : { cookie }),
    'sec-fetch-site': 'same-origin',
    ...extra,
  };
}

async function answer(res: Response): Promise<Answer> {
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, json: <T>() => JSON.parse(text) as T };
}

async function call(
  cookie: string | undefined,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Answer> {
  const res = await fetch(`${desk.origin}${url}`, {
    method,
    headers: headersFor(cookie, {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
      ...extra,
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return answer(res);
}

async function upload(cookie: string | undefined, caseId: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), 'w708-evidence.pdf');
  return answer(
    await fetch(`${desk.origin}/api/cases/${caseId}/artifacts`, {
      method: 'POST',
      headers: headersFor(cookie, extra),
      body: form,
    }),
  );
}

/** The W0-06 8.2 refusal envelope, and nothing of the target case or its documents. */
function assertRefused(r: Answer, status: 401 | 403 | 404, code: string, label: string): void {
  assert.equal(r.status, status, `${label}: ${r.status} ${r.text}`);
  const body = r.json<{ error: { code: string; messageKey: string; correlationId: string } }>();
  assert.deepEqual(Object.keys(body), ['error'], `${label}: the envelope carries nothing else`);
  assert.equal(body.error.code, code, label);
  assert.equal(body.error.messageKey, `error.${code}`, label);
  assert.equal(body.error.correlationId, r.headers.get('x-correlation-id'), label);
  for (const secret of ['W7-08 CM network case', 'W7-08 HR network case', 'w708-evidence.pdf'])
    assert.ok(!r.text.includes(secret), `${label}: nothing of the case or its documents leaks`);
}

const errorCode = (body: string) => (JSON.parse(body) as { error: { code: string } }).error.code;

const sessionOf = (a: NetworkAccount) => {
  const cookie = sessions.get(a);
  assert.ok(cookie !== undefined, `${a.sub} signed in`);
  return cookie;
};

async function count(query: ReturnType<typeof sql>): Promise<number> {
  return Number(((await db.owner.execute(query)).rows[0] as { n: number | string }).n);
}

async function refusedAudit(): Promise<{ reason: string; issuer_key: string; identity_mode: string }[]> {
  const rows = await db.owner.execute(
    sql`SELECT target_ref FROM audit_event WHERE action = 'identity.sign_in_refused' ORDER BY seq`,
  );
  return rows.rows.map((r) => (r as { target_ref: never }).target_ref);
}

test('item 1: readiness reports network mode, identity ok, a loopback bind and ready; the fixture routes do not exist', async () => {
  const ready = await call(undefined, 'GET', '/readyz');
  assert.equal(ready.status, 200, ready.text);
  const report = ready.json<ReadinessReport>();
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.identity, { mode: 'network', loopbackBind: true, status: 'ok' });
  assert.deepEqual(report.mailSink, { kind: 'file', status: 'ok' });
  assert.ok(!ready.text.includes(NETWORK_ISSUER) && !ready.text.includes('rai-desk.example'));

  assertRefused(await call(undefined, 'GET', '/auth/fixture/users'), 404, 'not_found', 'fixture users');
  assertRefused(
    await call(undefined, 'POST', '/auth/fixture/sign-in', { fixtureUserId: 'fx-user-admin' }),
    404,
    'not_found',
    'fixture sign-in',
  );
  const method = await call(undefined, 'GET', '/auth/sign-in-method');
  assert.deepEqual(method.json(), { method: 'organization' });
});

test('item 2: every allow-listed account signs in through /auth/sign-in and /auth/callback and gets __Host-rai_session with exactly its allow-list roles', async () => {
  for (const a of LISTED) {
    const signIn = await signInNetwork(desk.origin, a.sub);
    assert.equal(signIn.status, 303, `${a.sub}: ${signIn.body}`);
    assert.equal(signIn.redirectUrl.origin, NETWORK_ISSUER, 'the browser is sent to the configured issuer');
    assert.equal(
      signIn.redirectUrl.searchParams.get('redirect_uri'),
      `${NETWORK_BASE_URL}/auth/callback`,
      'the callback is derived from the https base URL',
    );
    assert.ok(signIn.cookie !== undefined, `${a.sub}: a session cookie`);
    const raw = signIn.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
      assert.ok(raw.split('; ').includes(attribute), `${a.sub}: ${attribute}`);
    assert.ok(!/;\s*Domain=/i.test(raw), `${a.sub}: a __Host- cookie carries no Domain`);
    assert.ok(
      !signIn.setCookies.some((c) => c.startsWith('rai_session=')),
      'never the plain cookie name on https',
    );
    sessions.set(a, signIn.cookie);

    const me = await call(signIn.cookie, 'GET', '/api/session');
    assert.equal(me.status, 200, me.text);
    const info = me.json<SessionInfo>();
    assert.equal(info.identityMode, 'network');
    assert.equal(info.principal.subjectId, subjectOf(a));
    assert.equal(info.principal.email, a.email);
    assert.deepEqual(info.principal.roles, ROLES.get(a), `${a.sub}: the allow-list roles, nothing else`);
  }
  assert.equal(await count(sql`SELECT count(*)::int AS n FROM session`), LISTED.length);
});

test('item 3: a verified but unlisted email is 403 with no session and a not_allow_listed audit row; an unverified email is refused', async () => {
  const sessionsBefore = await count(sql`SELECT count(*)::int AS n FROM session`);
  const auditBefore = (await refusedAudit()).length;

  const unlisted = await signInNetwork(desk.origin, UNLISTED.sub);
  assert.equal(unlisted.status, 403, unlisted.body);
  assert.equal(errorCode(unlisted.body), 'forbidden');
  assert.equal(unlisted.cookie, undefined, 'no session cookie');

  const unverified = await signInNetwork(desk.origin, DPO_UNVERIFIED.sub);
  assert.equal(unverified.status, 401, unverified.body);
  assert.equal(errorCode(unverified.body), 'unauthenticated');
  assert.equal(unverified.cookie, undefined, 'no session cookie');

  assert.equal(await count(sql`SELECT count(*)::int AS n FROM session`), sessionsBefore, 'no session row');
  assert.equal(
    await count(
      sql`SELECT count(*)::int AS n FROM session WHERE subject_id IN (${subjectOf(UNLISTED)}, ${subjectOf(DPO_UNVERIFIED)})`,
    ),
    0,
  );
  assert.equal(
    await count(sql`SELECT count(*)::int AS n FROM subject_profile WHERE email = ${UNLISTED.email}`),
    0,
    'no profile for a refused account',
  );
  const audit = (await refusedAudit()).slice(auditBefore);
  assert.deepEqual(
    audit.map((r) => [r.identity_mode, r.reason, r.issuer_key]),
    [
      ['network', 'not_allow_listed', 'oidc'],
      ['network', 'email_not_verified', 'oidc'],
    ],
  );
  assert.ok(!JSON.stringify(audit).includes('rai-desk.example'), 'the audit row never holds the email');
});

test('item 4 setup: owner A files a CM and an HR case through the API, uploads a document to each and submits the CM case', async () => {
  const owner = sessionOf(OWNER_A);
  const create = async (businessUnitId: 'CM' | 'HR', useCaseName: string) => {
    const created = await call(owner, 'POST', '/api/cases', {
      useCaseName,
      businessUnitId,
      businessUnit: businessUnitId === 'CM' ? 'Consumer Mobile' : 'Human Resources',
      businessOwner: subjectOf(OWNER_A),
      technicalOwner: 'Tech (synthetic)',
      sourceRecordId: { kind: 'unknown' },
      useCaseGroup: 'customer-analytics',
      vendorInvolved: false,
      modelType: 'llm',
    });
    assert.equal(created.status, 201, created.text);
    return created.json<CaseView>();
  };
  world.cmCase = await create('CM', 'W7-08 CM network case');
  world.hrCase = await create('HR', 'W7-08 HR network case');
  for (const [key, c] of [
    ['cmArtifact', world.cmCase],
    ['hrArtifact', world.hrCase],
  ] as const) {
    const up = await upload(owner, c.caseId);
    assert.equal(up.status, 201, up.text);
    world[key] = up.json<ArtifactRef>();
  }
  const draft = (await call(owner, 'GET', `/api/cases/${world.cmCase.caseId}/draft`)).json<PackDraft>();
  const submitted = await call(owner, 'POST', `/api/cases/${world.cmCase.caseId}/draft/submit`, {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  });
  assert.equal(submitted.status, 201, submitted.text);
  world.cmVersion = submitted.json<SubmittedVersion>();
});

test('item 4: no session is 401 on the API and on a direct artifact URL; no bytes are served', async () => {
  assertRefused(await call(undefined, 'GET', '/api/cases'), 401, 'unauthenticated', 'list');
  assertRefused(
    await call(undefined, 'GET', `/api/cases/${world.cmCase.caseId}`),
    401,
    'unauthenticated',
    'read',
  );
  const direct = await call(undefined, 'GET', `/api/artifacts/${world.cmArtifact.artifactId}`);
  assertRefused(direct, 401, 'unauthenticated', 'direct artifact URL');
  assert.equal(direct.headers.get('content-disposition'), null);
  const forged = await call(
    `${SESSION_COOKIE}=${randomUUID()}`,
    'GET',
    `/api/artifacts/${world.cmArtifact.artifactId}`,
  );
  assertRefused(forged, 401, 'unauthenticated', 'forged session cookie');
  const plain = await call(`rai_session=${randomUUID()}`, 'GET', '/api/session');
  assertRefused(plain, 401, 'unauthenticated', 'the plain cookie name is not read on https');
});

test('item 4: owner B cannot read, list, write, upload to or download from owner A cases (403)', async () => {
  const other = sessionOf(OWNER_B);
  const list = await call(other, 'GET', '/api/cases?pageSize=100');
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json<CaseListResponse>().items, [], 'owner B lists nothing');
  const owner = sessionOf(OWNER_A);
  for (const c of [world.cmCase, world.hrCase]) {
    assert.equal((await call(owner, 'GET', `/api/cases/${c.caseId}`)).status, 200, 'control: owner A reads');
    assertRefused(
      await call(other, 'GET', `/api/cases/${c.caseId}`),
      403,
      'forbidden',
      `read ${c.registryId}`,
    );
    assertRefused(await call(other, 'GET', `/api/cases/${c.caseId}/draft`), 403, 'forbidden', 'draft read');
    assertRefused(
      await call(other, 'PUT', `/api/cases/${c.caseId}/draft`, {
        expectedVersion: { versionId: randomUUID(), revision: 1 },
        slots: { 8: { state: 'not_yet' } },
      }),
      403,
      'forbidden',
      'draft write',
    );
    assertRefused(await upload(other, c.caseId), 403, 'forbidden', 'upload');
    assertRefused(await call(other, 'GET', `/api/cases/${c.caseId}/versions`), 403, 'forbidden', 'versions');
  }
  for (const a of [world.cmArtifact, world.hrArtifact]) {
    const direct = await call(other, 'GET', `/api/artifacts/${a.artifactId}`);
    assertRefused(direct, 403, 'forbidden', 'direct artifact download out of scope');
    assert.equal(direct.headers.get('content-disposition'), null);
    assertRefused(await call(other, 'GET', `/api/artifacts/${a.artifactId}/meta`), 403, 'forbidden', 'meta');
  }
  const ownerDownload = await call(owner, 'GET', `/api/artifacts/${world.cmArtifact.artifactId}`);
  assert.equal(ownerDownload.status, 200, 'control: owner A downloads its own document');
});

test('item 4: a BU SPOC reads its BU and is 403 on the other BU case, its document and its versions', async () => {
  for (const [spoc, mine, theirs, theirDoc] of [
    [SPOC_CM, world.cmCase, world.hrCase, world.hrArtifact],
    [SPOC_HR, world.hrCase, world.cmCase, world.cmArtifact],
  ] as const) {
    const cookie = sessionOf(spoc);
    const list = await call(cookie, 'GET', '/api/cases?pageSize=100');
    assert.deepEqual(
      list.json<CaseListResponse>().items.map((c) => c.caseId),
      [mine.caseId],
      `${spoc.sub}: only its BU`,
    );
    assert.equal((await call(cookie, 'GET', `/api/cases/${mine.caseId}`)).status, 200, 'in scope');
    assertRefused(
      await call(cookie, 'GET', `/api/cases/${theirs.caseId}`),
      403,
      'forbidden',
      'other BU read',
    );
    assertRefused(await upload(cookie, theirs.caseId), 403, 'forbidden', 'other BU upload');
    assertRefused(
      await call(cookie, 'GET', `/api/cases/${theirs.caseId}/versions`),
      403,
      'forbidden',
      'other BU versions',
    );
    assertRefused(
      await call(cookie, 'GET', `/api/artifacts/${theirDoc.artifactId}`),
      403,
      'forbidden',
      'other BU artifact by direct URL',
    );
  }
});

test('item 4: each reviewer decides only its own lane, Admin decides no lane, and neither makes owner writes (403); nothing is written', async () => {
  const { caseId } = world.cmCase;
  const { versionId } = world.cmVersion;
  const decisionsBefore = await count(sql`SELECT count(*)::int AS n FROM lane_decision`);
  const decide = (cookie: string, lane: string, kind: 'approve' | 'send-back') =>
    call(
      cookie,
      'POST',
      `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/${kind}`,
      kind === 'approve'
        ? { expectedVersion: { versionId, revision: 1 }, qcRunId: randomUUID() }
        : {
            expectedVersion: { versionId, revision: 1 },
            feedback: { items: [{ slot: 1, deficiency: 'x' }] },
          },
    );
  for (const [reviewer, otherLanes] of [
    [AI_COE, ['dpo', 'it_security']],
    [DPO, ['ai_coe', 'it_security']],
    [IT_SEC, ['ai_coe', 'dpo']],
    [ADMIN, ['ai_coe', 'dpo', 'it_security']],
  ] as const) {
    const cookie = sessionOf(reviewer);
    assert.equal((await call(cookie, 'GET', `/api/cases/${caseId}`)).status, 200, `${reviewer.sub} reads`);
    for (const lane of otherLanes)
      for (const kind of ['approve', 'send-back'] as const)
        assertRefused(await decide(cookie, lane, kind), 403, 'forbidden', `${reviewer.sub} ${kind} ${lane}`);
    assertRefused(
      await call(cookie, 'POST', '/api/cases', {
        useCaseName: 'Reviewer attempt',
        businessUnitId: 'CM',
        businessUnit: 'Consumer Mobile',
        businessOwner: subjectOf(reviewer),
        technicalOwner: 'x',
        sourceRecordId: { kind: 'unknown' },
        useCaseGroup: 'customer-analytics',
        vendorInvolved: false,
        modelType: 'other',
      }),
      403,
      'forbidden',
      `${reviewer.sub} create`,
    );
    assertRefused(await upload(cookie, world.hrCase.caseId), 403, 'forbidden', `${reviewer.sub} upload`);
    assertRefused(
      await call(cookie, 'POST', `/api/cases/${world.hrCase.caseId}/draft/submit`, {
        expectedVersion: { versionId: randomUUID(), revision: 1 },
      }),
      403,
      'forbidden',
      `${reviewer.sub} submit`,
    );
  }
  // Owner and BU SPOC of the case decide no lane either (D05).
  for (const holder of [OWNER_A, SPOC_CM])
    assertRefused(
      await decide(sessionOf(holder), 'dpo', 'approve'),
      403,
      'forbidden',
      `${holder.sub} approve`,
    );
  assert.equal(
    await count(sql`SELECT count(*)::int AS n FROM lane_decision`),
    decisionsBefore,
    'no decision',
  );
});

test('item 4: an unknown case id is 403 for a scoped actor and 404 for an all-cases actor', async () => {
  const nowhere = '00000000-0000-4000-8000-000000000000';
  assertRefused(await call(sessionOf(OWNER_B), 'GET', `/api/cases/${nowhere}`), 403, 'forbidden', 'owner');
  assertRefused(await call(sessionOf(SPOC_CM), 'GET', `/api/cases/${nowhere}`), 403, 'forbidden', 'spoc');
  assertRefused(await call(sessionOf(DPO), 'GET', `/api/cases/${nowhere}`), 404, 'not_found', 'reviewer');
});

test('item 6: a signed-in write marked Sec-Fetch-Site cross-site is 403 and writes nothing; same-origin succeeds', async () => {
  const owner = sessionOf(OWNER_A);
  const artifacts = () =>
    count(sql`SELECT count(*)::int AS n FROM artifact WHERE case_id = ${world.hrCase.caseId}`);
  const before = await artifacts();
  for (const site of ['cross-site', 'same-site']) {
    assertRefused(
      await upload(owner, world.hrCase.caseId, { 'sec-fetch-site': site }),
      403,
      'forbidden',
      `${site} upload`,
    );
    assertRefused(
      await call(owner, 'POST', '/api/session/locale', { locale: 'en' }, { 'sec-fetch-site': site }),
      403,
      'forbidden',
      `${site} locale`,
    );
  }
  assert.equal(await artifacts(), before, 'nothing written');
  assert.equal(
    (await call(owner, 'GET', '/api/session')).json<SessionInfo>().locale,
    'th',
    'locale unchanged',
  );
  assert.equal((await upload(owner, world.hrCase.caseId)).status, 201, 'the same upload same-origin');
  assert.equal(await artifacts(), before + 1);
});

test('item 5: an allow-list change applies at the next sign-in after restart; a live session keeps its recorded principal', async () => {
  const dpoBefore = sessionOf(DPO);
  const ownerBBefore = sessionOf(OWNER_B);
  await desk.close();
  // The list is parsed at adapter.start(): the DPO account now holds IT Security, owner B is removed.
  const changed = ALLOW_LIST.filter((e) => e.email !== OWNER_B.email).map((e): AllowListEntry =>
    e.email === DPO.email ? { email: e.email, roles: ROLES.get(IT_SEC)! } : e,
  );
  desk = await startNetworkDesk({ db: db.app, env: networkEnv(root, changed), accounts: ACCOUNTS });

  const live = await call(dpoBefore, 'GET', '/api/session');
  assert.equal(live.status, 200, live.text);
  assert.deepEqual(live.json<SessionInfo>().principal.roles, ROLES.get(DPO), 'the live session keeps dpo');
  const liveOwnerB = await call(ownerBBefore, 'GET', '/api/session');
  assert.equal(liveOwnerB.status, 200, 'a removed account keeps its live session until it ends');

  const fresh = await signInNetwork(desk.origin, DPO.sub);
  assert.equal(fresh.status, 303, fresh.body);
  const info = (await call(fresh.cookie, 'GET', '/api/session')).json<SessionInfo>();
  assert.equal(info.principal.subjectId, subjectOf(DPO), 'the same subject');
  assert.deepEqual(info.principal.roles, ROLES.get(IT_SEC));

  const auditBefore = (await refusedAudit()).length;
  const removed = await signInNetwork(desk.origin, OWNER_B.sub);
  assert.equal(removed.status, 403, removed.body);
  assert.equal(removed.cookie, undefined);
  assert.deepEqual(
    (await refusedAudit()).slice(auditBefore).map((r) => r.reason),
    ['not_allow_listed'],
  );
});

test('item 7: the real process with PUBLIC_BASE_URL=http://... in network mode exits 78 base_url_not_https and never listens', async () => {
  const port = await freeLoopbackPort();
  const env = networkEnv(root, ALLOW_LIST, {
    PORT: String(port),
    PUBLIC_BASE_URL: 'http://desk.rai-desk.test',
    LOG_LEVEL: 'error',
  });
  const r = await new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--conditions=rai-source', path.join('server', 'src', 'main.ts')],
      { cwd: RAI_WEB_ROOT, env },
    );
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.on('exit', (code) => resolve({ code, stderr, stdout }));
  });
  assert.equal(r.code, 78, r.stderr);
  assert.deepEqual(JSON.parse(r.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'base_url_not_https',
  });
  assert.ok(!r.stdout.includes('process.started'), 'never started');
  assert.ok(!`${r.stdout}${r.stderr}`.includes('rai-desk.example'), 'no allow-list content in the output');
  const probe = await fetch(`http://127.0.0.1:${port}/readyz`).catch(() => undefined);
  assert.equal(probe, undefined, 'nothing listens');
});
