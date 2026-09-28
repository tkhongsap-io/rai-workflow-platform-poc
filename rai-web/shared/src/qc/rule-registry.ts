// W6-03 (W6 plan section 2.4): the QC rules the product implements, by catalogue rule ID. An Admin publish of a
// `qc_rules` catalogue is refused when an entry names a rule not listed here, gives it another engine, selects it on a
// trigger it is not defined for, or lists it under a template it is restricted from (Q6: a rule that would silently
// not run can never be published). A static list in @rai/shared because shared cannot import server code; the server
// test `server/src/qc/rule-registry.test.ts` asserts the `metadata` entries equal `METADATA_RULES` (keys and
// triggers), so the two cannot drift.
//
// The content rules are the four the W4a catalogue lists for W4b (W4a plan section 4), with that catalogue's
// triggers, and `PACK-CONTRADICTION`, added by W4-06d (W6-03 merged first); the server test also asserts the
// `content` entries equal `CONTENT_RULES`. `RISK-TIER-UNKNOWN` (W5-10) joins in the PR that lands it (W6 plan 11.2).
import type { QcRuleEngine } from '../schemas/cases.js';
import type { QcTrigger } from './types.js';

export interface ImplementedRule {
  readonly engine: QcRuleEngine;
  /** The triggers the rule is defined for; a catalogue entry may select a subset. */
  readonly triggers: readonly QcTrigger[];
  /** When present, the only checklist template versions whose catalogue may list the rule (L12). */
  readonly templates?: readonly string[];
}

const rule = (engine: QcRuleEngine, triggers: QcTrigger[], templates?: string[]): ImplementedRule =>
  Object.freeze({
    engine,
    triggers: Object.freeze(triggers),
    ...(templates === undefined ? {} : { templates: Object.freeze(templates) }),
  });

export const IMPLEMENTED_RULES: Readonly<Record<string, ImplementedRule>> = Object.freeze({
  // W4-03 metadata rules (server/src/qc/deterministic/rules/index.ts).
  'PACK-SLOT-MISSING': rule('metadata', ['submit', 'approve_attempt']),
  'PACK-STAGE-MISMATCH': rule('metadata', ['submit']),
  'PACK-NA-VENDOR-DOC': rule('metadata', ['submit']),
  // W4b content rules, catalogued in W4a (provisional until D09).
  'ACC-METRIC-CITED': rule('content', ['upload', 'approve_attempt']),
  'ACC-EXTRACTION-NOT-HALLUCINATION': rule('content', ['approve_attempt']),
  // The v1.0 Sheet-3 bands never apply to another template version (source spec, L12).
  'ACC-BAND-V1-SHEET3': rule('content', ['approve_attempt'], ['v1.0 Sheet3']),
  'ACC-CLASSIC-ML-METRIC': rule('content', ['approve_attempt']),
  // W4-06d: the pack facts of slots 2 and 5, read on submit (W4b plan section 3.3).
  'PACK-CONTRADICTION': rule('content', ['submit']),
});
