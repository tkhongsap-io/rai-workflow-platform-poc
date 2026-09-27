// W4-05b (W4b plan section 4.2): the host side of the worker protocol. One request in (`{ mediaType, bytes, limits }`),
// one reply out. The reply is untrusted: it is checked against a TypeBox schema that refuses unknown keys, and
// anything malformed is `crash`. The output caps are counted again here, so a worker that ignores them is still
// `limit_output`. The extractor version is the host's; a reply cannot carry one.
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { EvidenceLocatorSchema } from '@rai/shared/schemas/review';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { Segment } from './port.js';
import type { WorkerLimits, WorkerRequest } from './worker/extract.js';

export type { WorkerLimits, WorkerReply, WorkerRequest } from './worker/extract.js';

const SegmentSchema = Type.Object(
  { locator: EvidenceLocatorSchema, text: Type.String() },
  { additionalProperties: false },
);
export const WorkerReplySchema = Type.Union([
  Type.Object(
    { ok: Type.Literal(true), segments: Type.Array(SegmentSchema) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([
        Type.Literal('unreadable'),
        Type.Literal('limit_bytes'),
        Type.Literal('limit_output'),
      ]),
    },
    { additionalProperties: false },
  ),
]);

export type ClassifiedReply =
  | { ok: true; segments: Segment[] }
  | { ok: false; reason: 'unreadable' | 'limit_bytes' | 'limit_output' | 'crash' };

export function buildWorkerRequest(
  input: { mediaType: AllowedMediaType; bytes: Uint8Array },
  limits: WorkerLimits,
): WorkerRequest {
  return { mediaType: input.mediaType, bytes: input.bytes, limits };
}

/** Over the caps first (so an oversized but well-formed reply is `limit_output`), then the schema. */
export function classifyReply(value: unknown, limits: WorkerLimits): ClassifiedReply {
  if (typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true) {
    const segments = (value as { segments?: unknown }).segments;
    if (Array.isArray(segments)) {
      if (segments.length > limits.maxSegments) return { ok: false, reason: 'limit_output' };
      let chars = 0;
      for (const segment of segments as unknown[]) {
        const text =
          typeof segment === 'object' && segment !== null ? (segment as { text?: unknown }).text : undefined;
        if (typeof text === 'string') chars += text.length;
      }
      if (chars > limits.maxTextChars) return { ok: false, reason: 'limit_output' };
    }
  }
  if (!Value.Check(WorkerReplySchema, value)) return { ok: false, reason: 'crash' };
  return value.ok ? { ok: true, segments: value.segments } : { ok: false, reason: value.reason };
}
