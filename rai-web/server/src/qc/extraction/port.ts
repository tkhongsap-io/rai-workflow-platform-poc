// W4-05b (W4b plan section 4.2): the extraction port the content runner (W4-06a) reads document bytes through. The
// product implementation is the forking host in client.ts; tests may pass a fake. Text in a `Segment` stays in the
// runner's memory for one run: it is never stored, logged, cached (decision 23) or returned by an endpoint.
import type { EvidenceLocator } from '@rai/shared/qc/types';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';

/**
 * The text-free ordinal locators the DOCX and XLSX parsers emit (W4-05c; W4b plan section 4.3, decision 21): a
 * paragraph ordinal, and a sheet ordinal with an A1 reference. W4-16 adds these shapes to the shared `EvidenceLocator`;
 * until then the port names them here, and once it lands this union adds nothing.
 */
export type OrdinalLocator =
  { kind: 'section'; index: number } | { kind: 'cell'; sheetIndex: number; cell: string };

/** The shared evidence locator, plus the ordinal shapes, so the text-free W4-16 shape applies here as it lands. */
export type Locator = EvidenceLocator | OrdinalLocator;
export interface Segment {
  locator: Locator;
  text: string; // stays in the runner's memory only
}

export const EXTRACT_FAILURE_REASONS = [
  'unreadable',
  'limit_bytes',
  'limit_time',
  'limit_memory',
  'limit_output',
  'crash',
] as const;
export type ExtractFailureReason = (typeof EXTRACT_FAILURE_REASONS)[number];

export type ExtractResult =
  | { ok: true; extractorVersion: string; segments: Segment[] }
  | { ok: false; extractorVersion: string; reason: ExtractFailureReason };

export interface Extractor {
  /** e.g. `rai-extract/1+0.0.0`: the protocol plus the server version. */
  readonly version: string;
  extract(
    input: { mediaType: AllowedMediaType; bytes: Uint8Array },
    signal: AbortSignal,
  ): Promise<ExtractResult>;
  selfTest(): Promise<boolean>;
}
