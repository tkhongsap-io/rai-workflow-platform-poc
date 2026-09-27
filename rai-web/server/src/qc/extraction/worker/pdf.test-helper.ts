// W4-05d (test only; excluded from the worker module graph by its suffix): a small PDF writer for the PDF extractor
// tests. Objects are numbered from 1 in the order given; the writer places a classic xref table and trailer after
// them, or a cross-reference stream when asked, and can shift every offset to break the xref. Synthetic text only.
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

export const PDF = 'application/pdf';

export type TestObject = string | { dict: string; stream: string | Buffer; flate?: boolean };

export interface TestPdfOptions {
  /** Trailer `/Root`; default `1 0 R`. */
  root?: string;
  /** Extra trailer entries, such as `/Encrypt 9 0 R`. */
  trailerExtra?: string;
  /** Added to every xref offset and to `startxref` (a broken xref). */
  xrefShift?: number;
  /** Write a cross-reference stream instead of a table (object streams only). */
  xrefStream?: boolean;
  /** Replaces `%%EOF\n` at the end. */
  tail?: string;
  /** Replaces the `%PDF-1.4` header line. */
  header?: string;
}

function streamParts(object: Exclude<TestObject, string>): [string, Buffer] {
  const raw = typeof object.stream === 'string' ? Buffer.from(object.stream, 'latin1') : object.stream;
  const data = object.flate === true ? deflateSync(raw) : raw;
  const filter = object.flate === true ? ' /Filter /FlateDecode' : '';
  const length = /\/Length\b/.test(object.dict) ? '' : ` /Length ${data.length}`;
  return [`<< ${object.dict}${filter}${length} >>`, data];
}

export function buildTestPdf(objects: TestObject[], options: TestPdfOptions = {}): Buffer {
  const parts: Buffer[] = [];
  let length = 0;
  const push = (value: string | Buffer) => {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'latin1') : value;
    parts.push(bytes);
    length += bytes.length;
  };
  const offsets: number[] = [];
  push(`${options.header ?? '%PDF-1.4'}\n%\xe2\xe3\xcf\xd3 RAI-DESK-SYNTHETIC-FIXTURE pdf\n`);
  objects.forEach((object, i) => {
    offsets.push(length);
    if (typeof object === 'string') push(`${i + 1} 0 obj\n${object}\nendobj\n`);
    else {
      const [dict, data] = streamParts(object);
      push(`${i + 1} 0 obj\n${dict}\nstream\n`);
      push(data);
      push('\nendstream\nendobj\n');
    }
  });
  const shift = options.xrefShift ?? 0;
  const size = objects.length + 1;
  const trailer = `/Size ${size} /Root ${options.root ?? '1 0 R'}${options.trailerExtra === undefined ? '' : ` ${options.trailerExtra}`}`;
  const xrefAt = length;
  if (options.xrefStream === true) {
    const data = Buffer.alloc(size * 7);
    push(`${size} 0 obj\n<< /Type /XRef ${trailer} /W [1 4 2] /Length ${data.length} >>\nstream\n`);
    push(data);
    push('\nendstream\nendobj\n');
  } else {
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (const offset of offsets) xref += `${String(offset + shift).padStart(10, '0')} 00000 n \n`;
    push(`${xref}trailer\n<< ${trailer} >>\n`);
  }
  push(`startxref\n${xrefAt + shift}\n${options.tail ?? '%%EOF\n'}`);
  return Buffer.concat(parts);
}

/** An incremental update: new bodies for the given object numbers, a new xref section and a trailer with `/Prev`. */
export function appendUpdate(base: Buffer, updates: Array<[number, string]>, size: number): Buffer {
  const text = base.toString('latin1');
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
  const parts: string[] = [];
  let length = base.length;
  const offsets: Array<[number, number]> = [];
  for (const [number, body] of updates) {
    const object = `${number} 0 obj\n${body}\nendobj\n`;
    offsets.push([number, length]);
    parts.push(object);
    length += Buffer.byteLength(object, 'latin1');
  }
  let xref = 'xref\n';
  for (const [number, offset] of offsets)
    xref += `${number} 1\n${String(offset).padStart(10, '0')} 00000 n \n`;
  parts.push(`${xref}trailer\n<< /Size ${size} /Root 1 0 R /Prev ${prev} >>\nstartxref\n${length}\n%%EOF\n`);
  return Buffer.concat([base, Buffer.from(parts.join(''), 'latin1')]);
}

/** A literal string operand for ASCII test text. */
export const lit = (text: string): string => `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** A content stream that shows each line with `Tj`, separated by `T*`. */
export function linesContent(lines: string[], font = '/F1'): string {
  return `BT\n${font} 12 Tf\n72 770 Td\n14 TL\n${lines.map((l, i) => `${i === 0 ? '' : 'T*\n'}${lit(l)} Tj\n`).join('')}ET\n`;
}

export const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
export const TYPE0 =
  '<< /Type /Font /Subtype /Type0 /BaseFont /SyntheticCid /Encoding /Identity-H /DescendantFonts [] >>';

export interface TextPdfOptions extends TestPdfOptions {
  flate?: boolean;
  /** Objects appended after the pages, numbered from `4 + 2 * pages`. */
  extra?: TestObject[];
  /** The `/F2` font dictionary; default a Type0 (CID) font. */
  f2?: string;
}

/**
 * Catalog (1), Pages (2), Helvetica /F1 (3), then for page i: the page (4 + 2i) and its content stream (5 + 2i).
 * The pages carry `/F1` (Helvetica) and `/F2` (a Type0 font by default) in their resources.
 */
export function textPdf(contents: string[], options: TextPdfOptions = {}): Buffer {
  const pageNumber = (i: number) => 4 + 2 * i;
  const f2 = 4 + 2 * contents.length + (options.extra?.length ?? 0);
  const objects: TestObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${pageNumber(i)} 0 R`).join(' ')}] /Count ${contents.length} >>`,
    HELVETICA,
  ];
  contents.forEach((content, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 ${f2} 0 R >> >> /Contents ${pageNumber(i) + 1} 0 R >>`,
      { dict: '', stream: content, flate: options.flate ?? false },
    );
  });
  objects.push(...(options.extra ?? []), options.f2 ?? TYPE0);
  return buildTestPdf(objects, options);
}
