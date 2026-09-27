// W4-02 (W4a plan section 3): rule selection from a `qc_rules` catalogue body. The version's
// checklist_template_version picks the template (L12: other versions never inherit the v1.0 Sheet-3 bands), the
// trigger filters the rules, and model_type routes the accuracy rules. Pure; the orchestrator loads the body.
import type { ModelType, QcTrigger, SelectedRule } from '@rai/shared/qc/types';
import type { ConfigurationBodies } from '@rai/shared/schemas/cases';

/** A selection that cannot yield a trustworthy rule list; the run is `unavailable:runner_error`, never clean. */
export class RuleSelectionError extends Error {
  constructor(readonly detail: 'unknown_template_version' | 'invalid_rule_catalogue') {
    super(`QC rule selection failed: ${detail}`);
    this.name = 'RuleSelectionError';
  }
}

/**
 * `model_type` routing (plan section 3): the classic-ML metric rule applies only to `classic_ml`, and the LLM
 * accuracy rules never do. Rules not listed here are not routed by model type.
 */
const MODEL_TYPE_ROUTING: Readonly<Record<string, (modelType: ModelType) => boolean>> = Object.freeze({
  'ACC-CLASSIC-ML-METRIC': (m: ModelType) => m === 'classic_ml',
  'ACC-METRIC-CITED': (m: ModelType) => m !== 'classic_ml',
  'ACC-EXTRACTION-NOT-HALLUCINATION': (m: ModelType) => m !== 'classic_ml',
  'ACC-BAND-V1-SHEET3': (m: ModelType) => m !== 'classic_ml',
});

function routed(ruleId: string, modelType: ModelType): boolean {
  return Object.hasOwn(MODEL_TYPE_ROUTING, ruleId) ? MODEL_TYPE_ROUTING[ruleId]!(modelType) : true;
}

export function selectRules(
  body: ConfigurationBodies['qc_rules'],
  templateVersion: string,
  trigger: QcTrigger,
  modelType: ModelType,
): SelectedRule[] {
  if (!Object.hasOwn(body.templates, templateVersion))
    throw new RuleSelectionError('unknown_template_version');
  const template = body.templates[templateVersion]!;
  return template.rules
    .filter((rule) => rule.triggers.includes(trigger) && routed(rule.ruleId, modelType))
    .map((rule) => ({
      ruleId: rule.ruleId,
      engine: rule.engine,
      severity: rule.severity,
      ...(rule.params === undefined ? {} : { params: structuredClone(rule.params) }),
    }));
}
