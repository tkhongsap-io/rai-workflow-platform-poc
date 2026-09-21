// Test-local byte builders for the W0-08 section 8.6 hostile set (unit level). The server never imports
// @rai/fixtures (W0-02 section 1.1), so the sniff tests build their own minimal PDF, stored-method ZIP, PNG and
// JPEG structures here; the integration suite runs the same rows through the route with the real fixture
// generator. Every structure is a stub: no real document, no macro, no malware, no EICAR (W0-08 8.6).

import { crc32, deflateSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
  flags?: number; // general-purpose bits (bit 0 = encrypted)
  method?: number; // 0 stored (default), 8 deflate, anything else refused
  declaredUncompressedSize?: number; // override for the "declared bomb" row
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

export interface ZipOptions {
  zip64Locator?: boolean; // insert a ZIP64 EOCD locator before the EOCD
  comment?: Buffer;
}

/** Stored-method ZIP with a central directory and an EOCD, mirroring the fixture generator's writer. */
export function buildZip(entries: ZipEntry[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 0;
    const data = method === 8 ? deflateSync(entry.data, { level: 6 }).subarray(2, -4) : entry.data; // raw deflate
    const crc = crc32(entry.data);
    const flags = entry.flags ?? 0;
    const uncompressed = entry.declaredUncompressedSize ?? entry.data.length;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0x5421),
      u32(crc),
      u32(data.length),
      u32(uncompressed),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0x5421),
        u32(crc),
        u32(data.length),
        u32(uncompressed),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(central);
  const locator = options.zip64Locator
    ? Buffer.concat([u32(0x07064b50), u32(0), Buffer.alloc(8, 0), u32(1)])
    : Buffer.alloc(0);
  const comment = options.comment ?? Buffer.alloc(0);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(comment.length),
    comment,
  ]);
  return Buffer.concat([...locals, centralBytes, locator, eocd]);
}

const CT_DOCX =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const CT_XLSX =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';

export function docxEntries(text = 'RAI-DESK-SYNTHETIC-FIXTURE unit'): ZipEntry[] {
  return [
    { name: '[Content_Types].xml', data: Buffer.from(CT_DOCX, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from('<Relationships/>', 'utf8') },
    {
      name: 'word/document.xml',
      data: Buffer.from(`<w:document><w:body><w:p>${text}</w:p></w:body></w:document>`, 'utf8'),
    },
  ];
}

export function xlsxEntries(): ZipEntry[] {
  return [
    { name: '[Content_Types].xml', data: Buffer.from(CT_XLSX, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from('<Relationships/>', 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>', 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet/>', 'utf8') },
  ];
}

export const docx = (): Buffer => buildZip(docxEntries());
export const xlsx = (): Buffer => buildZip(xlsxEntries());

/** A minimal single-page PDF: header, catalog, pages, page, xref, trailer, %%EOF. `extra` lands before the xref. */
export function pdf(extra = ''): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
  ];
  let body = '%PDF-1.4\n% RAI-DESK-SYNTHETIC-FIXTURE unit\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  body += extra;
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** RGB PNG of the given declared size; the IDAT holds one row of pixels for small sizes only (never decoded). */
export function png(width = 2, height = 2): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Math.min(height, 4);
  const cols = Math.min(width, 4);
  const raw = Buffer.alloc(rows * (1 + cols * 3), 0x7f);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** Baseline JPEG stub with a COM segment, DQT, SOF0 (given size), DHT, SOS, one scan byte, EOI. */
export function jpeg(width = 16, height = 16): Buffer {
  const sof = Buffer.from([
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  ]);
  const counts = Buffer.alloc(16, 0);
  counts[0] = 1;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xfe, Buffer.from('RAI-DESK-SYNTHETIC-FIXTURE unit', 'utf8')),
    jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    jpegSegment(0xc0, sof),
    jpegSegment(0xc4, Buffer.concat([Buffer.from([0x00]), counts, Buffer.from([0])])),
    jpegSegment(0xc4, Buffer.concat([Buffer.from([0x10]), counts, Buffer.from([0])])),
    jpegSegment(0xda, Buffer.from([1, 1, 0x00, 0, 63, 0])),
    Buffer.from([0x00]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

export interface HostileRow {
  name: string;
  bytes: Buffer;
  declaredName: string;
  expected: string; // an UnsafeUploadReason, or 'accepted'
}

/** Base documents the rows mutate; the integration suite passes the real fixture generator's bytes. */
export interface BaseDocuments {
  pdf: Buffer;
  docx: Buffer;
  xlsx: Buffer;
  png: Buffer;
  jpeg: Buffer;
}

export function unitBaseDocuments(): BaseDocuments {
  return { pdf: pdf(), docx: docx(), xlsx: xlsx(), png: png(), jpeg: jpeg() };
}

/** W0-08 section 8.6 rows that are decided by bytes and name alone (size boundaries and pack totals are route-level). */
export function hostileSet(base: BaseDocuments = unitBaseDocuments()): HostileRow[] {
  const fixtureDocx = base.docx;
  const fixturePdf = base.pdf;
  const fixturePng = base.png;
  const fixtureJpeg = base.jpeg;
  const docxPlus = (entry: ZipEntry): Buffer => buildZip([...docxEntries(), entry]);
  const ole = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(504),
  ]);
  const withFlags = (name: string, flags: number): Buffer =>
    buildZip(docxEntries().map((e) => (e.name === name ? { ...e, flags } : e)));
  const jpegBomb = (): Buffer => jpeg(65_535, 65_535);
  const pdfPlus = (objectText: string): Buffer => {
    const at = fixturePdf.lastIndexOf('xref');
    return Buffer.concat([
      fixturePdf.subarray(0, at),
      Buffer.from(`${objectText}\n`, 'utf8'),
      fixturePdf.subarray(at),
    ]);
  };
  return [
    {
      name: 'PE stub',
      bytes: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4094)]),
      declaredName: 'report.pdf',
      expected: 'type_not_allowed',
    },
    {
      name: 'ELF stub',
      bytes: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)]),
      declaredName: 'report.docx',
      expected: 'type_not_allowed',
    },
    {
      name: 'Shebang script',
      bytes: Buffer.from('#!/bin/sh\nexit 0\n'),
      declaredName: 'notes.pdf',
      expected: 'type_not_allowed',
    },
    {
      name: 'HTML',
      bytes: Buffer.from('<html><script>1</script></html>'),
      declaredName: 'page.pdf',
      expected: 'type_not_allowed',
    },
    { name: 'Renamed PNG', bytes: fixturePng, declaredName: 'diagram.pdf', expected: 'type_mismatch' },
    { name: 'Renamed PDF', bytes: fixturePdf, declaredName: 'scan.png', expected: 'type_mismatch' },
    { name: 'XLSX as DOCX', bytes: base.xlsx, declaredName: 'sheet.docx', expected: 'type_mismatch' },
    {
      name: 'Plain ZIP',
      bytes: buildZip([{ name: 'hello.txt', data: Buffer.from('hello') }]),
      declaredName: 'pack.docx',
      expected: 'container_invalid',
    },
    {
      name: 'Polyglot',
      bytes: Buffer.concat([fixtureJpeg, buildZip([{ name: 'x.txt', data: Buffer.from('x') }])]),
      declaredName: 'photo.jpg',
      expected: 'container_invalid',
    },
    {
      name: 'Polyglot 2',
      bytes: Buffer.concat([fixtureDocx, Buffer.alloc(16, 0x41)]),
      declaredName: 'brd.docx',
      expected: 'container_invalid',
    },
    {
      name: 'Macro package',
      bytes: docxPlus({ name: 'word/vbaProject.bin', data: Buffer.alloc(16) }),
      declaredName: 'brd.docx',
      expected: 'macro_enabled',
    },
    {
      name: 'Macro extension',
      bytes: fixtureDocx,
      declaredName: 'brd.docm',
      expected: 'extension_not_allowed',
    },
    {
      name: 'Nested archive',
      bytes: docxPlus({ name: 'word/embeddings/payload.zip', data: Buffer.alloc(16) }),
      declaredName: 'brd.docx',
      expected: 'nested_archive',
    },
    {
      name: 'Embedded executable',
      bytes: docxPlus({ name: 'word/embeddings/tool.exe', data: Buffer.alloc(16) }),
      declaredName: 'brd.docx',
      expected: 'nested_archive',
    },
    {
      name: 'Encrypted entry',
      bytes: withFlags('word/document.xml', 0x0001),
      declaredName: 'brd.docx',
      expected: 'encrypted_entry',
    },
    {
      name: 'Traversal entry',
      bytes: docxPlus({ name: '../../etc/passwd', data: Buffer.from('x') }),
      declaredName: 'brd.docx',
      expected: 'container_invalid',
    },
    {
      name: 'Declared bomb',
      bytes: docxPlus({
        name: 'word/big.bin',
        data: Buffer.alloc(8),
        declaredUncompressedSize: 1024 * 1024 * 1024,
      }),
      declaredName: 'brd.docx',
      expected: 'container_invalid',
    },
    {
      name: 'ZIP64',
      bytes: buildZip(docxEntries(), { zip64Locator: true }),
      declaredName: 'brd.docx',
      expected: 'container_invalid',
    },
    {
      name: 'PDF with JS',
      bytes: pdfPlus('9 0 obj\n<< /OpenAction << /S /JavaScript /JS (1) >> >>\nendobj'),
      declaredName: 'form.pdf',
      expected: 'active_content',
    },
    {
      name: 'PDF with embedded file',
      bytes: pdfPlus('9 0 obj\n<< /Type /EmbeddedFile /Length 0 >>\nstream\n\nendstream\nendobj'),
      declaredName: 'form.pdf',
      expected: 'active_content',
    },
    {
      name: 'PDF without EOF',
      bytes: fixturePdf.subarray(0, fixturePdf.indexOf('%%EOF')),
      declaredName: 'scan.pdf',
      expected: 'container_invalid',
    },
    { name: 'PNG bomb', bytes: png(100_000, 100_000), declaredName: 'big.png', expected: 'image_too_large' },
    {
      name: 'PNG trailing',
      bytes: Buffer.concat([fixturePng, Buffer.alloc(8, 0x41)]),
      declaredName: 'diagram.png',
      expected: 'container_invalid',
    },
    { name: 'JPEG bomb', bytes: jpegBomb(), declaredName: 'big.jpg', expected: 'image_too_large' },
    { name: 'Empty', bytes: Buffer.alloc(0), declaredName: 'empty.pdf', expected: 'empty_file' },
    {
      name: 'Bad filename: traversal',
      bytes: fixturePdf,
      declaredName: '../escape.pdf',
      expected: 'filename_invalid',
    },
    {
      name: 'Bad filename: NUL',
      bytes: fixturePdf,
      declaredName: 'a\u0000b.pdf',
      expected: 'filename_invalid',
    },
    {
      name: 'Bad filename: 201 code points',
      bytes: fixturePdf,
      declaredName: `${'ก'.repeat(197)}.pdf`,
      expected: 'filename_invalid',
    },
    {
      name: 'Bad filename: extension only',
      bytes: fixturePdf,
      declaredName: '.pdf',
      expected: 'filename_invalid',
    },
    {
      name: 'Double extension',
      bytes: fixturePdf,
      declaredName: 'report.pdf.exe',
      expected: 'extension_not_allowed',
    },
    { name: 'Legacy Office', bytes: ole, declaredName: 'old.doc', expected: 'extension_not_allowed' },
    { name: 'Legacy Office renamed', bytes: ole, declaredName: 'old.docx', expected: 'type_not_allowed' },
    { name: 'Accepted PDF', bytes: fixturePdf, declaredName: 'RiskScreening.pdf', expected: 'accepted' },
    { name: 'Accepted DOCX', bytes: fixtureDocx, declaredName: 'BRD.docx', expected: 'accepted' },
    { name: 'Accepted XLSX', bytes: base.xlsx, declaredName: 'Checklist.XLSX', expected: 'accepted' },
    { name: 'Accepted PNG', bytes: fixturePng, declaredName: 'diagram.png', expected: 'accepted' },
    { name: 'Accepted JPEG', bytes: fixtureJpeg, declaredName: 'photo.jpeg', expected: 'accepted' },
    {
      name: 'Accepted Thai name',
      bytes: fixturePdf,
      declaredName: 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf',
      expected: 'accepted',
    },
  ];
}
