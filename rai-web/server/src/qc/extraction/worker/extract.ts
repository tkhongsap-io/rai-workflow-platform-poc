// W4-05b (W4b plan section 4.2): what the extraction worker does with its one request. It runs in a fresh child
// process per artifact (decision 5, WA-D08) and imports only `node:buffer`, `node:zlib` and files under worker/
// (module-graph.test.ts), so this file defines its own wire types rather than importing the host's.
//
// Formats register by media type: DOCX and XLSX since W4-05c, PDF since W4-05d (PNG and JPEG stay unregistered: no
// OCR, decision 8). The sink, the typed stop and the worker limits live in sink.ts (W4-05c). A format pushes segments into a
// `SegmentSink`, which enforces the text and segment caps, and signals `unreadable`, `limit_bytes` or `limit_output`
// by throwing an `ExtractionStop`. Any other throw is a parser bug: it propagates, the worker dies, and the host
// records `crash`. Extracted text exists only in this process and in the one reply; nothing here logs or writes.
import { Buffer } from 'node:buffer';
import { DOCX_MEDIA_TYPE, extractDocx } from './docx.js';
import { PDF_MEDIA_TYPE, extractPdf } from './pdf.js';
import {
  ExtractionStop,
  SegmentSink,
  type FormatExtractor,
  type WorkerLimits,
  type WorkerSegment,
  type WorkerStopReason,
} from './sink.js';
import { XLSX_MEDIA_TYPE, extractXlsx } from './xlsx.js';

export {
  ExtractionStop,
  MAX_LOCATOR_STRING_CHARS,
  SegmentSink,
  WORKER_STOP_REASONS,
  locatorChars,
  type FormatExtractor,
  type WorkerLimits,
  type WorkerLocator,
  type WorkerSegment,
  type WorkerStopReason,
} from './sink.js';

export interface WorkerRequest {
  mediaType: string;
  bytes: Uint8Array;
  limits: WorkerLimits;
}
export type WorkerReply = { ok: true; segments: WorkerSegment[] } | { ok: false; reason: WorkerStopReason };

/** Media type → format: DOCX and XLSX (W4-05c) and PDF (W4-05d); nothing else, so images are unreadable. */
export const FORMAT_EXTRACTORS: ReadonlyMap<string, FormatExtractor> = new Map<string, FormatExtractor>([
  [DOCX_MEDIA_TYPE, extractDocx],
  [XLSX_MEDIA_TYPE, extractXlsx],
  [PDF_MEDIA_TYPE, extractPdf],
]);

const LIMIT_KEYS = [
  'maxTextChars',
  'maxSegments',
  'maxPartBytes',
  'maxTotalBytes',
  'maxPdfPages',
  'maxPdfObjects',
] as const satisfies ReadonlyArray<keyof WorkerLimits>;

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<Record<keyof WorkerRequest, unknown>>;
  if (typeof request.mediaType !== 'string' || !(request.bytes instanceof Uint8Array)) return false;
  const limits = request.limits;
  if (typeof limits !== 'object' || limits === null) return false;
  return LIMIT_KEYS.every((key) => Number.isSafeInteger((limits as Record<string, unknown>)[key]));
}

export function extractInWorker(
  request: WorkerRequest,
  formats: ReadonlyMap<string, FormatExtractor> = FORMAT_EXTRACTORS,
): WorkerReply {
  const format = formats.get(request.mediaType);
  if (format === undefined) return { ok: false, reason: 'unreadable' };
  const bytes = Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength);
  const sink = new SegmentSink(request.limits);
  try {
    format(bytes, sink, request.limits);
  } catch (error) {
    if (error instanceof ExtractionStop) return { ok: false, reason: error.reason };
    throw error;
  }
  if (sink.segments.length === 0) return { ok: false, reason: 'unreadable' };
  return { ok: true, segments: [...sink.segments] };
}
