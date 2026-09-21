// W0-08 sections 2 and 2.5: the hand-written sniff. Pure, `node:buffer` only, no library detector (W0-09 removed
// `file-type` from the pinned list; reconsidering one is a D08 item). Deny by default: a file is admitted only when
// its bytes match exactly one row of the section 2 table and its declared extension belongs to that row.
//
// Three stages, mirroring W0-08 section 4 checks 6-9: `sniffMagic` on the first 8 KiB (check 7: `type_not_allowed`
// when no row matches), the declared-extension comparison (check 8: `type_mismatch`), and `checkStructure` on the
// full bytes (check 9: the specific reason). `sniff()` composes them for the section 2.5 signature. Nothing here
// decompresses, parses XML, decodes an image or renders anything (section 2.4).

import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { UnsafeUploadReason } from '@rai/shared/errors';
import { checkFilename, MEDIA_TYPE_BY_KIND, type ArtifactKind } from './filename.js';

export const SNIFF_HEAD_BYTES = 8 * 1024;
export const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000;

/** What the magic alone can say: the two OOXML kinds share `PK\x03\x04` and are told apart by the central directory. */
export type MagicKind = 'pdf' | 'zip' | 'png' | 'jpeg';

export interface StructureLimits {
  maxImagePixels: number;
}

export type SniffResult =
  | { ok: true; kind: ArtifactKind; mediaType: AllowedMediaType }
  | { ok: false; reason: UnsafeUploadReason; sniffedMediaType?: AllowedMediaType };

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Section 2 magics on the first 8 KiB; anything else (section 2.3 magics included) is `undefined`. */
export function sniffMagic(bytes: Buffer): MagicKind | undefined {
  const head = bytes.subarray(0, SNIFF_HEAD_BYTES);
  if (
    head.length >= 8 &&
    head.subarray(0, 5).equals(PDF_MAGIC) &&
    (head[5] === 0x31 || head[5] === 0x32) && // '1' or '2'
    head[6] === 0x2e && // '.'
    head[7]! >= 0x30 &&
    head[7]! <= 0x39
  )
    return 'pdf';
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (head.length >= 4 && head.subarray(0, 4).equals(ZIP_MAGIC)) return 'zip';
  if (head.length >= 3 && head.subarray(0, 3).equals(JPEG_MAGIC)) return 'jpeg';
  return undefined;
}

function magicOfKind(kind: ArtifactKind): MagicKind {
  return kind === 'docx' || kind === 'xlsx' ? 'zip' : kind;
}

// ---- PDF (section 2, 2.1) --------------------------------------------------------------------------------------

const PDF_EOF = Buffer.from('%%EOF', 'ascii');
const PDF_ACTIVE_TOKENS = ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA'].map((t) =>
  Buffer.from(t, 'ascii'),
);
// PDF name tokens end at whitespace or a delimiter; the scan matches whole names so `/JSX` is not `/JS`.
const PDF_DELIMITERS = new Set([
  0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25,
]);

function pdfStructure(bytes: Buffer): SniffResult {
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024));
  if (tail.indexOf(PDF_EOF) < 0) return { ok: false, reason: 'container_invalid' };
  for (const token of PDF_ACTIVE_TOKENS) {
    let at = bytes.indexOf(token);
    while (at >= 0) {
      const next = bytes[at + token.length];
      if (next === undefined || PDF_DELIMITERS.has(next)) return { ok: false, reason: 'active_content' };
      at = bytes.indexOf(token, at + 1);
    }
  }
  return { ok: true, kind: 'pdf', mediaType: MEDIA_TYPE_BY_KIND.pdf };
}

// ---- ZIP container: DOCX and XLSX (section 2.2) ------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = 65_557; // 22 + 65,535 comment bytes
export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const ZIP_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** Section 2.3 archive and executable extensions an entry name may not end with (nested archive rule). */
export const NESTED_EXTENSIONS: readonly string[] = [
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.iso',
  '.cab',
  '.jar',
  '.apk',
  '.exe',
  '.dll',
  '.msi',
  '.com',
  '.scr',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.js',
  '.mjs',
  '.vbs',
  '.hta',
  '.lnk',
  '.app',
  '.dmg',
  '.pkg',
];

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  uncompressedSize: number;
}

function findEocd(bytes: Buffer): number {
  const start = Math.max(0, bytes.length - EOCD_SEARCH);
  for (let at = bytes.length - EOCD_MIN; at >= start; at -= 1) {
    if (bytes.readUInt32LE(at) === EOCD_SIG) return at;
  }
  return -1;
}

function readCentralDirectory(bytes: Buffer): CentralEntry[] | 'container_invalid' {
  const eocd = findEocd(bytes);
  if (eocd < 0) return 'container_invalid';
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (eocd + EOCD_MIN + commentLength !== bytes.length) return 'container_invalid'; // trailing bytes: polyglot
  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) return 'container_invalid'; // multi-disk
  const entryCount = bytes.readUInt16LE(eocd + 10);
  if (bytes.readUInt16LE(eocd + 8) !== entryCount) return 'container_invalid';
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  // ZIP64: a locator right before the EOCD, or the 16-bit / 32-bit sentinel values in the EOCD itself.
  if (eocd >= 20 && bytes.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) return 'container_invalid';
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return 'container_invalid';
  if (cdOffset + cdSize !== eocd) return 'container_invalid'; // the central directory sits exactly before the EOCD
  if (entryCount > ZIP_MAX_ENTRIES) return 'container_invalid';

  const entries: CentralEntry[] = [];
  let at = cdOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (at + 46 > eocd || bytes.readUInt32LE(at) !== CENTRAL_SIG) return 'container_invalid';
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const uncompressedSize = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLen = bytes.readUInt16LE(at + 32);
    const nameEnd = at + 46 + nameLength;
    if (nameEnd > eocd) return 'container_invalid';
    const name = bytes.subarray(at + 46, nameEnd).toString('utf8');
    if (uncompressedSize === 0xffffffff) return 'container_invalid'; // ZIP64 extra field would carry the real size
    entries.push({ name, flags, method, uncompressedSize });
    at = nameEnd + extraLength + commentLen;
  }
  if (at !== eocd) return 'container_invalid';
  return entries;
}

function entryNameInvalid(name: string): boolean {
  if (name === '' || name.includes('\u0000') || name.includes('\\') || name.startsWith('/')) return true;
  return name.split('/').includes('..');
}

function basename(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? name : name.slice(slash + 1);
}

function zipStructure(bytes: Buffer, declared: 'docx' | 'xlsx'): SniffResult {
  const entries = readCentralDirectory(bytes);
  if (entries === 'container_invalid') return { ok: false, reason: 'container_invalid' };
  let total = 0;
  for (const entry of entries) {
    if (entry.uncompressedSize > ZIP_MAX_ENTRY_BYTES) return { ok: false, reason: 'container_invalid' };
    total += entry.uncompressedSize;
  }
  if (total > ZIP_MAX_TOTAL_BYTES) return { ok: false, reason: 'container_invalid' };
  if (entries.some((e) => e.method !== 0 && e.method !== 8))
    return { ok: false, reason: 'container_invalid' };
  if (entries.some((e) => (e.flags & 0x0001) !== 0)) return { ok: false, reason: 'encrypted_entry' };
  if (entries.some((e) => entryNameInvalid(e.name))) return { ok: false, reason: 'container_invalid' };
  if (entries.some((e) => basename(e.name).toLowerCase() === 'vbaproject.bin'))
    return { ok: false, reason: 'macro_enabled' };
  if (entries.some((e) => NESTED_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext))))
    return { ok: false, reason: 'nested_archive' };

  const names = new Set(entries.map((e) => e.name));
  const isDocx = names.has('word/document.xml');
  const isXlsx = names.has('xl/workbook.xml');
  if (!names.has('[Content_Types].xml') || isDocx === isXlsx)
    return { ok: false, reason: 'container_invalid' };
  const kind: ArtifactKind = isDocx ? 'docx' : 'xlsx';
  if (kind !== declared)
    return { ok: false, reason: 'type_mismatch', sniffedMediaType: MEDIA_TYPE_BY_KIND[kind] };
  return { ok: true, kind, mediaType: MEDIA_TYPE_BY_KIND[kind] };
}

// ---- PNG -----------------------------------------------------------------------------------------------------------

const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const PNG_IHDR = Buffer.from('IHDR', 'ascii');

function pngStructure(bytes: Buffer, limits: StructureLimits): SniffResult {
  if (bytes.length < 8 + 25 + 12) return { ok: false, reason: 'container_invalid' };
  if (bytes.readUInt32BE(8) !== 13 || !bytes.subarray(12, 16).equals(PNG_IHDR))
    return { ok: false, reason: 'container_invalid' };
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) return { ok: false, reason: 'container_invalid' };
  if (width * height > limits.maxImagePixels) return { ok: false, reason: 'image_too_large' };
  if (!bytes.subarray(bytes.length - 12).equals(PNG_IEND)) return { ok: false, reason: 'container_invalid' };
  return { ok: true, kind: 'png', mediaType: MEDIA_TYPE_BY_KIND.png };
}

// ---- JPEG ----------------------------------------------------------------------------------------------------------

function jpegStructure(bytes: Buffer, limits: StructureLimits): SniffResult {
  if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
    return { ok: false, reason: 'container_invalid' };
  let at = 2;
  for (;;) {
    if (at + 1 >= bytes.length || bytes[at] !== 0xff) return { ok: false, reason: 'container_invalid' };
    while (bytes[at] === 0xff) at += 1; // fill bytes
    const marker = bytes[at];
    if (marker === undefined) return { ok: false, reason: 'container_invalid' };
    at += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || marker === 0xda) return { ok: false, reason: 'container_invalid' }; // EOI / SOS before a frame header
    if (at + 1 >= bytes.length) return { ok: false, reason: 'container_invalid' };
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) return { ok: false, reason: 'container_invalid' };
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 7) return { ok: false, reason: 'container_invalid' };
      const height = bytes.readUInt16BE(at + 3);
      const width = bytes.readUInt16BE(at + 5);
      if (height * width > limits.maxImagePixels) return { ok: false, reason: 'image_too_large' };
      return { ok: true, kind: 'jpeg', mediaType: MEDIA_TYPE_BY_KIND.jpeg };
    }
    at += length;
  }
}

// ---- composition -----------------------------------------------------------------------------------------------------

/** Section 4 check 9 for a kind whose magic already matched the declared row. */
export function checkStructure(bytes: Buffer, declared: ArtifactKind, limits: StructureLimits): SniffResult {
  switch (declared) {
    case 'pdf':
      return pdfStructure(bytes);
    case 'docx':
    case 'xlsx':
      return zipStructure(bytes, declared);
    case 'png':
      return pngStructure(bytes, limits);
    case 'jpeg':
      return jpegStructure(bytes, limits);
  }
}

/**
 * Section 4 checks 6-9 over the full bytes for a declared kind: empty → magic (`type_not_allowed`) → kind versus
 * the declared extension (`type_mismatch`) → structure. The result carries the section 2 media type of what was
 * sniffed when one is known, for the W0-10 `upload.rejected` line.
 */
export function inspectBytes(
  bytes: Buffer,
  declared: ArtifactKind,
  limits: StructureLimits = { maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS },
): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty_file' };
  const magic = sniffMagic(bytes);
  if (magic === undefined) return { ok: false, reason: 'type_not_allowed' };
  if (magic !== magicOfKind(declared)) {
    return magic === 'zip'
      ? { ok: false, reason: 'type_mismatch' }
      : { ok: false, reason: 'type_mismatch', sniffedMediaType: MEDIA_TYPE_BY_KIND[magic] };
  }
  return checkStructure(bytes, declared, limits);
}

/** The section 2.5 signature: `(bytes, declaredFilename) → { ok, kind, mediaType } | { ok: false, reason }`. */
export function sniff(
  bytes: Buffer,
  declaredFilename: string,
  limits: StructureLimits = { maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS },
): SniffResult {
  const name = checkFilename(declaredFilename);
  if (!name.ok) return { ok: false, reason: name.reason };
  return inspectBytes(bytes, name.kind, limits);
}
