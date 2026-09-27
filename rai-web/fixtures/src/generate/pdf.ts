// Hand-written single-page PDF (W0-08 8.5): header, catalog, pages, one page, one uncompressed Helvetica content
// stream, an Info dictionary whose /Subject carries the Thai line as UTF-16BE with BOM, the same line as UTF-8 in a
// `%` comment, an xref table and %%EOF. No /JavaScript, /JS, /Launch, /EmbeddedFile, /RichMedia or /XFA token
// exists by construction (the W0-08 2.1 scan). Rendering Thai glyphs is not a goal; the bytes are present.
// The medium variant appends deterministic `%` comment filler before the xref so the file is about 2 MiB.

import { createHash } from 'node:crypto';
import { zlibFixed } from './deflate.js';

export const PDF_MEDIUM_TARGET_BYTES = 2 * 1024 * 1024;

function pdfString(text: string): string {
  // Literal string: escape backslash and parentheses; the callers pass ASCII lines only.
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function utf16beHex(text: string): string {
  const units: string[] = ['FEFF'];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      units.push((0xd800 + (v >> 10)).toString(16).padStart(4, '0'));
      units.push((0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'));
    } else units.push(code.toString(16).padStart(4, '0'));
  }
  return `<${units.join('').toUpperCase()}>`;
}

export interface PdfInput {
  asciiLines: string[]; // shown in the content stream (Helvetica)
  thaiLine: string; // in the % comment and in /Subject
  title: string; // ASCII
  filler?: { targetBytes: number; seed: string } | undefined;
}

export function buildPdf(input: PdfInput): Buffer {
  const parts: Buffer[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (s: string | Buffer): void => {
    const b = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
    parts.push(b);
    length += b.length;
  };
  const beginObject = (n: number): void => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  push('%PDF-1.4\n');
  push(`% ${input.thaiLine}\n`); // UTF-8 bytes in a comment; a comment may hold any bytes but EOL

  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObject(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  beginObject(3);
  push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
  );
  beginObject(4);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const content =
    'BT\n/F1 12 Tf\n72 770 Td\n16 TL\n' +
    input.asciiLines.map((line, i) => `${i === 0 ? '' : 'T*\n'}${pdfString(line)} Tj\n`).join('') +
    'ET\n';
  const contentBytes = Buffer.from(content, 'utf8');
  beginObject(5);
  push(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  push('\nendstream\nendobj\n');

  beginObject(6);
  push(
    `<< /Producer (rai-web/fixtures) /Title ${pdfString(input.title)} /Subject ${utf16beHex(input.thaiLine)} >>\nendobj\n`,
  );

  if (input.filler !== undefined) {
    // Deterministic comment lines until the target size; hashing a counter keeps the bytes incompressible enough
    // to exercise a real transfer, and identical on every run.
    const lines: string[] = [];
    let n = 0;
    let fillerLength = 0;
    const overhead = 512; // room for the xref table and trailer below the target
    while (length + fillerLength < input.filler.targetBytes - overhead) {
      const digest = createHash('sha256').update(`${input.filler.seed}:${n}`).digest('hex');
      const line = `% filler ${String(n).padStart(8, '0')} ${digest}\n`;
      lines.push(line);
      fillerLength += line.length; // ASCII: bytes equal characters
      n += 1;
    }
    push(lines.join(''));
  }

  const xrefOffset = length;
  const count = 7;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i += 1) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(parts);
}

// ---- W4-09a: multi-page documents for the QC evaluation set (W4b plan section 11.1) ---------------------------
// Additive: buildPdf above and the slice1-synthetic bytes are unchanged. A page is text (Helvetica; an ASCII line
// is a literal string, any other line a UTF-16BE hex string with BOM, both of which the W4-05d extractor decodes),
// an image (one image XObject and no text operator: a scan), or CID text (a Type0 Identity-H font with no
// ToUnicode, glyph codes only: not decodable, plan section 4.3). `flate` compresses every stream with the
// platform-independent encoder of deflate.ts. `brokenXref` shifts every xref offset and startxref (malformed).

export type PdfPageSpec =
  { kind: 'text'; lines: string[] } | { kind: 'image' } | { kind: 'cid'; lines: string[] };

export interface PdfDocumentInput {
  title: string; // ASCII, into /Info /Title
  commentLines: string[]; // `%` comments after the header (UTF-8)
  pages: PdfPageSpec[];
  compression: 'none' | 'flate';
  brokenXref?: boolean;
}

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;
const IMAGE_SIZE = 8;

function textOperand(line: string): string {
  if (ASCII_PRINTABLE.test(line)) return pdfString(line);
  return utf16beHex(line);
}

/** Glyph codes for the CID page: two bytes per character, offset so no code is a Thai or ASCII code unit. */
function cidOperand(line: string): string {
  const codes = [...line].map((ch) => (0x1000 + (ch.codePointAt(0)! % 0x1000)).toString(16).toUpperCase());
  return `<${codes.join('')}>`;
}

function pageContent(page: PdfPageSpec): string {
  if (page.kind === 'image') return `q\n400 0 0 400 96 300 cm\n/Im1 Do\nQ\n`;
  const font = page.kind === 'text' ? '/F1' : '/F2';
  const operand = page.kind === 'text' ? textOperand : cidOperand;
  return (
    `BT\n${font} 11 Tf\n72 780 Td\n14 TL\n` +
    page.lines.map((line, i) => `${i === 0 ? '' : 'T*\n'}${operand(line)} Tj\n`).join('') +
    'ET\n'
  );
}

export function buildPdfDocument(input: PdfDocumentInput): Buffer {
  const parts: Buffer[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (s: string | Buffer): void => {
    const b = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
    parts.push(b);
    length += b.length;
  };
  const object = (n: number, body: string): void => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const streamObject = (n: number, dict: string, data: Buffer): void => {
    const encoded = input.compression === 'flate' ? zlibFixed(data) : data;
    const filter = input.compression === 'flate' ? ' /Filter /FlateDecode' : '';
    offsets[n] = length;
    push(`${n} 0 obj\n<< ${dict}${filter} /Length ${encoded.length} >>\nstream\n`);
    push(encoded);
    push('\nendstream\nendobj\n');
  };

  // 1 catalog, 2 pages, 3 info, 4 Helvetica, 5 Type0, 6 CIDFont, 7 image; then page i: 8 + 2i, content 9 + 2i.
  const pageObject = (i: number): number => 8 + 2 * i;
  push('%PDF-1.4\n');
  for (const line of input.commentLines) push(`% ${line}\n`);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(
    2,
    `<< /Type /Pages /Kids [${input.pages.map((_, i) => `${pageObject(i)} 0 R`).join(' ')}] /Count ${input.pages.length} >>`,
  );
  object(3, `<< /Producer (rai-web/fixtures) /Title ${pdfString(input.title)} >>`);
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  object(
    5,
    '<< /Type /Font /Subtype /Type0 /BaseFont /EvalThaiCid /Encoding /Identity-H /DescendantFonts [6 0 R] >>',
  );
  object(
    6,
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /EvalThaiCid /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>',
  );
  const pixels = Buffer.alloc(IMAGE_SIZE * IMAGE_SIZE);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 4) & 0xff;
  streamObject(
    7,
    `/Type /XObject /Subtype /Image /Width ${IMAGE_SIZE} /Height ${IMAGE_SIZE} /ColorSpace /DeviceGray /BitsPerComponent 8`,
    pixels,
  );
  input.pages.forEach((page, i) => {
    object(
      pageObject(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 7 0 R >> >> /Contents ${pageObject(i) + 1} 0 R >>`,
    );
    streamObject(pageObject(i) + 1, '', Buffer.from(pageContent(page), 'utf8'));
  });

  const shift = input.brokenXref === true ? 13 : 0;
  const xrefOffset = length;
  const count = pageObject(input.pages.length);
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i += 1) xref += `${String(offsets[i]! + shift).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset + shift}\n%%EOF\n`);
  return Buffer.concat(parts);
}
