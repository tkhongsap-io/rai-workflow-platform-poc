// Hand-written single-page PDF (W0-08 8.5): header, catalog, pages, one page, one uncompressed Helvetica content
// stream, an Info dictionary whose /Subject carries the Thai line as UTF-16BE with BOM, the same line as UTF-8 in a
// `%` comment, an xref table and %%EOF. No /JavaScript, /JS, /Launch, /EmbeddedFile, /RichMedia or /XFA token
// exists by construction (the W0-08 2.1 scan). Rendering Thai glyphs is not a goal; the bytes are present.
// The medium variant appends deterministic `%` comment filler before the xref so the file is about 2 MiB.

import { createHash } from 'node:crypto';

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
