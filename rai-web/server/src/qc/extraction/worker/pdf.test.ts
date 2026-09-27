// W4-05d (W4b plan sections 4.3 and 4.4): the PDF text-layer reader. One `page` segment per text line; everything a
// broken, hostile or image-only PDF does ends as a typed `ok: false`, never a throw. Synthetic PDFs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { extractInWorker, type WorkerLimits, type WorkerReply } from './extract.js';
import { FIXED_WORKER_LIMITS } from '../limits.js';
import {
  PDF,
  appendUpdate,
  buildTestPdf,
  linesContent,
  lit,
  textPdf,
  HELVETICA,
  type TestObject,
} from './pdf.test-helper.js';

const LIMITS: WorkerLimits = { maxTextChars: 1_000_000, ...FIXED_WORKER_LIMITS };
const run = (bytes: Buffer, limits: Partial<WorkerLimits> = {}): WorkerReply =>
  extractInWorker({ mediaType: PDF, bytes, limits: { ...LIMITS, ...limits } });
const texts = (reply: WorkerReply) => {
  assert.ok(reply.ok, JSON.stringify(reply));
  return reply.segments.map((s) => [s.locator.page, s.text]);
};
const refused = (reply: WorkerReply, reason = 'unreadable', message?: string) =>
  assert.deepEqual(reply, { ok: false, reason }, message);
const page = (body: string) => `BT\n/F1 12 Tf\n72 770 Td\n14 TL\n${body}\nET\n`;

test('each text line is one segment with a 1-based page locator and no text in the locator', () => {
  const reply = run(
    textPdf([
      linesContent(['RAI-DESK-SYNTHETIC-FIXTURE pdf', 'answer: yes; metric: accuracy']),
      linesContent(['page two line']),
    ]),
  );
  assert.deepEqual(reply, {
    ok: true,
    segments: [
      { locator: { kind: 'page', page: 1 }, text: 'RAI-DESK-SYNTHETIC-FIXTURE pdf' },
      { locator: { kind: 'page', page: 1 }, text: 'answer: yes; metric: accuracy' },
      { locator: { kind: 'page', page: 2 }, text: 'page two line' },
    ],
  });
});

test('the \' and " operators start a new line; TJ joins its strings and a wide gap is a space', () => {
  const reply = run(
    textPdf([
      page(`${lit('one')} Tj\n${lit('two')} '\n1 2 ${lit('three')} "\n[(fo) -20 (ur) -300 <66697665>] TJ`),
    ]),
  );
  assert.deepEqual(texts(reply), [
    [1, 'one'],
    [1, 'two'],
    [1, 'threefour five'],
  ]);
});

test('Td, TD and Tm that move vertically start a line; a move on the same line is a space', () => {
  const reply = run(
    textPdf([
      page(
        [
          `${lit('a')} Tj 40 0 Td ${lit('b')} Tj`,
          `0 -14 Td ${lit('c')} Tj`,
          `0 -14 TD ${lit('d')} Tj T* ${lit('e')} Tj`,
          `1 0 0 1 72 500 Tm ${lit('f')} Tj 1 0 0 1 200 500 Tm ${lit('g')} Tj`,
        ].join('\n'),
      ),
    ]),
  );
  assert.deepEqual(texts(reply), [
    [1, 'a b'],
    [1, 'c'],
    [1, 'd'],
    [1, 'e'],
    [1, 'f g'],
  ]);
});

test('separate text objects at different heights are separate lines; blank lines yield nothing', () => {
  const content = `BT /F1 12 Tf 72 700 Td ${lit('first')} Tj ET\nBT /F1 12 Tf 72 680 Td ${lit('   ')} Tj ET\nBT /F1 12 Tf 72 660 Td ${lit('second')} Tj ET`;
  assert.deepEqual(texts(run(textPdf([content]))), [
    [1, 'first'],
    [1, 'second'],
  ]);
});

test('literal strings: escapes, octal, nesting and line continuation; controls other than tab are dropped', () => {
  const reply = run(
    textPdf([page('(Tab\\there \\101\\102C \\(x\\) (nest) back\\\\slash con\\\ntinued\\n\\001) Tj')]),
  );
  assert.deepEqual(texts(reply), [[1, 'Tab\there ABC (x) (nest) back\\slash continued']]);
});

test('hex strings are Latin-1, odd digits pad with 0, and a BOM makes them UTF-16BE', () => {
  const reply = run(
    textPdf([page('<48 65 6C 6C 6F> Tj T* <4869 2> Tj T* <E9> Tj T* <FEFF0E2A0E270E310E2A0E140E35> Tj')]),
  );
  assert.deepEqual(texts(reply), [
    [1, 'Hello'],
    [1, 'Hi '],
    [1, 'é'],
    [1, 'สวัสดี'],
  ]);
});

test('a literal string with a BOM is UTF-16BE too', () => {
  const reply = run(textPdf([page('(\\376\\377\\000A\\000B) Tj')]));
  assert.deepEqual(texts(reply), [[1, 'AB']]);
});

test('text in a Type0 (CID) font is not decoded; a page with only CID text is a scan', () => {
  const cidOnly = run(textPdf([`BT /F2 12 Tf 72 700 Td <10411042> Tj ET`]));
  refused(cidOnly);
  const mixed = run(
    textPdf([`BT /F2 12 Tf 72 700 Td <10411042> Tj ET\nBT /F1 12 Tf 72 680 Td (latin) Tj ET`]),
  );
  assert.deepEqual(texts(mixed), [[1, 'latin']]);
  const qRestores = run(textPdf([`BT /F1 12 Tf 72 700 Td q /F2 12 Tf <1041> Tj Q 0 -14 Td (back) Tj ET`]));
  assert.deepEqual(texts(qRestores), [[1, 'back']]);
});

test('resources are inherited from the page tree and may be indirect; contents may be an array', () => {
  const second = `BT /F1 12 Tf 72 600 Td ${lit('second stream')} Tj ET`;
  const objects: TestObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources 6 0 R >>',
    '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 3 0 R /Contents [5 0 R 8 0 R] >>',
    { dict: '', stream: page(`${lit('from the first stream')} Tj`) },
    '<< /Font 7 0 R >>',
    '<< /F1 9 0 R >>',
    { dict: '/Length 10 0 R', stream: second },
    HELVETICA,
    String(second.length),
  ];
  assert.deepEqual(texts(run(buildTestPdf(objects))), [
    [1, 'from the first stream'],
    [1, 'second stream'],
  ]);
});

test('FlateDecode content streams are inflated, as a name or a one-element array', () => {
  assert.deepEqual(texts(run(textPdf([linesContent(['compressed line'])], { flate: true }))), [
    [1, 'compressed line'],
  ]);
  const arrayFilter = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    { dict: '/Filter [/FlateDecode]', stream: deflateSync(Buffer.from(page('(arrayed) Tj'), 'latin1')) },
  ]);
  assert.deepEqual(texts(run(arrayFilter)), [[1, 'arrayed']]);
});

test('other filters leave that stream unread; when every stream has one the PDF is unreadable', () => {
  const content = (filter: string, text: string): TestObject => ({
    dict: filter,
    stream: page(`${lit(text)} Tj`),
  });
  const pdf = (streams: TestObject[]) =>
    buildTestPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /Contents [${streams.map((_, i) => `${4 + i} 0 R`).join(' ')}] >>`,
      ...streams,
    ]);
  refused(run(pdf([content('/Filter /ASCII85Decode', 'hidden'), content('/Filter /LZWDecode', 'hidden')])));
  refused(run(pdf([content('/Filter [/ASCIIHexDecode /FlateDecode]', 'hidden')])));
  refused(run(pdf([content('/Filter /FlateDecode /DecodeParms << /Predictor 12 >>', 'hidden')])));
  assert.deepEqual(texts(run(pdf([content('/Filter /DCTDecode', 'hidden'), content('', 'plain')]))), [
    [1, 'plain'],
  ]);
});

test('inline image data is skipped, even when it looks like text operators', () => {
  const content = page(`(before) Tj\nBI /W 4 /H 1 /CS /G /BPC 8 ID \x00(evil) Tj\xff EI\nT* (after) Tj`);
  assert.deepEqual(texts(run(textPdf([content]))), [
    [1, 'before'],
    [1, 'after'],
  ]);
});

test('an incremental update is read through /Prev and its newer objects win', () => {
  const base = textPdf([linesContent(['old text'])]);
  const updated = appendUpdate(
    base,
    [
      [5, `<< /Length 9 0 R >>\nstream\n${page('(new text) Tj')}\nendstream`],
      [9, String(page('(new text) Tj').length)],
    ],
    10,
  );
  assert.deepEqual(texts(run(updated)), [[1, 'new text']]);
});

test('a scanned page (an image and no text operator) or an empty page tree is unreadable', () => {
  const scan = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: '', stream: 'q 400 0 0 400 96 300 cm /Im1 Do Q' },
    {
      dict: '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8',
      stream: Buffer.alloc(4),
    },
  ]);
  refused(run(scan));
  refused(run(buildTestPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'])));
  refused(
    run(buildTestPdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Page >>'])),
    'unreadable',
    'Pages root is a Page',
  );
});

test('encryption, an xref stream, a broken xref and a broken container are unreadable', () => {
  const good = [linesContent(['would be text'])];
  assert.equal(run(textPdf(good)).ok, true, 'the control extracts');
  const cases: Array<[string, Buffer]> = [
    ['/Encrypt', textPdf(good, { trailerExtra: '/Encrypt << /Filter /Standard /V 1 >>' })],
    ['xref stream only', textPdf(good, { xrefStream: true })],
    ['shifted offsets', textPdf(good, { xrefShift: 13 })],
    ['no %%EOF', textPdf(good, { tail: '' })],
    ['not a PDF', textPdf(good, { header: '%PDX-1.4' })],
    ['root not a reference', textPdf(good, { root: '<< /Type /Catalog >>' })],
    ['root missing', textPdf(good, { root: '99 0 R' })],
    ['empty', Buffer.alloc(0)],
    ['only the header', Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')],
  ];
  for (const [name, bytes] of cases) refused(run(bytes), 'unreadable', name);
  const text = textPdf(good).toString('latin1');
  const garbage = text.replace(/startxref\n\d+/, 'startxref\nabc');
  refused(run(Buffer.from(garbage, 'latin1')), 'unreadable', 'startxref not a number');
  const far = text.replace(/startxref\n\d+/, 'startxref\n99999999');
  refused(run(Buffer.from(far, 'latin1')), 'unreadable', 'startxref past the end');
  const badEntry = text.replace(
    /(xref\n0 \d+\n0000000000 65535 f \n\d{10} 00000 )n/,
    (_all, head: string) => `${head}x`,
  );
  refused(run(Buffer.from(badEntry, 'latin1')), 'unreadable', 'xref entry type');
});

test('a stream whose Length does not end at endstream, or a Flate stream that fails, is unreadable', () => {
  const wrongLength = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    { dict: '/Length 5', stream: page('(text) Tj') },
  ]);
  refused(run(wrongLength));
  const corrupt = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    { dict: '/Filter /FlateDecode', stream: Buffer.from('not zlib data at all', 'latin1') },
  ]);
  refused(run(corrupt));
});

test('an active-content name is unreadable even with a text layer (the upload refuses it too)', () => {
  const extra = (body: string) => textPdf([linesContent(['text'])], { extra: [body] });
  for (const body of [
    '<< /S /JavaScript /JS (1) >>',
    '<< /Type /EmbeddedFile >>',
    '<< /S /Launch /F (x) >>',
    '<< /RichMedia 1 >>',
    '<< /XFA 1 >>',
  ])
    refused(run(extra(body)), 'unreadable', body);
  assert.equal(run(extra('<< /JSX 1 /JavaScriptish 2 >>')).ok, true, 'whole names only');
});

test('cycles and deep nesting end as unreadable, never a hang or a stack overflow', () => {
  const cycle = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [2 0 R] /Count 1 >>',
  ]);
  refused(run(cycle));
  const lengthCycle = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
    { dict: '/Length 5 0 R', stream: page('(x) Tj') },
    '5 0 R',
  ]);
  refused(run(lengthCycle));
  // Round 1 (W4-05d): a /Length that names a stream whose /Length names the next stream, 3000 deep, is a nested read
  // chain with no cycle; it must end as unreadable, not as a RangeError out of the worker.
  const chain: TestObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
  ];
  for (let n = 4; n < 3004; n += 1) chain.push({ dict: `/Length ${n + 1} 0 R`, stream: '' });
  chain.push('0');
  refused(run(buildTestPdf(chain)), 'unreadable', 'a 3000-deep /Length chain');
  const deep = buildTestPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources 5 0 R >>',
    { dict: '', stream: page('(x) Tj') },
    `${'['.repeat(200)}${']'.repeat(200)}`,
  ]);
  refused(run(deep), 'unreadable', 'nesting deeper than 64');
  const deepContent = textPdf([page(`${'['.repeat(5000)}(x) Tj`)]);
  refused(run(deepContent), 'unreadable', 'a content stream nested too deep yields no text');
  const deepTree: TestObject[] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  for (let i = 2; i < 100; i += 1) deepTree.push(`<< /Type /Pages /Kids [${i + 1} 0 R] /Count 1 >>`);
  deepTree.push(
    `<< /Type /Page /Contents ${deepTree.length + 2} 0 R /Resources << /Font << /F1 ${deepTree.length + 3} 0 R >> >> >>`,
    { dict: '', stream: page('(deep) Tj') },
    HELVETICA,
  );
  refused(run(buildTestPdf(deepTree)));
});

test('pages over maxPdfPages and xref entries over maxPdfObjects are limit_output', () => {
  const three = textPdf([linesContent(['1']), linesContent(['2']), linesContent(['3'])]);
  assert.equal(run(three, { maxPdfPages: 3 }).ok, true);
  refused(run(three, { maxPdfPages: 2 }), 'limit_output');
  const objects = 3 + 2 * 3 + 1; // in-use objects: catalog, pages, font, three pages and contents, the Type0 font
  assert.equal(run(three, { maxPdfObjects: objects }).ok, true);
  refused(run(three, { maxPdfObjects: objects - 1 }), 'limit_output');
});

test('a decoded stream over maxPartBytes, or all streams over maxTotalBytes, is limit_bytes', () => {
  const big = page(`${lit('x'.repeat(2000))} Tj`);
  const pdf = textPdf([big, big], { flate: true });
  assert.equal(run(pdf).ok, true);
  refused(run(pdf, { maxPartBytes: 1000 }), 'limit_bytes');
  refused(run(pdf, { maxTotalBytes: 3000 }), 'limit_bytes');
  const plain = textPdf([big, big]);
  refused(run(plain, { maxTotalBytes: 3000 }), 'limit_bytes', 'unfiltered streams count too');
});

test('text over maxTextChars is limit_output', () => {
  refused(run(textPdf([linesContent(['0123456789', 'abc'])]), { maxTextChars: 12 }), 'limit_output');
});

test('every truncation and every single-byte change of a text PDF ends as a clean reply, never a throw', () => {
  const pdf = textPdf(
    [
      page(`${lit('RAI-DESK-SYNTHETIC-FIXTURE fuzz')} Tj T* [(a) -300 <FEFF0041>] TJ 1 2 (b) "`),
      linesContent(['two']),
    ],
    { flate: false },
  );
  const flate = textPdf([linesContent(['compressed'])], { flate: true });
  for (const base of [pdf, flate]) {
    for (let end = 0; end < base.length; end += 1)
      assert.doesNotThrow(() => run(base.subarray(0, end)), `truncated at ${end}`);
    for (let at = 0; at < base.length; at += 1)
      for (const value of [0x00, 0x20, 0x28, 0x29, 0x3c, 0x5b, 0x2f, 0x39, 0xff]) {
        const mutated = Buffer.from(base);
        mutated[at] = value;
        assert.doesNotThrow(() => run(mutated), `byte ${at} = ${value}`);
      }
  }
});
