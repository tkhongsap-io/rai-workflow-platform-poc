// W4-05c (W4b plan section 4.3): DOCX yields one `section` segment per non-blank paragraph, located by its 1-based
// paragraph ordinal and carrying no document text in the locator (decision 21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInWorker, type WorkerLimits, type WorkerReply } from './extract.js';
import { extractDocx } from './docx.js';
import { buildTestZip, docxEntries, docxOf, documentXml, DOCX, para, W_NS } from './ooxml.test-helper.js';

const LIMITS: WorkerLimits = {
  maxTextChars: 100_000,
  maxSegments: 1000,
  maxPartBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxPdfPages: 10,
  maxPdfObjects: 100,
};
const run = (bytes: Buffer, limits: WorkerLimits = LIMITS): WorkerReply =>
  extractInWorker({ mediaType: DOCX, bytes, limits }, new Map([[DOCX, extractDocx]]));
const docxWith = (body: string, method = 8) => buildTestZip(docxEntries(body, method));

test('each paragraph is one section segment with its 1-based ordinal', () => {
  assert.deepEqual(run(docxOf(['First line', 'บรรทัดที่สอง', 'metric: accuracy; value: 0.91'])), {
    ok: true,
    segments: [
      { locator: { kind: 'section', index: 1 }, text: 'First line' },
      { locator: { kind: 'section', index: 2 }, text: 'บรรทัดที่สอง' },
      { locator: { kind: 'section', index: 3 }, text: 'metric: accuracy; value: 0.91' },
    ],
  });
});

test('stored and deflate packages read the same', () => {
  assert.deepEqual(run(docxOf(['a', 'b'], 0)), run(docxOf(['a', 'b'], 8)));
});

test('blank paragraphs keep their ordinal but yield no segment', () => {
  const body = `${para('one')}<w:p/><w:p><w:r><w:t>   </w:t></w:r></w:p>${para('four')}`;
  assert.deepEqual(run(docxWith(body)), {
    ok: true,
    segments: [
      { locator: { kind: 'section', index: 1 }, text: 'one' },
      { locator: { kind: 'section', index: 4 }, text: 'four' },
    ],
  });
});

test('runs join; tabs and breaks become whitespace; deleted text, field codes and fallbacks are not read', () => {
  const body =
    '<w:p><w:r><w:t>Hal</w:t></w:r><w:r><w:t>lu</w:t><w:tab/><w:t>cination</w:t><w:br/><w:t>rate</w:t></w:r>' +
    '<w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>' +
    '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
    '<mc:Choice Requires="wps"><w:t>shape text</w:t></mc:Choice>' +
    '<mc:Fallback><w:p><w:r><w:t>shape text</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:r></w:p>' +
    para('last');
  assert.deepEqual(run(docxWith(body)), {
    ok: true,
    segments: [
      { locator: { kind: 'section', index: 1 }, text: 'Hallu\tcination\nrate' },
      { locator: { kind: 'section', index: 2 }, text: 'shape text' },
      { locator: { kind: 'section', index: 3 }, text: 'last' },
    ],
  });
});

test('paragraphs inside tables and text boxes are numbered in document order', () => {
  const body =
    para('before') +
    `<w:tbl><w:tr><w:tc>${para('cell one')}</w:tc><w:tc>${para('cell two')}</w:tc></w:tr></w:tbl>` +
    '<w:p><w:r><w:t>outer</w:t><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></w:r></w:p>' +
    para('after');
  const reply = run(docxWith(body));
  assert.ok(reply.ok);
  assert.deepEqual(
    reply.segments.map((s) => [s.locator.index, s.text]),
    [
      [1, 'before'],
      [2, 'cell one'],
      [3, 'cell two'],
      [4, 'outer'],
      [5, 'boxed'],
      [6, 'after'],
    ],
  );
});

test('another prefix bound to the WordprocessingML namespace, and Strict OOXML, read the same', () => {
  const xml = documentXml('<x:p><x:r><x:t>prefixed</x:t></x:r></x:p>', 'x');
  const entries = docxEntries('').map((e) => (e.name === 'word/document.xml' ? { ...e, data: xml } : e));
  const reply = run(buildTestZip(entries));
  assert.deepEqual(reply, {
    ok: true,
    segments: [{ locator: { kind: 'section', index: 1 }, text: 'prefixed' }],
  });
  const strict = xml.replace(W_NS, 'http://purl.oclc.org/ooxml/wordprocessingml/main');
  const strictEntries = entries.map((e) => (e.name === 'word/document.xml' ? { ...e, data: strict } : e));
  assert.deepEqual(run(buildTestZip(strictEntries)), reply);
});

test('entities in the text expand; the locator never carries text', () => {
  const reply = run(docxWith('<w:p><w:r><w:t>a &lt; b &amp; &#3585;</w:t></w:r></w:p>'));
  assert.deepEqual(reply, {
    ok: true,
    segments: [{ locator: { kind: 'section', index: 1 }, text: 'a < b & ก' }],
  });
  assert.ok(reply.ok);
  assert.deepEqual(Object.keys(reply.segments[0]!.locator), ['kind', 'index']);
});

test('no document part, a DOCTYPE, an unknown entity, markup errors or no text are unreadable', () => {
  const withoutDocument = docxEntries(para('x')).filter((e) => e.name !== 'word/document.xml');
  const doctype = docxEntries(para('x')).map((e) =>
    e.name === 'word/document.xml'
      ? { ...e, data: `<!DOCTYPE w:document [<!ENTITY e "synthetic">]>\n${documentXml(para('&e;'))}` }
      : e,
  );
  const cases: Array<[string, Buffer]> = [
    ['no word/document.xml', buildTestZip(withoutDocument)],
    ['DOCTYPE', buildTestZip(doctype)],
    ['unknown entity', docxWith('<w:p><w:r><w:t>&nbsp;</w:t></w:r></w:p>')],
    ['unbalanced', docxWith('<w:p><w:r><w:t>x</w:r></w:p>')],
    ['no paragraphs', docxWith('<w:sectPr/>')],
    ['only blank paragraphs', docxWith('<w:p/><w:p><w:r><w:t> </w:t></w:r></w:p>')],
    ['not a zip', Buffer.from('PK\u0003\u0004 not really')],
  ];
  for (const [name, bytes] of cases) assert.deepEqual(run(bytes), { ok: false, reason: 'unreadable' }, name);
});

test('output over the text or segment cap is limit_output', () => {
  const many = docxOf(Array.from({ length: 20 }, (_, i) => `paragraph ${i}`));
  assert.deepEqual(run(many, { ...LIMITS, maxSegments: 19 }), { ok: false, reason: 'limit_output' });
  assert.deepEqual(run(many, { ...LIMITS, maxTextChars: 50 }), { ok: false, reason: 'limit_output' });
});

test('a part over the decompressed cap is limit_bytes', () => {
  const big = docxOf(['x'.repeat(5000)]);
  assert.deepEqual(run(big, { ...LIMITS, maxPartBytes: 4000 }), { ok: false, reason: 'limit_bytes' });
});
