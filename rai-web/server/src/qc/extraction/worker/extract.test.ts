// W4-05b (W4b plan section 4.2): the worker's dispatch. The format registry was empty until W4-05c and W4-05d; the
// sink and the typed stops are what those parsers build on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExtractionStop,
  FORMAT_EXTRACTORS,
  MAX_LOCATOR_STRING_CHARS,
  SegmentSink,
  extractInWorker,
  isWorkerRequest,
  type FormatExtractor,
  type WorkerLimits,
  type WorkerRequest,
} from './extract.js';

const LIMITS: WorkerLimits = {
  maxTextChars: 10,
  maxSegments: 3,
  maxPartBytes: 1024,
  maxTotalBytes: 4096,
  maxPdfPages: 2,
  maxPdfObjects: 10,
};
const MEDIA_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
];
const request = (mediaType = 'application/pdf'): WorkerRequest => ({
  mediaType,
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  limits: LIMITS,
});
const registry = (format: FormatExtractor) => new Map([['application/pdf', format]]);

test('DOCX and XLSX (W4-05c) and PDF (W4-05d) are registered; bytes that are not a document are unreadable', () => {
  assert.deepEqual(
    [...FORMAT_EXTRACTORS.keys()].sort(),
    [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    'PNG and JPEG stay unregistered (no OCR, decision 8)',
  );
  for (const mediaType of MEDIA_TYPES)
    assert.deepEqual(extractInWorker(request(mediaType)), { ok: false, reason: 'unreadable' });
});

test('a registered format gets the bytes as a Buffer and its segments come back in order', () => {
  let seen: Buffer | undefined;
  const reply = extractInWorker(
    request(),
    registry((bytes, sink) => {
      seen = bytes;
      sink.add({ kind: 'page', page: 1 }, 'ab');
      sink.add({ kind: 'page', page: 2 }, 'cd');
    }),
  );
  assert.ok(Buffer.isBuffer(seen));
  assert.deepEqual([...seen], [0x25, 0x50, 0x44, 0x46]);
  assert.deepEqual(reply, {
    ok: true,
    segments: [
      { locator: { kind: 'page', page: 1 }, text: 'ab' },
      { locator: { kind: 'page', page: 2 }, text: 'cd' },
    ],
  });
});

test('a format that finds no text is unreadable', () => {
  assert.deepEqual(
    extractInWorker(
      request(),
      registry(() => {}),
    ),
    { ok: false, reason: 'unreadable' },
  );
});

test('the sink stops at the text cap and at the segment cap', () => {
  const chars = new SegmentSink(LIMITS);
  chars.add({ kind: 'absent' }, '0123456789');
  assert.throws(
    () => chars.add({ kind: 'absent' }, 'x'),
    (e) => e instanceof ExtractionStop && e.reason === 'limit_output',
  );
  const count = new SegmentSink(LIMITS);
  for (let i = 0; i < 3; i++) count.add({ kind: 'absent' }, '');
  assert.throws(
    () => count.add({ kind: 'absent' }, ''),
    (e) => e instanceof ExtractionStop && e.reason === 'limit_output',
  );
  assert.equal(count.segments.length, 3);
});

test('a typed stop becomes the reply reason', () => {
  for (const reason of ['unreadable', 'limit_bytes', 'limit_output'] as const)
    assert.deepEqual(
      extractInWorker(
        request(),
        registry(() => {
          throw new ExtractionStop(reason);
        }),
      ),
      { ok: false, reason },
    );
  assert.deepEqual(
    extractInWorker(
      request(),
      registry((_bytes, sink) => {
        for (;;) sink.add({ kind: 'absent' }, 'xyz');
      }),
    ),
    { ok: false, reason: 'limit_output' },
  );
});

test('any other throw propagates, so the worker dies and the host records a crash', () => {
  assert.throws(
    () =>
      extractInWorker(
        request(),
        registry(() => {
          throw new RangeError('synthetic parser bug');
        }),
      ),
    RangeError,
  );
});

test('the request guard accepts the host request and refuses anything else', () => {
  assert.equal(isWorkerRequest(request()), true);
  for (const value of [
    undefined,
    null,
    'x',
    {},
    { ...request(), mediaType: 7 },
    { ...request(), bytes: [1, 2] },
    { ...request(), limits: undefined },
    { ...request(), limits: { ...LIMITS, maxTextChars: '10' } },
  ])
    assert.equal(isWorkerRequest(value), false, JSON.stringify(value));
});

test('the sink counts locator strings toward the text cap and stops at the per-field bound', () => {
  const sink = new SegmentSink(LIMITS);
  sink.add({ kind: 'cell', sheet: 'Sheet', cell: 'A1' }, 'abc');
  assert.throws(
    () => sink.add({ kind: 'section', heading: 'h' }, ''),
    (e) => e instanceof ExtractionStop && e.reason === 'limit_output',
  );
  const bound = new SegmentSink({ maxTextChars: 2_000_000, maxSegments: 3 });
  assert.throws(
    () => bound.add({ kind: 'section', heading: 'x'.repeat(MAX_LOCATOR_STRING_CHARS + 1) }, ''),
    (e) => e instanceof ExtractionStop && e.reason === 'limit_output',
  );
  bound.add({ kind: 'section', heading: 'x'.repeat(MAX_LOCATOR_STRING_CHARS) }, '');
  assert.equal(bound.segments.length, 1);
});
