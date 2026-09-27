// W4-05d (W4b plan sections 4.3 and 4.4): PDF → one `page` segment per text line of the text layer. Hand-written on
// Node built-ins (decision 8); imports only `node:buffer`, `node:zlib` and worker/ files (module-graph.test.ts).
//
// Container: `%PDF-` header, `%%EOF` in the last 1 024 bytes, and the last `startxref` there pointing at a classic
// `xref` table with its `trailer` (older tables through `/Prev`, newest entry wins). A cross-reference stream (a file
// with object streams only), `/Encrypt`, an xref offset that does not hold `n g obj`, and any grammar error are
// `unreadable`. An active-content name the upload refuses is `unreadable` here too (defence in depth).
//
// Pages: the catalog's `/Pages` tree in order, `/Resources` inherited. Content: `/Contents` streams with no filter or
// `/FlateDecode` (no predictor), inflated with `maxOutputLength`; a stream with any other filter is not read. Text:
// `Tj`, `TJ`, `'` and `"`, literal and hex strings, UTF-16BE when a string starts with a byte-order mark and Latin-1
// otherwise. A string shown in a Type0 (CID) font is not decoded (no CMap reading: plan section 4.3), and images are
// never read (no OCR, decision 8). A new line starts at `T*`, `'` and `"`, and wherever the text line matrix moves
// vertically; a move along the same line, or a `TJ` gap of 200/1000 em or more, becomes a space. The locator is
// `{ kind: 'page', page }` (1-based) and carries no text and no line ordinal (decision 21). Nothing is logged or kept.
import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import { ExtractionStop, type FormatExtractor, type SegmentSink, type WorkerLimits } from './sink.js';

export const PDF_MEDIA_TYPE = 'application/pdf';

/** Nesting of arrays and dictionaries, and depth of the page tree. */
const MAX_DEPTH = 64;
/** `TJ` adjustments at or below this (thousandths of an em, negative moves right) read as a space. */
const TJ_SPACE = -200;
const TAIL_BYTES = 1024;
const ACTIVE_NAMES = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'RichMedia', 'XFA'];

// ---- values ------------------------------------------------------------------------------------------------------

interface PdfName {
  readonly t: 'name';
  readonly v: string;
}
interface PdfString {
  readonly t: 'str';
  readonly v: string; // bytes as Latin-1 code units
}
interface PdfRef {
  readonly t: 'ref';
  readonly n: number;
  readonly g: number;
}
interface PdfDict {
  readonly t: 'dict';
  readonly v: Map<string, PdfValue>;
}
interface PdfOp {
  readonly t: 'op';
  readonly v: string;
}
type PdfValue = number | boolean | null | PdfName | PdfString | PdfRef | PdfDict | PdfValue[];
interface PdfStream {
  readonly t: 'stream';
  readonly dict: PdfDict;
  readonly data: string;
}
type PdfObject = PdfValue | PdfStream;

/** A grammar error. The object reader turns it into `unreadable`; the content reader ends that page's content. */
class PdfSyntaxError extends Error {}
const syntax = (): never => {
  throw new PdfSyntaxError('pdf syntax');
};
const unreadable = (): never => {
  throw new ExtractionStop('unreadable');
};

const isName = (v: unknown): v is PdfName =>
  typeof v === 'object' && v !== null && (v as PdfName).t === 'name';
const isString = (v: unknown): v is PdfString =>
  typeof v === 'object' && v !== null && (v as PdfString).t === 'str';
const isRef = (v: unknown): v is PdfRef => typeof v === 'object' && v !== null && (v as PdfRef).t === 'ref';
const isDict = (v: unknown): v is PdfDict =>
  typeof v === 'object' && v !== null && (v as PdfDict).t === 'dict';
const isStream = (v: unknown): v is PdfStream =>
  typeof v === 'object' && v !== null && (v as PdfStream).t === 'stream';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

// ---- lexer -------------------------------------------------------------------------------------------------------

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c: number) => !Number.isNaN(c) && !WHITESPACE.has(c) && !DELIMITERS.has(c);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const INTEGER = /^\d+$/;
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

class Lexer {
  pos: number;
  constructor(
    readonly src: string,
    start = 0,
    readonly refs = true,
  ) {
    this.pos = start;
  }

  private code(at = this.pos): number {
    return this.src.charCodeAt(at);
  }

  skipSpace(): void {
    for (;;) {
      const c = this.code();
      if (WHITESPACE.has(c)) this.pos += 1;
      else if (c === 0x25) {
        while (this.pos < this.src.length && this.code() !== 0x0a && this.code() !== 0x0d) this.pos += 1;
      } else return;
    }
  }

  private regularRun(): string {
    const start = this.pos;
    while (isRegular(this.code())) this.pos += 1;
    return this.src.slice(start, this.pos);
  }

  /** The next value or operator; `undefined` at the end of the input. */
  next(depth = 0): PdfValue | PdfOp | undefined {
    if (depth > MAX_DEPTH) syntax();
    this.skipSpace();
    if (this.pos >= this.src.length) return undefined;
    const c = this.code();
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literal();
    if (c === 0x3c) {
      if (this.code(this.pos + 1) === 0x3c) return this.dict(depth);
      return this.hex();
    }
    if (c === 0x5b) return this.array(depth);
    if (!isRegular(c)) return syntax();
    const word = this.regularRun();
    if (NUMBER.test(word)) return this.numberOrRef(word);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return { t: 'op', v: word };
  }

  /** A value (not an operator); a grammar error otherwise. */
  value(depth = 0): PdfValue {
    const token = this.next(depth);
    if (
      token === undefined ||
      (typeof token === 'object' && token !== null && 't' in token && token.t === 'op')
    )
      return syntax();
    return token;
  }

  private numberOrRef(word: string): PdfValue {
    const number = Number(word);
    if (!this.refs || !INTEGER.test(word)) return number;
    const save = this.pos;
    this.skipSpace();
    const generation = this.regularRun();
    this.skipSpace();
    if (INTEGER.test(generation) && this.regularRun() === 'R') {
      const g = Number(generation);
      if (Number.isSafeInteger(number) && Number.isSafeInteger(g)) return { t: 'ref', n: number, g };
    }
    this.pos = save;
    return number;
  }

  private name(): PdfName {
    this.pos += 1;
    const raw = this.regularRun();
    const v = raw.replace(/#([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return { t: 'name', v };
  }

  private literal(): PdfString {
    this.pos += 1;
    let out = '';
    let nesting = 1;
    for (;;) {
      if (this.pos >= this.src.length) return syntax();
      const ch = this.src[this.pos]!;
      this.pos += 1;
      if (ch === '(') nesting += 1;
      else if (ch === ')') {
        nesting -= 1;
        if (nesting === 0) return { t: 'str', v: out };
      } else if (ch === '\r') {
        if (this.src[this.pos] === '\n') this.pos += 1;
        out += '\n';
        continue;
      } else if (ch === '\\') {
        out += this.escape();
        continue;
      }
      out += ch;
    }
  }

  private escape(): string {
    if (this.pos >= this.src.length) return syntax();
    const ch = this.src[this.pos]!;
    this.pos += 1;
    if (ch in ESCAPES) return ESCAPES[ch]!;
    if (ch >= '0' && ch <= '7') {
      let digits = ch;
      while (digits.length < 3 && this.src[this.pos]! >= '0' && this.src[this.pos]! <= '7') {
        digits += this.src[this.pos]!;
        this.pos += 1;
      }
      return String.fromCharCode(parseInt(digits, 8) & 0xff);
    }
    if (ch === '\r') {
      if (this.src[this.pos] === '\n') this.pos += 1;
      return '';
    }
    if (ch === '\n') return '';
    return ch; // \( \) \\ and an unknown escape: the character itself
  }

  private hex(): PdfString {
    this.pos += 1;
    let digits = '';
    for (;;) {
      if (this.pos >= this.src.length) return syntax();
      const c = this.code();
      this.pos += 1;
      if (c === 0x3e) break;
      if (WHITESPACE.has(c)) continue;
      const ch = String.fromCharCode(c);
      if (!/[0-9A-Fa-f]/.test(ch)) return syntax();
      digits += ch;
    }
    if (digits.length % 2 === 1) digits += '0';
    let out = '';
    for (let i = 0; i < digits.length; i += 2)
      out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
    return { t: 'str', v: out };
  }

  private array(depth: number): PdfValue[] {
    this.pos += 1;
    const items: PdfValue[] = [];
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.src.length) return syntax();
      if (this.code() === 0x5d) {
        this.pos += 1;
        return items;
      }
      items.push(this.value(depth + 1));
    }
  }

  private dict(depth: number): PdfDict {
    this.pos += 2;
    const entries = new Map<string, PdfValue>();
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.src.length) return syntax();
      if (this.code() === 0x3e && this.code(this.pos + 1) === 0x3e) {
        this.pos += 2;
        return { t: 'dict', v: entries };
      }
      const key = this.value(depth + 1);
      if (!isName(key)) return syntax();
      entries.set(key.v, this.value(depth + 1));
    }
  }

  /** After `BI`: skip the image dictionary, `ID`, one whitespace byte and the data up to a whitespace-framed `EI`. */
  skipInlineImage(): void {
    for (;;) {
      const token = this.next(1);
      if (token === undefined) return syntax();
      if (typeof token === 'object' && token !== null && 't' in token && token.t === 'op') {
        if (token.v === 'ID') break;
        return syntax();
      }
    }
    this.pos += 1;
    const end = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ]|$)/g;
    end.lastIndex = this.pos - 1;
    const found = end.exec(this.src);
    if (found === null) return syntax();
    this.pos = found.index + 3;
  }
}

// ---- document ----------------------------------------------------------------------------------------------------

interface XrefEntry {
  offset: number;
  generation: number;
}

class PdfDocument {
  /** Object number → in-use entry, or null when the newest section marks it free. */
  readonly xref = new Map<number, XrefEntry | null>();
  readonly trailer: PdfDict;
  readonly #cache = new Map<number, PdfObject>();
  readonly #reading = new Set<number>();
  #decodedBytes = 0;
  #inUse = 0;

  constructor(
    readonly src: string,
    readonly limits: WorkerLimits,
  ) {
    const tail = src.slice(Math.max(0, src.length - TAIL_BYTES));
    const marker = tail.lastIndexOf('startxref');
    if (!src.startsWith('%PDF-') || !tail.includes('%%EOF') || marker < 0) unreadable();
    const at = new Lexer(tail, marker + 'startxref'.length).value();
    let trailer: PdfDict | undefined;
    const seen = new Set<number>();
    let offset: number | undefined = isCount(at) ? at : unreadable();
    while (offset !== undefined) {
      if (seen.has(offset)) unreadable();
      seen.add(offset);
      const section = this.#readXref(offset);
      trailer ??= section;
      if (section.v.has('Encrypt')) unreadable();
      const prev = section.v.get('Prev');
      if (prev !== undefined && !isCount(prev)) unreadable();
      offset = prev as number | undefined;
    }
    this.trailer = trailer!;
  }

  /** One classic xref table at `offset` and its trailer; entries already set by a newer section are kept. */
  #readXref(offset: number): PdfDict {
    const src = this.src;
    if (offset >= src.length || !src.startsWith('xref', offset) || isRegular(src.charCodeAt(offset + 4)))
      unreadable();
    const lexer = new Lexer(src, offset + 4, false);
    const entry = /(\d{10})[ ](\d{5})[ ]([nf])(?:\r\n|[ \r\n]{1,2})/y;
    for (;;) {
      lexer.skipSpace();
      if (src.startsWith('trailer', lexer.pos)) {
        const trailer = new Lexer(src, lexer.pos + 'trailer'.length).value();
        return isDict(trailer) ? trailer : unreadable();
      }
      const first = lexer.value();
      const count = lexer.value();
      if (!isCount(first) || !isCount(count)) unreadable();
      lexer.skipSpace();
      for (let i = 0; i < (count as number); i += 1) {
        entry.lastIndex = lexer.pos;
        const match = entry.exec(src);
        if (match === null) return unreadable();
        lexer.pos = entry.lastIndex;
        const number = (first as number) + i;
        if (this.xref.has(number)) continue;
        if (match[3] === 'f' || number === 0) this.xref.set(number, null);
        else {
          this.xref.set(number, { offset: Number(match[1]), generation: Number(match[2]) });
          this.#inUse += 1;
          if (this.#inUse > this.limits.maxPdfObjects) throw new ExtractionStop('limit_output');
        }
      }
    }
  }

  /** The object a value names: a reference is followed (a missing object is null); anything else is itself. */
  resolve(value: PdfValue | undefined): PdfObject | undefined {
    return isRef(value) ? this.object(value) : value;
  }

  object(ref: PdfRef): PdfObject {
    const entry = this.xref.get(ref.n);
    if (entry === undefined || entry === null || entry.generation !== ref.g) return null;
    const cached = this.#cache.get(ref.n);
    if (cached !== undefined) return cached;
    if (this.#reading.has(ref.n)) return unreadable();
    this.#reading.add(ref.n);
    try {
      const object = this.#readObject(ref, entry.offset);
      this.#cache.set(ref.n, object);
      return object;
    } catch (error) {
      // An object grammar error is a broken file wherever it is met, including inside a page's content reading.
      if (error instanceof PdfSyntaxError) unreadable();
      throw error;
    } finally {
      this.#reading.delete(ref.n);
    }
  }

  #readObject(ref: PdfRef, offset: number): PdfObject {
    const header = /(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj(?![^\0\t\n\f\r ()<>[\]{}/%])/y;
    header.lastIndex = offset;
    const match = header.exec(this.src);
    if (match === null || Number(match[1]) !== ref.n || Number(match[2]) !== ref.g) return unreadable();
    const lexer = new Lexer(this.src, header.lastIndex);
    const value = lexer.value();
    lexer.skipSpace();
    if (!isDict(value) || !this.src.startsWith('stream', lexer.pos)) return value;
    let start = lexer.pos + 'stream'.length;
    if (this.src.startsWith('\r\n', start)) start += 2;
    else if (this.src[start] === '\n' || this.src[start] === '\r') start += 1;
    else return unreadable();
    const length = this.resolve(value.v.get('Length'));
    if (!isCount(length) || start + length > this.src.length) return unreadable();
    const after = /(?:\r\n|\r|\n)?endstream/y;
    after.lastIndex = start + length;
    if (after.exec(this.src) === null) return unreadable();
    return { t: 'stream', dict: value, data: this.src.slice(start, start + length) };
  }

  dict(value: PdfValue | undefined): PdfDict | undefined {
    const object = this.resolve(value);
    return isDict(object) ? object : undefined;
  }

  /** A content stream's decoded bytes (Latin-1), or undefined when its filter is not read. */
  decode(stream: PdfStream): string | undefined {
    const filter = this.resolve(stream.dict.v.get('Filter'));
    let data: string;
    if (filter === undefined || filter === null || (Array.isArray(filter) && filter.length === 0))
      data = stream.data;
    else {
      const name = Array.isArray(filter) && filter.length === 1 ? this.resolve(filter[0]) : filter;
      if (!isName(name) || name.v !== 'FlateDecode') return undefined;
      let parms = this.resolve(stream.dict.v.get('DecodeParms'));
      if (Array.isArray(parms)) parms = parms.length === 1 ? this.resolve(parms[0]) : undefined;
      if (parms !== undefined && parms !== null) {
        const predictor = isDict(parms) ? this.resolve(parms.v.get('Predictor')) : 0;
        if (!(predictor === undefined || predictor === 1)) return undefined;
      }
      data = this.#inflate(stream.data);
    }
    if (data.length > this.limits.maxPartBytes) throw new ExtractionStop('limit_bytes');
    this.#decodedBytes += data.length;
    if (this.#decodedBytes > this.limits.maxTotalBytes) throw new ExtractionStop('limit_bytes');
    return data;
  }

  #inflate(data: string): string {
    try {
      return inflateSync(Buffer.from(data, 'latin1'), { maxOutputLength: this.limits.maxPartBytes }).toString(
        'latin1',
      );
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError)
        throw new ExtractionStop('limit_bytes');
      return unreadable();
    }
  }
}

// ---- pages -------------------------------------------------------------------------------------------------------

interface Page {
  node: PdfDict;
  resources: PdfValue | undefined;
}

function collectPages(doc: PdfDocument): Page[] {
  const root = doc.trailer.v.get('Root');
  if (!isRef(root)) return unreadable();
  const catalog = doc.dict(root);
  const top = catalog?.v.get('Pages');
  if (!isRef(top)) return unreadable();
  const pages: Page[] = [];
  const visited = new Set<number>();
  const walk = (ref: PdfRef, inherited: PdfValue | undefined, depth: number, root: boolean): void => {
    if (depth > MAX_DEPTH || visited.has(ref.n)) unreadable();
    visited.add(ref.n);
    const node = doc.dict(ref) ?? unreadable();
    const type = node.v.get('Type');
    const resources = node.v.get('Resources') ?? inherited;
    if (isName(type) && type.v === 'Pages') {
      const kids = doc.resolve(node.v.get('Kids')) ?? [];
      if (!Array.isArray(kids)) return unreadable();
      for (const kid of kids) walk(isRef(kid) ? kid : unreadable(), resources, depth + 1, false);
    } else if (isName(type) && type.v === 'Page' && !root) {
      pages.push({ node, resources });
      if (pages.length > doc.limits.maxPdfPages) throw new ExtractionStop('limit_output');
    } else unreadable();
  };
  walk(top, undefined, 0, true);
  return pages;
}

function pageContent(doc: PdfDocument, page: Page): string {
  let contents = doc.resolve(page.node.v.get('Contents'));
  if (contents === undefined || contents === null) return '';
  if (!Array.isArray(contents)) contents = [contents as PdfValue];
  const parts: string[] = [];
  for (const item of contents) {
    const stream = doc.resolve(item);
    if (!isStream(stream)) return unreadable();
    const decoded = doc.decode(stream);
    if (decoded !== undefined) parts.push(decoded);
  }
  return parts.join('\n');
}

/** Font resource name → whether it is a Type0 (CID) font, whose codes are not decoded. */
function compositeFonts(
  doc: PdfDocument,
  resources: PdfValue | undefined,
): (font: string | undefined) => boolean {
  const fonts = doc.dict(doc.dict(resources)?.v.get('Font'));
  const known = new Map<string, boolean>();
  return (font) => {
    if (font === undefined || fonts === undefined) return false;
    let composite = known.get(font);
    if (composite === undefined) {
      const subtype = doc.dict(fonts.v.get(font))?.v.get('Subtype');
      composite = isName(subtype) && subtype.v === 'Type0';
      known.set(font, composite);
    }
    return composite;
  };
}

// ---- text --------------------------------------------------------------------------------------------------------

/** Latin-1, or UTF-16BE after a byte-order mark; C0 and C1 controls other than tab are dropped. */
function decodeText(bytes: string): string {
  let text = bytes;
  if (bytes.startsWith('\xfe\xff')) {
    const body = Buffer.from(bytes.slice(2, 2 + ((bytes.length - 2) & ~1)), 'latin1');
    text = body.swap16().toString('utf16le').toWellFormed();
  }
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x09 || (c >= 0x20 && c < 0x7f) || c > 0x9f) out += ch;
  }
  return out;
}

const numbers = (operands: PdfValue[], count: number): number[] | undefined => {
  const tail = operands.slice(-count);
  return tail.length === count && tail.every((v) => typeof v === 'number') ? tail : undefined;
};

/** The text lines of one page's content, in content order. */
function pageLines(content: string, isComposite: (font: string | undefined) => boolean): string[] {
  const lines: string[] = [];
  let current: string | undefined;
  let currentY = 0;
  let newLine = false;
  let moved = false;
  let font: string | undefined;
  const fonts: Array<string | undefined> = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  let leading = 0;

  const move = (tx: number, ty: number) => {
    const [a, b, c, d, e, f] = matrix as [number, number, number, number, number, number];
    matrix = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
    moved = true;
  };
  const nextLine = () => {
    move(0, -leading);
    newLine = true;
  };
  const show = (value: PdfValue | undefined) => {
    if (!isString(value) || isComposite(font)) return;
    const text = decodeText(value.v);
    if (text === '') return;
    const y = matrix[5]!;
    if (current === undefined || newLine || Math.abs(y - currentY) > 0.01) {
      if (current !== undefined) lines.push(current);
      current = text;
      currentY = y;
    } else {
      if (moved && !/\s$/.test(current) && !/^\s/.test(text)) current += ' ';
      current += text;
    }
    newLine = false;
    moved = false;
  };

  const lexer = new Lexer(content, 0, false);
  const operands: PdfValue[] = [];
  try {
    for (;;) {
      const token = lexer.next();
      if (token === undefined) break;
      if (!(typeof token === 'object' && token !== null && 't' in token && token.t === 'op')) {
        operands.push(token);
        if (operands.length > 64) operands.shift();
        continue;
      }
      const last = operands[operands.length - 1];
      switch (token.v) {
        case 'BT':
          matrix = [1, 0, 0, 1, 0, 0];
          break;
        case 'Tf': {
          const name = operands[operands.length - 2];
          if (isName(name)) font = name.v;
          break;
        }
        case 'TL':
          if (typeof last === 'number') leading = last;
          break;
        case 'Td':
        case 'TD': {
          const t = numbers(operands, 2);
          if (t !== undefined) {
            if (token.v === 'TD') leading = -t[1]!;
            move(t[0]!, t[1]!);
          }
          break;
        }
        case 'Tm': {
          const m = numbers(operands, 6);
          if (m !== undefined) {
            matrix = m;
            moved = true;
          }
          break;
        }
        case 'T*':
          nextLine();
          break;
        case "'":
        case '"':
          nextLine();
          show(last);
          break;
        case 'Tj':
          show(last);
          break;
        case 'TJ':
          if (Array.isArray(last))
            for (const item of last) {
              if (typeof item === 'number') {
                if (item <= TJ_SPACE) moved = true;
              } else show(item);
            }
          break;
        case 'q':
          if (fonts.length < MAX_DEPTH) fonts.push(font);
          break;
        case 'Q':
          if (fonts.length > 0) font = fonts.pop();
          break;
        case 'BI':
          lexer.skipInlineImage();
          break;
        default:
          break;
      }
      operands.length = 0;
    }
  } catch (error) {
    // A content grammar error ends this page's content; the lines read so far stand.
    if (!(error instanceof PdfSyntaxError)) throw error;
  }
  if (current !== undefined) lines.push(current);
  return lines;
}

// ---- entry -------------------------------------------------------------------------------------------------------

/** Whether the raw bytes carry an active-content name the upload refuses (whole names, as `sniff.ts` scans). */
function hasActiveContent(src: string): boolean {
  for (const name of ACTIVE_NAMES) {
    const token = `/${name}`;
    for (let at = src.indexOf(token); at >= 0; at = src.indexOf(token, at + 1)) {
      const next = src.charCodeAt(at + token.length);
      if (!isRegular(next)) return true;
    }
  }
  return false;
}

export const extractPdf: FormatExtractor = (bytes: Buffer, sink: SegmentSink, limits: WorkerLimits) => {
  const src = bytes.toString('latin1');
  if (hasActiveContent(src)) unreadable();
  try {
    const doc = new PdfDocument(src, limits);
    const pages = collectPages(doc);
    pages.forEach((page, i) => {
      const lines = pageLines(pageContent(doc, page), compositeFonts(doc, page.resources));
      for (const line of lines) if (line.trim() !== '') sink.add({ kind: 'page', page: i + 1 }, line);
    });
  } catch (error) {
    if (error instanceof PdfSyntaxError) unreadable();
    throw error;
  }
};
