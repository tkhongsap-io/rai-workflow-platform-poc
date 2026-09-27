// W4-05b (W4b plan sections 2 and 4.4): extraction limits. The configurable ones are local policy caps with no
// default: W4-13b reads them from `QC_EXTRACT_*` (config.ts stays the only reader of process.env) and refuses a value
// outside these bounds at start; `createWorkerExtractor` refuses them too. A local override can never widen a bound;
// raising one is a D08 change. The fixed ones are sent to the worker, which enforces them itself.
import type { WorkerLimits } from './worker/extract.js';

export interface ExtractionLimits {
  /** Wall clock per artifact, from fork (`QC_EXTRACT_TIMEOUT_MS`); below the 10 000 ms orchestrator deadline. */
  timeoutMs: number;
  /** The worker's `--max-old-space-size` (`QC_EXTRACT_MAX_MEMORY_MB`). */
  maxMemoryMb: number;
  /** Text out, in UTF-16 code units (`QC_EXTRACT_MAX_TEXT_CHARS`). */
  maxTextChars: number;
  /** Worker processes alive at once (`QC_EXTRACT_MAX_CONCURRENCY`). */
  maxConcurrency: number;
  /** Bytes in: the upload cap (`UPLOAD_MAX_FILE_BYTES`), passed by W4-13b. */
  maxInputBytes: number;
}

export const EXTRACTION_LIMIT_BOUNDS = {
  timeoutMs: { min: 500, max: 9000 },
  maxMemoryMb: { min: 64, max: 512 },
  maxTextChars: { min: 1000, max: 2_000_000 },
  maxConcurrency: { min: 1, max: 4 },
  maxInputBytes: { min: 1, max: Number.MAX_SAFE_INTEGER },
} as const satisfies Record<keyof ExtractionLimits, { min: number; max: number }>;

/** Section 4.4: 50 000 segments; 20 MiB per decompressed part, 100 MiB per artifact; 2 000 PDF pages, 100 000 objects. */
export const FIXED_WORKER_LIMITS = Object.freeze({
  maxSegments: 50_000,
  maxPartBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxPdfPages: 2000,
  maxPdfObjects: 100_000,
}) satisfies Omit<WorkerLimits, 'maxTextChars'>;

/** The keys whose value is not an integer inside its bound; empty when the limits are valid. */
export function extractionLimitsProblems(limits: ExtractionLimits): Array<keyof ExtractionLimits> {
  return (Object.keys(EXTRACTION_LIMIT_BOUNDS) as Array<keyof ExtractionLimits>).filter((key) => {
    const value: unknown = (limits as Partial<ExtractionLimits>)[key];
    const { min, max } = EXTRACTION_LIMIT_BOUNDS[key];
    return !(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max);
  });
}

export function workerLimitsOf(limits: ExtractionLimits): WorkerLimits {
  return { maxTextChars: limits.maxTextChars, ...FIXED_WORKER_LIMITS };
}
