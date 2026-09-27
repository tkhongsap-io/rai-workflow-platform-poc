// W4-06a (W4b plan section 3.1; ADR-0006, decisions 7, 22, 27 and 28): the content QC runner, the W4b implementation of
// the `QcRunner` port that reads what documents say. It executes only the catalogue's `content` rules; the W4a
// deterministic runner keeps the `metadata` rules as the other run part of the same trigger (decision 27, W4-18).
//
//   1. Decide before reading. `rules === null` → `not_configured`. An unknown content rule, a trigger the rule is not
//      defined for, params that fail its schema, an unknown lane mapping or an approve attempt without a lane →
//      `runner_error`. A rule whose `claimSource` is `grammar+model` → `not_configured` / `model_disabled`: no model
//      port exists before W4-07. No byte is read on any of these paths.
//   2. Lane scope (decisions 22 and 28). A rule reads only its readable slots: on upload, `params.slots` ∩ the
//      single-lane slots of the version's mapping ∩ the uploaded slot; on submit, `params.slots`; on an approve attempt,
//      `params.slots` ∩ the run lane's slots. Slot 9 is never read. A rule with nothing in scope reads nothing, emits
//      nothing and is still counted in `rulesEvaluated`.
//   3. Read and extract each artifact in scope once per run: at most `byteLength` bytes whose sha256 must equal
//      `contentHash` (`hash_mismatch`); a `read()` that rejects is `blob_missing`. Extraction failures map to
//      `artifact_unreadable` / `extract_<reason>`, a crash to `runner_error` / `extract_crash`, an abort to `timeout`.
//      Any failure makes this run part unavailable: it never returns a shorter clean result.
//   4. Evaluate each rule over its documents. Text stays in memory for the run; findings cite locators and hashes.
//
// Its module graph holds no network, process, database or blob-store module (module-graph.test.ts): bytes arrive
// through the request's authorized read handles and text through the injected `Extractor`.
import { createHash } from 'node:crypto';
import {
  LANE_MAPPINGS_BY_VERSION,
  owningLaneRule,
  slotsForLane,
  type Lane,
  type LaneMapping,
} from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcFinding,
  QcRunRequest,
  QcRunResult,
  QcRunner,
  QcUnavailableReason,
  SelectedRule,
  SlotNumber,
} from '@rai/shared/qc/types';
import { ALLOWED_MEDIA_TYPES, type AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { ContentRuleBaseParams } from '@rai/shared/schemas/cases';
import { Value } from 'typebox/value';
import { SERVER_PACKAGE_VERSION } from '../../server-version.js';
import type { ExtractFailureReason, Extractor, Segment } from '../extraction/port.js';
import { CONTENT_RULES } from './rules/index.js';
import type { ContentDocument, ContentRule } from './rules/rule.js';

/** The runner identity (W0-04 `qc_run.engine_id`) of the content run part. */
export const CONTENT_RUNNER = 'content' as const;

/** What the host logs as `qc.extract.failed` (W0-10): identities and numbers only, no filename or text. */
export interface ExtractFailedEvent {
  slot: SlotNumber;
  reason: ExtractFailureReason;
  durationMs: number;
  extractorVersion: string;
}

export interface ContentQcRunnerOptions {
  extractor: Extractor;
  now?: () => Date;
  /** Defaults to the `@rai/server` package version. */
  runnerVersion?: string;
  /** Called once per failed extraction; the composition binds it to the `qc.extract.failed` line (W4-13b). */
  onExtractFailed?: (event: ExtractFailedEvent) => void;
}

class Unavailable extends Error {
  constructor(
    readonly reason: QcUnavailableReason,
    readonly detail: string | null,
  ) {
    super(`${reason}: ${detail ?? '-'}`);
  }
}

const runnerError = (detail: string) => new Unavailable('runner_error', detail);
const unreadable = (detail: string) => new Unavailable('artifact_unreadable', detail);

interface PlannedRule {
  rule: SelectedRule;
  impl: ContentRule;
  params: ContentRuleBaseParams;
  slots: ReadonlySet<SlotNumber>;
}

/** Slots exactly one lane reviews under the mapping (a single-lane slot, W0-06 7.1). */
function singleLane(slot: SlotNumber, mapping: LaneMapping): Lane | null {
  const rule = owningLaneRule({ kind: 'slot', slot }, mapping);
  return rule.kind === 'lane' ? rule.lane : null;
}

/** Decision 28 and 22: the slots this rule may read on this request. Never slot 9. */
function readableSlots(
  params: ContentRuleBaseParams,
  request: QcRunRequest,
  mapping: LaneMapping,
): Set<SlotNumber> {
  const listed = params.slots.filter((s): s is SlotNumber => s >= 1 && s <= 8);
  const carried = new Set(request.slots.map((s) => s.slot));
  switch (request.trigger) {
    case 'upload':
      return new Set(listed.filter((slot) => carried.has(slot) && singleLane(slot, mapping) !== null));
    case 'submit':
      return new Set(listed);
    case 'approve_attempt': {
      const laneSlots = new Set<number>(slotsForLane(request.lane!, mapping));
      return new Set(listed.filter((slot) => laneSlots.has(slot)));
    }
  }
}

function plan(request: QcRunRequest): { rules: PlannedRule[]; mapping: LaneMapping } {
  if (request.rules === null) throw new Unavailable('not_configured', 'no_qc_rules_revision');
  const mapping = Object.hasOwn(LANE_MAPPINGS_BY_VERSION, request.laneMappingVersion)
    ? LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]
    : undefined;
  if (mapping === undefined) throw runnerError('unknown_lane_mapping');
  if (request.trigger === 'approve_attempt' && request.lane === null)
    throw runnerError('approve_attempt_without_lane');
  const rules: PlannedRule[] = [];
  for (const rule of request.rules) {
    if (rule.engine !== 'content') continue; // metadata rules run in the deterministic part (decision 27)
    const impl = Object.hasOwn(CONTENT_RULES, rule.ruleId) ? CONTENT_RULES[rule.ruleId] : undefined;
    if (impl === undefined) throw runnerError('unknown_content_rule');
    if (!impl.triggers.includes(request.trigger)) throw runnerError('unsupported_rule_trigger');
    if (!Value.Check(impl.paramsSchema, rule.params)) throw runnerError('invalid_rule_params');
    const params = rule.params as unknown as ContentRuleBaseParams;
    rules.push({ rule, impl, params, slots: readableSlots(params, request, mapping) });
  }
  // No model port exists before W4-07; a rule that asks for model assist cannot run as configured.
  if (rules.some((r) => r.params.claimSource !== 'grammar'))
    throw new Unavailable('not_configured', 'model_disabled');
  return { rules, mapping };
}

async function readBytes(artifact: AuthorizedArtifactRef): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await artifact.read();
  } catch {
    throw unreadable('blob_missing'); // no blob, no store bound, or a revoked handle (W4-05a)
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > artifact.byteLength) {
        await reader.cancel().catch(() => undefined);
        throw unreadable('hash_mismatch'); // more bytes than recorded: not the stored artifact
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Unavailable) throw error;
    throw unreadable('blob_missing');
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.contentHash)
    throw unreadable('hash_mismatch');
  return bytes;
}

const isAllowedMediaType = (mediaType: string): mediaType is AllowedMediaType =>
  (ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType);

export function createContentQcRunner(options: ContentQcRunnerOptions): QcRunner {
  const { extractor } = options;
  const now = options.now ?? (() => new Date());
  const identity = Object.freeze({
    runner: CONTENT_RUNNER,
    runnerVersion: options.runnerVersion ?? SERVER_PACKAGE_VERSION,
  });

  /** One artifact's segments: read, hash-check and extract. */
  async function segmentsOf(
    artifact: AuthorizedArtifactRef,
    signal: AbortSignal,
    extracted: { used: boolean },
  ): Promise<Segment[]> {
    const bytes = await readBytes(artifact);
    if (!isAllowedMediaType(artifact.mediaType)) throw unreadable('extract_unreadable');
    const started = performance.now();
    const failed = (reason: ExtractFailureReason, extractorVersion: string) =>
      options.onExtractFailed?.({
        slot: artifact.slot,
        reason,
        durationMs: Math.max(0, performance.now() - started),
        extractorVersion,
      });
    let result;
    extracted.used = true; // the run reports the extractor it used (W4-11b `engine.extractorVersion`)
    try {
      result = await extractor.extract({ mediaType: artifact.mediaType, bytes }, signal);
    } catch {
      if (signal.aborted) throw new Unavailable('timeout', null);
      failed('crash', extractor.version);
      throw runnerError('extract_crash');
    }
    if (signal.aborted) throw new Unavailable('timeout', null);
    if (result.ok) return result.segments;
    failed(result.reason, result.extractorVersion);
    if (result.reason === 'crash') throw runnerError('extract_crash');
    throw unreadable(`extract_${result.reason}`);
  }

  async function evaluate(
    request: QcRunRequest,
    signal: AbortSignal,
    extracted: { used: boolean },
  ): Promise<{ findings: QcFinding[]; rulesEvaluated: string[] }> {
    const { rules } = plan(request);
    if (signal.aborted) throw new Unavailable('timeout', null);
    const inScope = new Set(rules.flatMap((r) => [...r.slots]));
    const toRead = request.artifacts.filter((a) => inScope.has(a.slot));
    // Every artifact once, concurrently (the extractor caps live workers); the first failure in request order wins,
    // so the outcome does not depend on which extraction finished first.
    const settled = await Promise.allSettled(
      toRead.map((artifact) => segmentsOf(artifact, signal, extracted)),
    );
    const segments = new Map<string, Segment[]>();
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') throw outcome.reason as Error;
      segments.set(toRead[i]!.artifactId, outcome.value);
    });
    const findings: QcFinding[] = [];
    const rulesEvaluated: string[] = [];
    const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!;
    for (const { rule, impl, slots } of rules) {
      const documents: ContentDocument[] = toRead
        .filter((artifact) => slots.has(artifact.slot))
        .map((artifact) => ({
          artifact,
          segments: segments.get(artifact.artifactId)!,
          owningLane:
            request.trigger === 'approve_attempt'
              ? request.lane
              : request.trigger === 'upload'
                ? singleLane(artifact.slot, mapping)
                : null,
        }));
      findings.push(
        ...impl.evaluate({ request, rule, params: rule.params, documents, provenance: identity }),
      );
      rulesEvaluated.push(rule.ruleId);
    }
    return { findings, rulesEvaluated };
  }

  return {
    identity,
    async run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult> {
      const startedAt = now().toISOString();
      const extracted = { used: false };
      const engine = () => (extracted.used ? { engine: { extractorVersion: extractor.version } } : {});
      try {
        const { findings, rulesEvaluated } = await evaluate(request, signal, extracted);
        return {
          status: 'completed',
          findings,
          rulesEvaluated,
          startedAt,
          finishedAt: now().toISOString(),
          ...engine(),
        };
      } catch (error) {
        if (!(error instanceof Unavailable)) throw error;
        return {
          status: 'unavailable',
          reason: error.reason,
          detail: error.detail,
          startedAt,
          finishedAt: now().toISOString(),
          ...engine(),
        };
      }
    },
  };
}
