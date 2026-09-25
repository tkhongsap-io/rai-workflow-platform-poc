// W0-07 section 3.4 step 4 and 5: the shared validator a runner result passes before anything is persisted.
// The orchestrator (W2-05, server/src/qc) treats any violation as `unavailable:runner_error` with the violation
// name in `detail`; the scripted substitute (W1-10) runs the same checks over its scripts at construction so a
// malformed script is a build failure, never a finding. Pure: no I/O, no clock.

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { LANES, type Lane, type LaneMapping, owningLaneRule } from '../constants.js';
import { QC_RULE_ID_PATTERN, type FindingScope, type QcFinding } from './types.js';

const SlotSchema = Type.Union([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => Type.Literal(n)));
const LaneSchema = Type.Union(LANES.map((lane) => Type.Literal(lane)));
const TriggerSchema = Type.Union([
  Type.Literal('upload'),
  Type.Literal('submit'),
  Type.Literal('approve_attempt'),
]);
const Sha256HexSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });

export const EvidenceLocatorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('page'),
      page: Type.Integer({ minimum: 1 }),
      region: Type.Optional(
        Type.Object(
          { x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('text_range'),
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('cell'), sheet: Type.String({ minLength: 1 }), cell: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('section'), heading: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('absent') }, { additionalProperties: false }),
]);

/** References only: no `excerpt` or any other document-text field can pass `additionalProperties: false`. */
export const EvidenceLocationSchema = Type.Object(
  {
    artifactId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    contentHash: Type.Union([Sha256HexSchema, Type.Null()]),
    slot: Type.Union([SlotSchema, Type.Null()]),
    locator: EvidenceLocatorSchema,
    excerptHash: Type.Optional(Sha256HexSchema),
  },
  { additionalProperties: false },
);

export const MeasureSchema = Type.Object(
  {
    metric: Type.String({ minLength: 1 }),
    value: Type.Union([Type.Number(), Type.Null()]),
    denominator: Type.Union([Type.Number(), Type.Null()]),
    threshold: Type.Union([Type.Number(), Type.Null()]),
    unit: Type.Union([Type.Literal('percent'), Type.Literal('ratio'), Type.Literal('count')]),
    thresholdSource: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const FindingScopeSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('artifact'),
      slot: SlotSchema,
      artifactId: Type.String({ minLength: 1 }),
      contentHash: Sha256HexSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('slot'), slot: SlotSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('pack') }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('run'), trigger: TriggerSchema, lane: Type.Union([LaneSchema, Type.Null()]) },
    { additionalProperties: false },
  ),
]);

export const QcFindingSchema = Type.Object(
  {
    findingKey: Type.String({ minLength: 1 }),
    ruleId: Type.String({ pattern: QC_RULE_ID_PATTERN.source }),
    ruleRevision: Type.String({ minLength: 1 }),
    trigger: TriggerSchema,
    scope: FindingScopeSchema,
    severity: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
    owningLane: LaneSchema,
    evidence: Type.Array(EvidenceLocationSchema, { minItems: 1 }),
    measure: Type.Union([MeasureSchema, Type.Null()]),
    message: Type.Object(
      {
        key: Type.String({ pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' }), // a locale key (D12), never text
        params: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
      },
      { additionalProperties: false },
    ),
    provenance: Type.Object(
      { runner: Type.String({ minLength: 1 }), runnerVersion: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const QcRunResultSchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal('completed'),
      findings: Type.Array(QcFindingSchema),
      rulesEvaluated: Type.Array(Type.String({ pattern: QC_RULE_ID_PATTERN.source })),
      startedAt: Type.String({ minLength: 1 }),
      finishedAt: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal('unavailable'),
      reason: Type.Union([
        Type.Literal('timeout'),
        Type.Literal('runner_error'),
        Type.Literal('not_configured'),
        Type.Literal('artifact_unreadable'),
      ]),
      detail: Type.Union([Type.String(), Type.Null()]),
      startedAt: Type.String({ minLength: 1 }),
      finishedAt: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);

/** The violation names W0-07 3.4 step 4 and 5 put in `detail`. Never document text, never a filename. */
export type QcFindingViolation =
  | 'unknown_field'
  | 'document_text_field'
  | 'excerpt_hash_invalid'
  | 'evidence_missing'
  | 'rule_id_invalid'
  | 'rule_revision_mismatch'
  | 'trigger_mismatch'
  | 'owning_lane_invalid'
  | 'threshold_source_mismatch'
  | 'run_scope_forbidden'
  | 'qc_unavailable_rule_forbidden'
  | 'finding_key_mismatch'
  | 'schema_violation'
  | 'owning_lane_mismatch'
  | 'owning_lane_slot_informational'
  | 'finding_outside_lane';

/** The request fields a finding is checked against (a subset of `QcRunRequest`). */
export interface QcFindingContext {
  trigger: QcFinding['trigger'];
  qcRulesRevision: string;
  checklistTemplateVersion: string;
}

const EVIDENCE_FIELDS = new Set(['artifactId', 'contentHash', 'slot', 'locator', 'excerptHash']);
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** `scopeKey` per W0-07 3.4 step 6: the scope's fields joined in order, so triggers and lanes stay distinct. */
export function scopeKeyOf(scope: FindingScope): string {
  switch (scope.kind) {
    case 'artifact':
      return `artifact:${scope.slot}:${scope.artifactId}:${scope.contentHash}`;
    case 'slot':
      return `slot:${scope.slot}`;
    case 'pack':
      return 'pack';
    case 'run':
      return `run:${scope.trigger}:${scope.lane ?? '-'}`;
  }
}

export function findingKeyOf(ruleId: string, scope: FindingScope): string {
  return `${ruleId}:${scopeKeyOf(scope)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Step 4 of W0-07 3.4 over one finding. Returns the first violation, or null when the finding conforms.
 * `value` is untrusted runner output, so it is typed unknown; a null result narrows it to `QcFinding`.
 */
export function validateQcFinding(value: unknown, context: QcFindingContext): QcFindingViolation | null {
  if (!isRecord(value)) return 'schema_violation';
  // Named checks first, so the violation in `detail` says what went wrong (all are also schema failures).
  if (Array.isArray(value['evidence'])) {
    if (value['evidence'].length === 0) return 'evidence_missing';
    for (const entry of value['evidence'] as unknown[]) {
      if (!isRecord(entry)) return 'schema_violation';
      for (const key of Object.keys(entry)) if (!EVIDENCE_FIELDS.has(key)) return 'document_text_field';
      if (entry['excerptHash'] !== undefined) {
        if (typeof entry['excerptHash'] !== 'string' || !SHA256_HEX.test(entry['excerptHash']))
          return 'excerpt_hash_invalid';
      }
    }
  }
  if (typeof value['ruleId'] === 'string' && !QC_RULE_ID_PATTERN.test(value['ruleId']))
    return 'rule_id_invalid';
  if (typeof value['owningLane'] === 'string' && !(LANES as readonly string[]).includes(value['owningLane']))
    return 'owning_lane_invalid';
  if (!Value.Check(QcFindingSchema, value)) {
    const extra = [...Value.Errors(QcFindingSchema, value)].some((e) => e.keyword === 'additionalProperties');
    return extra ? 'unknown_field' : 'schema_violation';
  }
  const finding = value as QcFinding;
  if (finding.ruleId === 'QC-UNAVAILABLE') return 'qc_unavailable_rule_forbidden';
  if (finding.scope.kind === 'run') return 'run_scope_forbidden';
  if (finding.ruleRevision !== context.qcRulesRevision) return 'rule_revision_mismatch';
  if (finding.trigger !== context.trigger) return 'trigger_mismatch';
  if (finding.measure !== null && finding.measure.thresholdSource !== context.checklistTemplateVersion)
    return 'threshold_source_mismatch';
  if (finding.findingKey !== findingKeyOf(finding.ruleId, finding.scope)) return 'finding_key_mismatch';
  return null;
}

/**
 * Step 5 of W0-07 3.4 under W0-06 section 7 as recorded on 2026-09-25: a single-lane slot and the pack have one
 * lane; slot 5 belongs to the lane whose rule raised it; slot 9 carries no defects. On an approve-attempt run
 * every finding must belong to that run's lane. A run-scoped finding is refused earlier (`run_scope_forbidden`).
 */
export function checkOwningLane(
  finding: QcFinding,
  mapping: LaneMapping,
  runLane: Lane | null,
): QcFindingViolation | null {
  if (finding.scope.kind === 'run') return 'run_scope_forbidden';
  const rule = owningLaneRule(finding.scope, mapping);
  if (rule.kind === 'no_defects') return 'owning_lane_slot_informational';
  if (rule.kind === 'lane' && rule.lane !== finding.owningLane) return 'owning_lane_mismatch';
  if (rule.kind === 'raising_lane' && !rule.lanes.includes(finding.owningLane)) return 'owning_lane_mismatch';
  if (runLane !== null && finding.owningLane !== runLane) return 'finding_outside_lane';
  return null;
}

/** Type guards over the sub-schemas, so callers outside `shared` need no schema library of their own. */
export function isEvidenceLocator(value: unknown): value is QcFinding['evidence'][number]['locator'] {
  return Value.Check(EvidenceLocatorSchema, value);
}

export function isMeasure(value: unknown): value is NonNullable<QcFinding['measure']> {
  return Value.Check(MeasureSchema, value);
}
