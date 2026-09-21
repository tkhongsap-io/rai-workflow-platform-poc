// W1-13: W0-02 section 7.4 (upload, download, meta) with the W0-05 rows T11, T12, T33(ii, iii) and the W0-08
// section 4 rows the substitute reproduces (checks 1-8 and 10) with their section 5 reason keys.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { ArtifactRefSchema, type ArtifactRef } from '@rai/shared/schemas/artifacts';
import { findFixtureCase } from '../../data/cases/index.js';
import {
  FIXTURE_DOCUMENTS,
  THAI_NAMED_FIXTURE_DOCUMENT_ID,
  findFixtureDocument,
} from '../../data/documents/index.js';
import { generateDocument } from '../../generate.js';
import { readManifest } from '../../manifest.js';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import { call, multipartFile, signIn, type CallResult } from './testing.js';

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: unknown };
}

const nonvendor = findFixtureCase('fx-case-nonvendor')!;
const vendor = findFixtureCase('fx-case-vendor')!;
const thaiDoc = findFixtureDocument(THAI_NAMED_FIXTURE_DOCUMENT_ID)!;
const manifest = readManifest();

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = generateDocument(findFixtureDocument('fx-doc-0001-09')!);

describe('W1-13 substitute: artifacts (7.4)', () => {
  let substitute: ApiSubstitute;
  const users: Record<string, string> = {};
  beforeEach(async () => {
    substitute = createApiSubstitute({ now: () => new Date('2026-09-22T03:00:00Z') });
    for (const id of [
      'fx-user-owner-cm',
      'fx-user-owner-cm-2',
      'fx-user-spoc-cm',
      'fx-user-dpo',
      'fx-user-admin',
    ])
      users[id] = await signIn(substitute, id);
  });

  function denied(): Array<Record<string, unknown>> {
    return substitute.store.logLines.filter((l) => l.event === 'authz.denied').map((l) => l.fields);
  }

  async function upload(
    user: string,
    caseId: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<CallResult> {
    const { body, contentType } = multipartFile(filename, bytes);
    return call(substitute, 'POST', `/api/cases/${caseId}/artifacts`, {
      cookie: users[user],
      headers: { 'content-type': contentType },
      body,
    });
  }

  it('GET /api/artifacts/{id}/meta answers the ArtifactRef of every fixture document, Thai filename preserved', async () => {
    for (const document of FIXTURE_DOCUMENTS) {
      const response = await call(substitute, 'GET', `/api/artifacts/${document.artifactId}/meta`, {
        cookie: users['fx-user-dpo'],
      });
      assert.equal(response.status, 200, document.fixtureDocumentId);
      const ref = response.json<ArtifactRef>();
      assert.ok(Value.Check(ArtifactRefSchema, ref), JSON.stringify(ref));
      assert.equal(ref.filename, document.filename);
      assert.equal(ref.sha256, manifest.documents[document.fixtureDocumentId]?.sha256);
      assert.equal(ref.sizeBytes, manifest.documents[document.fixtureDocumentId]?.sizeBytes);
      assert.equal(ref.uploadedBy, 'fixture:fx-user-owner-cm');
    }
    const thai = (
      await call(substitute, 'GET', `/api/artifacts/${thaiDoc.artifactId}/meta`, {
        cookie: users['fx-user-owner-cm'],
      })
    ).json<ArtifactRef>();
    assert.equal(thai.filename, 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf');
    assert.equal(thai.caseId, vendor.caseId);
  });

  it('GET /api/artifacts/{id} streams the bytes with the W0-02 7.4 headers; the hash matches the manifest', async () => {
    const response = await call(substitute, 'GET', `/api/artifacts/${thaiDoc.artifactId}`, {
      cookie: users['fx-user-owner-cm'],
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cache-control'], 'no-store');
    const disposition = response.headers['content-disposition'] ?? '';
    assert.match(disposition, /^attachment; filename\*=UTF-8''/);
    assert.equal(
      decodeURIComponent(disposition.slice("attachment; filename*=UTF-8''".length)),
      thaiDoc.filename,
    );
    assert.equal(
      createHash('sha256').update(response.body!).digest('hex'),
      manifest.documents[THAI_NAMED_FIXTURE_DOCUMENT_ID]?.sha256,
    );
    assert.equal(
      response.headers['content-length'],
      String(manifest.documents[THAI_NAMED_FIXTURE_DOCUMENT_ID]?.sizeBytes),
    );
    assert.ok(new TextDecoder().decode(response.body).includes('RAI-DESK-SYNTHETIC-FIXTURE'));
  });

  it('a direct artifact URL without a session is 401 (T12); another owner is 403 scope with no bytes (T11)', async () => {
    const anonymous = await call(substitute, 'GET', `/api/artifacts/${thaiDoc.artifactId}`);
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers['content-type'], 'application/json; charset=utf-8');
    const other = await call(substitute, 'GET', `/api/artifacts/${thaiDoc.artifactId}`, {
      cookie: users['fx-user-owner-cm-2'],
    });
    assert.equal(other.status, 403);
    assert.equal(other.json<Envelope>().error.details, undefined);
    const meta = await call(substitute, 'GET', `/api/artifacts/${thaiDoc.artifactId}/meta`, {
      cookie: users['fx-user-spoc-cm'],
    }); // HR case, CM SPOC
    assert.equal(meta.status, 403);
    assert.deepEqual(
      denied().map((d) => [d.action, d.targetType, d.reason, d.targetId]),
      [
        ['artifact.download', 'artifact', 'scope', thaiDoc.artifactId],
        ['artifact.download', 'artifact', 'scope', thaiDoc.artifactId],
      ],
    );
  });

  it('an unresolvable artifactId is 403 scope for own/BU-only actors and 404 artifact for all_cases holders (T33 ii)', async () => {
    const random = randomUUID();
    for (const suffix of ['', '/meta']) {
      for (const user of ['fx-user-owner-cm-2', 'fx-user-spoc-cm', 'fx-user-owner-cm'])
        assert.equal(
          (await call(substitute, 'GET', `/api/artifacts/${random}${suffix}`, { cookie: users[user] }))
            .status,
          403,
          `${user}${suffix}`,
        );
      for (const user of ['fx-user-dpo', 'fx-user-admin']) {
        const response = await call(substitute, 'GET', `/api/artifacts/${random}${suffix}`, {
          cookie: users[user],
        });
        assert.equal(response.status, 404, `${user}${suffix}`);
        assert.deepEqual(response.json<Envelope>().error.details, { resource: 'artifact' });
      }
    }
    assert.equal(denied().length, 6);
  });

  it('POST /api/cases/{caseId}/artifacts: 201 ArtifactRef with the sniffed media type and the content hash', async () => {
    const response = await upload('fx-user-owner-cm', nonvendor.caseId, 'Extra_Note.pdf', PDF);
    assert.equal(response.status, 201, response.text());
    const ref = response.json<ArtifactRef>();
    assert.ok(Value.Check(ArtifactRefSchema, ref));
    assert.equal(ref.caseId, nonvendor.caseId);
    assert.equal(ref.mediaType, 'application/pdf');
    assert.equal(ref.sizeBytes, PDF.byteLength);
    assert.equal(ref.sha256, createHash('sha256').update(PDF).digest('hex'));
    assert.equal(ref.uploadedBy, 'fixture:fx-user-owner-cm');
    assert.equal(ref.uploadedAt, '2026-09-22T03:00:00.000Z');
    const download = await call(substitute, 'GET', `/api/artifacts/${ref.artifactId}`, {
      cookie: users['fx-user-spoc-cm'],
    });
    assert.equal(download.status, 200);
    assert.deepEqual(download.body, PDF);
    // The same bytes again: a new metadata row over the same blob (idempotent by content hash).
    const again = await upload('fx-user-spoc-cm', nonvendor.caseId, 'Extra_Note.pdf', PDF);
    assert.equal(again.status, 201);
    assert.notEqual(again.json<ArtifactRef>().artifactId, ref.artifactId);
    assert.equal(again.json<ArtifactRef>().sha256, ref.sha256);
    assert.equal(again.json<ArtifactRef>().uploadedBy, 'fixture:fx-user-spoc-cm');
  });

  it('a Thai filename round-trips through upload, meta and the download header (NFC)', async () => {
    const name = 'เอกสารเพิ่มเติม_ทดสอบ.png'.normalize('NFD'); // arrives decomposed; stored NFC
    const response = await upload('fx-user-owner-cm', nonvendor.caseId, name, PNG);
    assert.equal(response.status, 201, response.text());
    const ref = response.json<ArtifactRef>();
    assert.equal(ref.filename, name.normalize('NFC'));
    assert.equal(ref.mediaType, 'image/png');
    const download = await call(substitute, 'GET', `/api/artifacts/${ref.artifactId}`, {
      cookie: users['fx-user-owner-cm'],
    });
    assert.equal(
      decodeURIComponent(
        (download.headers['content-disposition'] ?? '').slice("attachment; filename*=UTF-8''".length),
      ),
      name.normalize('NFC'),
    );
  });

  it('upload: reviewers and Admin are 403 role, another owner is 403 scope (T10, T11); nothing stored', async () => {
    const before = substitute.store.artifacts.size;
    for (const [user, reason] of [
      ['fx-user-dpo', 'role'],
      ['fx-user-admin', 'role'],
      ['fx-user-owner-cm-2', 'scope'],
    ] as const) {
      const response = await upload(user, nonvendor.caseId, 'x.pdf', PDF);
      assert.equal(response.status, 403, user);
      assert.equal(denied().at(-1)?.reason, reason);
    }
    assert.equal(substitute.store.artifacts.size, before);
  });

  it('upload to an unresolvable caseId: 403 scope for own/BU-only actors, 403 role for reviewers and Admin (T33 iii)', async () => {
    const random = randomUUID();
    for (const [user, reason] of [
      ['fx-user-owner-cm-2', 'scope'],
      ['fx-user-spoc-cm', 'scope'],
      ['fx-user-dpo', 'role'],
      ['fx-user-admin', 'role'],
    ] as const) {
      const response = await upload(user, random, 'x.pdf', PDF);
      assert.equal(response.status, 403, user);
      assert.equal(denied().at(-1)?.reason, reason);
    }
  });

  it('upload: 422 invalid_input when no file part is sent or the case has no open draft', async () => {
    const noFile = await call(substitute, 'POST', `/api/cases/${nonvendor.caseId}/artifacts`, {
      cookie: users['fx-user-owner-cm'],
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode('{}'),
    });
    assert.equal(noFile.status, 422);
    assert.deepEqual(noFile.json<Envelope>().error, {
      code: 'invalid_input',
      messageKey: 'error.invalid_input',
      correlationId: noFile.json<Envelope>().error.correlationId,
      details: { fields: [{ path: 'body.file', messageKey: 'validation.required' }] },
    });
    const wrongPart = multipartFile('x.pdf', PDF, 'document');
    const wrong = await call(substitute, 'POST', `/api/cases/${nonvendor.caseId}/artifacts`, {
      cookie: users['fx-user-owner-cm'],
      headers: { 'content-type': wrongPart.contentType },
      body: wrongPart.body,
    });
    assert.equal(wrong.status, 422);
    // Submit the case, then upload: no open draft.
    const submit = await call(substitute, 'POST', `/api/cases/${nonvendor.caseId}/draft/submit`, {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: { expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 } },
    });
    assert.equal(submit.status, 201, submit.text());
    const closed = await upload('fx-user-owner-cm', nonvendor.caseId, 'x.pdf', PDF);
    assert.equal(closed.status, 422);
    assert.deepEqual(closed.json<Envelope>().error.details, {
      fields: [{ path: 'body', messageKey: 'validation.no_open_draft' }],
    });
  });

  it('upload: the W0-08 unsafe_upload reasons the substitute reproduces, each with the section 5 key', async () => {
    const expect = async (
      filename: string,
      bytes: Uint8Array,
      reason: string,
      params?: Record<string, number>,
    ) => {
      const response = await upload('fx-user-owner-cm', nonvendor.caseId, filename, bytes);
      assert.equal(response.status, 422, `${filename}: ${response.text()}`);
      const body = response.json<Envelope>();
      assert.equal(body.error.code, 'unsafe_upload');
      assert.equal(body.error.messageKey, 'error.unsafe_upload');
      assert.deepEqual(
        body.error.details,
        params === undefined
          ? { reasonKey: `error.unsafe_upload.${reason}` }
          : { reasonKey: `error.unsafe_upload.${reason}`, params },
      );
      assert.ok(!response.text().includes(filename), 'the filename is never echoed');
    };
    await expect('nothing_inside.pdf', new Uint8Array(0), 'empty_file');
    await expect('tool.exe', PDF, 'extension_not_allowed');
    await expect('noext', PDF, 'extension_not_allowed');
    await expect('.pdf', PDF, 'filename_invalid'); // empty stem
    await expect('../escape.pdf', PDF, 'filename_invalid');
    await expect('bad\u0000name.pdf', PDF, 'filename_invalid');
    await expect(' padded.pdf', PDF, 'filename_invalid');
    await expect(`${'ก'.repeat(201)}.pdf`, PDF, 'filename_invalid');
    await expect('garbage.pdf', new TextEncoder().encode('this is not a pdf'), 'type_not_allowed');
    await expect('image.pdf', PNG, 'type_mismatch');
    await expect('doc.docx', generateDocument(findFixtureDocument('fx-doc-0001-02')!), 'type_mismatch'); // xlsx bytes
    assert.equal(denied().length, 0);
    assert.equal(substitute.store.artifacts.size, FIXTURE_DOCUMENTS.length);
  });

  it('upload: too_large and pack_total_exceeded carry the configured limit in params', async () => {
    const small = createApiSubstitute({
      uploadMaxFileBytes: 2 * 1024 * 1024,
      uploadMaxPackBytes: 3 * 1024 * 1024,
    });
    const cookie = await signIn(small, 'fx-user-owner-cm');
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PDF, 0);
    const { body, contentType } = multipartFile('big.pdf', big);
    const tooLarge = await call(small, 'POST', `/api/cases/${nonvendor.caseId}/artifacts`, {
      cookie,
      headers: { 'content-type': contentType },
      body,
    });
    assert.equal(tooLarge.status, 422);
    assert.deepEqual(tooLarge.json<Envelope>().error.details, {
      reasonKey: 'error.unsafe_upload.too_large',
      params: { max_file_mb: 2 },
    });
    // fx-case-vendor holds the 2 MiB DPA; adding 1.5 MiB more takes it over the 3 MiB pack limit.
    const spoc = await signIn(small, 'fx-user-dpo-spoc-hr');
    const medium = new Uint8Array(1.5 * 1024 * 1024);
    medium.set(PDF, 0);
    const part = multipartFile('more.pdf', medium);
    const over = await call(small, 'POST', `/api/cases/${vendor.caseId}/artifacts`, {
      cookie: spoc,
      headers: { 'content-type': part.contentType },
      body: part.body,
    });
    assert.equal(over.status, 422);
    assert.deepEqual(over.json<Envelope>().error.details, {
      reasonKey: 'error.unsafe_upload.pack_total_exceeded',
      params: { max_pack_mb: 3 },
    });
    const fits = await call(small, 'POST', `/api/cases/${nonvendor.caseId}/artifacts`, {
      cookie,
      headers: { 'content-type': part.contentType },
      body: part.body,
    });
    assert.equal(fits.status, 201);
  });
});
