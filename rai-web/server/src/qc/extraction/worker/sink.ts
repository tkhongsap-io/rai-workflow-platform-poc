// W4-05b/W4-05c (W4b plan sections 4.2-4.4): what every format parser in the worker shares: the worker's own limits,
// the locator and segment it emits, the typed stop, and the sink that enforces the output caps. Split out of
// extract.ts in W4-05c so the format files (docx.ts, xlsx.ts) can import it while extract.ts imports them for the
// registry, with no import cycle. Imports only files under worker/ (module-graph.test.ts).
import type { Buffer } from 'node:buffer';

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
