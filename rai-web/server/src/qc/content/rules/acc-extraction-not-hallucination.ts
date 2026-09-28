// ACC-EXTRACTION-NOT-HALLUCINATION (W4b plan section 3.3; provisional until D09). Extraction accuracy is not a
// hallucination rate (PRD; v1.0 item 3.5): a claim on the hallucination item that cites a metric in
// `params.extractionMetrics` is a finding, whatever its answer, because the figure it offers measures something else.
//
//   - One finding per such claim (decision 30): artifact scope, the claim's locator and `excerptHash`, its
//     `claimKey`. The same claim text written twice in one artifact is one finding, one evidence entry per place.
//   - `measure` is the stated figure under the cited metric ID: value, denominator and threshold as stated numbers
//     (null when not stated as one), the value's unit (else the stated `unit` word, else `percent`), and
//     `thresholdSource` the version's template.
//   - Approve attempts only; its seeded `slots` are [1], so the runner hands it slot 1 on the AI/COE attempt and
//     nothing on the DPO and IT/Security attempts (decision 28). Findings are owned by the run's lane.
import type { EvidenceLocation, Measure, QcFinding } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import {
  AccExtractionNotHallucinationParamsSchema,
  type AccExtractionNotHallucinationParams,
} from '@rai/shared/schemas/cases';
import {
  claimItem,
  metricIdOf,
  parseClaims,
  parseValue,
  statedUnitOf,
  type GrammarClaim,
} from '../claims.js';
import { decimalToNumber } from '../decimal.js';
import { claimKeyOf, excerptHashOf } from '../excerpt.js';
import type { ContentDocument, ContentRule, ContentRuleInput } from './rule.js';

const ITEM_REFERENCE = /^\d+(\.\d+){0,3}$/; // decision 26: an item number enters params only by this pattern

function numberOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const parsed = parseValue(text);
  return parsed === null ? null : decimalToNumber(parsed.decimal);
}

function measureOf(claim: GrammarClaim, metric: string, templateVersion: string): Measure {
  const { fields } = claim;
  const value = fields.value === undefined ? null : parseValue(fields.value, fields.unit);
  const unit = value?.unit ?? statedUnitOf(fields.unit) ?? 'percent';
  return {
    metric,
    value: value === null ? null : decimalToNumber(value.decimal),
    denominator: numberOf(fields.denominator),
    threshold: numberOf(fields.threshold),
    unit,
    thresholdSource: templateVersion,
  };
}

function documentFindings(
  input: ContentRuleInput,
  params: AccExtractionNotHallucinationParams,
  doc: ContentDocument,
): QcFinding[] {
  const { request, rule, provenance } = input;
  const { artifact } = doc;
  if (doc.owningLane === null) return []; // approve attempts only (triggers); a run lane always owns the finding
  const scope = {
    kind: 'artifact' as const,
    slot: artifact.slot,
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
  };
  const byClaim = new Map<string, QcFinding>();
  for (const claim of parseClaims(doc.segments, params.labels)) {
    if (claimItem(claim, params.items) !== 'hallucination') continue;
    if (claim.fields.metric === undefined) continue;
    const metric = metricIdOf(claim.fields.metric);
    if (!params.extractionMetrics.includes(metric)) continue;
    const excerptHash = excerptHashOf(claim.excerpt);
    const claimKey = claimKeyOf(excerptHash);
    const evidence: EvidenceLocation = {
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
      slot: artifact.slot,
      locator: claim.locator,
      excerptHash,
    };
    const known = byClaim.get(claimKey);
    if (known !== undefined) {
      known.evidence.push(evidence);
      continue;
    }
    // `metric` is an extraction metric ID from the catalogue, so it matches the key pattern (message_param_text).
    const messageParams: Record<string, string | number> = { slot: artifact.slot, metric };
    const reference = claim.fields.item?.trim();
    if (reference !== undefined && ITEM_REFERENCE.test(reference)) messageParams['item'] = reference;
    byClaim.set(claimKey, {
      findingKey: findingKeyOf(rule.ruleId, scope, claimKey),
      ruleId: rule.ruleId,
      ruleRevision: request.qcRulesRevision,
      trigger: request.trigger,
      scope,
      claimKey,
      severity: rule.severity,
      owningLane: doc.owningLane,
      evidence: [evidence],
      measure: measureOf(claim, metric, request.checklistTemplateVersion),
      message: { key: 'qc.finding.acc_extraction_not_hallucination', params: messageParams },
      provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
    });
  }
  return [...byClaim.values()];
}

function evaluate(input: ContentRuleInput): QcFinding[] {
  const params = input.params as AccExtractionNotHallucinationParams; // checked against the schema by the runner
  return input.documents.flatMap((doc) => documentFindings(input, params, doc));
}

export const ACC_EXTRACTION_NOT_HALLUCINATION: ContentRule = Object.freeze({
  triggers: Object.freeze(['approve_attempt'] as const),
  paramsSchema: AccExtractionNotHallucinationParamsSchema,
  evaluate,
});
