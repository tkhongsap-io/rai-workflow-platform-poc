// Minimal OOXML packages (W0-08 8.5) over a stored-method ZIP writer: CRC-32 from node:zlib, fixed DOS timestamps,
// no compression, so the sentinel text is greppable in the raw bytes and the same input yields the same bytes.
// DOCX: [Content_Types].xml, _rels/.rels, word/document.xml. XLSX: [Content_Types].xml, _rels/.rels,
// xl/workbook.xml, xl/worksheets/sheet1.xml, xl/_rels/workbook.xml.rels. Nothing else; no macro, no embedding.

import { crc32 } from 'node:zlib';
import { deflateRawFixed } from './deflate.js';

export interface ZipEntry {
  name: string; // forward slashes, no leading slash, ASCII
  data: Buffer;
}

// 2026-01-01 00:00:00 in DOS date/time fields (fixed; W0-08 8.1 rule 3 determinism).
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

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

/** Stored-method ZIP (method 0) with a central directory and a plain EOCD; no ZIP64, no comment, no extra fields. */
export function buildStoredZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'ascii');
    const crc = crc32(entry.data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method: stored
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0),
        u16(0),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk
        u16(0), // internal attributes
        u32(0), // external attributes
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/**
 * W4-09a options (additive; with none, the slice1-synthetic bytes are unchanged): `doctype` declares an internal DTD
 * in word/document.xml (a malformed input the extractor refuses, plan section 4.3); `method: 'deflate'` compresses
 * every part with the platform-independent encoder of deflate.ts.
 */
export interface DocxOptions {
  doctype?: boolean;
  method?: ZipMethod;
}

export function buildDocx(lines: string[], options: DocxOptions = {}): Buffer {
  const contentTypes =
    `${XML_DECLARATION}<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    `${XML_DECLARATION}<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="word/document.xml"/>` +
    '</Relationships>';
  const doctype =
    options.doctype === true
      ? '<!DOCTYPE w:document [<!ENTITY eval "synthetic evaluation document">]>\n'
      : '';
  const document =
    `${XML_DECLARATION}${doctype}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(l)}</w:t></w:r></w:p>`).join('') +
    '<w:sectPr/></w:body></w:document>';
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ];
  return options.method === 'deflate'
    ? buildZip(entries.map((e) => ({ ...e, method: 'deflate' })))
    : buildStoredZip(entries);
}

export function buildXlsx(lines: string[]): Buffer {
  const contentTypes =
    `${XML_DECLARATION}<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';
  const rels =
    `${XML_DECLARATION}<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="xl/workbook.xml"/>` +
    '</Relationships>';
  const workbook =
    `${XML_DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<sheets><sheet name="Fixture" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const sheet =
    `${XML_DECLARATION}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    lines
      .map(
        (l, i) =>
          `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${xmlEscape(l)}</t></is></c></row>`,
      )
      .join('') +
    '</sheetData></worksheet>';
  const workbookRels =
    `${XML_DECLARATION}<Relationships xmlns="${REL_NS}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';
  return buildStoredZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
  ]);
}

// ---- W4-09a: the QC evaluation set's workbooks (W4b plan section 11.1) -----------------------------------------

export type ZipMethod = 'stored' | 'deflate';

/**
 * A ZIP with a per-entry method: `stored` (method 0) or `deflate` (method 8, fixed-Huffman from deflate.ts, so the
 * bytes do not depend on the platform's zlib). Same fixed timestamps and layout as buildStoredZip.
 */
export function buildZip(entries: Array<ZipEntry & { method: ZipMethod }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'ascii');
    const crc = crc32(entry.data);
    const method = entry.method === 'deflate' ? 8 : 0;
    const body = entry.method === 'deflate' ? deflateRawFixed(entry.data) : entry.data;
    const common = Buffer.concat([
      u16(0), // flags
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(body.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0), // extra
    ]);
    const local = Buffer.concat([u32(0x04034b50), u16(20), common, name, body]);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        common,
        u16(0), // comment
        u16(0), // disk
        u16(0), // internal attributes
        u32(0), // external attributes
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

export interface XlsxSheet {
  name: string;
  /** Rows from row 1; a null cell is left out. A cell of digits (optionally with a decimal part) is numeric. */
  rows: Array<Array<string | null>>;
}

export interface XlsxWorkbookInput {
  /** Written, stored, into docProps/core.xml as dc:title, so the provenance marker stays greppable. */
  title: string;
  sheets: XlsxSheet[];
  sharedStrings: boolean;
  method: ZipMethod;
}

const NUMERIC_CELL = /^\d{1,15}(\.\d{1,15})?$/;

export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function buildXlsxWorkbook(input: XlsxWorkbookInput): Buffer {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  let stringCount = 0;
  const cellXml = (ref: string, value: string): string => {
    if (NUMERIC_CELL.test(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    if (!input.sharedStrings) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    let index = stringIndex.get(value);
    if (index === undefined) {
      index = strings.length;
      strings.push(value);
      stringIndex.set(value, index);
    }
    stringCount += 1;
    return `<c r="${ref}" t="s"><v>${index}</v></c>`;
  };
  const sheetXml = input.sheets.map(
    (sheet) =>
      `${XML_DECLARATION}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      sheet.rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">` +
            row.map((v, c) => (v === null ? '' : cellXml(`${columnName(c)}${r + 1}`, v))).join('') +
            '</row>',
        )
        .join('') +
      '</sheetData></worksheet>',
  );
  const sheetTypes = input.sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  const contentTypes =
    `${XML_DECLARATION}<Types xmlns="${CT_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetTypes +
    (input.sharedStrings
      ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      : '') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  const rels =
    `${XML_DECLARATION}<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';
  const workbook =
    `${XML_DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    '<sheets>' +
    input.sheets
      .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>';
  const workbookRels =
    `${XML_DECLARATION}<Relationships xmlns="${REL_NS}">` +
    input.sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    (input.sharedStrings
      ? `<Relationship Id="rId${input.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
      : '') +
    '</Relationships>';
  const core =
    `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${xmlEscape(input.title)}</dc:title></cp:coreProperties>`;
  const entries: Array<ZipEntry & { method: ZipMethod }> = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8'), method: input.method },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8'), method: input.method },
    { name: 'docProps/core.xml', data: Buffer.from(core, 'utf8'), method: 'stored' },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8'), method: input.method },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8'), method: input.method },
    ...sheetXml.map((xml, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(xml, 'utf8'),
      method: input.method,
    })),
  ];
  if (input.sharedStrings) {
    const sst =
      `${XML_DECLARATION}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringCount}" uniqueCount="${strings.length}">` +
      strings.map((t) => `<si><t xml:space="preserve">${xmlEscape(t)}</t></si>`).join('') +
      '</sst>';
    entries.push({ name: 'xl/sharedStrings.xml', data: Buffer.from(sst, 'utf8'), method: input.method });
  }
  return buildZip(entries);
}
