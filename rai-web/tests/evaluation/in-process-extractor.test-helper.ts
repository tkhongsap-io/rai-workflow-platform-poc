// W4-08a test support: the extraction worker's parsers run in process behind the `Extractor` port, so the unit tests
// run the whole dev split in seconds. The CLI (`run.ts`) uses the real forking worker (`createWorkerExtractor`). Each
// call is recorded (media type and byte length only) so a test can see what was read.
import type { Extractor, Segment } from '@rai/server/qc/extraction/port';
import { FIXED_WORKER_LIMITS } from '@rai/server/qc/extraction/limits';
import { extractInWorker } from '@rai/server/qc/extraction/worker/extract';

export const IN_PROCESS_EXTRACTOR_VERSION = 'rai-extract/1+in-process';

export function inProcessExtractor(calls: Array<{ mediaType: string; byteLength: number }> = []): Extractor {
  return {
    version: IN_PROCESS_EXTRACTOR_VERSION,
    extract(input) {
      calls.push({ mediaType: input.mediaType, byteLength: input.bytes.byteLength });
      const reply = extractInWorker({
        mediaType: input.mediaType,
        bytes: input.bytes,
        limits: { maxTextChars: 1_000_000, ...FIXED_WORKER_LIMITS },
      });
      return Promise.resolve(
        reply.ok
          ? {
              ok: true,
              extractorVersion: IN_PROCESS_EXTRACTOR_VERSION,
              segments: reply.segments as Segment[],
            }
          : { ok: false, extractorVersion: IN_PROCESS_EXTRACTOR_VERSION, reason: reply.reason },
      );
    },
    selfTest: () => Promise.resolve(true),
  };
}
