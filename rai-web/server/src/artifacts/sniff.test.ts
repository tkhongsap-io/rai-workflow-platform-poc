// W0-08 section 2.5: the sniff is unit-tested with node:test against the section 8.6 hostile set. Every row that
// bytes and name alone decide is here; the size boundaries and the pack total are route-level rows in the
// integration suite. Also: the section 3 filename rule and the section 6 Content-Disposition round trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNSAFE_UPLOAD_REASONS } from '@rai/shared/errors';
import {
  asciiFallback,
  checkFilename,
  contentDisposition,
  filenameFromContentDisposition,
  rfc8187Decode,
  rfc8187Encode,
} from './filename.js';
import { checkStructure, inspectBytes, sniff, sniffMagic } from './sniff.js';
import { buildZip, docx, docxEntries, hostileSet, jpeg, pdf, png, xlsx } from './sniff.test-bytes.js';

test('W0-08 8.6 hostile set: every byte-level row is rejected with the stated reason and every fixture kind is accepted', () => {
  const rows = hostileSet();
  assert.ok(rows.length >= 32, 'the section 8.6 byte-level rows are all present');
  for (const row of rows) {
    const result = sniff(row.bytes, row.declaredName);
    if (row.expected === 'accepted') {
      assert.equal(result.ok, true, `${row.name}: expected accepted, got ${JSON.stringify(result)}`);
    } else {
      assert.equal(result.ok, false, `${row.name}: expected ${row.expected}, got accepted`);
      if (!result.ok) assert.equal(result.reason, row.expected, `${row.name}: reason`);
      assert.ok(
        (UNSAFE_UPLOAD_REASONS as readonly string[]).includes(row.expected),
        `${row.name}: reason vocabulary`,
      );
    }
  }
});

test('the stored media type comes from the section 2 row of the sniffed bytes, never from the request', () => {
  assert.deepEqual(sniff(pdf(), 'a.pdf'), { ok: true, kind: 'pdf', mediaType: 'application/pdf' });
  assert.deepEqual(sniff(docx(), 'a.docx'), {
    ok: true,
    kind: 'docx',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.deepEqual(sniff(xlsx(), 'a.xlsx'), {
    ok: true,
    kind: 'xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  assert.deepEqual(sniff(png(), 'a.png'), { ok: true, kind: 'png', mediaType: 'image/png' });
  assert.deepEqual(sniff(jpeg(), 'a.jpg'), { ok: true, kind: 'jpeg', mediaType: 'image/jpeg' });
});

test('magic on the first 8 KiB: the five section 2 structures and nothing else', () => {
  assert.equal(sniffMagic(pdf()), 'pdf');
  assert.equal(sniffMagic(Buffer.from('%PDF-2.0\n')), 'pdf');
  assert.equal(sniffMagic(Buffer.from('%PDF-3.0\n')), undefined, 'only 1.x and 2.x');
  assert.equal(sniffMagic(docx()), 'zip');
  assert.equal(sniffMagic(png()), 'png');
  assert.equal(sniffMagic(jpeg()), 'jpeg');
  for (const magic of [
    [0x4d, 0x5a],
    [0x7f, 0x45, 0x4c, 0x46],
    [0xcf, 0xfa, 0xed, 0xfe],
    [0x23, 0x21],
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    [0x1f, 0x8b],
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    [0x47, 0x49, 0x46, 0x38],
    [0x3c, 0x68, 0x74, 0x6d, 0x6c],
  ]) {
    assert.equal(sniffMagic(Buffer.concat([Buffer.from(magic), Buffer.alloc(64)])), undefined);
  }
  assert.equal(sniffMagic(Buffer.alloc(0)), undefined);
});

test('type_mismatch carries the sniffed media type for the log line; a plain ZIP under an image name carries none', () => {
  assert.deepEqual(inspectBytes(png(), 'pdf'), {
    ok: false,
    reason: 'type_mismatch',
    sniffedMediaType: 'image/png',
  });
  assert.deepEqual(inspectBytes(docx(), 'png'), { ok: false, reason: 'type_mismatch' });
  assert.deepEqual(inspectBytes(xlsx(), 'docx'), {
    ok: false,
    reason: 'type_mismatch',
    sniffedMediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
});

test('PDF active-content scan matches whole name tokens and %%EOF within the last 1,024 bytes', () => {
  assert.equal(
    checkStructure(pdf('5 0 obj << /S /Launch /F (x) >> endobj\n'), 'pdf', { maxImagePixels: 1 }).ok,
    false,
  );
  assert.deepEqual(checkStructure(pdf('% /RichMedia\n'), 'pdf', { maxImagePixels: 1 }), {
    ok: false,
    reason: 'active_content',
  });
  assert.deepEqual(checkStructure(pdf('% /XFA\n'), 'pdf', { maxImagePixels: 1 }), {
    ok: false,
    reason: 'active_content',
  });
  assert.equal(
    checkStructure(pdf('% /JSX and /JavaScriptish are names of their own\n'), 'pdf', { maxImagePixels: 1 })
      .ok,
    true,
  );
  const eofFar = Buffer.concat([pdf(), Buffer.from('%'.repeat(1100))]);
  assert.deepEqual(checkStructure(eofFar, 'pdf', { maxImagePixels: 1 }), {
    ok: false,
    reason: 'container_invalid',
  });
});

test('ZIP container rules: entry count, per-entry and total declared sizes, compression method, package kind', () => {
  const limits = { maxImagePixels: 1 };
  const many = buildZip([
    ...docxEntries(),
    ...Array.from({ length: 2001 }, (_, i) => ({ name: `word/p${i}.xml`, data: Buffer.alloc(1) })),
  ]);
  assert.deepEqual(checkStructure(many, 'docx', limits), { ok: false, reason: 'container_invalid' });
  const bigTotal = buildZip([
    ...docxEntries(),
    ...Array.from({ length: 6 }, (_, i) => ({
      name: `word/m${i}.bin`,
      data: Buffer.alloc(1),
      declaredUncompressedSize: 90 * 1024 * 1024,
    })),
  ]);
  assert.deepEqual(
    checkStructure(bigTotal, 'docx', limits),
    { ok: false, reason: 'container_invalid' },
    'sum over 500 MiB',
  );
  const aes = buildZip(docxEntries().map((e) => (e.name === 'word/document.xml' ? { ...e, method: 99 } : e)));
  assert.deepEqual(
    checkStructure(aes, 'docx', limits),
    { ok: false, reason: 'container_invalid' },
    'method 99',
  );
  const deflated = buildZip(docxEntries().map((e) => ({ ...e, method: 8 })));
  assert.equal(checkStructure(deflated, 'docx', limits).ok, true, 'method 8 is allowed');
  const both = buildZip([...docxEntries(), { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') }]);
  assert.deepEqual(
    checkStructure(both, 'docx', limits),
    { ok: false, reason: 'container_invalid' },
    'both kinds present',
  );
  const noTypes = buildZip(docxEntries().filter((e) => e.name !== '[Content_Types].xml'));
  assert.deepEqual(checkStructure(noTypes, 'docx', limits), { ok: false, reason: 'container_invalid' });
  const backslash = buildZip([...docxEntries(), { name: 'word\\evil.xml', data: Buffer.alloc(1) }]);
  assert.deepEqual(checkStructure(backslash, 'docx', limits), { ok: false, reason: 'container_invalid' });
  const leadingSlash = buildZip([...docxEntries(), { name: '/word/evil.xml', data: Buffer.alloc(1) }]);
  assert.deepEqual(checkStructure(leadingSlash, 'docx', limits), { ok: false, reason: 'container_invalid' });
  const macroDir = buildZip([...docxEntries(), { name: 'xl/VBAPROJECT.BIN', data: Buffer.alloc(1) }]);
  assert.deepEqual(
    checkStructure(macroDir, 'docx', limits),
    { ok: false, reason: 'macro_enabled' },
    'any directory, case-insensitive',
  );
  const withComment = buildZip(docxEntries(), { comment: Buffer.from('ok') });
  assert.equal(
    checkStructure(withComment, 'docx', limits).ok,
    true,
    'an EOCD comment is counted, not trailing bytes',
  );
});

test('PNG and JPEG rules: IHDR first, pixel cap from configuration, IEND last, SOF before SOS, EOI last', () => {
  assert.equal(
    checkStructure(png(2000, 2000), 'png', { maxImagePixels: 4_000_000 }).ok,
    true,
    'exactly at the cap',
  );
  assert.deepEqual(checkStructure(png(2000, 2001), 'png', { maxImagePixels: 4_000_000 }), {
    ok: false,
    reason: 'image_too_large',
  });
  assert.deepEqual(checkStructure(png(0, 10), 'png', { maxImagePixels: 4_000_000 }), {
    ok: false,
    reason: 'container_invalid',
  });
  const noIhdr = Buffer.concat([png().subarray(0, 8), png().subarray(33)]);
  assert.deepEqual(checkStructure(noIhdr, 'png', { maxImagePixels: 4_000_000 }), {
    ok: false,
    reason: 'container_invalid',
  });
  assert.equal(checkStructure(jpeg(2000, 2000), 'jpeg', { maxImagePixels: 4_000_000 }).ok, true);
  assert.deepEqual(checkStructure(jpeg(2000, 2001), 'jpeg', { maxImagePixels: 4_000_000 }), {
    ok: false,
    reason: 'image_too_large',
  });
  const noEoi = jpeg().subarray(0, -2);
  assert.deepEqual(checkStructure(noEoi, 'jpeg', { maxImagePixels: 4_000_000 }), {
    ok: false,
    reason: 'container_invalid',
  });
  const sosFirst = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]),
    Buffer.from([0xff, 0xd9]),
  ]);
  assert.deepEqual(checkStructure(sosFirst, 'jpeg', { maxImagePixels: 4_000_000 }), {
    ok: false,
    reason: 'container_invalid',
  });
});

test('filename rule (W0-08 section 3): NFC, 200 code points, no path or control characters, allowed extension, non-empty stem', () => {
  const thai = 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf';
  const ok = checkFilename(thai);
  assert.deepEqual(ok, { ok: true, filename: thai, extension: 'pdf', kind: 'pdf' });
  const nfd = 'Résumé_ผู้ให้บริการ.pdf'.normalize('NFD'); // Thai has no composed forms; the Latin letters exercise NFC
  assert.notEqual(nfd, nfd.normalize('NFC'));
  const normalised = checkFilename(nfd);
  assert.equal(normalised.ok && normalised.filename, nfd.normalize('NFC'), 'NFD input is stored NFC');
  assert.deepEqual(checkFilename(`${'ก'.repeat(196)}.pdf`).ok, true, 'exactly 200 code points');
  assert.deepEqual(checkFilename(`${'ก'.repeat(197)}.pdf`), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename(' a.pdf'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('a.pdf '), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('a\tb.pdf'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('a\u007fb.pdf'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('dir\\a.pdf'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('.'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('..'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename(''), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename(undefined), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('.pdf'), { ok: false, reason: 'filename_invalid' });
  assert.deepEqual(checkFilename('README'), { ok: false, reason: 'extension_not_allowed' });
  assert.deepEqual(checkFilename('a.PDF').ok, true, 'case-insensitive extension');
  for (const ext of [
    'zip',
    'exe',
    'docm',
    'xlsm',
    'doc',
    'xls',
    'rtf',
    'html',
    'svg',
    'xml',
    'gif',
    'webp',
    'js',
    'sh',
  ])
    assert.deepEqual(checkFilename(`a.${ext}`), { ok: false, reason: 'extension_not_allowed' }, ext);
});

test('Content-Disposition (W0-08 section 6): RFC 8187 filename* round-trips a Thai name; ASCII fallback never empty', () => {
  const thai = 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf';
  const header = contentDisposition(thai);
  assert.ok(header.startsWith('attachment; filename="'));
  assert.ok(header.includes("filename*=UTF-8''%E0%B9%80"), header);
  assert.equal(filenameFromContentDisposition(header), thai);
  assert.equal(rfc8187Decode(rfc8187Encode(thai)), thai);
  assert.equal(rfc8187Encode("a b'c(d).pdf"), "UTF-8''a%20b%27c%28d%29.pdf", 'only attr-chars stay literal');
  assert.equal(
    asciiFallback(thai),
    `${'_'.repeat(26)}2569.pdf`,
    'ASCII code points stay, every other one is _',
  );
  assert.equal(asciiFallback('plain "quoted"\\name.pdf'), 'plain _quoted__name.pdf');
  assert.equal(asciiFallback('ก'), 'artifact');
  assert.equal(
    contentDisposition('BRD_v1.0.docx'),
    `attachment; filename="BRD_v1.0.docx"; filename*=UTF-8''BRD_v1.0.docx`,
  );
});
