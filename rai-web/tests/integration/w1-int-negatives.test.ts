// W1-INT: the W1 exit negatives as direct-API tests against the REAL server process (W0-02 8.2: "Negative tests
// for A01 are always direct-API integration tests, never only UI assertions"; the W1-08 list: wrong role, other
// BU, direct file URL, unsafe upload, `local-google` refuses a non-loopback bind and an unknown mode and fails
// closed per W0-03). The server is the one deployable spawned as its own process on loopback in test mode
// (tests/support/process.ts) against this ticket's Postgres with fixture set slice1-synthetic@1 loaded; every
// request goes over HTTP with a session cookie obtained from POST /auth/fixture/sign-in, never a fabricated one.
// Proves A01 (and the upload half of W0-08) for the package exit. Fixture ids: fx-user-owner-cm (owns every
// fixture case), fx-user-owner-cm-2 (owns none), fx-user-spoc-cm (BU CM), fx-user-dpo, fx-user-ai-coe,
// fx-user-it-security, fx-user-admin; cases fx-case-nonvendor (RAI-2000-0001, CM) and fx-case-vendor
// (RAI-2000-0002, HR); documents fx-doc-0001-01 and fx-doc-0002-01.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { findFixtureDocument } from '@rai/fixtures/data/documents/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { readEnv } from '@rai/server/config';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import {
  RAI_WEB_ROOT,
  freeLoopbackPort,
  startTestServer,
  testServerEnv,
  type TestServerProcess,
} from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, firstCookie } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const BLOB_DIR = path.join(RAI_WEB_ROOT, '.local', 'test', 'blobs'); // what tests/support/process.ts hands the server

const OWNER = 'fx-user-owner-cm';
const OTHER_OWNER = 'fx-user-owner-cm-2';
const SPOC_CM = 'fx-user-spoc-cm';
const REVIEWERS_AND_ADMIN = [
  'fx-user-dpo',
  'fx-user-ai-coe',
  'fx-user-it-security',
  'fx-user-admin',
] as const;

const CM_CASE = findFixtureCase('fx-case-nonvendor')!; // RAI-2000-0001, BU CM, owner fx-user-owner-cm
const HR_CASE = findFixtureCase('fx-case-vendor')!; // RAI-2000-0002, BU HR, owner fx-user-owner-cm
const CM_DOC = findFixtureDocument('fx-doc-0001-01')!;
const HR_DOC = findFixtureDocument('fx-doc-0002-01')!;

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: Record<string, unknown> };
}
interface Session {
  cookie: string;
}

let db: TestDatabase;
let outputDir: string;
let server: TestServerProcess;

before(async () => {
  db = await openTestDatabase();
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-int-negatives-'));
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await rm(path.join(BLOB_DIR, 'sha256'), { recursive: true, force: true });
  await loadFixtures(db.operator, { nodeEnv: 'test', identityMode: 'fixture', blobDir: BLOB_DIR, outputDir });
  server = await startTestServer();
});
after(async () => {
  await server.stop();
  await db.close();
  await rm(outputDir, { recursive: true, force: true });
});

async function signIn(fixtureUserId: string): Promise<Session> {
  const res = await fetch(`${server.baseUrl}${FIXTURE_SIGN_IN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ fixtureUserId }),
  });
  assert.equal(res.status, 200, await res.text());
  const cookie = firstCookie(res.headers.get('set-cookie') ?? undefined);
  assert.ok(cookie !== undefined, 'no session cookie');
  return { cookie };
}

function headersFor(
  session: Session | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...(session === undefined ? {} : { cookie: session.cookie }),
    'sec-fetch-site': 'same-origin',
    ...extra,
  };
}

async function call(
  session: Session | undefined,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: headersFor(session, {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

async function upload(session: Session | undefined, caseId: string, filename: string, bytes: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename);
  const res = await fetch(`${server.baseUrl}/api/cases/${caseId}/artifacts`, {
    method: 'POST',
    headers: headersFor(session),
    body: form,
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

/** The W0-06 8.2 envelope for a refusal: the code, the key, the correlation id, and nothing of the target. */
function assertRefused(
  r: { status: number; text: string; headers: Headers },
  status: 401 | 403 | 404,
  code: 'unauthenticated' | 'forbidden' | 'not_found',
  label: string,
): Envelope {
  assert.equal(r.status, status, `${label}: ${r.status} ${r.text}`);
  const body = JSON.parse(r.text) as Envelope;
  assert.equal(body.error.code, code, label);
  assert.equal(body.error.messageKey, `error.${code}`, label);
  assert.equal(body.error.correlationId, r.headers.get('x-correlation-id'), label);
  assert.deepEqual(Object.keys(body), ['error'], `${label}: the envelope carries nothing else`);
  for (const secret of [CM_CASE.useCaseName, HR_CASE.useCaseName, CM_DOC.filename, HR_DOC.filename])
    assert.ok(!r.text.includes(secret), `${label}: nothing of the case or its documents leaks`);
  return body;
}

const draftWrite = (versionId: string) => ({
  expectedVersion: { versionId, revision: 1 },
  slots: { 8: { state: 'not_yet' } },
});

async function artifactCount(caseId: string): Promise<number> {
  const r = await db.owner.execute(sql`SELECT count(*)::int AS n FROM artifact WHERE case_id = ${caseId}`);
  return (r.rows[0] as { n: number }).n;
}

describe(`W1-INT exit negatives (A01) over HTTP against the real server process — ${SET}`, () => {
  it('no session: the API and a direct artifact URL (a copied link) answer 401 with the envelope; no bytes are served', async () => {
    assertRefused(await call(undefined, 'GET', '/api/cases'), 401, 'unauthenticated', 'list');
    assertRefused(
      await call(undefined, 'GET', `/api/cases/${CM_CASE.caseId}`),
      401,
      'unauthenticated',
      'read',
    );
    assertRefused(
      await call(undefined, 'POST', '/api/cases', { useCaseName: 'x' }),
      401,
      'unauthenticated',
      'create',
    );
    const direct = await call(undefined, 'GET', `/api/artifacts/${CM_DOC.artifactId}`);
    assertRefused(direct, 401, 'unauthenticated', 'direct artifact URL');
    assert.equal(direct.headers.get('content-disposition'), null);
    assert.match(direct.headers.get('content-type') ?? '', /application\/json/);
    assertRefused(
      await call(undefined, 'GET', `/api/artifacts/${CM_DOC.artifactId}/meta`),
      401,
      'unauthenticated',
      'artifact meta',
    );
    assertRefused(
      await upload(undefined, CM_CASE.caseId, 'x.pdf', Buffer.from('%PDF-1.4\n%%EOF\n')),
      401,
      'unauthenticated',
      'upload',
    );
    // A cookie that names no session is the same 401 (never a 500, never a hint).
    const forged = await fetch(`${server.baseUrl}/api/artifacts/${CM_DOC.artifactId}`, {
      headers: headersFor({ cookie: `rai_session=${randomUUID()}` }),
    });
    assertRefused(
      { status: forged.status, text: await forged.text(), headers: forged.headers },
      401,
      'unauthenticated',
      'forged cookie',
    );
  });

  it('wrong role: each reviewer and the Admin can read a case but is 403 on create, draft write, upload and submit (W0-05 role rows)', async () => {
    for (const fixtureUserId of REVIEWERS_AND_ADMIN) {
      const session = await signIn(fixtureUserId);
      const read = await call(session, 'GET', `/api/cases/${CM_CASE.caseId}`);
      assert.equal(read.status, 200, `${fixtureUserId}: reads every case (all_cases scope)`);
      assertRefused(
        await call(session, 'POST', '/api/cases', {
          useCaseName: 'Reviewer attempt',
          businessUnitId: 'CM',
          businessUnit: 'Consumer Mobile',
          businessOwner: 'fixture:fx-user-owner-cm',
          technicalOwner: 'x',
          sourceRecordId: { kind: 'unknown' },
          useCaseGroup: 'customer-analytics',
          vendorInvolved: false,
          modelType: 'other',
        }),
        403,
        'forbidden',
        `${fixtureUserId} create`,
      );
      assertRefused(
        await call(session, 'PUT', `/api/cases/${CM_CASE.caseId}/draft`, draftWrite(CM_CASE.draftVersionId)),
        403,
        'forbidden',
        `${fixtureUserId} draft write`,
      );
      assertRefused(
        await upload(session, CM_CASE.caseId, 'x.pdf', Buffer.from('%PDF-1.4\n%%EOF\n')),
        403,
        'forbidden',
        `${fixtureUserId} upload`,
      );
      assertRefused(
        await call(session, 'POST', `/api/cases/${CM_CASE.caseId}/draft/submit`, {
          expectedVersion: { versionId: CM_CASE.draftVersionId, revision: 1 },
        }),
        403,
        'forbidden',
        `${fixtureUserId} submit`,
      );
    }
    // Nothing changed: the CM case still holds its open draft and no version.
    const row = (
      await db.owner.execute(
        sql`SELECT draft_version_id, current_version_id FROM "case" WHERE id = ${CM_CASE.caseId}`,
      )
    ).rows[0] as { draft_version_id: string; current_version_id: string | null };
    assert.deepEqual(row, { draft_version_id: CM_CASE.draftVersionId, current_version_id: null });
    assert.equal(server.linesFor('authz.denied').length >= REVIEWERS_AND_ADMIN.length * 4, true);
  });

  it('other BU: the CM SPOC is 403 on an HR case for read, draft, write, upload, submit, versions and its artifact, and the HR cases are absent from its list; the owner of nothing sees nothing', async () => {
    const spoc = await signIn(SPOC_CM);
    const list = await call(spoc, 'GET', '/api/cases?pageSize=100');
    assert.equal(list.status, 200, list.text);
    const listed = (JSON.parse(list.text) as CaseListResponse).items.map((c) => c.registryId).sort();
    assert.deepEqual(listed, ['RAI-2000-0001', 'RAI-2000-0003'], 'only the CM cases');
    assert.ok(!list.text.includes(HR_CASE.useCaseName), 'nothing of an HR case in the list body');
    assert.equal((await call(spoc, 'GET', `/api/cases/${CM_CASE.caseId}`)).status, 200, 'in scope: CM');

    assertRefused(await call(spoc, 'GET', `/api/cases/${HR_CASE.caseId}`), 403, 'forbidden', 'HR read');
    assertRefused(
      await call(spoc, 'GET', `/api/cases/${HR_CASE.caseId}/draft`),
      403,
      'forbidden',
      'HR draft read',
    );
    assertRefused(
      await call(spoc, 'PUT', `/api/cases/${HR_CASE.caseId}/draft`, draftWrite(HR_CASE.draftVersionId)),
      403,
      'forbidden',
      'HR draft write',
    );
    assertRefused(
      await upload(spoc, HR_CASE.caseId, 'x.pdf', Buffer.from('%PDF-1.4\n%%EOF\n')),
      403,
      'forbidden',
      'HR upload',
    );
    assertRefused(
      await call(spoc, 'POST', `/api/cases/${HR_CASE.caseId}/draft/submit`, {
        expectedVersion: { versionId: HR_CASE.draftVersionId, revision: 1 },
      }),
      403,
      'forbidden',
      'HR submit',
    );
    assertRefused(
      await call(spoc, 'GET', `/api/cases/${HR_CASE.caseId}/versions`),
      403,
      'forbidden',
      'HR versions',
    );
    assertRefused(
      await call(spoc, 'GET', `/api/cases/${HR_CASE.caseId}/versions/latest`),
      403,
      'forbidden',
      'HR latest',
    );
    const direct = await call(spoc, 'GET', `/api/artifacts/${HR_DOC.artifactId}`);
    assertRefused(direct, 403, 'forbidden', 'HR artifact by direct URL');
    assert.equal(direct.headers.get('content-disposition'), null);
    assertRefused(
      await call(spoc, 'GET', `/api/artifacts/${HR_DOC.artifactId}/meta`),
      403,
      'forbidden',
      'HR meta',
    );
    assert.equal(
      (await call(spoc, 'GET', `/api/artifacts/${CM_DOC.artifactId}/meta`)).status,
      200,
      'CM meta',
    );

    const other = await signIn(OTHER_OWNER);
    const empty = await call(other, 'GET', '/api/cases?pageSize=100');
    assert.equal(empty.status, 200);
    assert.deepEqual((JSON.parse(empty.text) as CaseListResponse).items, []);
    for (const c of [CM_CASE, HR_CASE]) {
      assertRefused(
        await call(other, 'GET', `/api/cases/${c.caseId}`),
        403,
        'forbidden',
        `owner-2 read ${c.registryId}`,
      );
      assertRefused(
        await call(other, 'PUT', `/api/cases/${c.caseId}/draft`, draftWrite(c.draftVersionId)),
        403,
        'forbidden',
        `owner-2 write ${c.registryId}`,
      );
      assertRefused(
        await upload(other, c.caseId, 'x.pdf', Buffer.from('%PDF-1.4\n%%EOF\n')),
        403,
        'forbidden',
        `owner-2 upload ${c.registryId}`,
      );
    }
    assertRefused(
      await call(other, 'GET', `/api/artifacts/${CM_DOC.artifactId}`),
      403,
      'forbidden',
      'owner-2 artifact',
    );
    // An id that exists nowhere is 404 only for an all-cases actor (W0-05 T33); for a scoped actor it is the same
    // 403 as an out-of-scope case, so probing ids reveals nothing.
    const nowhere = '00000000-0000-4000-8000-000000000000';
    assertRefused(await call(other, 'GET', `/api/cases/${nowhere}`), 403, 'forbidden', 'owner-2 unknown id');
    assertRefused(await call(spoc, 'GET', `/api/cases/${nowhere}`), 403, 'forbidden', 'spoc unknown id');
    assertRefused(
      await call(await signIn('fx-user-dpo'), 'GET', `/api/cases/${nowhere}`),
      404,
      'not_found',
      'reviewer unknown id',
    );
  });

  it('unsafe upload: a disguised executable is refused 422 unsafe_upload (type_not_allowed), nothing is stored, the filename is not echoed', async () => {
    const owner = await signIn(OWNER);
    const before = await artifactCount(CM_CASE.caseId);
    const rejectedBefore = server.linesFor('upload.rejected').length;
    const disguised = [
      {
        name: 'PE stub as report.pdf',
        filename: 'report.pdf',
        bytes: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4094)]),
      },
      {
        name: 'ELF stub as report.docx',
        filename: 'report.docx',
        bytes: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)]),
      },
      { name: 'shell script as notes.pdf', filename: 'notes.pdf', bytes: Buffer.from('#!/bin/sh\nexit 0\n') },
    ];
    for (const row of disguised) {
      const res = await upload(owner, CM_CASE.caseId, row.filename, row.bytes);
      assert.equal(res.status, 422, `${row.name}: ${res.status} ${res.text}`);
      const body = JSON.parse(res.text) as Envelope;
      assert.equal(body.error.code, 'unsafe_upload', row.name);
      assert.equal(body.error.messageKey, 'error.unsafe_upload', row.name);
      assert.equal(body.error.details?.reasonKey, 'error.unsafe_upload.type_not_allowed', row.name);
      assert.ok(!res.text.includes(row.filename), `${row.name}: the filename is not echoed`);
    }
    assert.equal(await artifactCount(CM_CASE.caseId), before, 'no artifact row');
    assert.equal(server.linesFor('upload.rejected').length, rejectedBefore + disguised.length);
    for (const line of server.linesFor('upload.rejected').slice(rejectedBefore)) {
      assert.equal((line.fields as { reason?: string }).reason, 'type_not_allowed');
      assert.ok(
        !JSON.stringify(line).includes('.pdf') && !JSON.stringify(line).includes('.docx'),
        'no filename in the log',
      );
    }
    // The same route accepts a genuine document from the same actor: the refusal is about the bytes.
    const ok = await upload(
      owner,
      CM_CASE.caseId,
      'genuine.pdf',
      Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n'),
    );
    assert.equal(ok.status, 201, ok.text);
    assert.equal(await artifactCount(CM_CASE.caseId), before + 1);
  });
});

/** Runs main.ts with `env` to exit and returns its exit code and streams (a refusal never listens). */
function runToExit(
  env: Record<string, string>,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
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
}

describe('W1-INT exit negatives: local-google fails closed (W0-03 S1, S2; exit 78, never listening)', () => {
  it('a non-loopback bind and an unknown mode each exit 78 with the reason code before any port is bound', async () => {
    const port = await freeLoopbackPort();
    const shell = readEnv();
    const google = {
      ...testServerEnv(port),
      PATH: shell.PATH ?? '',
      HOME: shell.HOME ?? '',
      NODE_ENV: 'development',
      RAI_IDENTITY_MODE: 'local-google',
      RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
      RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
    };
    const cases: { name: string; env: Record<string, string>; reason: string }[] = [
      { name: 'non-loopback bind', env: { ...google, HOST: '0.0.0.0' }, reason: 'bind_not_loopback' },
      {
        name: 'non-loopback public base URL',
        env: { ...google, PUBLIC_BASE_URL: `http://10.0.0.5:${port}` },
        reason: 'base_url_not_loopback', // W0-03 S3, the adapter's finer code
      },
      { name: 'unknown mode', env: { ...google, RAI_IDENTITY_MODE: 'google' }, reason: 'mode_unknown' },
      { name: 'missing mode', env: { ...google, RAI_IDENTITY_MODE: '' }, reason: 'mode_unknown' },
    ];
    for (const c of cases) {
      const r = await runToExit(c.env);
      assert.equal(r.code, 78, `${c.name}: exit ${r.code}\n${r.stderr}`);
      const last = r.stderr.trim().split('\n').at(-1) ?? '';
      assert.deepEqual(JSON.parse(last), { event: 'process.refused', reason: c.reason }, c.name);
      assert.ok(!r.stdout.includes('process.started'), `${c.name}: never started`);
      const probe = await fetch(`http://127.0.0.1:${port}/api/session`).catch(() => undefined);
      assert.equal(probe, undefined, `${c.name}: nothing listens`);
    }
  });
});
