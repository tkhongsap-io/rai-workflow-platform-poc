// Minimal OOXML packages (W0-08 8.5) over a stored-method ZIP writer: CRC-32 from node:zlib, fixed DOS timestamps,
// no compression, so the sentinel text is greppable in the raw bytes and the same input yields the same bytes.
// DOCX: [Content_Types].xml, _rels/.rels, word/document.xml. XLSX: [Content_Types].xml, _rels/.rels,
// xl/workbook.xml, xl/worksheets/sheet1.xml, xl/_rels/workbook.xml.rels. Nothing else; no macro, no embedding.

import { crc32 } from 'node:zlib';

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

export function buildDocx(lines: string[]): Buffer {
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
  const document =
    `${XML_DECLARATION}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(l)}</w:t></w:r></w:p>`).join('') +
    '<w:sectPr/></w:body></w:document>';
  return buildStoredZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ]);
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
