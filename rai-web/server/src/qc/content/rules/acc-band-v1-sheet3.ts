// ACC-BAND-V1-SHEET3 (W4b plan section 3.3; provisional until D09). Checklist template v1.0 Sheet 3 (SL#2.1) sets
// go-live hallucination bands by risk tier: high below 1%, medium below 2%, low below 3%. A stated hallucination rate
// at or above the band of its stated tier is a finding; strict less-than passes, so a rate equal to its band fails.
//
//   - Judged claims: on the hallucination item (`params.items`), citing a metric in `params.bandMetrics`, with a value
//     that parses as a percent or a ratio (plan 3.2; a stated `unit` word wins). The answer does not matter: a stated
//     rate is judged as stated. No value, a value that does not parse, or a count is not a rate (ACC-METRIC-CITED
//     judges that claim).
//   - The rate in percent is the value (`percent`) or the value × 100 on the decimal string (`ratio`), and it is
//     compared with the band exactly (`compareDecimal`, decision 11); numbers are made only after the comparison.
//   - A claim whose `tier` is missing or matches no word of `params.tiers` cannot be banded: it is a finding with the
//     message `qc.finding.acc_band_v1_sheet3_tier_missing`, whatever the rate.
//   - One finding per judged claim (decision 30): artifact scope, the claim's locator and `excerptHash`, its
//     `claimKey`; the same claim text twice in one artifact is one finding with one evidence entry per place.
//   - The bands belong to v1.0 Sheet 3 only (L12): the seed lists the rule on that template only, publishing it on
//     another is refused (`rule_template_isolated`), and the rule raises nothing on any other template.
//   - Approve attempts only; its seeded `slots` are [1], so only the AI/COE attempt reads slot 1 (decision 28).
import type { EvidenceLocation, Measure, QcFinding } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import { AccBandV1Sheet3ParamsSchema, type AccBandV1Sheet3Params } from '@rai/shared/schemas/cases';
import {
  claimItem,
  metricIdOf,
  normaliseLabel,
  parseClaims,
  parseValue,
  type GrammarClaim,
} from '../claims.js';
import { compareDecimal, decimalToNumber, ratioToPercent } from '../decimal.js';
import { claimKeyOf, excerptHashOf } from '../excerpt.js';
import type { ContentDocument, ContentRule, ContentRuleInput } from './rule.js';

/** The only checklist template whose bands these are (W4a template isolation; `IMPLEMENTED_RULES` agrees). */
export const BAND_TEMPLATE = 'v1.0 Sheet3';
const ITEM_REFERENCE = /^\d+(\.\d+){0,3}$/; // decision 26: an item number enters params only by this pattern
const TIERS = ['high', 'medium', 'low'] as const;
type Tier = (typeof TIERS)[number];

function tierOf(text: string | undefined, params: AccBandV1Sheet3Params): Tier | null {
  if (text === undefined) return null;
  const word = normaliseLabel(text);
  if (word === '') return null;
  for (const tier of TIERS) {
    const words = [...params.tiers[tier].en, ...params.tiers[tier].th].map(normaliseLabel);
    if (words.includes(word)) return tier;
  }
  return null;
}

/** The claim's rate in percent as a canonical decimal string, or null when it states no percent or ratio. */
function percentOf(claim: GrammarClaim): string | null {
  const { value, unit } = claim.fields;
  if (value === undefined) return null;
  const parsed = parseValue(value, unit);
  if (parsed === null) return null;
  if (parsed.unit === 'percent') return parsed.decimal;
  if (parsed.unit === 'ratio') return ratioToPercent(parsed.decimal);
  return null; // a count is not a rate
}

function numberOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const parsed = parseValue(text);
  return parsed === null ? null : decimalToNumber(parsed.decimal);
}

function documentFindings(
  input: ContentRuleInput,
  params: AccBandV1Sheet3Params,
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
    if (!params.bandMetrics.includes(metric)) continue;
    const percent = percentOf(claim);
    if (percent === null) continue;
    const tier = tierOf(claim.fields.tier, params);
    const band = tier === null ? null : params.bands[tier];
    if (band !== null && compareDecimal(percent, band) < 0) continue; // strictly below its band: passes

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
    // `value` and `threshold` are exact decimal strings and `threshold_source` is the version's template, so every
    // param passes `message_param_text`; `tier` is one of the three tier keys.
    const messageParams: Record<string, string | number> =
      tier === null || band === null
        ? { slot: artifact.slot, value: percent, threshold_source: request.checklistTemplateVersion }
        : {
            slot: artifact.slot,
            tier,
            value: percent,
            threshold: band,
            threshold_source: request.checklistTemplateVersion,
          };
    const reference = claim.fields.item?.trim();
    if (reference !== undefined && ITEM_REFERENCE.test(reference)) messageParams['item'] = reference;
    const measure: Measure = {
      metric,
      value: decimalToNumber(percent),
      denominator: numberOf(claim.fields.denominator),
      threshold: band === null ? null : decimalToNumber(band),
      unit: 'percent',
      thresholdSource: BAND_TEMPLATE,
    };
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
      message: {
        key: band === null ? 'qc.finding.acc_band_v1_sheet3_tier_missing' : 'qc.finding.acc_band_v1_sheet3',
        params: messageParams,
      },
      provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
    });
  }
  return [...byClaim.values()];
}

function evaluate(input: ContentRuleInput): QcFinding[] {
  // Other templates never inherit the v1.0 Sheet-3 bands (L12), whatever a request carries.
  if (input.request.checklistTemplateVersion !== BAND_TEMPLATE) return [];
  const params = input.params as AccBandV1Sheet3Params; // checked against the schema by the runner
  return input.documents.flatMap((doc) => documentFindings(input, params, doc));
}

export const ACC_BAND_V1_SHEET3: ContentRule = Object.freeze({
  triggers: Object.freeze(['approve_attempt'] as const),
  paramsSchema: AccBandV1Sheet3ParamsSchema,
  evaluate,
});
