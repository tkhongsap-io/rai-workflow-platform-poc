// W4-05c (W4b plan section 4.3, decision 8): the worker's XML tokenizer for OOXML parts. Hand-written, no library, and
// deliberately small: it yields open, close and text events with namespace-resolved names and nothing else.
//
// - A DOCTYPE, and any other `<!` declaration except a comment or CDATA, is `unreadable`: no DTD, so no external
//   entity and no entity expansion bomb can exist.
// - Only the five predefined references (`&lt; &gt; &amp; &quot; &apos;`) and numeric references to valid XML
//   characters expand; any other reference, or a bare `&`, is `unreadable`.
// - Markup must balance and terminate, with exactly one root element; a duplicate attribute, an unquoted value, a `<`
//   in a value or an undeclared-prefix unbinding is `unreadable`.
// - Input is strict UTF-8 (`decodeXml`); a declared encoding other than UTF-8 is `unreadable`.
//
// Every failure is thrown as `ExtractionStop('unreadable')`, so the worker replies cleanly. Scanning is linear: each
// step advances with `indexOf` or a sticky pattern, never a backtracking search over the rest of the input.
import type { Buffer } from 'node:buffer';
import { ExtractionStop } from './sink.js';

export interface XmlAttribute {
  ns: string;
  local: string;
  value: string;
}
export type XmlEvent =
  | { type: 'open'; ns: string; local: string; attributes: readonly XmlAttribute[] }
  | { type: 'close'; ns: string; local: string }
  | { type: 'text'; text: string };

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
/** An unbound prefix resolves to a namespace no parser matches, so its elements are simply not read. */
const UNBOUND = 'urn:rai-unbound:';

function unreadable(): never {
  throw new ExtractionStop('unreadable');
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** Strict UTF-8 to string; a UTF-8 BOM is dropped, UTF-16 and invalid bytes are unreadable; CR and CRLF become LF. */
export function decodeXml(bytes: Buffer | Uint8Array): string {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  )
    unreadable();
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return unreadable();
  }
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

// XML 1.0 name characters, less the combining marks (U+0300-036F) and joiners (U+200C-200D), which no OOXML name uses;
// a name with one is unreadable.
const NAME_START =
  'A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u203F-\\u2040`;
const QNAME = new RegExp(`[${NAME_START}][${NAME_CHAR}]*(?::[${NAME_START}][${NAME_CHAR}]*)?`, 'y');
const SPACE = /[ \t\n]*/y;
const ENCODING = /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function validChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Expands the five predefined and numeric references; anything else is unreadable. */
function expand(raw: string): string {
  if (!raw.includes('&')) return raw;
  let out = '';
  let from = 0;
  for (let amp = raw.indexOf('&'); amp >= 0; amp = raw.indexOf('&', from)) {
    out += raw.slice(from, amp);
    const semi = raw.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 12) unreadable();
    const name = raw.slice(amp + 1, semi);
    let value = PREDEFINED[name];
    if (value === undefined) {
      const hex = /^#x([0-9A-Fa-f]{1,6})$/.exec(name);
      const dec = hex === null ? /^#([0-9]{1,7})$/.exec(name) : null;
      const code = hex !== null ? parseInt(hex[1]!, 16) : dec !== null ? parseInt(dec[1]!, 10) : -1;
      if (!validChar(code)) unreadable();
      value = String.fromCodePoint(code);
    }
    out += value;
    from = semi + 1;
  }
  return out + raw.slice(from);
}

interface Frame {
  qname: string;
  ns: string;
  local: string;
  scope: ReadonlyMap<string, string>; // prefix ('' = default) → namespace
}

function resolve(
  qname: string,
  scope: ReadonlyMap<string, string>,
  isAttribute: boolean,
): { ns: string; local: string } {
  const colon = qname.indexOf(':');
  if (colon < 0) return { ns: isAttribute ? '' : (scope.get('') ?? ''), local: qname };
  const prefix = qname.slice(0, colon);
  const local = qname.slice(colon + 1);
  if (prefix === 'xml') return { ns: XML_NS, local };
  if (prefix === 'xmlns') return { ns: XMLNS_NS, local };
  return { ns: scope.get(prefix) ?? `${UNBOUND}${prefix}`, local };
}

/** The value of an attribute by namespace ('' for an unprefixed attribute) and local name. */
export function attributeOf(event: XmlEvent, ns: string, local: string): string | undefined {
  if (event.type !== 'open') return undefined;
  return event.attributes.find((a) => a.ns === ns && a.local === local)?.value;
}

export function* xmlEvents(source: string): Generator<XmlEvent> {
  const stack: Frame[] = [];
  const rootScope: ReadonlyMap<string, string> = new Map();
  let rootSeen = false;
  let pos = 0;
  const end = source.length;

  const readName = (): string => {
    QNAME.lastIndex = pos;
    const m = QNAME.exec(source);
    if (m === null) unreadable();
    pos = QNAME.lastIndex;
    return m[0];
  };
  const skipSpace = (): number => {
    SPACE.lastIndex = pos;
    SPACE.exec(source);
    const skipped = SPACE.lastIndex - pos;
    pos = SPACE.lastIndex;
    return skipped;
  };

  while (pos < end) {
    const lt = source.indexOf('<', pos);
    const textEnd = lt < 0 ? end : lt;
    if (textEnd > pos) {
      const raw = source.slice(pos, textEnd);
      if (stack.length === 0) {
        if (raw.trim() !== '') unreadable(); // text outside the root element
      } else yield { type: 'text', text: expand(raw) };
      pos = textEnd;
      continue;
    }
    // pos is at '<'
    if (source.startsWith('<!--', pos)) {
      const close = source.indexOf('-->', pos + 4);
      if (close < 0) unreadable();
      pos = close + 3;
    } else if (source.startsWith('<![CDATA[', pos)) {
      if (stack.length === 0) unreadable();
      const close = source.indexOf(']]>', pos + 9);
      if (close < 0) unreadable();
      const text = source.slice(pos + 9, close);
      if (text !== '') yield { type: 'text', text };
      pos = close + 3;
    } else if (source.startsWith('<!', pos)) {
      unreadable(); // DOCTYPE, ENTITY, ELEMENT, ATTLIST, NOTATION, or anything else
    } else if (source.startsWith('<?', pos)) {
      const close = source.indexOf('?>', pos + 2);
      if (close < 0) unreadable();
      const body = source.slice(pos + 2, close);
      if (/^xml\s/.test(body)) {
        const m = ENCODING.exec(body);
        const encoding = m === null ? undefined : (m[1] ?? m[2])!.toLowerCase();
        if (encoding !== undefined && encoding !== 'utf-8' && encoding !== 'utf8') unreadable();
      }
      pos = close + 2;
    } else if (source.startsWith('</', pos)) {
      pos += 2;
      const qname = readName();
      skipSpace();
      if (source[pos] !== '>') unreadable();
      pos += 1;
      const frame = stack.pop();
      if (frame === undefined || frame.qname !== qname) unreadable();
      yield { type: 'close', ns: frame.ns, local: frame.local };
    } else {
      pos += 1;
      if (stack.length === 0 && rootSeen) unreadable(); // a second root element
      const qname = readName();
      const raw: Array<{ qname: string; value: string }> = [];
      let selfClosing = false;
      for (;;) {
        const spaced = skipSpace();
        if (source.startsWith('/>', pos)) {
          selfClosing = true;
          pos += 2;
          break;
        }
        if (source[pos] === '>') {
          pos += 1;
          break;
        }
        if (spaced === 0) unreadable(); // attributes are separated by whitespace; also catches end of input
        const name = readName();
        skipSpace();
        if (source[pos] !== '=') unreadable();
        pos += 1;
        skipSpace();
        const quote = source[pos];
        if (quote !== '"' && quote !== "'") unreadable();
        const close = source.indexOf(quote, pos + 1);
        if (close < 0) unreadable();
        const value = source.slice(pos + 1, close);
        if (value.includes('<')) unreadable();
        if (raw.some((a) => a.qname === name)) unreadable();
        raw.push({ qname: name, value: expand(value) });
        pos = close + 1;
      }

      const parent = stack.length === 0 ? rootScope : stack[stack.length - 1]!.scope;
      let scope = parent;
      for (const a of raw) {
        const prefix = a.qname === 'xmlns' ? '' : a.qname.startsWith('xmlns:') ? a.qname.slice(6) : undefined;
        if (prefix === undefined) continue;
        if (prefix !== '' && a.value === '') unreadable(); // a prefix cannot be unbound in XML 1.0
        if (scope === parent) scope = new Map(parent);
        (scope as Map<string, string>).set(prefix, a.value);
      }
      const { ns, local } = resolve(qname, scope, false);
      const attributes: XmlAttribute[] = [];
      for (const a of raw) {
        if (a.qname === 'xmlns' || a.qname.startsWith('xmlns:')) continue;
        const name = resolve(a.qname, scope, true);
        attributes.push({ ns: name.ns, local: name.local, value: a.value });
      }
      rootSeen = true;
      yield { type: 'open', ns, local, attributes };
      if (selfClosing) yield { type: 'close', ns, local };
      else stack.push({ qname, ns, local, scope });
    }
  }
  if (!rootSeen || stack.length > 0) unreadable();
}
