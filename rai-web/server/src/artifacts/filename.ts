// W0-08 section 3 "Filename" rule and the section 6 `Content-Disposition` header. Pure: no I/O.
//
// The rule, applied before any file byte is read (W0-08 section 4 check 4): NFC-normalised, at most 200 code
// points, no `/`, `\`, NUL, U+0000-U+001F or U+007F, no leading or trailing whitespace, not `.` or `..`, ending
// with an allowed extension (section 2 table, case-insensitive) with at least one code point before it. Path and
// control characters are refused rather than stripped so the uploader sees what was wrong. Thai filenames pass
// unchanged apart from NFC normalisation (W0-02 section 10.6). The download header carries the NFC name RFC 8187
// percent-encoded in `filename*` and an ASCII fallback in `filename` (every non-ASCII code point → `_`).

import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';

export type ArtifactKind = 'pdf' | 'docx' | 'xlsx' | 'png' | 'jpeg';

/** W0-08 section 2 table: extension → kind. Only the last extension counts (`report.pdf.exe` is `.exe`). */
export const KIND_BY_EXTENSION: Readonly<Record<string, ArtifactKind>> = Object.freeze({
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
});

export const MEDIA_TYPE_BY_KIND: Readonly<Record<ArtifactKind, AllowedMediaType>> = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpeg: 'image/jpeg',
});

export const FILENAME_MAX_CODE_POINTS = 200;

export type FilenameCheck =
  | { ok: true; filename: string; extension: string; kind: ArtifactKind }
  | { ok: false; reason: 'filename_invalid' | 'extension_not_allowed' };

// eslint-disable-next-line no-control-regex -- the rule names these code points explicitly
const FORBIDDEN = /[\u0000-\u001f\u007f/\\]/;

function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}

/** The section 3 rule. `declared` is the client's filename as received (any normalisation form). */
export function checkFilename(declared: string | undefined): FilenameCheck {
  if (declared === undefined || declared === '') return { ok: false, reason: 'filename_invalid' };
  const filename = declared.normalize('NFC');
  if (codePointLength(filename) > FILENAME_MAX_CODE_POINTS) return { ok: false, reason: 'filename_invalid' };
  if (FORBIDDEN.test(filename)) return { ok: false, reason: 'filename_invalid' };
  if (filename !== filename.trim()) return { ok: false, reason: 'filename_invalid' };
  if (filename === '.' || filename === '..') return { ok: false, reason: 'filename_invalid' };
  const dot = filename.lastIndexOf('.');
  if (dot === 0) return { ok: false, reason: 'filename_invalid' }; // `.pdf` alone: the stem must be non-empty
  if (dot < 0) return { ok: false, reason: 'extension_not_allowed' }; // no extension (section 2.3 last row)
  const extension = filename.slice(dot + 1).toLowerCase();
  const kind = KIND_BY_EXTENSION[extension];
  if (kind === undefined) return { ok: false, reason: 'extension_not_allowed' };
  return { ok: true, filename, extension, kind };
}

/** RFC 8187 attr-char: ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~". */
const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

/** `UTF-8''<percent-encoded>` value for `filename*` (RFC 8187 ext-value). */
export function rfc8187Encode(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && ATTR_CHAR.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `UTF-8''${out}`;
}

/** Inverse of rfc8187Encode for tests and clients; throws on a value that is not `UTF-8''...`. */
export function rfc8187Decode(extValue: string): string {
  const match = /^UTF-8'[^']*'(.*)$/i.exec(extValue);
  if (match === null) throw new Error('not an RFC 8187 ext-value');
  return decodeURIComponent(match[1]!);
}

/** W0-08 section 6: every non-ASCII code point (and the two quoted-string specials) becomes `_`; never empty. */
export function asciiFallback(filename: string): string {
  const replaced = Array.from(filename, (ch) => {
    const code = ch.codePointAt(0)!;
    return code < 0x20 || code > 0x7e || ch === '"' || ch === '\\' ? '_' : ch;
  }).join('');
  if (replaced.replace(/_/g, '') === '') {
    const dot = filename.lastIndexOf('.');
    return `artifact${dot > 0 ? filename.slice(dot) : ''}`;
  }
  return replaced;
}

/** `attachment; filename="<ascii fallback>"; filename*=UTF-8''<RFC 8187 percent-encoded NFC filename>`. */
export function contentDisposition(filename: string): string {
  return `attachment; filename="${asciiFallback(filename)}"; filename*=${rfc8187Encode(filename)}`;
}

/** Reads the `filename*` value back out of a Content-Disposition header (tests, W1-06 client). */
export function filenameFromContentDisposition(header: string): string | undefined {
  const star = /filename\*=([^;]+)/i.exec(header);
  if (star !== null) return rfc8187Decode(star[1]!.trim());
  const plain = /filename="([^"]*)"/i.exec(header);
  return plain === null ? undefined : plain[1];
}
