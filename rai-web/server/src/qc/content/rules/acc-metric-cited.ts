// ACC-METRIC-CITED (W4b plan section 3.3; provisional until D09). A "Yes" on a hallucination or accuracy item must
// cite an accepted metric, a value, a denominator, a threshold and its evidence (source spec: "a Yes on
// hallucination/accuracy must cite metric, denominator, threshold and artefact"). An extraction metric is not an
// accepted metric, so it counts as absent here (ACC-EXTRACTION-NOT-HALLUCINATION, W4-06b, judges it on its own).
//
//   - One finding per defective claim (decision 30): artifact scope, the claim's locator and `excerptHash`, and its
//     `claimKey`. The same claim text written twice in one artifact is one claim: one finding, one evidence entry per
//     place it appears.
//   - `measure` carries what the claim stated when it names an accepted metric and a value (denominator and threshold
//     null when missing, `thresholdSource` the version's template); otherwise it is null, because `MeasureSchema`
//     needs a metric and a unit. Either way the gaps are in `params.missing`, a comma list of field keys.
//   - Owned by the document's lane: slot 1's AI/COE on upload, the run's lane on an approve attempt (decision 28).
import type { EvidenceLocation, Measure, QcFinding } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import { AccMetricCitedParamsSchema, type AccMetricCitedParams } from '@rai/shared/schemas/cases';
import { claimItem, metricIdOf, parseClaims, parseValue, type GrammarClaim } from '../claims.js';
import { decimalToNumber } from '../decimal.js';
import { claimKeyOf, excerptHashOf } from '../excerpt.js';
import type { ContentDocument, ContentRule, ContentRuleInput } from './rule.js';

const JUDGED_ITEMS = new Set(['hallucination', 'accuracy']);
const FIELD_ORDER = ['metric', 'value', 'denominator', 'threshold', 'evidence'] as const;
const ITEM_REFERENCE = /^\d+(\.\d+){0,3}$/; // decision 26: an item number enters params only by this pattern

interface Judged {
  missing: string[];
  measure: Measure | null;
}

function numberOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const parsed = parseValue(text);
  return parsed === null ? null : decimalToNumber(parsed.decimal);
}

function judge(claim: GrammarClaim, params: AccMetricCitedParams, templateVersion: string): Judged {
  const { fields } = claim;
  const metric = fields.metric === undefined ? undefined : metricIdOf(fields.metric);
  const accepted = metric !== undefined && params.acceptedMetrics.includes(metric) ? metric : undefined;
  const value = fields.value === undefined ? null : parseValue(fields.value, fields.unit);
  const denominator = numberOf(fields.denominator);
  const threshold = numberOf(fields.threshold);
  const present: Record<(typeof FIELD_ORDER)[number], boolean> = {
    metric: accepted !== undefined,
    value: value !== null,
    denominator: denominator !== null,
    threshold: threshold !== null,
    evidence: (fields.evidence ?? '').trim() !== '',
  };
  const missing = FIELD_ORDER.filter((field) => !present[field]);
  const measure: Measure | null =
    accepted === undefined || value === null
      ? null
      : {
          metric: accepted,
          value: decimalToNumber(value.decimal),
          denominator,
          threshold,
          unit: value.unit,
          thresholdSource: templateVersion,
        };
  return { missing, measure };
}

function documentFindings(
  input: ContentRuleInput,
  params: AccMetricCitedParams,
  doc: ContentDocument,
): QcFinding[] {
  const { request, rule, provenance } = input;
  const { artifact } = doc;
  if (doc.owningLane === null) return []; // not selected on submit (triggers); nothing to own
  const scope = {
    kind: 'artifact' as const,
    slot: artifact.slot,
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
  };
  const byClaim = new Map<string, QcFinding>();
  for (const claim of parseClaims(doc.segments, params.labels)) {
    if (claim.answer !== 'yes') continue;
    const item = claimItem(claim, params.items);
    if (item === null || !JUDGED_ITEMS.has(item)) continue;
    const { missing, measure } = judge(claim, params, request.checklistTemplateVersion);
    if (missing.length === 0) continue;
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
    const messageParams: Record<string, string | number> = {
      slot: artifact.slot,
      missing: missing.join(','),
    };
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
      measure,
      message: { key: 'qc.finding.acc_metric_cited', params: messageParams },
      provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
    });
  }
  return [...byClaim.values()];
}

function evaluate(input: ContentRuleInput): QcFinding[] {
  const params = input.params as AccMetricCitedParams; // checked against the schema by the runner
  return input.documents.flatMap((doc) => documentFindings(input, params, doc));
}

export const ACC_METRIC_CITED: ContentRule = Object.freeze({
  triggers: Object.freeze(['upload', 'approve_attempt'] as const),
  paramsSchema: AccMetricCitedParamsSchema,
  evaluate,
});
