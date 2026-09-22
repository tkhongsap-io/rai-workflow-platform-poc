import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binary, BYTES, digest, measured } from './profiles.js';
import { exactPdf } from './surface-measure.js';
test('exact-size PDFs differ; binary validation catches truncation and corruption', () => {
  const first = exactPdf('first'),
    second = exactPdf('second');
  assert.equal(first.length, BYTES);
  assert.equal(second.length, BYTES);
  assert.notEqual(digest(first), digest(second));
  const text = Buffer.from(first).toString('latin1');
  const offset = Number(/startxref\n(\d+)/.exec(text)![1]);
  assert.equal(text.slice(offset, offset + 5), 'xref\n');
  const r = { bytes: first, contentLength: String(BYTES), status: 200, wallMs: 1, correlationId: 'id' };
  binary(r, digest(first));
  assert.throws(() => binary({ ...r, bytes: first.subarray(1) }, digest(first)));
  assert.throws(() => binary({ ...r, bytes: second }, digest(first)));
  const failed = measured({ ...r, status: 500 }, 200, () => {});
  assert.equal(failed.status, 500);
  assert.equal(failed.correlationId, 'id');
  assert(failed.error);
});
