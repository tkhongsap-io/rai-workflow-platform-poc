// W1-03 Done when, against the real Postgres and a real BLOB_DIR through the W0-02 7.4 routes: a permitted file
// uploads and its hash is recorded; an executable disguised by extension is rejected with unsafe_upload; a direct
// file URL without an authorized session is refused (A01, T12); downloaded bytes match the stored hash (A07); a
// Thai filename round-trips unchanged. Plus the W0-05 rows that name W1-03 (T10, T11, T33), the W0-08 section 4
// checks 3 and 5 (no open draft, per-file boundary), the section 3 request rules (one `file` part, nothing else),
// dedupe of identical bytes (W0-04), the audit and log shapes (W0-08 5.1, W0-10 3.3) and the operator commands.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { FixtureSession } from '../support/sign-in.js';
import { auditStore } from '@rai/server/audit/store';
import { keyPathFor } from '@rai/server/artifacts/blob-store';
import { filenameFromContentDisposition } from '@rai/server/artifacts/filename';
import { verifyStore } from '@rai/server/operator/store-verify';
import { FIXTURE_CASES } from '@rai/fixtures/data/cases/index';
import { THAI_NAMED_FIXTURE_DOCUMENT_ID, findFixtureDocument } from '@rai/fixtures/data/documents/index';
import { readManifest, fixtureSetLabel } from '@rai/fixtures/manifest';
import {
  LIMITS,
  fixtureBaseDocuments,
  fixtureDocumentBytes,
  multipart,
  objectCount,
  openHarness,
  pdfOfExactSize,
  sha256,
  signIn,
  upload,
  type Harness,
} from './w1-03-helpers.js';

const SET = fixtureSetLabel(readManifest());
const CASE_CM = FIXTURE_CASES.find((c) => c.fixtureCaseId === 'fx-case-nonvendor')!;
const CASE_HR = FIXTURE_CASES.find((c) => c.fixtureCaseId === 'fx-case-vendor')!;
const THAI_NAME = 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf';

let h: Harness;
const base = fixtureBaseDocuments();

before(async () => {
  h = await openHarness();
});
beforeEach(async () => {
  await h.reload();
});
after(async () => {
  await h.close();
});

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: Record<string, unknown> };
}

async function auditRows(action?: string) {
  const rows = await auditStore.read(h.db.app, {});
  return action === undefined ? rows : rows.filter((r) => r.action === action);
}
async function artifactCount(): Promise<number> {
  const r = await h.db.owner.execute(sql`SELECT count(*)::int AS n FROM artifact`);
  return (r.rows[0] as { n: number }).n;
}
const withUser = (s: { cookie: string }) => ({ cookie: s.cookie, 'sec-fetch-site': 'same-origin' });

test(`${SET}: a permitted file uploads as owner and its SHA-256 is recorded on the row, the blob key and the audit event`, async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const objectsBefore = await objectCount(h.blobDir);
  const res = await upload(h.app, owner, CASE_CM.caseId, 'RiskScreening_v2.pdf', base.pdf, 'application/pdf');
  assert.equal(res.statusCode, 201, res.body);
  const ref = res.json<ArtifactRef>();
  const hash = sha256(base.pdf);
  assert.equal(ref.sha256, hash, 'the hash of the bytes is the recorded hash');
  assert.equal(ref.caseId, CASE_CM.caseId);
  assert.equal(ref.filename, 'RiskScreening_v2.pdf');
  assert.equal(ref.mediaType, 'application/pdf');
  assert.equal(ref.sizeBytes, base.pdf.length);
  assert.equal(ref.uploadedBy, 'fixture:fx-user-owner-cm');
  assert.match(ref.artifactId, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['cache-control'], 'no-store');

  const row = await h.db.owner.execute(sql`SELECT * FROM artifact WHERE id = ${ref.artifactId}`);
  const stored = row.rows[0] as Record<string, unknown>;
  assert.equal(stored.content_hash, hash);
  assert.equal(stored.media_type, 'application/pdf');
  assert.equal(stored.uploaded_role, 'owner');
  assert.equal(stored.case_id, CASE_CM.caseId);
  assert.equal(stored.correlation_id, res.headers['x-correlation-id']);
  assert.equal(stored.bytes_state, 'present');

  const file = keyPathFor(h.blobDir, hash);
  assert.deepEqual(await readFile(file), base.pdf, 'the object under the hash holds the bytes');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await objectCount(h.blobDir), objectsBefore + 1);
  assert.deepEqual(await readdir(h.store.tmpDir), [], 'no temp file remains');

  const events = await auditRows('artifact.uploaded');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.actorSubjectId, 'fixture:fx-user-owner-cm');
  assert.equal(events[0]!.actorRole, 'owner');
  assert.equal(events[0]!.targetCaseId, CASE_CM.caseId);
  assert.equal(events[0]!.targetVersionId, CASE_CM.draftVersionId);
  assert.equal(events[0]!.correlationId, res.headers['x-correlation-id']);
  assert.deepEqual(events[0]!.targetRef, {
    artifact_id: ref.artifactId,
    content_hash: hash,
    size_bytes: base.pdf.length,
    deduplicated: false,
  });
  assert.ok(!JSON.stringify(events).includes('RiskScreening_v2'), 'the filename is never an audit ref');

  const stored_lines = h.linesFor('upload.stored');
  assert.equal(stored_lines.length, 1);
  assert.deepEqual(stored_lines[0]!.fields, {
    caseId: CASE_CM.caseId,
    artifactId: ref.artifactId,
    contentHash: hash,
    sizeBytes: base.pdf.length,
    mediaType: 'application/pdf',
  });
  assert.equal(stored_lines[0]!.correlationId, res.headers['x-correlation-id']);
  assert.equal(h.linesFor('upload.rejected').length, 0);
});

test('every fixture kind uploads under its own extension with the sniffed media type, whatever the part Content-Type says', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const rows: [string, Buffer, string][] = [
    ['BRD_v1.docx', base.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['Checklist.XLSX', base.xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['Diagram.png', base.png, 'image/png'],
    ['Photo.jpg', base.jpeg, 'image/jpeg'],
    ['Photo2.jpeg', base.jpeg, 'image/jpeg'],
  ];
  for (const [name, bytes, mediaType] of rows) {
    const res = await upload(h.app, owner, CASE_CM.caseId, name, bytes, 'application/pdf'); // a lying part header
    assert.equal(res.statusCode, 201, `${name}: ${res.body}`);
    assert.equal(res.json<ArtifactRef>().mediaType, mediaType, name);
  }
});

test('an executable disguised by extension is rejected with unsafe_upload type_not_allowed: nothing stored, no audit row, one upload.rejected line without the filename', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const before = {
    artifacts: await artifactCount(),
    objects: await objectCount(h.blobDir),
    audit: (await auditRows()).length,
  };
  const pe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4094)]);
  const res = await upload(h.app, owner, CASE_CM.caseId, 'quarterly_report.pdf', pe, 'application/pdf');
  assert.equal(res.statusCode, 422, res.body);
  const body = res.json<Envelope>();
  assert.equal(body.error.code, 'unsafe_upload');
  assert.equal(body.error.messageKey, 'error.unsafe_upload');
  assert.equal(body.error.correlationId, res.headers['x-correlation-id']);
  assert.deepEqual(body.error.details, { reasonKey: 'error.unsafe_upload.type_not_allowed' });
  assert.ok(!res.body.includes('quarterly_report'), 'the filename is not echoed');
  assert.ok(!res.body.includes('MZ'), 'the bytes are not echoed');

  assert.equal(await artifactCount(), before.artifacts, 'no artifact row');
  assert.equal(await objectCount(h.blobDir), before.objects, 'no object written');
  assert.deepEqual(await readdir(h.store.tmpDir), [], 'the temp file was unlinked');
  assert.equal((await auditRows()).length, before.audit, 'a rejection writes no audit event (W0-08 5.1)');
  const rejected = h.linesFor('upload.rejected');
  assert.equal(rejected.length, 1);
  assert.deepEqual(rejected[0]!.fields, {
    caseId: CASE_CM.caseId,
    reason: 'type_not_allowed',
    declaredMediaType: 'application/pdf',
    sizeBytes: pe.length,
  });
  assert.equal(rejected[0]!.correlationId, res.headers['x-correlation-id']);
  assert.ok(!rejected[0]!.raw.includes('quarterly_report'), 'the log line never carries the filename');
  assert.ok(!rejected[0]!.raw.includes(sha256(pe)), 'nor the hash of rejected bytes');
  assert.equal(h.linesFor('upload.stored').length, 0);

  // A permitted document renamed under another permitted extension is type_mismatch, and the sniffed type is logged.
  const renamed = await upload(h.app, owner, CASE_CM.caseId, 'diagram.pdf', base.png);
  assert.equal(renamed.statusCode, 422);
  assert.deepEqual(renamed.json<Envelope>().error.details, {
    reasonKey: 'error.unsafe_upload.type_mismatch',
  });
  assert.deepEqual(h.linesFor('upload.rejected')[1]!.fields, {
    caseId: CASE_CM.caseId,
    reason: 'type_mismatch',
    sniffedMediaType: 'image/png',
    declaredMediaType: 'application/pdf',
    sizeBytes: base.png.length,
  });
});

test('T12 / A01: a direct file URL without a session is 401 on the bytes, the metadata and the upload; the blob directory is not routable', async () => {
  const doc = findFixtureDocument('fx-doc-0001-01')!;
  const artifactUrl = `/api/artifacts/${doc.artifactId}`;
  for (const url of [artifactUrl, `${artifactUrl}/meta`]) {
    for (const headers of [{}, { cookie: 'rai_session=forged' }]) {
      const res = await h.app.inject({ method: 'GET', url, headers });
      assert.equal(res.statusCode, 401, url);
      const body = res.json<Envelope>();
      assert.deepEqual(Object.keys(body.error).sort(), ['code', 'correlationId', 'messageKey']);
      assert.equal(body.error.code, 'unauthenticated');
      assert.equal(body.error.messageKey, 'error.unauthenticated');
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.ok(!res.body.includes(doc.filename), 'nothing about the artifact leaks');
    }
  }
  const up = await upload(h.app, undefined, CASE_CM.caseId, 'a.pdf', base.pdf);
  assert.equal(up.statusCode, 401);
  assert.equal(up.json<Envelope>().error.code, 'unauthenticated');
  assert.equal((await auditRows('artifact.downloaded')).length, 0);
  assert.equal((await auditRows('artifact.uploaded')).length, 0);
  assert.equal(h.linesFor('authz.denied').length, 0, 'a 401 never reaches authorize');

  const hash = sha256(fixtureDocumentBytes('fx-doc-0001-01'));
  for (const url of [
    `/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
    `/.local/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
    `/api/blobs/${hash}`,
    `/api/artifacts/${hash}`,
  ]) {
    const res = await h.app.inject({ method: 'GET', url });
    assert.ok(res.statusCode === 404 || res.statusCode === 401, `${url}: ${res.statusCode}`);
    assert.notEqual(res.body.slice(0, 5), '%PDF-', 'no bytes are ever served by hash or path');
  }
});

test('A07: downloaded bytes match the stored hash; headers are the W0-08 section 6 set; audit artifact.downloaded', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const uploaded = await upload(
    h.app,
    owner,
    CASE_CM.caseId,
    'Architecture_v2.pdf',
    base.pdf,
    'application/pdf',
  );
  assert.equal(uploaded.statusCode, 201);
  const ref = uploaded.json<ArtifactRef>();

  const res = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${ref.artifactId}`,
    headers: withUser(owner),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(sha256(res.rawPayload), ref.sha256, 'bytes hash to the recorded hash');
  assert.deepEqual(res.rawPayload, base.pdf);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.headers['content-length'], String(base.pdf.length));
  assert.equal(
    res.headers['content-disposition'],
    `attachment; filename="Architecture_v2.pdf"; filename*=UTF-8''Architecture_v2.pdf`,
  );
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-security-policy'], 'sandbox');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');

  const meta = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${ref.artifactId}/meta`,
    headers: withUser(owner),
  });
  assert.equal(meta.statusCode, 200);
  assert.deepEqual(meta.json(), ref);

  const events = await auditRows('artifact.downloaded');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.actorSubjectId, 'fixture:fx-user-owner-cm');
  assert.equal(events[0]!.actorRole, 'owner');
  assert.equal(events[0]!.targetCaseId, CASE_CM.caseId);
  assert.deepEqual(events[0]!.targetRef, { artifact_id: ref.artifactId });
  assert.equal(events[0]!.correlationId, res.headers['x-correlation-id']);

  // The fixture set's medium PDF (about 2 MiB) streams intact for a reviewer, and store:verify agrees with the rows.
  const dpo = await signIn(h.app, 'fx-user-dpo');
  const medium = findFixtureDocument('fx-doc-0002-03')!;
  const big = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${medium.artifactId}`,
    headers: withUser(dpo),
  });
  assert.equal(big.statusCode, 200);
  assert.equal(sha256(big.rawPayload), sha256(fixtureDocumentBytes('fx-doc-0002-03')));
  assert.equal(big.rawPayload.length, Number(big.headers['content-length']));
  const report = await verifyStore(h.db.urls.operator, h.blobDir);
  assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
  assert.equal(report.ok, report.referenced);
  assert.ok(report.referenced >= 33);
});

test('a Thai filename round-trips unchanged through upload, metadata and the download header; NFD input is stored NFC', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  assert.equal(THAI_NAME, THAI_NAME.normalize('NFC'));
  assert.equal(Array.from(THAI_NAME).length, 34);
  const res = await upload(h.app, owner, CASE_CM.caseId, THAI_NAME, base.pdf, 'application/pdf');
  assert.equal(res.statusCode, 201, res.body);
  const ref = res.json<ArtifactRef>();
  assert.equal(ref.filename, THAI_NAME);
  const row = await h.db.owner.execute(sql`SELECT filename FROM artifact WHERE id = ${ref.artifactId}`);
  assert.equal((row.rows[0] as { filename: string }).filename, THAI_NAME);
  const meta = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${ref.artifactId}/meta`,
    headers: withUser(owner),
  });
  assert.equal(meta.json<ArtifactRef>().filename, THAI_NAME);
  const dl = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${ref.artifactId}`,
    headers: withUser(owner),
  });
  assert.equal(dl.statusCode, 200);
  const disposition = String(dl.headers['content-disposition']);
  assert.ok(disposition.startsWith('attachment; filename="'), disposition);
  assert.ok(disposition.includes("filename*=UTF-8''%E0%B9%80%E0%B8%AD"), disposition);
  assert.equal(
    filenameFromContentDisposition(disposition),
    THAI_NAME,
    'RFC 8187 decodes to the same code points',
  );
  assert.ok(/^[\x20-\x7e]+$/.test(disposition), 'the header itself is ASCII');

  // The fixture set's own Thai-named file (fx-doc-0002-09, W0-08 8.4) downloads with its name intact for a reviewer.
  const dpo = await signIn(h.app, 'fx-user-dpo');
  const thaiDoc = findFixtureDocument(THAI_NAMED_FIXTURE_DOCUMENT_ID)!;
  const fx = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${thaiDoc.artifactId}`,
    headers: withUser(dpo),
  });
  assert.equal(fx.statusCode, 200);
  assert.equal(filenameFromContentDisposition(String(fx.headers['content-disposition'])), thaiDoc.filename);
  assert.equal(sha256(fx.rawPayload), sha256(fixtureDocumentBytes(THAI_NAMED_FIXTURE_DOCUMENT_ID)));

  const nfd = 'Résumé_ผู้ให้บริการ.pdf'.normalize('NFD');
  const nfc = nfd.normalize('NFC');
  assert.notEqual(nfd, nfc);
  const res2 = await upload(h.app, owner, CASE_CM.caseId, nfd, base.pdf);
  assert.equal(res2.statusCode, 201);
  assert.equal(res2.json<ArtifactRef>().filename, nfc);
});

test('T10: reviewers and Admin hold no artifact.upload row: 403 role on any case, no bytes stored, one authz.denied line each', async () => {
  const before = await objectCount(h.blobDir);
  for (const user of ['fx-user-dpo', 'fx-user-ai-coe', 'fx-user-it-security', 'fx-user-admin']) {
    const session = await signIn(h.app, user);
    const res = await upload(h.app, session, CASE_CM.caseId, 'a.pdf', base.pdf, 'application/pdf');
    assert.equal(res.statusCode, 403, `${user}: ${res.body}`);
    const body = res.json<Envelope>();
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'correlationId', 'messageKey']);
    assert.equal(body.error.code, 'forbidden');
    const denied = h
      .linesFor('authz.denied')
      .filter((l) => l.correlationId === res.headers['x-correlation-id']);
    assert.equal(denied.length, 1, user);
    assert.equal(denied[0]!.fields?.reason, 'role');
    assert.equal(denied[0]!.fields?.action, 'artifact.upload');
    assert.equal(denied[0]!.fields?.targetId, CASE_CM.caseId);
  }
  assert.equal(await objectCount(h.blobDir), before);
  assert.equal((await auditRows('artifact.uploaded')).length, 0);
  assert.deepEqual(await readdir(h.store.tmpDir), []);
});

test('T11: another owner and an out-of-BU SPOC are 403 scope on upload and download; in-scope SPOC and the dual-role SPOC upload as bu_spoc; reviewers and Admin download', async () => {
  const doc = findFixtureDocument('fx-doc-0001-01')!; // on the CM case owned by fx-user-owner-cm
  const hrDoc = findFixtureDocument('fx-doc-0002-01')!; // on the HR case
  const ownerB = await signIn(h.app, 'fx-user-owner-cm-2');
  const spocCm = await signIn(h.app, 'fx-user-spoc-cm');
  const dualHr = await signIn(h.app, 'fx-user-dpo-spoc-hr');

  const denials: [string, { cookie: string }, string, Buffer | undefined][] = [
    ['owner-b upload on owner-a case', ownerB, `/api/cases/${CASE_CM.caseId}/artifacts`, base.pdf],
    ['owner-b download on owner-a case', ownerB, `/api/artifacts/${doc.artifactId}`, undefined],
    ['owner-b meta on owner-a case', ownerB, `/api/artifacts/${doc.artifactId}/meta`, undefined],
    ['spoc-cm upload on HR case', spocCm, `/api/cases/${CASE_HR.caseId}/artifacts`, base.pdf],
    ['spoc-cm download on HR case', spocCm, `/api/artifacts/${hrDoc.artifactId}`, undefined],
  ];
  const auditBefore = (await auditRows()).length;
  for (const [label, session, url, bytes] of denials) {
    const res =
      bytes === undefined
        ? await h.app.inject({ method: 'GET', url, headers: withUser(session) })
        : await upload(
            h.app,
            session as FixtureSession,
            url.split('/')[3]!,
            'a.pdf',
            bytes,
            'application/pdf',
          );
    assert.equal(res.statusCode, 403, `${label}: ${res.body}`);
    const body = res.json<Envelope>();
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'correlationId', 'messageKey'], label);
    assert.equal(body.error.code, 'forbidden');
    assert.ok(
      !res.body.includes(doc.filename) && !res.body.includes('Churn'),
      `${label}: no case field leaks`,
    );
    const denied = h
      .linesFor('authz.denied')
      .filter((l) => l.correlationId === res.headers['x-correlation-id']);
    assert.equal(denied.length, 1, label);
    assert.equal(denied[0]!.fields?.reason, 'scope', label);
  }
  assert.equal((await auditRows()).length, auditBefore, 'denials write no audit row');
  assert.equal((await auditRows('artifact.uploaded')).length, 0);

  const bySpoc = await upload(h.app, spocCm, CASE_CM.caseId, 'spoc.pdf', base.pdf, 'application/pdf');
  assert.equal(bySpoc.statusCode, 201, bySpoc.body);
  assert.equal(bySpoc.json<ArtifactRef>().uploadedBy, 'fixture:fx-user-spoc-cm');
  const byDual = await upload(h.app, dualHr, CASE_HR.caseId, 'dual.pdf', base.pdf, 'application/pdf');
  assert.equal(byDual.statusCode, 201, byDual.body);
  const uploads = await auditRows('artifact.uploaded');
  assert.deepEqual(
    uploads.map((e) => [e.actorSubjectId, e.actorRole]),
    [
      ['fixture:fx-user-spoc-cm', 'bu_spoc'],
      ['fixture:fx-user-dpo-spoc-hr', 'bu_spoc'],
    ],
    'the SPOC is recorded as the actor in the role the row allowed; the dual-role identity acts as bu_spoc, never dpo',
  );
  const dualOnCm = await upload(h.app, dualHr, CASE_CM.caseId, 'dual.pdf', base.pdf, 'application/pdf');
  assert.equal(dualOnCm.statusCode, 403, 'the dual-role identity holds no write row outside HR');

  for (const user of [
    'fx-user-dpo',
    'fx-user-ai-coe',
    'fx-user-it-security',
    'fx-user-admin',
    'fx-user-owner-cm',
    'fx-user-spoc-cm',
  ]) {
    const session = await signIn(h.app, user);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/artifacts/${doc.artifactId}`,
      headers: withUser(session),
    });
    assert.equal(res.statusCode, 200, user);
    assert.equal(sha256(res.rawPayload), sha256(fixtureDocumentBytes('fx-doc-0001-01')));
  }
  const downloads = await auditRows('artifact.downloaded');
  assert.deepEqual(
    downloads.map((e) => e.actorRole),
    ['dpo', 'ai_coe', 'it_security', 'admin', 'owner', 'bu_spoc'],
  );
});

test('T33: an unresolvable artifact or case id is 403 scope for an own/BU-only caller and 404 artifact only for an all_cases holder', async () => {
  const ghostArtifact = randomUUID();
  const ghostCase = randomUUID();
  for (const user of ['fx-user-owner-cm-2', 'fx-user-spoc-cm', 'fx-user-owner-cm']) {
    const session = await signIn(h.app, user);
    for (const url of [`/api/artifacts/${ghostArtifact}`, `/api/artifacts/${ghostArtifact}/meta`]) {
      const res = await h.app.inject({ method: 'GET', url, headers: withUser(session) });
      assert.equal(res.statusCode, 403, `${user} ${url}: ${res.body}`);
      assert.deepEqual(Object.keys(res.json<Envelope>().error).sort(), [
        'code',
        'correlationId',
        'messageKey',
      ]);
      const denied = h
        .linesFor('authz.denied')
        .filter((l) => l.correlationId === res.headers['x-correlation-id']);
      assert.equal(denied.length, 1);
      assert.deepEqual(
        {
          reason: denied[0]!.fields?.reason,
          targetId: denied[0]!.fields?.targetId,
          targetType: denied[0]!.fields?.targetType,
        },
        { reason: 'scope', targetId: ghostArtifact, targetType: 'artifact' },
      );
    }
    const up = await upload(h.app, session, ghostCase, 'a.pdf', base.pdf, 'application/pdf');
    assert.equal(up.statusCode, 403, `${user} upload to a ghost case`);
    assert.equal(up.json<Envelope>().error.code, 'forbidden');
  }
  for (const user of ['fx-user-dpo', 'fx-user-admin']) {
    const session = await signIn(h.app, user);
    for (const url of [`/api/artifacts/${ghostArtifact}`, `/api/artifacts/${ghostArtifact}/meta`]) {
      const res = await h.app.inject({ method: 'GET', url, headers: withUser(session) });
      assert.equal(res.statusCode, 404, `${user} ${url}: ${res.body}`);
      const body = res.json<Envelope>();
      assert.equal(body.error.code, 'not_found');
      assert.deepEqual(body.error.details, { resource: 'artifact' });
      assert.equal(
        h.linesFor('authz.denied').filter((l) => l.correlationId === res.headers['x-correlation-id']).length,
        0,
      );
    }
    const up = await upload(h.app, session, ghostCase, 'a.pdf', base.pdf, 'application/pdf');
    assert.equal(up.statusCode, 403, `${user}: role denies before existence is answered`);
    const denied = h
      .linesFor('authz.denied')
      .filter((l) => l.correlationId === up.headers['x-correlation-id']);
    assert.equal(denied[0]!.fields?.reason, 'role');
  }
  assert.equal((await auditRows('artifact.downloaded')).length, 0);
  assert.equal((await auditRows('artifact.uploaded')).length, 0);
  // A non-UUID id never reaches the database and is treated as unresolved too.
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const odd = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/not-a-uuid`,
    headers: withUser(owner),
  });
  assert.equal(odd.statusCode, 403);
});

test('W0-08 check 3: a case with no open draft answers 422 invalid_input validation.no_open_draft before any byte is stored', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  await h.db.owner.execute(sql`UPDATE "case" SET draft_version_id = NULL WHERE id = ${CASE_CM.caseId}`);
  const before = await objectCount(h.blobDir);
  const res = await upload(h.app, owner, CASE_CM.caseId, 'a.pdf', base.pdf, 'application/pdf');
  assert.equal(res.statusCode, 422, res.body);
  const body = res.json<Envelope>();
  assert.equal(body.error.code, 'invalid_input');
  assert.deepEqual(body.error.details, {
    fields: [{ path: 'caseId', messageKey: 'validation.no_open_draft' }],
  });
  assert.equal(await objectCount(h.blobDir), before);
  assert.deepEqual(await readdir(h.store.tmpDir), []);
  assert.equal((await auditRows('artifact.uploaded')).length, 0);
  assert.equal(h.linesFor('upload.rejected').length, 0, 'not an unsafe upload: no rejection line');
});

test('W0-08 section 3: one part named file and nothing else; a missing part, another name, a non-file field or a non-multipart body is 422 invalid_input', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const before = await objectCount(h.blobDir);
  const cases: [string, { headers: Record<string, string>; payload: Buffer | string }][] = [
    ['no parts', multipart([])],
    ['a field only', multipart([{ name: 'slot', data: '5' }])],
    [
      'a field before the file',
      multipart([
        { name: 'slot', data: '5' },
        { name: 'file', filename: 'a.pdf', data: base.pdf },
      ]),
    ],
    ['the file under another name', multipart([{ name: 'document', filename: 'a.pdf', data: base.pdf }])],
    ['json', { headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ file: 'a.pdf' }) }],
    ['octet-stream', { headers: { 'content-type': 'application/octet-stream' }, payload: base.pdf }],
  ];
  for (const [label, body] of cases) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${CASE_CM.caseId}/artifacts`,
      headers: { ...body.headers, ...withUser(owner) },
      payload: body.payload,
    });
    assert.equal(res.statusCode, 422, `${label}: ${res.statusCode} ${res.body}`);
    assert.equal(res.json<Envelope>().error.code, 'invalid_input', label);
  }
  assert.equal(await objectCount(h.blobDir), before, 'none of them stored anything');
  // A second file part trips limits.files (1); at most the first is stored and the second is never read.
  const two = multipart([
    { name: 'file', filename: 'a.pdf', data: base.pdf },
    { name: 'file', filename: 'b.pdf', data: base.docx },
  ]);
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/cases/${CASE_CM.caseId}/artifacts`,
    headers: { ...two.headers, ...withUser(owner) },
    payload: two.payload,
  });
  assert.ok(res.statusCode === 201 || res.statusCode === 422, `${res.statusCode} ${res.body}`);
  assert.ok((await objectCount(h.blobDir)) - before <= 1);
  assert.equal(await h.store.exists(sha256(base.docx)), false, 'the second file is never stored');
  assert.deepEqual(await readdir(h.store.tmpDir), []);
});

test('identical bytes uploaded twice keep separate metadata rows and share one object (W0-04)', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const before = await objectCount(h.blobDir);
  const first = await upload(h.app, owner, CASE_CM.caseId, 'first.pdf', base.pdf, 'application/pdf');
  const second = await upload(h.app, owner, CASE_CM.caseId, 'second.pdf', base.pdf, 'application/pdf');
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  const a = first.json<ArtifactRef>();
  const b = second.json<ArtifactRef>();
  assert.notEqual(a.artifactId, b.artifactId);
  assert.equal(a.sha256, b.sha256);
  assert.equal(b.filename, 'second.pdf');
  assert.equal(await objectCount(h.blobDir), before + 1, 'one object for two rows');
  const events = await auditRows('artifact.uploaded');
  assert.equal((events[1]!.targetRef as { deduplicated: boolean }).deduplicated, true);
  // A third upload of the same bytes on another case is a separate row bound to that case (case binding).
  const dual = await signIn(h.app, 'fx-user-dpo-spoc-hr');
  const third = await upload(h.app, dual, CASE_HR.caseId, 'third.pdf', base.pdf, 'application/pdf');
  assert.equal(third.statusCode, 201);
  assert.equal(third.json<ArtifactRef>().caseId, CASE_HR.caseId);
  const ownerB = await signIn(h.app, 'fx-user-owner-cm-2');
  const cross = await h.app.inject({
    method: 'GET',
    url: `/api/artifacts/${third.json<ArtifactRef>().artifactId}`,
    headers: withUser(ownerB),
  });
  assert.equal(cross.statusCode, 403, 'the same bytes under another case are still scoped by that case');
});

test('W0-08 8.6 boundary: exactly 25 MiB of valid PDF is accepted; 25 MiB + 1 is too_large with the limit in params and nothing stored', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const max = pdfOfExactSize(LIMITS.maxFileBytes, 'max');
  assert.equal(max.length, 26_214_400);
  const ok = await upload(h.app, owner, CASE_CM.caseId, 'max.pdf', max, 'application/pdf');
  assert.equal(ok.statusCode, 201, ok.body.slice(0, 300));
  assert.equal(ok.json<ArtifactRef>().sizeBytes, 26_214_400);
  assert.equal(ok.json<ArtifactRef>().sha256, sha256(max));

  const before = await objectCount(h.blobDir);
  const over = pdfOfExactSize(LIMITS.maxFileBytes + 1, 'over');
  assert.equal(over.length, 26_214_401);
  const res = await upload(h.app, owner, CASE_CM.caseId, 'max.pdf', over, 'application/pdf');
  assert.equal(res.statusCode, 422, res.body.slice(0, 300));
  const body = res.json<Envelope>();
  assert.equal(body.error.code, 'unsafe_upload');
  assert.deepEqual(body.error.details, {
    reasonKey: 'error.unsafe_upload.too_large',
    params: { max_file_mb: 25 },
  });
  assert.equal(await objectCount(h.blobDir), before);
  assert.deepEqual(await readdir(h.store.tmpDir), []);
  const rejected = h.linesFor('upload.rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]!.fields?.reason, 'too_large');
});

test('store:verify re-hashes every referenced object and fails on a tampered one; store:cleanup removes stale temp files only', async () => {
  const clean = await verifyStore(h.db.urls.operator, h.blobDir);
  assert.equal(clean.failures.length, 0);
  assert.equal(clean.referenced, 33);
  const hash = sha256(fixtureDocumentBytes('fx-doc-0001-01'));
  await writeFile(keyPathFor(h.blobDir, hash), Buffer.from('tampered'), { mode: 0o600 });
  const tampered = await verifyStore(h.db.urls.operator, h.blobDir);
  assert.deepEqual(tampered.failures, [{ hash, reason: 'size_mismatch' }]);
  await writeFile(keyPathFor(h.blobDir, hash), fixtureDocumentBytes('fx-doc-0001-01'), { mode: 0o600 });
  await writeFile(path.join(h.store.tmpDir, 'stale-upload'), 'x');
  assert.equal(await h.store.cleanupTemp(3_600_000, new Date(Date.now() + 7_200_000)), 1);
  assert.deepEqual(await readdir(h.store.tmpDir), []);
});
