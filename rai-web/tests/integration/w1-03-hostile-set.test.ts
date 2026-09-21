// W0-08 section 8.6 through the route (the W1-08 "unsafe upload" evidence): every hostile row that applies at
// upload time is sent to POST /api/cases/{caseId}/artifacts by the case owner and must answer 422 unsafe_upload
// with the stated reason, store nothing, write no audit row and emit one upload.rejected line; the accepted rows
// answer 201. The pack-total boundary (six 25 MiB files into slots 1-6, then a seventh) runs against the real
// 150 MiB limit with the slots attached directly in the database, because the attaching save-draft is W1-04.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import { UNSAFE_UPLOAD_REASONS } from '@rai/shared/errors';
import { auditStore } from '@rai/server/audit/store';
import { hostileSet } from '@rai/server/artifacts/sniff.test-bytes';
import { FIXTURE_CASES } from '@rai/fixtures/data/cases/index';
import { readManifest, fixtureSetLabel } from '@rai/fixtures/manifest';
import {
  LIMITS,
  fixtureBaseDocuments,
  objectCount,
  openHarness,
  pdfOfExactSize,
  signIn,
  upload,
  type Harness,
} from './w1-03-helpers.js';

const SET = fixtureSetLabel(readManifest());
const CASE_CM = FIXTURE_CASES.find((c) => c.fixtureCaseId === 'fx-case-nonvendor')!;

let h: Harness;
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

test(`${SET}: every W0-08 8.6 byte-level hostile row is refused at the route with its reason and nothing is stored; the accepted rows land`, async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const rows = hostileSet(fixtureBaseDocuments());
  const auditBefore = (await auditStore.read(h.db.app, {})).length;
  let stored = 0;
  for (const row of rows) {
    const objectsBefore = await objectCount(h.blobDir);
    const linesBefore = h.linesFor('upload.rejected').length;
    const res = await upload(h.app, owner, CASE_CM.caseId, row.declaredName, row.bytes, 'application/pdf');
    if (row.expected === 'accepted') {
      assert.equal(res.statusCode, 201, `${row.name}: ${res.body}`);
      assert.equal(res.json<ArtifactRef>().filename, row.declaredName.normalize('NFC'));
      stored += 1;
      continue;
    }
    assert.equal(res.statusCode, 422, `${row.name}: ${res.statusCode} ${res.body}`);
    const body = res.json<Envelope>();
    assert.equal(body.error.code, 'unsafe_upload', row.name);
    assert.equal(body.error.messageKey, 'error.unsafe_upload', row.name);
    assert.equal(body.error.details?.reasonKey, `error.unsafe_upload.${row.expected}`, row.name);
    assert.ok((UNSAFE_UPLOAD_REASONS as readonly string[]).includes(row.expected), row.name);
    if (row.expected === 'image_too_large')
      assert.deepEqual(body.error.details?.params, { max_megapixels: 40 }, row.name);
    else
      assert.equal(body.error.details?.params, undefined, `${row.name}: params only for the sized reasons`);
    assert.ok(!res.body.includes(row.declaredName), `${row.name}: the filename is not echoed`);
    assert.equal(await objectCount(h.blobDir), objectsBefore, `${row.name}: nothing written`);
    assert.deepEqual(await readdir(h.store.tmpDir), [], `${row.name}: temp file unlinked`);
    const rejected = h.linesFor('upload.rejected');
    assert.equal(rejected.length, linesBefore + 1, `${row.name}: one upload.rejected line`);
    const line = rejected[rejected.length - 1]!;
    assert.equal(line.fields?.reason, row.expected, row.name);
    assert.equal(line.fields?.caseId, CASE_CM.caseId);
    assert.equal(line.correlationId, res.headers['x-correlation-id']);
    assert.ok(!line.raw.includes(row.declaredName), `${row.name}: the log line never carries the filename`);
    assert.deepEqual(
      Object.keys(line.fields ?? {}).filter(
        (k) => !['caseId', 'reason', 'sniffedMediaType', 'declaredMediaType', 'sizeBytes'].includes(k),
      ),
      [],
      `${row.name}: only the W0-10 3.3 fields`,
    );
  }
  assert.equal(stored, rows.filter((r) => r.expected === 'accepted').length);
  const auditAfter = await auditStore.read(h.db.app, {});
  assert.equal(
    auditAfter.length - auditBefore,
    stored,
    'one artifact.uploaded per accepted row, none per rejection',
  );
  assert.ok(auditAfter.slice(auditBefore).every((e) => e.action === 'artifact.uploaded'));
});

test('W0-08 8.6 pack total: six files at the per-file limit attached to slots 1-6 reach exactly 150 MiB; the seventh is pack_total_exceeded at check 10', async () => {
  const owner = await signIn(h.app, 'fx-user-owner-cm');
  const draftId = CASE_CM.draftVersionId;
  // Start from an empty pack: the fixture case's own attachments would otherwise count towards the total.
  await h.db.owner.execute(
    sql`UPDATE artifact_slot SET state = 'missing', artifact_id = NULL, reason = NULL WHERE version_id = ${draftId}`,
  );
  const refs: ArtifactRef[] = [];
  for (let slot = 1; slot <= 6; slot += 1) {
    const bytes = pdfOfExactSize(LIMITS.maxFileBytes, `pack-${slot}`);
    const res = await upload(h.app, owner, CASE_CM.caseId, `p${slot}.pdf`, bytes, 'application/pdf');
    assert.equal(res.statusCode, 201, `p${slot}.pdf: ${res.body.slice(0, 200)}`);
    const ref = res.json<ArtifactRef>();
    refs.push(ref);
    // The attaching save-draft is W1-04's route; the slot row is written directly here (same table, same rule).
    await h.db.owner.execute(
      sql`UPDATE artifact_slot SET state = 'attached', artifact_id = ${ref.artifactId}, reason = NULL WHERE version_id = ${draftId} AND slot = ${slot}`,
    );
  }
  const total = await h.db.owner.execute(
    sql`SELECT sum(a.size_bytes)::bigint AS total FROM artifact_slot s JOIN artifact a ON a.id = s.artifact_id WHERE s.version_id = ${draftId} AND s.state = 'attached'`,
  );
  assert.equal(Number((total.rows[0] as { total: string }).total), 157_286_400, '150 MiB exactly');
  assert.equal(new Set(refs.map((r) => r.sha256)).size, 6, 'six distinct objects');

  const objectsBefore = await objectCount(h.blobDir);
  const small = fixtureBaseDocuments().pdf; // the smallest valid fixture PDF
  const seventh = await upload(h.app, owner, CASE_CM.caseId, 'p7.pdf', small, 'application/pdf');
  assert.equal(seventh.statusCode, 422, seventh.body);
  const body = seventh.json<Envelope>();
  assert.equal(body.error.code, 'unsafe_upload');
  assert.deepEqual(body.error.details, {
    reasonKey: 'error.unsafe_upload.pack_total_exceeded',
    params: { max_pack_mb: 150 },
  });
  assert.equal(
    await objectCount(h.blobDir),
    objectsBefore,
    'checks 5-9 passed, check 10 discarded the bytes',
  );
  assert.deepEqual(await readdir(h.store.tmpDir), []);
  const rejected = h.linesFor('upload.rejected');
  assert.equal(rejected.length, 1);
  assert.deepEqual(rejected[0]!.fields, {
    caseId: CASE_CM.caseId,
    reason: 'pack_total_exceeded',
    sniffedMediaType: 'application/pdf',
    declaredMediaType: 'application/pdf',
    sizeBytes: small.length,
  });
  const uploads = (await auditStore.read(h.db.app, {})).filter((e) => e.action === 'artifact.uploaded');
  assert.equal(uploads.length, 6, 'the seventh wrote no audit row');

  // Detaching one slot frees its bytes: the same small file is then accepted.
  await h.db.owner.execute(
    sql`UPDATE artifact_slot SET state = 'missing', artifact_id = NULL WHERE version_id = ${draftId} AND slot = 6`,
  );
  const again = await upload(h.app, owner, CASE_CM.caseId, 'p7.pdf', small, 'application/pdf');
  assert.equal(again.statusCode, 201, again.body);
});
