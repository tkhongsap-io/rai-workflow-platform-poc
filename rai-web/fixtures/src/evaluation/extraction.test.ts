// W4-05c/W4-05d cross-check (W4b plan sections 4.3 and 11.1): the extraction worker reads the evaluation set's DOCX,
// XLSX and text PDF renderings at exactly the locators the renderer records for each claim, and refuses the DOCTYPE,
// image, CID and broken-xref renderings. Test-only (excluded from the set hash by its suffix); the worker's parsers run
// in process here, the fork is tested in server/src/qc/extraction/client.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInWorker, type WorkerLimits } from '@rai/server/qc/extraction/worker/extract';
import { FIXED_WORKER_LIMITS } from '@rai/server/qc/extraction/limits';
import { generateEvalSet } from './generate.js';

const LIMITS: WorkerLimits = { maxTextChars: 1_000_000, ...FIXED_WORKER_LIMITS };

test('every DOCX and XLSX rendering extracts, and each claim locator names an extracted segment', () => {
  const documents = generateEvalSet().filter((g) =>
    ['docx', 'docx_doctype', 'xlsx'].includes(g.document.format),
  );
  assert.ok(documents.some((g) => g.document.format === 'docx'));
  assert.ok(documents.some((g) => g.document.format === 'xlsx'));
  for (const { document } of documents) {
    const reply = extractInWorker({ mediaType: document.mediaType, bytes: document.bytes, limits: LIMITS });
    if (document.format === 'docx_doctype') {
      assert.deepEqual(reply, { ok: false, reason: 'unreadable' }, document.documentId);
      continue;
    }
    assert.ok(reply.ok, `${document.documentId}: ${JSON.stringify(reply)}`);
    const found = new Set(reply.segments.map((s) => JSON.stringify(s.locator)));
    for (const locator of document.claimLocators)
      assert.ok(found.has(JSON.stringify(locator)), `${document.documentId}: ${JSON.stringify(locator)}`);
    if (document.format === 'docx')
      assert.deepEqual(
        reply.segments.map((s) => s.locator.index),
        reply.segments.map((_, i) => i + 1),
        `${document.documentId}: one segment per paragraph, no blank paragraph`,
      );
  }
});

test('W4-05d: the text PDF renderings extract at their page locators; image, CID and broken-xref ones are unreadable', () => {
  const documents = generateEvalSet().filter((g) => g.document.mediaType === 'application/pdf');
  const formats = new Set(documents.map((g) => g.document.format));
  for (const format of ['pdf', 'pdf_flate', 'pdf_image', 'pdf_cid', 'pdf_broken_xref'])
    assert.ok(formats.has(format as never), `the set has a ${format} rendering`);
  for (const { document } of documents) {
    const reply = extractInWorker({ mediaType: document.mediaType, bytes: document.bytes, limits: LIMITS });
    if (document.format !== 'pdf' && document.format !== 'pdf_flate') {
      assert.deepEqual(reply, { ok: false, reason: 'unreadable' }, document.documentId);
      continue;
    }
    assert.ok(reply.ok, `${document.documentId}: ${JSON.stringify(reply)}`);
    assert.ok(
      reply.segments.every((s) => s.locator.kind === 'page'),
      document.documentId,
    );
    const found = new Set(reply.segments.map((s) => JSON.stringify(s.locator)));
    for (const locator of document.claimLocators)
      assert.ok(found.has(JSON.stringify(locator)), `${document.documentId}: ${JSON.stringify(locator)}`);
  }
});
