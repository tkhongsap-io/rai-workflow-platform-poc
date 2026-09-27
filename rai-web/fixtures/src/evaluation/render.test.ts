// W4-09a: the evaluation set's document builders and renderer (W4b plan section 11.1 layout; section 4.3 formats).
// The PDF and OOXML builders are additive: the slice1-synthetic bytes are pinned by data/manifest.json and checked
// by generate.test.ts, unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { sniff } from '@rai/server/artifacts/sniff';
import { FIXTURE_SENTINEL } from '../data/documents/index.js';
import { buildDocx, buildXlsxWorkbook } from '../generate/ooxml.js';
import { buildPdfDocument } from '../generate/pdf.js';
import { EVAL_CASES } from './cases.js';
import { claimLine, renderDocument } from './render.js';
import type { EvalDocument } from './types.js';
import { DEV_KEY_ORDER } from './vocabulary.js';

// ---- small readers (test-local) --------------------------------------------------------------------------------

interface ZipPart {
  name: string;
  method: number;
  data: Buffer; // decompressed
}

function readZip(bytes: Buffer): ZipPart[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  assert.ok(eocd >= 0);
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  const parts: ZipPart[] = [];
  for (let i = 0; i < count; i += 1) {
    const method = bytes.readUInt16LE(p + 10);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const size = bytes.readUInt32LE(p + 24);
    const nameLength = bytes.readUInt16LE(p + 28);
    const localOffset = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtra;
    const raw = bytes.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, size, name);
    parts.push({ name, method, data });
    p += 46 + nameLength;
  }
  return parts;
}

function part(parts: ZipPart[], name: string): string {
  const found = parts.find((x) => x.name === name);
  assert.ok(found, name);
  return found.data.toString('utf8');
}

/** Object bodies by number, and each content stream decoded. */
function pdfObjects(bytes: Buffer): Map<number, { dict: string; stream: Buffer | null }> {
  const text = bytes.toString('latin1');
  const out = new Map<number, { dict: string; stream: Buffer | null }>();
  const re = /(\d+) 0 obj\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    const body = text.slice(start, end);
    const s = body.indexOf('stream\n');
    if (s < 0) out.set(Number(m[1]), { dict: body, stream: null });
    else {
      const dict = body.slice(0, s);
      const length = Number(/\/Length (\d+)/.exec(dict)![1]);
      const raw = bytes.subarray(start + s + 7, start + s + 7 + length);
      out.set(Number(m[1]), {
        dict,
        stream: dict.includes('/FlateDecode') ? inflateSync(raw) : Buffer.from(raw),
      });
    }
  }
  return out;
}

function xrefIsConsistent(bytes: Buffer): boolean {
  const text = bytes.toString('latin1');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  if (text.slice(startxref, startxref + 4) !== 'xref') return false;
  const rows = text.slice(startxref).split('\n').slice(3);
  for (const row of rows) {
    const e = /^(\d{10}) 00000 n $/.exec(row);
    if (e === null) break;
    if (!/^\d+ 0 obj\n/.test(text.slice(Number(e[1])))) return false;
  }
  return true;
}

// ---- builders --------------------------------------------------------------------------------------------------

test('buildPdfDocument writes several pages with several lines each, and FlateDecode streams decode to the same operators', () => {
  for (const compression of ['none', 'flate'] as const) {
    const bytes = buildPdfDocument({
      title: `${FIXTURE_SENTINEL} t`,
      commentLines: ['comment'],
      compression,
      pages: [
        { kind: 'text', lines: ['first line', 'second (line)'] },
        { kind: 'text', lines: ['third line'] },
        { kind: 'text', lines: ['fourth line'] },
      ],
    });
    const text = bytes.toString('latin1');
    assert.match(text, /^%PDF-1\.4\n/);
    assert.match(text, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count 3/);
    assert.ok(xrefIsConsistent(bytes), `${compression}: xref`);
    const streams = [...pdfObjects(bytes).values()].flatMap((o) =>
      o.stream !== null && o.stream.toString('latin1').includes('BT') ? [o.stream.toString('latin1')] : [],
    );
    assert.equal(streams.length, 3);
    assert.match(streams[0]!, /\(first line\) Tj\nT\*\n\(second \\\(line\\\)\) Tj/);
    assert.equal(text.includes('/FlateDecode'), compression === 'flate');
    if (compression === 'flate') assert.ok(!text.includes('(first line)'), 'the operators are compressed');
  }
});

test('a non-ASCII line is written as a UTF-16BE hex string with BOM', () => {
  const bytes = buildPdfDocument({
    title: 't',
    commentLines: [],
    compression: 'none',
    pages: [{ kind: 'text', lines: ['ใช่'] }],
  });
  assert.ok(bytes.toString('latin1').includes('<FEFF0E430E0A0E48> Tj'));
});

test('an image-only page and a CID-font page carry no decodable text operator', () => {
  const bytes = buildPdfDocument({
    title: 't',
    commentLines: [],
    compression: 'none',
    pages: [{ kind: 'image' }, { kind: 'cid', lines: ['ข้อมูลส่วนบุคคล answer'] }],
  });
  const objects = [...pdfObjects(bytes).values()];
  const contents = objects.flatMap((o) =>
    o.stream !== null && !o.dict.includes('/Subtype /Image') ? [o.stream.toString('latin1')] : [],
  );
  assert.equal(contents.length, 2);
  assert.match(contents[0]!, /\/Im1 Do/);
  assert.doesNotMatch(contents[0]!, /Tj|TJ|'|"/);
  // CID page: only hex glyph codes under the Type0 font; no literal string, no BOM, no Thai code unit.
  assert.match(contents[1]!, /\/F2 \d+ Tf/);
  assert.doesNotMatch(contents[1]!, /\(|FEFF|0E[0-7][0-9A-F]/);
  const text = bytes.toString('latin1');
  assert.match(text, /\/Subtype \/Type0 .*\/Encoding \/Identity-H/);
  assert.ok(!text.includes('/ToUnicode'));
  assert.ok(!bytes.includes(Buffer.from('ข้อมูล', 'utf8')));
});

test('a broken cross-reference table: startxref and the offsets do not point at their objects', () => {
  const pages = [{ kind: 'text' as const, lines: ['a line'] }];
  const good = buildPdfDocument({ title: 't', commentLines: [], compression: 'none', pages });
  const broken = buildPdfDocument({
    title: 't',
    commentLines: [],
    compression: 'none',
    pages,
    brokenXref: true,
  });
  assert.ok(xrefIsConsistent(good));
  assert.ok(!xrefIsConsistent(broken));
  assert.ok(broken.toString('latin1').endsWith('%%EOF\n'));
});

test('buildXlsxWorkbook: several sheets, shared strings, numeric cells, stored or deflate entries', () => {
  for (const method of ['stored', 'deflate'] as const) {
    const bytes = buildXlsxWorkbook({
      title: `${FIXTURE_SENTINEL} x`,
      sharedStrings: true,
      method,
      sheets: [
        { name: 'Evidence', rows: [['note'], ['note']] },
        {
          name: 'Claims',
          rows: [
            ['item', 'answer', 'denominator'],
            ['2.1', 'Yes', '500'],
          ],
        },
      ],
    });
    const parts = readZip(bytes);
    assert.ok(
      parts
        .filter((p) => p.name !== 'docProps/core.xml')
        .every((p) => p.method === (method === 'deflate' ? 8 : 0)),
    );
    const core = parts.find((p) => p.name === 'docProps/core.xml');
    assert.equal(core?.method, 0, 'the provenance title stays greppable');
    const workbook = part(parts, 'xl/workbook.xml');
    assert.match(
      workbook,
      /<sheet name="Evidence" sheetId="1" r:id="rId1"\/><sheet name="Claims" sheetId="2" r:id="rId2"\/>/,
    );
    const sst = part(parts, 'xl/sharedStrings.xml');
    assert.match(sst, /count="6" uniqueCount="5"/);
    assert.match(
      sst,
      /<si><t xml:space="preserve">note<\/t><\/si><si><t xml:space="preserve">item<\/t><\/si>/,
    );
    const sheet2 = part(parts, 'xl/worksheets/sheet2.xml');
    assert.match(sheet2, /<c r="A2"><v>2\.1<\/v><\/c><c r="B2" t="s"><v>4<\/v><\/c>/);
    assert.match(sheet2, /<c r="C2"><v>500<\/v><\/c>/);
    assert.match(part(parts, '[Content_Types].xml'), /sharedStrings\+xml/);
    assert.match(part(parts, 'xl/_rels/workbook.xml.rels'), /Target="sharedStrings.xml"/);
  }
});

test('buildDocx keeps its slice-1 output without options, and can declare a DOCTYPE or deflate its parts', () => {
  const plain = buildDocx(['a', 'b']);
  assert.ok(plain.equals(buildDocx(['a', 'b'], {})));
  const doctype = part(readZip(buildDocx(['a'], { doctype: true })), 'word/document.xml');
  assert.match(doctype, /^<\?xml [^>]+\?>\n<!DOCTYPE w:document \[/);
  const deflated = readZip(buildDocx(['a', 'b'], { method: 'deflate' }));
  assert.ok(deflated.every((p) => p.method === 8));
  assert.match(
    part(deflated, 'word/document.xml'),
    /<w:p><w:r><w:t xml:space="preserve">b<\/w:t><\/w:r><\/w:p>/,
  );
});

// ---- renderer --------------------------------------------------------------------------------------------------

const claim = {
  item: 'hallucination',
  ref: '2.1',
  answer: 'yes',
  metric: 'hallucination_rate',
  value: '0.4%',
  denominator: '500',
  threshold: '1%',
  evidence: 'eval-report-a',
  tier: 'high',
} as const;

function doc(
  format: EvalDocument['format'],
  pages: EvalDocument['pages'],
  language: 'en' | 'th' = 'en',
): EvalDocument {
  const ext = format.startsWith('pdf')
    ? 'pdf'
    : format === 'png'
      ? 'png'
      : format.startsWith('docx')
        ? 'docx'
        : 'xlsx';
  return { documentId: 'ev-test-s1', slot: 1, format, language, filename: `EvalTest.${ext}`, pages };
}

test('claimLine writes the dev key order, `key: value` pairs joined by "; ", and only the fields present', () => {
  assert.equal(
    claimLine(claim, 'en'),
    'item: 2.1; question: Hallucination rate measured on the evaluation set?; answer: Yes; metric: hallucination_rate; value: 0.4%; denominator: 500; threshold: 1%; evidence: eval-report-a; tier: high',
  );
  assert.equal(
    claimLine({ item: 'personal_data', ref: '1.2', answer: 'no' }, 'th'),
    'item: 1.2; question: ระบบมีการประมวลผลข้อมูลส่วนบุคคลหรือไม่; answer: ไม่ใช่',
  );
});

test('DOCX: the preamble comes first and each claim locator is the 1-based ordinal of its paragraph', () => {
  const r = renderDocument(
    doc('docx', [[{ text: 'intro' }, { claim }], [{ claim: { ...claim, ref: '2.2' } }]]),
  );
  const xml = part(readZip(r.bytes), 'word/document.xml');
  const paragraphs = [...xml.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((m) => m[1]!);
  assert.ok(paragraphs[0]!.startsWith(`${FIXTURE_SENTINEL} qc-eval-synthetic@1 ev-test-s1`));
  assert.deepEqual(r.claimLocators, [
    { kind: 'section', index: paragraphs.indexOf('intro') + 2 },
    { kind: 'section', index: paragraphs.indexOf('intro') + 3 },
  ]);
  for (const l of r.claimLocators)
    assert.ok(l.kind === 'section' && paragraphs[l.index - 1]!.includes('answer: Yes'));
});

test('XLSX: a header row precedes the first claim on each sheet and the locator is the answer cell', () => {
  const r = renderDocument(doc('xlsx', [[{ text: 'intro' }], [{ text: 'sheet two' }, { claim }, { claim }]]));
  assert.deepEqual(r.claimLocators, [
    { kind: 'cell', sheetIndex: 2, cell: 'C3' },
    { kind: 'cell', sheetIndex: 2, cell: 'C4' },
  ]);
  const parts = readZip(r.bytes);
  const sst = [...part(parts, 'xl/sharedStrings.xml').matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map(
    (m) => m[1]!,
  );
  const sheet2 = part(parts, 'xl/worksheets/sheet2.xml');
  const cell = (ref: string): string => {
    const m = new RegExp(`<c r="${ref}"( t="s")?><v>([^<]*)</v></c>`).exec(sheet2);
    assert.ok(m, ref);
    return m[1] === undefined ? m[2]! : sst[Number(m[2])]!;
  };
  assert.deepEqual(
    DEV_KEY_ORDER.map((_, i) => cell(`${String.fromCharCode(65 + i)}2`)),
    [...DEV_KEY_ORDER],
  );
  assert.equal(cell('C3'), 'Yes');
  assert.equal(cell('F3'), '500');
});

test('PDF: page 1 carries the preamble; each claim locator is its page', () => {
  for (const format of ['pdf', 'pdf_flate'] as const) {
    const r = renderDocument(doc(format, [[{ claim }], [{ text: 'x' }, { claim }]]));
    assert.deepEqual(r.claimLocators, [
      { kind: 'page', page: 1 },
      { kind: 'page', page: 2 },
    ]);
  }
});

test('unreadable formats expose no claim locator', () => {
  for (const format of ['png', 'pdf_image', 'pdf_cid', 'pdf_broken_xref', 'docx_doctype'] as const)
    assert.deepEqual(renderDocument(doc(format, [[{ claim }]])).claimLocators, []);
});

test('every document of the set passes the upload sniff as its media type and carries the sentinel and its id in plain bytes', () => {
  let count = 0;
  for (const c of EVAL_CASES)
    for (const s of c.slots) {
      if (s.disposition !== 'attached') continue;
      const r = renderDocument(s.document);
      const sniffed = sniff(r.bytes, r.filename);
      assert.ok(sniffed.ok, `${r.documentId}: ${JSON.stringify(sniffed)}`);
      assert.equal(sniffed.mediaType, r.mediaType, r.documentId);
      const latin1 = r.bytes.toString('latin1');
      assert.ok(latin1.includes(`${FIXTURE_SENTINEL} qc-eval-synthetic@1 ${r.documentId}`), r.documentId);
      assert.equal(r.filename, r.filename.normalize('NFC'));
      count += 1;
    }
  assert.ok(count > 40);
});
