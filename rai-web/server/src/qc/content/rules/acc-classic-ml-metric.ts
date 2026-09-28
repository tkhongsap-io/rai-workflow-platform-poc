// ACC-CLASSIC-ML-METRIC (W4b plan section 3.3; provisional until D09). A classic-ML model uses its sheet's matching
// metric or a justified N/A (source spec QC). An attached artifact passes when some claim on the
// `classic_ml_performance` item cites a metric in `params.matchingMetrics` with a value that parses, or answers `na`
// with a reason (a non-empty `evidence` field: the grammar's place for what backs an answer). Otherwise:
//
//   - One finding for the artifact, with no `claimKey`: the defect is that the document as a whole never states the
//     matching metric, not one claim's text, so one disposition covers it (the run holds at most one per artifact).
//   - Evidence: every performance claim's locator and `excerptHash`, in document order; an artifact with no
//     performance claim is cited with an `absent` locator.
//   - `measure` is null: there is no matching figure to report. Message params `{ slot, threshold_source }`, the
//     threshold source being the version's template (the sheet whose metric is meant).
//
// Selected only for `classic_ml` (`qc/select.ts`). Approve attempts only; its seeded `slots` are [1], so only the
// AI/COE attempt reads slot 1 (decision 28). A slot 1 that is not applicable, missing or not yet carries no artifact,
// so nothing is read and nothing raised: the N/A reason is metadata, and the metadata rules own the other states.
import type { EvidenceLocation, QcFinding } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import { AccClassicMlMetricParamsSchema, type AccClassicMlMetricParams } from '@rai/shared/schemas/cases';
import { claimItem, metricIdOf, parseClaims, parseValue, type GrammarClaim } from '../claims.js';
import { excerptHashOf } from '../excerpt.js';
import type { ContentDocument, ContentRule, ContentRuleInput } from './rule.js';

function satisfies(claim: GrammarClaim, params: AccClassicMlMetricParams): boolean {
  const { fields } = claim;
  if (claim.answer === 'na') return (fields.evidence ?? '').trim() !== '';
  const metric = fields.metric === undefined ? undefined : metricIdOf(fields.metric);
  if (metric === undefined || !params.matchingMetrics.includes(metric)) return false;
  return fields.value !== undefined && parseValue(fields.value, fields.unit) !== null;
}

function documentFinding(
  input: ContentRuleInput,
  params: AccClassicMlMetricParams,
  doc: ContentDocument,
): QcFinding | null {
  const { request, rule, provenance } = input;
  const { artifact } = doc;
  if (doc.owningLane === null) return null; // approve attempts only (triggers); a run lane always owns the finding
  const performance = parseClaims(doc.segments, params.labels).filter(
    (claim) => claimItem(claim, params.items) === 'classic_ml_performance',
  );
  if (performance.some((claim) => satisfies(claim, params))) return null;
  const at = { artifactId: artifact.artifactId, contentHash: artifact.contentHash, slot: artifact.slot };
  const evidence: EvidenceLocation[] =
    performance.length === 0
      ? [{ ...at, locator: { kind: 'absent' } }]
      : performance.map((claim) => ({
          ...at,
          locator: claim.locator,
          excerptHash: excerptHashOf(claim.excerpt),
        }));
  const scope = {
    kind: 'artifact' as const,
    slot: artifact.slot,
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
  };
  return {
    findingKey: findingKeyOf(rule.ruleId, scope),
    ruleId: rule.ruleId,
    ruleRevision: request.qcRulesRevision,
    trigger: request.trigger,
    scope,
    severity: rule.severity,
    owningLane: doc.owningLane,
    evidence,
    measure: null,
    message: {
      key: 'qc.finding.acc_classic_ml_metric',
      params: { slot: artifact.slot, threshold_source: request.checklistTemplateVersion },
    },
    provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
  };
}

function evaluate(input: ContentRuleInput): QcFinding[] {
  const params = input.params as AccClassicMlMetricParams; // checked against the schema by the runner
  return input.documents.flatMap((doc) => documentFinding(input, params, doc) ?? []);
}

export const ACC_CLASSIC_ML_METRIC: ContentRule = Object.freeze({
  triggers: Object.freeze(['approve_attempt'] as const),
  paramsSchema: AccClassicMlMetricParamsSchema,
  evaluate,
});
