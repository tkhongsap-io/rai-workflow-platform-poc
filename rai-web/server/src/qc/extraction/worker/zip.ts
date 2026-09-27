// W4-05c (W4b plan sections 4.3 and 4.4, decision 8): the worker's ZIP reader for DOCX and XLSX. Hand-written on
// `node:zlib`, no library. The central directory is read as `artifacts/sniff.ts` reads it (the worker may not import
// server code, so the rules are restated here), and then each part is read on demand and checked against it:
//
// - the container: EOCD exactly at the end (no trailing bytes: a polyglot), one disk, matching counts, no ZIP64, the
//   directory right before the EOCD, at most 2 000 entries; every entry name safe and unique; no encrypted entry;
//   method stored (0) or deflate (8) only; no macro project, nested archive or executable (what the upload refuses);
//   every entry's data inside the file, before the directory, and not overlapping another entry's;
// - a part: its local header agrees with the directory (signature, name); deflate runs through `inflateRawSync` with
//   `maxOutputLength`, so a bomb never becomes a large buffer; the output length and CRC-32 equal the directory's.
//
// A declared or actual part over `maxPartBytes`, or a declared or actual total over `maxTotalBytes`, is `limit_bytes`;
// any other inconsistency is `unreadable`. Both are thrown as an `ExtractionStop`, so the worker replies cleanly.
import type { Buffer } from 'node:buffer';
import { crc32, inflateRawSync } from 'node:zlib';
import { ExtractionStop } from './sink.js';

export interface ZipLimits {
  maxPartBytes: number;
  maxTotalBytes: number;
}

export interface ZipArchive {
  readonly names: readonly string[];
  has(name: string): boolean;
  /** The part's bytes, or undefined when the package has no such part. */
  read(name: string): Buffer | undefined;
}

export const ZIP_MAX_ENTRIES = 2000;
const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;

/** As `artifacts/sniff.ts` NESTED_EXTENSIONS: archives and executables the upload refuses inside a package. */
const NESTED_EXTENSIONS: readonly string[] = [
  '.zip',
  '.7z',
  '.rar',
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

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  dataStart: number;
}

function unreadable(): never {
  throw new ExtractionStop('unreadable');
}
function overLimit(): never {
  throw new ExtractionStop('limit_bytes');
}

function findEocd(bytes: Buffer): number {
  if (bytes.length < EOCD_MIN) return -1;
  const stop = Math.max(0, bytes.length - EOCD_SEARCH);
  for (let at = bytes.length - EOCD_MIN; at >= stop; at -= 1)
    if (bytes.readUInt32LE(at) === EOCD_SIG) return at;
  return -1;
}

function nameUnsafe(name: string): boolean {
  if (name === '' || name.includes('\u0000') || name.includes('\\') || name.startsWith('/')) return true;
  return name.split('/').some((segment) => segment === '..');
}

function refusedByUpload(name: string): boolean {
  const lower = name.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  return base === 'vbaproject.bin' || NESTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function openZip(bytes: Buffer, limits: ZipLimits): ZipArchive {
  const eocd = findEocd(bytes);
  if (eocd < 0) unreadable();
  if (eocd + EOCD_MIN + bytes.readUInt16LE(eocd + 20) !== bytes.length) unreadable(); // trailing bytes
  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) unreadable(); // multi-disk
  const count = bytes.readUInt16LE(eocd + 10);
  if (bytes.readUInt16LE(eocd + 8) !== count) unreadable();
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (eocd >= 20 && bytes.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) unreadable();
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) unreadable();
  if (cdOffset + cdSize !== eocd || count > ZIP_MAX_ENTRIES) unreadable();

  const entries = new Map<string, Entry>();
  let declaredTotal = 0;
  let at = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (at + CENTRAL_HEADER > eocd || bytes.readUInt32LE(at) !== CENTRAL_SIG) unreadable();
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const nameEnd = at + CENTRAL_HEADER + nameLength;
    if (nameEnd > eocd) unreadable();
    const name = bytes.toString('utf8', at + CENTRAL_HEADER, nameEnd);
    if (nameUnsafe(name) || entries.has(name) || refusedByUpload(name)) unreadable();
    if ((flags & 0x0001) !== 0) unreadable(); // encrypted
    if (method !== 0 && method !== 8) unreadable();
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) unreadable(); // ZIP64
    if (size > limits.maxPartBytes) overLimit();
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes) overLimit();
    if (localOffset + LOCAL_HEADER > cdOffset || bytes.readUInt32LE(localOffset) !== LOCAL_SIG) unreadable();
    const dataStart =
      localOffset +
      LOCAL_HEADER +
      bytes.readUInt16LE(localOffset + 26) +
      bytes.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > cdOffset) unreadable();
    if (method === 0 && compressedSize !== size) unreadable();
    entries.set(name, { name, method, crc, compressedSize, size, localOffset, dataStart });
    at = nameEnd + extraLength + commentLength;
  }
  if (at !== eocd) unreadable();

  // No two entries share bytes (the overlapping-entry bomb): sorted by offset, each ends before the next begins.
  const ordered = [...entries.values()].sort((a, b) => a.localOffset - b.localOffset);
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    if (previous.dataStart + previous.compressedSize > ordered[i]!.localOffset) unreadable();
  }

  let inflatedTotal = 0;
  const read = (name: string): Buffer | undefined => {
    const entry = entries.get(name);
    if (entry === undefined) return undefined;
    const nameLength = bytes.readUInt16LE(entry.localOffset + 26);
    if (
      bytes.toString(
        'utf8',
        entry.localOffset + LOCAL_HEADER,
        entry.localOffset + LOCAL_HEADER + nameLength,
      ) !== name
    )
      unreadable();
    const raw = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    let data: Buffer;
    if (entry.method === 0) data = raw;
    else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: limits.maxPartBytes });
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError)
          overLimit();
        return unreadable();
      }
    }
    if (data.length !== entry.size || crc32(data) >>> 0 !== entry.crc) unreadable();
    inflatedTotal += data.length;
    if (inflatedTotal > limits.maxTotalBytes) overLimit();
    return data;
  };

  const names = [...entries.keys()];
  return { names, has: (name) => entries.has(name), read };
}
