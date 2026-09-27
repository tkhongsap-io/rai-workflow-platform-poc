// W4-05c test helper: a ZIP writer with per-entry overrides (method, flags, sizes, CRC, local name) and minimal
// synthetic DOCX and XLSX packages. Test-only: the `.test-helper.ts` suffix keeps it out of the worker's module graph
// (module-graph.test.ts) and out of the product worker. Synthetic text only.
import { crc32, deflateRawSync } from 'node:zlib';

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const S_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface TestZipEntry {
  name: string;
  data: Buffer | string;
  method?: number; // 0 stored (default), 8 deflate, anything else written as stored bytes with that method id
  flags?: number;
  declaredSize?: number; // uncompressed size in both headers
  crc?: number;
  localName?: string; // a different name in the local header
  compressedOverride?: Buffer; // raw bytes written as the entry's data
}

export interface TestZipOptions {
  trailing?: Buffer;
  zip64Locator?: boolean;
  countOverride?: number; // total entries in the EOCD
  centralOffsetDelta?: number;
  overlapSecondOntoFirst?: boolean; // second central entry points at the first local header
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

export function buildTestZip(entries: TestZipEntry[], options: TestZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const method = entry.method ?? 0;
    const body = entry.compressedOverride ?? (method === 8 ? deflateRawSync(raw) : raw);
    const crc = entry.crc ?? crc32(raw);
    const size = entry.declaredSize ?? raw.length;
    const flags = entry.flags ?? 0;
    const name = Buffer.from(entry.name, 'utf8');
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8');
    const common = (n: Buffer) =>
      Buffer.concat([
        u16(flags),
        u16(method),
        u16(0),
        u16(0x5c21),
        u32(crc),
        u32(body.length),
        u32(size),
        u16(n.length),
        u16(0),
      ]);
    const local = Buffer.concat([u32(0x04034b50), u16(20), common(localName), localName, body]);
    offsets.push(offset);
    const at = options.overlapSecondOntoFirst === true && central.length === 1 ? offsets[0]! : offset;
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        common(name),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(at),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(central);
  const count = options.countOverride ?? entries.length;
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(centralBytes.length),
    u32(offset + (options.centralOffsetDelta ?? 0)),
    u16(0),
  ]);
  const locator =
    options.zip64Locator === true ? Buffer.concat([u32(0x07064b50), Buffer.alloc(16)]) : Buffer.alloc(0);
  return Buffer.concat([...locals, centralBytes, locator, eocd, options.trailing ?? Buffer.alloc(0)]);
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** word/document.xml around a body; paragraphs are `<w:p>` strings. */
export function documentXml(body: string, prefix = 'w'): string {
  return `${DECL}<${prefix}:document xmlns:${prefix}="${W_NS}"><${prefix}:body>${body}</${prefix}:body></${prefix}:document>`;
}

export const para = (text: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;

export function docxEntries(documentBody: string, method = 8): TestZipEntry[] {
  return [
    {
      name: '[Content_Types].xml',
      data: `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
      method,
    },
    { name: '_rels/.rels', data: `${DECL}<Relationships xmlns="${PKG_REL_NS}"/>`, method },
    { name: 'word/document.xml', data: documentXml(documentBody), method },
  ];
}

export const docxOf = (paragraphs: string[], method = 8): Buffer =>
  buildTestZip(docxEntries(paragraphs.map(para).join(''), method));

export interface TestSheet {
  name: string;
  cells: string; // the <sheetData> content
  target?: string; // rels target (default worksheets/sheetN.xml)
  part?: string; // package path (default xl/worksheets/sheetN.xml)
}

export function xlsxEntries(
  sheets: TestSheet[],
  options: { sharedStrings?: string[]; rels?: boolean; method?: number } = {},
): TestZipEntry[] {
  const method = options.method ?? 8;
  const entries: TestZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
      method,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `${DECL}<workbook xmlns="${S_NS}" xmlns:r="${R_NS}"><sheets>` +
        sheets
          .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        '</sheets></workbook>',
      method,
    },
  ];
  if (options.rels !== false)
    entries.push({
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${DECL}<Relationships xmlns="${PKG_REL_NS}">` +
        sheets
          .map(
            (s, i) =>
              `<Relationship Id="rId${i + 1}" Type="${R_NS}/worksheet" Target="${s.target ?? `worksheets/sheet${i + 1}.xml`}"/>`,
          )
          .join('') +
        '</Relationships>',
      method,
    });
  sheets.forEach((s, i) =>
    entries.push({
      name: s.part ?? `xl/worksheets/sheet${i + 1}.xml`,
      data: `${DECL}<worksheet xmlns="${S_NS}"><sheetData>${s.cells}</sheetData></worksheet>`,
      method,
    }),
  );
  if (options.sharedStrings !== undefined)
    entries.push({
      name: 'xl/sharedStrings.xml',
      data:
        `${DECL}<sst xmlns="${S_NS}" count="${options.sharedStrings.length}">` +
        options.sharedStrings.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join('') +
        '</sst>',
      method,
    });
  return entries;
}

export const inlineCell = (ref: string, text: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;

/** The self-test package (selftest-docx.ts embeds its bytes): stored, two parts, one paragraph. */
export function selfTestEntries(text: string): TestZipEntry[] {
  return [
    {
      name: '[Content_Types].xml',
      data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      name: 'word/document.xml',
      data: `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ];
}
