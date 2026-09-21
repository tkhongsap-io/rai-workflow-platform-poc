// W1-13: the substitute's approximation of W0-08 checks 4, 6, 7 and 8 (filename rule, empty file, magic sniff on
// the leading bytes, sniffed kind versus declared extension) with the section 5 reason vocabulary. It exists so a
// Lane B upload flow sees the same `unsafe_upload` envelope shapes it must render. It is NOT the product sniffer:
// the structural checks of W0-08 sections 2.1, 2.2 and the PNG/JPEG rules (check 9) belong to W1-03's
// `server/src/artifacts/` and are not reproduced here; a file that passes here may still be refused there.

import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { UnsafeUploadReason } from '@rai/shared/errors';

export type SniffedKind = 'pdf' | 'docx' | 'xlsx' | 'png' | 'jpeg';

export const MEDIA_TYPE_BY_SNIFFED_KIND: Readonly<Record<SniffedKind, AllowedMediaType>> = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpeg: 'image/jpeg',
});

const EXTENSION_KIND: ReadonlyMap<string, SniffedKind> = new Map([
  ['pdf', 'pdf'],
  ['docx', 'docx'],
  ['xlsx', 'xlsx'],
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
]);

export const FILENAME_MAX_CODE_POINTS = 200;

/** W0-08 section 3 filename rule, evaluated on the NFC form. Returns the reason or undefined when it passes. */
export function filenameProblem(filename: string): 'filename_invalid' | 'extension_not_allowed' | undefined {
  const name = filename.normalize('NFC');
  if (name === '' || name !== name.trim() || name === '.' || name === '..') return 'filename_invalid';
  if ([...name].length > FILENAME_MAX_CODE_POINTS) return 'filename_invalid';
  // eslint-disable-next-line no-control-regex -- the rule names the control range explicitly
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return 'filename_invalid';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return dot === -1 ? 'extension_not_allowed' : 'filename_invalid'; // '.pdf': empty stem
  const ext = name.slice(dot + 1).toLowerCase();
  if (!EXTENSION_KIND.has(ext)) return 'extension_not_allowed';
  return undefined;
}

export function extensionKind(filename: string): SniffedKind | undefined {
  const name = filename.normalize('NFC');
  const dot = name.lastIndexOf('.');
  return dot === -1 ? undefined : EXTENSION_KIND.get(name.slice(dot + 1).toLowerCase());
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

function asciiIncludes(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Magic sniff over the whole in-memory body (the server reads the first 8 KiB, W0-08 check 7; ZIP kinds need
 * the central directory, which the substitute finds by scanning the entry names). Undefined = no allowed kind.
 */
export function sniffKind(bytes: Uint8Array): SniffedKind | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) && (bytes[5] === 0x31 || bytes[5] === 0x32))
    return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const hasWord = asciiIncludes(bytes, 'word/document.xml');
    const hasXl = asciiIncludes(bytes, 'xl/workbook.xml');
    if (hasWord && !hasXl) return 'docx';
    if (hasXl && !hasWord) return 'xlsx';
    return undefined;
  }
  return undefined;
}

export interface SniffResult {
  ok: true;
  kind: SniffedKind;
  mediaType: AllowedMediaType;
}

export interface SniffRejection {
  ok: false;
  reason: UnsafeUploadReason;
}

/** Checks 4, 6, 7 and 8 in the W0-08 order; check 5 (per-file limit) runs before this in the route. */
export function checkUpload(filename: string, bytes: Uint8Array): SniffResult | SniffRejection {
  const nameProblem = filenameProblem(filename);
  if (nameProblem !== undefined) return { ok: false, reason: nameProblem };
  if (bytes.length === 0) return { ok: false, reason: 'empty_file' };
  const sniffed = sniffKind(bytes);
  if (sniffed === undefined) return { ok: false, reason: 'type_not_allowed' };
  const declared = extensionKind(filename);
  if (declared !== sniffed) return { ok: false, reason: 'type_mismatch' };
  return { ok: true, kind: sniffed, mediaType: MEDIA_TYPE_BY_SNIFFED_KIND[sniffed] };
}
