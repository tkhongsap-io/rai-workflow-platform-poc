// W1-05 Done when "the case and version reopen unchanged after process restart" — the W0-04 "Restart proof" recipe
// (W0-02 8.1: a spawned process, not app.inject()): start the one deployable in test mode on loopback
// (tests/support/process.ts) → sign in over HTTP → create, upload, attach and submit through the API → record the
// registry id, the current version id, the manifest hash, the frozen rows, the 7.6 bodies and the artifact hash →
// SIGTERM the process and wait for exit 0 → start a new process on the same DATABASE_URL and BLOB_DIR → read the
// case, the version list, the version by id and latest, the rows, and download the artifact → assert equality of
// every recorded value and that the downloaded bytes hash to the stored sha256. Nothing is cached in the process
// (W0-04: no in-memory case cache, no in-process idempotency map): the replay under the original key also survives
// the restart. Fixture set slice1-synthetic@1 (W1-09) for the configuration seed; identities fx-user-owner-cm.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseCreateRequest, CaseView } from '@rai/shared/schemas/cases';
import type { PackDraft, PackDraftUpdateRequest } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion } from '@rai/shared/schemas/versions';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { RAI_WEB_ROOT, startTestServer, type TestServerProcess } from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, firstCookie } from '../support/sign-in.js';
import { fixtureBaseDocuments } from './w1-03-helpers.js';

const SET = fixtureSetLabel(readManifest());
const OWNER_A = 'fx-user-owner-cm';
const BLOB_DIR = path.join(RAI_WEB_ROOT, '.local', 'test', 'blobs'); // what tests/support/process.ts hands the server

let db: TestDatabase;
let outputDir: string;

before(async () => {
  db = await openTestDatabase();
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-05-restart-'));
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await rm(path.join(BLOB_DIR, 'sha256'), { recursive: true, force: true });
  await loadFixtures(db.operator, { nodeEnv: 'test', identityMode: 'fixture', blobDir: BLOB_DIR, outputDir });
});
after(async () => {
  await db.close();
  await rm(outputDir, { recursive: true, force: true });
});

interface Session {
  cookie: string;
}

async function signIn(server: TestServerProcess, fixtureUserId: string): Promise<Session> {
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

function headers(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: session.cookie, 'sec-fetch-site': 'same-origin', ...extra };
}

async function json<T>(
  server: TestServerProcess,
  session: Session,
  url: string,
): Promise<{ status: number; text: string; body: T }> {
  const res = await fetch(`${server.baseUrl}${url}`, { headers: headers(session) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as T };
}

async function post<T>(
  server: TestServerProcess,
  session: Session,
  method: 'POST' | 'PUT',
  url: string,
  body: unknown,
  key?: string,
) {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: headers(session, {
      'content-type': 'application/json',
      ...(key === undefined ? {} : { 'idempotency-key': key }),
    }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: JSON.parse(text) as T,
    correlationId: res.headers.get('x-correlation-id'),
  };
}

type Row = Record<string, unknown>;
async function rows(caseId: string, versionId: string): Promise<{ c: Row; v: Row; s: Row[] }> {
  const c = (await db.owner.execute(sql`SELECT * FROM "case" WHERE id = ${caseId}`)).rows[0] as
    Row | undefined;
  const v = (await db.owner.execute(sql`SELECT * FROM pack_version WHERE id = ${versionId}`)).rows[0] as
    Row | undefined;
  const s = (
    await db.owner.execute(sql`SELECT * FROM artifact_slot WHERE version_id = ${versionId} ORDER BY slot`)
  ).rows as Row[];
  assert.ok(c !== undefined && v !== undefined, 'case and version rows exist');
  assert.equal(s.length, 9);
  return { c, v, s };
}

describe(`W1-05 restart proof (A07) — ${SET}, fx-user-owner-cm`, () => {
  it('create → upload → attach → submit, SIGTERM, a new process on the same database and blob directory: the case and the version reopen unchanged; the artifact downloads with the stored hash; the replay under the original key still answers', async () => {
    const first = await startTestServer();
    let recorded: {
      caseId: string;
      registryId: string;
      versionId: string;
      manifestHash: string;
      sha256: string;
      artifactId: string;
      view: string;
      versionBody: string;
      list: string;
      latest: string;
      submitKey: string;
      submitBody: SubmitRequest;
      db: Awaited<ReturnType<typeof rows>>;
    };
    try {
      const owner = await signIn(first, OWNER_A);
      const created = await post<CaseView>(
        first,
        owner,
        'POST',
        '/api/cases',
        {
          useCaseName: 'ระบบคัดกรองความเสี่ยงเอกสาร (Restart proof)',
          businessUnitId: 'CM',
          businessUnit: 'Consumer Mobile',
          businessOwner: findFixtureUser(OWNER_A)!.subjectId,
          technicalOwner: 'Tanawat P. (synthetic)',
          sourceRecordId: { kind: 'known', value: 'TPM-RESTART-0001' },
          useCaseGroup: 'customer-service',
          vendorInvolved: false,
          modelType: 'classic_ml',
        } satisfies CaseCreateRequest,
        randomUUID(),
      );
      assert.equal(created.status, 201, created.text);
      const caseId = created.body.caseId;

      const pdf = fixtureBaseDocuments().pdf;
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'BRD_restart.pdf');
      const uploaded = await fetch(`${first.baseUrl}/api/cases/${caseId}/artifacts`, {
        method: 'POST',
        headers: headers(owner),
        body: form,
      });
      assert.equal(uploaded.status, 201, await uploaded.clone().text());
      const ref = (await uploaded.json()) as ArtifactRef;
      assert.equal(ref.sha256, createHash('sha256').update(pdf).digest('hex'));

      const draft = await json<PackDraft>(first, owner, `/api/cases/${caseId}/draft`);
      const attached = await post<PackDraft>(first, owner, 'PUT', `/api/cases/${caseId}/draft`, {
        expectedVersion: { versionId: draft.body.draftId, revision: draft.body.draftRevision },
        stageContext: 'pre_build',
        slots: { 5: { state: 'attached', artifactId: ref.artifactId }, 2: { state: 'not_yet' } },
      } satisfies PackDraftUpdateRequest);
      assert.equal(attached.status, 200, attached.text);

      const submitKey = randomUUID();
      const submitBody: SubmitRequest = {
        expectedVersion: { versionId: attached.body.draftId, revision: attached.body.draftRevision },
      };
      const submitted = await post<SubmittedVersion>(
        first,
        owner,
        'POST',
        `/api/cases/${caseId}/draft/submit`,
        submitBody,
        submitKey,
      );
      assert.equal(submitted.status, 201, submitted.text);
      const version = submitted.body;
      assert.equal(version.stageContext, 'pre_build');
      assert.equal(version.laneMappingVersion, 'lane-mapping/v1');
      assert.deepEqual(version.slots[5], { state: 'attached', artifact: ref });

      const view = await json<CaseView>(first, owner, `/api/cases/${caseId}`);
      assert.equal(view.body.currentVersion?.versionId, version.versionId);
      const list = await json(first, owner, `/api/cases/${caseId}/versions`);
      const latest = await json(first, owner, `/api/cases/${caseId}/versions/latest`);
      const byId = await json(first, owner, `/api/cases/${caseId}/versions/${version.versionId}`);
      assert.equal(byId.text, submitted.text);
      const stored = await rows(caseId, version.versionId);
      assert.equal(stored.c.current_version_id, version.versionId);
      assert.equal(stored.c.draft_version_id, null);
      recorded = {
        caseId,
        registryId: view.body.registryId,
        versionId: version.versionId,
        manifestHash: stored.v.manifest_hash as string,
        sha256: ref.sha256,
        artifactId: ref.artifactId,
        view: view.text,
        versionBody: submitted.text,
        list: list.text,
        latest: latest.text,
        submitKey,
        submitBody,
        db: stored,
      };
      assert.match(recorded.manifestHash, /^[0-9a-f]{64}$/);
    } finally {
      const exit = await first.stop(); // SIGTERM → process.stopping → exit 0 (W0-04 graceful shutdown)
      assert.deepEqual(exit, { code: 0, signal: null });
      assert.equal(first.linesFor('process.stopping').length, 1);
    }

    const second = await startTestServer();
    try {
      assert.notEqual(second.pid, first.pid);
      const owner = await signIn(second, OWNER_A); // sessions live in Postgres; a fresh sign-in is the simplest proof of scope
      const view = await json<CaseView>(second, owner, `/api/cases/${recorded.caseId}`);
      assert.equal(view.status, 200, view.text);
      assert.equal(view.text, recorded.view);
      assert.equal(view.body.registryId, recorded.registryId);
      assert.equal(view.body.currentVersion?.versionId, recorded.versionId);
      assert.equal(view.body.draft, null);
      assert.equal(view.body.status, 'in_review');

      const byId = await json(second, owner, `/api/cases/${recorded.caseId}/versions/${recorded.versionId}`);
      assert.equal(byId.status, 200, byId.text);
      assert.equal(byId.text, recorded.versionBody);
      assert.equal(
        (await json(second, owner, `/api/cases/${recorded.caseId}/versions/latest`)).text,
        recorded.latest,
      );
      assert.equal((await json(second, owner, `/api/cases/${recorded.caseId}/versions`)).text, recorded.list);
      assert.equal(recorded.latest, recorded.versionBody);

      const stored = await rows(recorded.caseId, recorded.versionId);
      assert.deepEqual(stored, recorded.db);
      assert.equal(stored.v.manifest_hash, recorded.manifestHash);

      const download = await fetch(`${second.baseUrl}/api/artifacts/${recorded.artifactId}`, {
        headers: headers(owner),
      });
      assert.equal(download.status, 200);
      const bytes = Buffer.from(await download.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), recorded.sha256);
      assert.equal(download.headers.get('content-type'), 'application/pdf');

      // The idempotency record is in Postgres, not in the process: the replay answers the original 201 body.
      const replay = await post<SubmittedVersion>(
        second,
        owner,
        'POST',
        `/api/cases/${recorded.caseId}/draft/submit`,
        recorded.submitBody,
        recorded.submitKey,
      );
      assert.equal(replay.status, 201, replay.text);
      assert.equal(replay.text, recorded.versionBody);
      const fresh = await post(
        second,
        owner,
        'POST',
        `/api/cases/${recorded.caseId}/draft/submit`,
        recorded.submitBody,
        randomUUID(),
      );
      assert.equal(fresh.status, 409, fresh.text);
      const events = (
        await db.owner.execute(
          sql`SELECT count(*)::int AS n FROM audit_event WHERE action = 'version.submitted'`,
        )
      ).rows[0] as { n: number };
      assert.equal(events.n, 1);
    } finally {
      await second.stop();
    }
  });
});
