// W4-05b (W4b plan section 4.2): one request in, one reply out; the reply is checked, and anything malformed is a
// crash. The host counts the output again, so a worker that ignores its caps is still `limit_output`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_WORKER_LIMITS } from './limits.js';
import { buildWorkerRequest, classifyReply } from './protocol.js';
import { MAX_LOCATOR_STRING_CHARS, type WorkerLimits } from './worker/extract.js';

const LIMITS: WorkerLimits = { ...FIXED_WORKER_LIMITS, maxTextChars: 1000 };
const PDF = 'application/pdf';

test('the request carries the media type, the bytes and the worker limits only', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(buildWorkerRequest({ mediaType: PDF, bytes }, LIMITS), {
    mediaType: PDF,
    bytes,
    limits: LIMITS,
  });
});

test('a well-formed ok reply gives its segments', () => {
  const segments = [
    { locator: { kind: 'page', page: 1 }, text: 'synthetic line' },
    { locator: { kind: 'absent' }, text: '' },
  ];
  assert.deepEqual(classifyReply({ ok: true, segments }, LIMITS), { ok: true, segments });
  assert.deepEqual(classifyReply({ ok: true, segments: [] }, LIMITS), { ok: true, segments: [] });
});

test('each reason a worker may report passes through', () => {
  for (const reason of ['unreadable', 'limit_bytes', 'limit_output'] as const)
    assert.deepEqual(classifyReply({ ok: false, reason }, LIMITS), { ok: false, reason });
});

test('a reason only the host may decide, or an unknown one, is a crash', () => {
  for (const reason of ['limit_time', 'limit_memory', 'crash', 'timeout', 'ok', ''])
    assert.deepEqual(classifyReply({ ok: false, reason }, LIMITS), { ok: false, reason: 'crash' }, reason);
});

test('a malformed reply is a crash', () => {
  const malformed: unknown[] = [
    undefined,
    null,
    'ok',
    42,
    [],
    {},
    { ok: 'true', segments: [] },
    { ok: true },
    { ok: true, segments: 'x' },
    { ok: true, segments: [{ locator: { kind: 'page', page: 1 } }] },
    { ok: true, segments: [{ locator: { kind: 'page', page: 1 }, text: 7 }] },
    { ok: true, segments: [{ locator: { kind: 'paragraph' }, text: 'x' }] },
    { ok: true, segments: [{ text: 'x' }] },
    { ok: true, segments: [{ locator: { kind: 'absent' }, text: 'x', extra: 1 }] },
    { ok: true, segments: [], extractorVersion: 'forged/1' },
    { ok: false, reason: 'unreadable', extra: true },
    { ok: false },
  ];
  for (const value of malformed)
    assert.deepEqual(classifyReply(value, LIMITS), { ok: false, reason: 'crash' }, JSON.stringify(value));
});

test('text over the cap is limit_output, and text at the cap is not', () => {
  const at = [{ locator: { kind: 'absent' }, text: 'x'.repeat(1000) }];
  assert.equal(classifyReply({ ok: true, segments: at }, LIMITS).ok, true);
  const over = [
    { locator: { kind: 'absent' }, text: 'x'.repeat(600) },
    { locator: { kind: 'absent' }, text: 'x'.repeat(401) },
  ];
  assert.deepEqual(classifyReply({ ok: true, segments: over }, LIMITS), {
    ok: false,
    reason: 'limit_output',
  });
});

test('more segments than the cap is limit_output, and exactly the cap is not', () => {
  const limits: WorkerLimits = { ...LIMITS, maxSegments: 3 };
  const segment = { locator: { kind: 'absent' }, text: 'x' };
  assert.equal(classifyReply({ ok: true, segments: [segment, segment, segment] }, limits).ok, true);
  assert.deepEqual(classifyReply({ ok: true, segments: [segment, segment, segment, segment] }, limits), {
    ok: false,
    reason: 'limit_output',
  });
});

test('a locator with a key outside its kind is a crash, on every kind and on the page region', () => {
  const smuggled = 'x'.repeat(8);
  const locators: unknown[] = [
    { kind: 'absent', smuggled },
    { kind: 'page', page: 1, smuggled },
    { kind: 'page', page: 1, region: { x: 0, y: 0, w: 1, h: 1, smuggled } },
    { kind: 'text_range', start: 0, end: 1, smuggled },
    { kind: 'cell', sheet: 'S', cell: 'A1', smuggled },
    { kind: 'section', heading: 'H', smuggled },
  ];
  for (const locator of locators)
    assert.deepEqual(
      classifyReply({ ok: true, segments: [{ locator, text: 'a' }] }, { ...LIMITS, maxTextChars: 10_000 }),
      { ok: false, reason: 'crash' },
      JSON.stringify(locator),
    );
});

test('a smuggled locator key cannot slip past the text cap either', () => {
  const reply = {
    ok: true,
    segments: [{ locator: { kind: 'absent', smuggled: 'x'.repeat(1000) }, text: 'a' }],
  };
  assert.equal(classifyReply(reply, { ...LIMITS, maxTextChars: 10 }).ok, false);
});

test('locator strings count toward the text cap', () => {
  const limits: WorkerLimits = { ...LIMITS, maxTextChars: 10 };
  const at = [{ locator: { kind: 'cell', sheet: 'Sheet', cell: 'A1' }, text: 'abc' }];
  assert.equal(classifyReply({ ok: true, segments: at }, limits).ok, true);
  const heading = [{ locator: { kind: 'section', heading: 'x'.repeat(1000) }, text: 'a' }];
  assert.deepEqual(classifyReply({ ok: true, segments: heading }, limits), {
    ok: false,
    reason: 'limit_output',
  });
  const cell = [{ locator: { kind: 'cell', sheet: 'Sheet1', cell: 'A1' }, text: 'abc' }];
  assert.deepEqual(classifyReply({ ok: true, segments: cell }, limits), {
    ok: false,
    reason: 'limit_output',
  });
});

test('a locator string over the per-field bound is limit_output even under a large text cap', () => {
  const limits: WorkerLimits = { ...LIMITS, maxTextChars: 2_000_000 };
  const long = 'x'.repeat(MAX_LOCATOR_STRING_CHARS + 1);
  for (const locator of [
    { kind: 'section', heading: long },
    { kind: 'cell', sheet: long, cell: 'A1' },
    { kind: 'cell', sheet: 'S', cell: long },
  ])
    assert.deepEqual(
      classifyReply({ ok: true, segments: [{ locator, text: 'a' }] }, limits),
      { ok: false, reason: 'limit_output' },
      locator.kind,
    );
  const atBound = [{ locator: { kind: 'section', heading: long.slice(1) }, text: 'a' }];
  assert.equal(classifyReply({ ok: true, segments: atBound }, limits).ok, true);
});
