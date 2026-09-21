// W1-13: a minimal multipart/form-data reader for the upload route (W0-02 7.4: one part named `file`, nothing
// else is read; W0-08 section 3 `limits.files: 1`, `limits.fields: 0`). It reads a complete body held in memory;
// the substitute never streams. Filenames arrive as UTF-8 in the part header, as browsers and undici send them.

export interface MultipartPart {
  name: string;
  filename?: string;
  bytes: Uint8Array;
}

const CRLF = new Uint8Array([13, 10]);
const utf8 = new TextDecoder('utf-8');

export function boundaryOf(contentType: string | undefined): string | undefined {
  if (contentType === undefined) return undefined;
  const match = /^multipart\/form-data\s*;.*?\bboundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) return undefined;
  const value = (match[1] ?? match[2] ?? '').trim();
  return value === '' ? undefined : value;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function parseContentDisposition(value: string): { name?: string; filename?: string } {
  const out: { name?: string; filename?: string } = {};
  for (const raw of value.split(';').slice(1)) {
    const eq = raw.indexOf('=');
    if (eq === -1) continue;
    const key = raw.slice(0, eq).trim().toLowerCase();
    let val = raw.slice(eq + 1).trim();
    if (key === 'filename*') {
      const m = /^utf-8''(.*)$/i.exec(val);
      if (m !== null) {
        try {
          out.filename = decodeURIComponent(m[1] ?? '');
        } catch {
          out.filename = m[1] ?? '';
        }
      }
      continue;
    }
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replaceAll('\\"', '"');
    if (key === 'name') out.name = val;
    else if (key === 'filename' && out.filename === undefined) out.filename = val;
  }
  return out;
}

/** Splits a complete multipart body into its parts; malformed input yields an empty list, never a throw. */
export function parseMultipart(body: Uint8Array, boundary: string): MultipartPart[] {
  const delimiter = new TextEncoder().encode(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let position = indexOf(body, delimiter);
  if (position === -1) return parts;
  position += delimiter.length;
  for (;;) {
    // After a delimiter: either "--" (close) or CRLF then the part.
    if (body[position] === 45 && body[position + 1] === 45) break;
    if (body[position] !== 13 || body[position + 1] !== 10) break;
    position += 2;
    const headerEnd = indexOf(body, new Uint8Array([13, 10, 13, 10]), position);
    if (headerEnd === -1) break;
    const headerText = utf8.decode(body.subarray(position, headerEnd));
    const contentStart = headerEnd + 4;
    const next = indexOf(body, delimiter, contentStart);
    if (next === -1) break;
    // The part content ends before the CRLF that precedes the next delimiter.
    const contentEnd = next - CRLF.length;
    const bytes = body.subarray(contentStart, Math.max(contentStart, contentEnd));
    let disposition: { name?: string; filename?: string } = {};
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      if (line.slice(0, colon).trim().toLowerCase() === 'content-disposition')
        disposition = parseContentDisposition(line.slice(colon + 1));
    }
    const part: MultipartPart = { name: disposition.name ?? '', bytes };
    if (disposition.filename !== undefined) part.filename = disposition.filename;
    parts.push(part);
    position = next + delimiter.length;
  }
  return parts;
}
