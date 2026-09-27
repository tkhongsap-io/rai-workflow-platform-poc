// W4-05c (W4b plan section 4.3): DOCX → one `section` segment per non-blank paragraph. Reads `word/document.xml` only
// (headers, footers, comments and notes are not read). Every WordprocessingML `p` takes the next 1-based ordinal in
// document order, blank or not, so the locator names the paragraph's position; only a paragraph with non-blank text
// yields a segment. The locator is `{ kind: 'section', index }` and carries no document text (decision 21).
//
// A paragraph's text is its `t` text, with `tab` as a tab and `br`/`cr` as a line break; deleted text (`delText`) and
// field codes (`instrText`) are not `t` and are not read. `mc:Fallback` content is skipped, so an alternate rendering
// of the same text box is not read twice. A paragraph nested inside another (a text box) is its own paragraph.
import type { Buffer } from 'node:buffer';
import { ExtractionStop, type FormatExtractor, type SegmentSink, type WorkerLimits } from './sink.js';
import { decodeXml, xmlEvents } from './xml.js';
import { openZip } from './zip.js';

export const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Transitional and Strict OOXML WordprocessingML namespaces. */
const W_NAMESPACES: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

interface Paragraph {
  index: number;
  text: string;
}

export const extractDocx: FormatExtractor = (bytes: Buffer, sink: SegmentSink, limits: WorkerLimits) => {
  const zip = openZip(bytes, limits);
  const part = zip.read('word/document.xml');
  if (part === undefined) throw new ExtractionStop('unreadable');

  const open: Paragraph[] = [];
  const done: Paragraph[] = [];
  let ordinal = 0;
  let skip = 0; // depth inside mc:Fallback
  let inText = 0; // depth inside w:t
  for (const event of xmlEvents(decodeXml(part))) {
    if (event.type === 'text') {
      if (skip === 0 && inText > 0 && open.length > 0) open[open.length - 1]!.text += event.text;
      continue;
    }
    if (skip > 0) {
      skip += event.type === 'open' ? 1 : -1;
      continue;
    }
    if (event.type === 'open' && event.ns === MC_NS && event.local === 'Fallback') {
      skip = 1;
      continue;
    }
    if (!W_NAMESPACES.has(event.ns)) continue;
    const current = open[open.length - 1];
    if (event.type === 'open') {
      if (event.local === 'p') open.push({ index: (ordinal += 1), text: '' });
      else if (event.local === 't') inText += 1;
      else if (current !== undefined && event.local === 'tab') current.text += '\t';
      else if (current !== undefined && (event.local === 'br' || event.local === 'cr')) current.text += '\n';
    } else if (event.local === 'p') {
      const paragraph = open.pop();
      if (paragraph !== undefined && paragraph.text.trim() !== '') done.push(paragraph);
    } else if (event.local === 't') inText -= 1;
  }
  done.sort((a, b) => a.index - b.index);
  for (const paragraph of done) sink.add({ kind: 'section', index: paragraph.index }, paragraph.text);
};
