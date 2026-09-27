// W4-09a: the fixed-Huffman encoder behind the evaluation set's FlateDecode PDFs and deflate ZIP entries. Its
// output is decoded by node:zlib (the extractor's inflater) and never depends on the platform's zlib build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { adler32, deflateRawFixed, zlibFixed } from './deflate.js';

const SAMPLES: Buffer[] = [
  Buffer.alloc(0),
  Buffer.from('BT /F1 12 Tf 72 770 Td (item: 2.1; answer: Yes) Tj ET\n', 'latin1'),
  Buffer.from('เอกสารสังเคราะห์สำหรับการทดสอบ', 'utf8'),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  Buffer.alloc(70_000, 0x41),
];

test('raw fixed-Huffman deflate round-trips through inflateRawSync for every byte value', () => {
  for (const sample of SAMPLES) assert.deepEqual(inflateRawSync(deflateRawFixed(sample)), sample);
});

test('the zlib wrapper round-trips through inflateSync (header 78 01, Adler-32 trailer)', () => {
  for (const sample of SAMPLES) {
    const z = zlibFixed(sample);
    assert.equal(z[0], 0x78);
    assert.equal(z[1], 0x01);
    assert.equal(z.readUInt32BE(z.length - 4), adler32(sample));
    assert.deepEqual(inflateSync(z), sample);
  }
});

test('the encoder is deterministic: the same input gives the same bytes', () => {
  for (const sample of SAMPLES)
    assert.deepEqual(deflateRawFixed(sample), deflateRawFixed(Buffer.from(sample)));
});

test('Adler-32 matches the RFC 1950 value of a known string', () => {
  assert.equal(adler32(Buffer.from('Wikipedia', 'ascii')), 0x11e60398);
});
