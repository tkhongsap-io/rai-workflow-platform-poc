// W4-05c (W4b plan section 4.3): XLSX → one `cell` segment per non-blank cell, locator
// `{ kind: 'cell', sheetIndex, cell }`: the 1-based sheet ordinal in `xl/workbook.xml` order and the A1 reference. No
// sheet name reaches a locator (decision 21).
//
// - Sheets: `sheets/sheet` in workbook order; each sheet's part through `xl/_rels/workbook.xml.rels` (`r:id` →
//   `Target`, relative to `xl/` or absolute from the package root, never escaping it). A package with no workbook
//   relationships part falls back to `xl/worksheets/sheetN.xml` by position; one that has the part but not the id is
//   inconsistent.
// - Strings: `xl/sharedStrings.xml` (or the workbook's sharedStrings relationship target), each `si` the join of its
//   `t` text with phonetic runs (`rPh`) skipped; inline strings (`is`) the same.
// - Cells: `c` inside `sheetData`, typed by `t`: `s` (shared index), `inlineStr`, `str`, `e`, `d`, `n` or absent (the
//   cached `v`; formulas are never evaluated), `b` (`TRUE`/`FALSE`).
// - `unreadable`: a missing workbook or sheet part, a cell whose `r` is missing or outside `^[A-Z]{1,3}[1-9]\d{0,6}$`,
//   a shared-string index out of range or not a number, plus every ZIP and XML refusal.
import type { Buffer } from 'node:buffer';
import { ExtractionStop, type FormatExtractor, type SegmentSink, type WorkerLimits } from './sink.js';
import { attributeOf, decodeXml, xmlEvents, type XmlEvent } from './xml.js';
import { openZip, type ZipArchive } from './zip.js';

export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The plan's A1 pattern (W4b plan sections 4.3 and 9): what a `cell` locator may carry. */
export const CELL_REFERENCE = /^[A-Z]{1,3}[1-9]\d{0,6}$/;

const S_NAMESPACES: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
]);
const R_NAMESPACES: readonly string[] = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
];
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORKBOOK = 'xl/workbook.xml';
const WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels';

function unreadable(): never {
  throw new ExtractionStop('unreadable');
}

function events(zip: ZipArchive, name: string) {
  const part = zip.read(name);
  if (part === undefined) unreadable();
  return xmlEvents(decodeXml(part));
}

/** A relationship target as a package path: relative to `xl/`, or absolute from the root; never above the root. */
function targetPath(target: string): string {
  const segments = target.startsWith('/') ? [] : ['xl'];
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) unreadable();
      segments.pop();
    } else segments.push(segment);
  }
  if (segments.length === 0) unreadable();
  return segments.join('/');
}

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

function readRelationships(zip: ZipArchive): Map<string, Relationship> | undefined {
  if (!zip.has(WORKBOOK_RELS)) return undefined;
  const relationships = new Map<string, Relationship>();
  for (const event of events(zip, WORKBOOK_RELS)) {
    if (event.type !== 'open' || event.ns !== PKG_REL_NS || event.local !== 'Relationship') continue;
    const id = attributeOf(event, '', 'Id');
    const target = attributeOf(event, '', 'Target');
    if (id === undefined || target === undefined) unreadable();
    relationships.set(id, {
      type: attributeOf(event, '', 'Type') ?? '',
      target,
      external: attributeOf(event, '', 'TargetMode') === 'External',
    });
  }
  return relationships;
}

function readSheetIds(zip: ZipArchive): Array<string | undefined> {
  const ids: Array<string | undefined> = [];
  let inSheets = 0;
  for (const event of events(zip, WORKBOOK)) {
    if (event.type === 'text' || !S_NAMESPACES.has(event.ns)) continue;
    if (event.local === 'sheets') inSheets += event.type === 'open' ? 1 : -1;
    else if (event.type === 'open' && event.local === 'sheet' && inSheets > 0)
      ids.push(R_NAMESPACES.map((ns) => attributeOf(event, ns, 'id')).find((v) => v !== undefined));
  }
  return ids;
}

/** Collects a string item's (`si` or `is`) `t` text, phonetic runs skipped, from the events inside the item. */
function stringItemCollector() {
  let depthInPhonetic = 0;
  let inText = 0;
  let text = '';
  return {
    onEvent(event: XmlEvent): void {
      if (event.type === 'text') {
        if (inText > 0 && depthInPhonetic === 0) text += event.text;
        return;
      }
      if (!S_NAMESPACES.has(event.ns)) return;
      const delta = event.type === 'open' ? 1 : -1;
      if (event.local === 'rPh') depthInPhonetic += delta;
      else if (event.local === 't') inText += delta;
    },
    take(): string {
      const out = text;
      text = '';
      inText = 0;
      depthInPhonetic = 0;
      return out;
    },
  };
}

function readSharedStrings(zip: ZipArchive, path: string | undefined): string[] | undefined {
  if (path === undefined || !zip.has(path)) return undefined;
  const strings: string[] = [];
  const item = stringItemCollector();
  let inItem = 0;
  for (const event of events(zip, path)) {
    if (event.type !== 'text' && S_NAMESPACES.has(event.ns) && event.local === 'si') {
      if (event.type === 'open') inItem += 1;
      else {
        inItem -= 1;
        strings.push(item.take());
      }
      continue;
    }
    if (inItem > 0) item.onEvent(event);
  }
  return strings;
}

function booleanText(value: string): string {
  return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value;
}

function readSheet(
  zip: ZipArchive,
  path: string,
  sheetIndex: number,
  shared: () => string[] | undefined,
  sink: SegmentSink,
): void {
  let inSheetData = 0;
  let cell: { ref: string; type: string } | undefined;
  let inValue = 0;
  let value = '';
  let inInline = 0;
  const inline = stringItemCollector();
  for (const event of events(zip, path)) {
    if (cell !== undefined && inInline > 0) {
      if (event.type !== 'text' && S_NAMESPACES.has(event.ns) && event.local === 'is') {
        inInline += event.type === 'open' ? 1 : -1;
        if (inInline === 0) value = inline.take();
        continue;
      }
      inline.onEvent(event);
      continue;
    }
    if (event.type === 'text') {
      if (cell !== undefined && inValue > 0) value += event.text;
      continue;
    }
    if (!S_NAMESPACES.has(event.ns)) continue;
    if (event.local === 'sheetData') {
      inSheetData += event.type === 'open' ? 1 : -1;
      continue;
    }
    if (inSheetData === 0) continue;
    if (event.local === 'c') {
      if (event.type === 'open') {
        const ref = attributeOf(event, '', 'r');
        if (ref === undefined || !CELL_REFERENCE.test(ref)) unreadable();
        cell = { ref, type: attributeOf(event, '', 't') ?? 'n' };
        value = '';
        continue;
      }
      if (cell === undefined) continue;
      let text = value;
      if (cell.type === 's' && value.trim() !== '') {
        if (!/^\d{1,9}$/.test(value.trim())) unreadable();
        const strings = shared();
        const index = Number(value.trim());
        if (strings === undefined || index >= strings.length) unreadable();
        text = strings[index]!;
      } else if (cell.type === 'b') text = booleanText(value.trim());
      if (text.trim() !== '') sink.add({ kind: 'cell', sheetIndex, cell: cell.ref }, text);
      cell = undefined;
      continue;
    }
    if (cell === undefined) continue;
    if (event.local === 'v') inValue += event.type === 'open' ? 1 : -1;
    else if (event.local === 'is' && event.type === 'open') inInline = 1;
  }
}

export const extractXlsx: FormatExtractor = (bytes: Buffer, sink: SegmentSink, limits: WorkerLimits) => {
  const zip = openZip(bytes, limits);
  if (!zip.has(WORKBOOK)) unreadable();
  const relationships = readRelationships(zip);
  const sheetIds = readSheetIds(zip);

  const sharedRel = [...(relationships?.values() ?? [])].find(
    (r) => r.type.endsWith('/sharedStrings') && !r.external,
  );
  const sharedPath = sharedRel !== undefined ? targetPath(sharedRel.target) : 'xl/sharedStrings.xml';
  let strings: string[] | undefined | null = null; // null: not read yet
  const shared = (): string[] | undefined => {
    if (strings === null) strings = readSharedStrings(zip, sharedPath);
    return strings;
  };

  sheetIds.forEach((id, i) => {
    let path: string;
    if (relationships === undefined) path = `xl/worksheets/sheet${i + 1}.xml`;
    else {
      const relationship = id === undefined ? undefined : relationships.get(id);
      if (relationship === undefined || relationship.external) unreadable();
      path = targetPath(relationship.target);
    }
    if (!zip.has(path)) unreadable();
    readSheet(zip, path, i + 1, shared, sink);
  });
};
