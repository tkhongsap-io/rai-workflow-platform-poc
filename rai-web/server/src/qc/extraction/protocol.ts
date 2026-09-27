// W4-05b (W4b plan section 4.2): the host side of the worker protocol. One request in (`{ mediaType, bytes, limits }`),
// one reply out. The reply is untrusted: it is checked against a TypeBox schema that refuses unknown keys, and
// anything malformed is `crash`. The output caps are counted again here, so a worker that ignores them is still
// `limit_output`. The extractor version is the host's; a reply cannot carry one.
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { Segment } from './port.js';
import { CELL_REFERENCE_PATTERN } from '@rai/shared/qc/types';
import { locatorChars, type WorkerLimits, type WorkerRequest } from './worker/extract.js';

export type { WorkerLimits, WorkerReply, WorkerRequest } from './worker/extract.js';

/**
 * The shared `EvidenceLocator` shape as the wire accepts it: the same five kinds, but every variant and the page region
 * refuse unknown keys (spec item 3), and the ordinals the parsers always emit are required. Since W4-16 the text shapes
 * (`section.heading`, `cell.sheet`) are gone from the shared contract and from the wire, so a worker cannot put document
 * text into a stored, served locator (decisions 21 and 23): a reply carrying one is a crash.
 */
const WIRE_STRICT = { additionalProperties: false } as const;
export const WireLocatorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('page'),
      page: Type.Number(),
      region: Type.Optional(
        Type.Object({ x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() }, WIRE_STRICT),
      ),
    },
    WIRE_STRICT,
  ),
  Type.Object({ kind: Type.Literal('text_range'), start: Type.Number(), end: Type.Number() }, WIRE_STRICT),
  Type.Object({ kind: Type.Literal('absent') }, WIRE_STRICT),
  // W4-05c: the text-free ordinal shapes the DOCX and XLSX parsers emit (decision 21, the W4-16 contract): a paragraph
  // ordinal, and a sheet ordinal with an A1 reference checked by the plan's pattern. No string here is document text.
  Type.Object({ kind: Type.Literal('section'), index: Type.Integer({ minimum: 1 }) }, WIRE_STRICT),
  Type.Object(
    {
      kind: Type.Literal('cell'),
      sheetIndex: Type.Integer({ minimum: 1 }),
      cell: Type.String({ pattern: CELL_REFERENCE_PATTERN }),
    },
    WIRE_STRICT,
  ),
]);

const SegmentSchema = Type.Object(
  { locator: WireLocatorSchema, text: Type.String() },
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

/**
 * Over the caps first (so an oversized but well-formed reply is `limit_output`), then the strict schema. Locator
 * strings count toward the text cap, and one over `MAX_LOCATOR_STRING_CHARS` is `limit_output`.
 */
export function classifyReply(value: unknown, limits: WorkerLimits): ClassifiedReply {
  if (typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true) {
    const segments = (value as { segments?: unknown }).segments;
    if (Array.isArray(segments)) {
      if (segments.length > limits.maxSegments) return { ok: false, reason: 'limit_output' };
      let chars = 0;
      for (const segment of segments as unknown[]) {
        if (typeof segment !== 'object' || segment === null) continue;
        const { text, locator } = segment as { text?: unknown; locator?: unknown };
        if (typeof text === 'string') chars += text.length;
        const inLocator = locatorChars(locator);
        if (inLocator < 0) return { ok: false, reason: 'limit_output' };
        chars += inLocator;
      }
      if (chars > limits.maxTextChars) return { ok: false, reason: 'limit_output' };
    }
  }
  if (!Value.Check(WorkerReplySchema, value)) return { ok: false, reason: 'crash' };
  return value.ok ? { ok: true, segments: value.segments } : { ok: false, reason: value.reason };
}
