// W4-05b (W4b plan section 4.2): what the extraction worker does with its one request. It runs in a fresh child
// process per artifact (decision 5, WA-D08) and imports only `node:buffer`, `node:zlib` and files under worker/
// (module-graph.test.ts), so this file defines its own wire types rather than importing the host's.
//
// Formats register by media type. The registry is empty in W4-05b: every input is `unreadable` until W4-05c adds DOCX
// and XLSX and W4-05d adds PDF (PNG and JPEG stay unregistered: no OCR, decision 8). A format pushes segments into a
// `SegmentSink`, which enforces the text and segment caps, and signals `unreadable`, `limit_bytes` or `limit_output`
// by throwing an `ExtractionStop`. Any other throw is a parser bug: it propagates, the worker dies, and the host
// records `crash`. Extracted text exists only in this process and in the one reply; nothing here logs or writes.
import { Buffer } from 'node:buffer';

/** The reasons a worker may report itself; `limit_time`, `limit_memory` and `crash` are decided by the host. */
export const WORKER_STOP_REASONS = ['unreadable', 'limit_bytes', 'limit_output'] as const;
export type WorkerStopReason = (typeof WORKER_STOP_REASONS)[number];

/** The limits the worker enforces itself (W4b plan section 4.4), sent in every request. */
export interface WorkerLimits {
  maxTextChars: number;
  maxSegments: number;
  maxPartBytes: number;
  maxTotalBytes: number;
  maxPdfPages: number;
  maxPdfObjects: number;
}

/**
 * The most UTF-16 code units any one locator string field (`sheet`, `cell`, `heading`) may carry. Locators are stored
 * and served (decisions 21 and 23), so their strings also count toward `maxTextChars`; this per-field bound keeps a
 * heading from carrying a paragraph even under a large text cap. Over it is `limit_output`.
 */
export const MAX_LOCATOR_STRING_CHARS = 512;

/** A locator as the worker emits it; the host checks it against the shared `EvidenceLocator` schema. */
export interface WorkerLocator {
  readonly kind: string;
  readonly [field: string]: string | number;
}
export interface WorkerSegment {
  locator: WorkerLocator;
  text: string;
}

export interface WorkerRequest {
  mediaType: string;
  bytes: Uint8Array;
  limits: WorkerLimits;
}
export type WorkerReply = { ok: true; segments: WorkerSegment[] } | { ok: false; reason: WorkerStopReason };

/** Thrown by a format to end extraction with a reason the host accepts from a worker. */
export class ExtractionStop extends Error {
  constructor(readonly reason: WorkerStopReason) {
    super(reason);
    this.name = 'ExtractionStop';
  }
}

/**
 * The UTF-16 code units in a locator's string fields, counted toward `maxTextChars`; -1 when any one field is over
 * `MAX_LOCATOR_STRING_CHARS`. Every own string value counts, so an unexpected key cannot hide text from the cap.
 */
export function locatorChars(locator: unknown): number {
  if (typeof locator !== 'object' || locator === null) return 0;
  let chars = 0;
  for (const [key, value] of Object.entries(locator)) {
    if (key === 'kind' || typeof value !== 'string') continue;
    if (value.length > MAX_LOCATOR_STRING_CHARS) return -1;
    chars += value.length;
  }
  return chars;
}

/**
 * Collects segments and stops with `limit_output` at the text cap (UTF-16 code units of text and locator strings), at
 * the per-field locator bound, or at the segment cap.
 */
export class SegmentSink {
  readonly #segments: WorkerSegment[] = [];
  #chars = 0;
  constructor(private readonly limits: Pick<WorkerLimits, 'maxTextChars' | 'maxSegments'>) {}

  add(locator: WorkerLocator, text: string): void {
    if (this.#segments.length >= this.limits.maxSegments) throw new ExtractionStop('limit_output');
    const chars = text.length + locatorChars(locator);
    if (chars < 0 || this.#chars + chars > this.limits.maxTextChars) throw new ExtractionStop('limit_output');
    this.#chars += chars;
    this.#segments.push({ locator, text });
  }

  get segments(): readonly WorkerSegment[] {
    return this.#segments;
  }
}

export type FormatExtractor = (bytes: Buffer, sink: SegmentSink, limits: WorkerLimits) => void;

/** Media type → format. W4-05c and W4-05d register here; nothing else does. */
export const FORMAT_EXTRACTORS: ReadonlyMap<string, FormatExtractor> = new Map();

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
