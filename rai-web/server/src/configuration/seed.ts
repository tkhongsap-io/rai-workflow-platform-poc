// The minimal slice-1 configuration seed (W1-00). Published revisions; W6 adds Admin editing. Values:
//   checklist_templates  the checklist_template_version list W0-08 section 8.3 names ('v1.0 Sheet3', 'v2.0')
//   sla                  working days per lane (D01: DPO 3, others 5)
//   calendar             Asia/Bangkok (D06) with a placeholder holiday list until Admin publishes the Thai
//                        public-holiday list (W6); the dates are widely published fixed-date holidays, not a claim
//   operator_recipients  the single synthetic address of W0-08 section 8.2 (D06); never a real operator address
//   use_case_groups      the D11 value list the W0-08 fixture cases use
//   qc_rules             W4-02: the W4a rule catalogue, label 'w4a.1', per checklist template version (W4a plan
//                        sections 3 and 4). Metadata rules run in W4a (W4-03); content rules are catalogued for
//                        W4b. v2.0 has no ACC-BAND-V1-SHEET3 (L12). Severities follow W0-07 3.5; provisional until D09
// The lane mapping is not configuration (D02; shared/src/constants.ts) and is never seeded here.

import type { ConfigurationBodies, SeedableConfigurationKind } from '@rai/shared/schemas/cases';
import type { Tx } from '../db/client.js';
import { publishRevision, type ConfigurationRevisionRow } from './store.js';

export const SEED_ACTOR = { subjectId: 'system', role: 'system' } as const;

export type ConfigurationSeed = {
  [K in SeedableConfigurationKind]: ConfigurationBodies[K];
};

type QcRule = ConfigurationBodies['qc_rules']['templates'][string]['rules'][number];

const LANE_GATED_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8]; // every slot but 9 (D02 noLaneGate)
const W4A_METADATA_RULES: readonly QcRule[] = [
  {
    ruleId: 'PACK-SLOT-MISSING',
    engine: 'metadata',
    triggers: ['submit', 'approve_attempt'],
    severity: 'medium',
  },
  {
    ruleId: 'PACK-STAGE-MISMATCH',
    engine: 'metadata',
    triggers: ['submit'],
    severity: 'medium',
    // The source spec's two examples: a deployment checklist (slot 8) filed at idea; any lane-gated slot not yet
    // at pre_launch.
    params: { attachedForbiddenAt: { idea: [8] }, notYetForbiddenAt: { pre_launch: LANE_GATED_SLOTS } },
  },
  { ruleId: 'PACK-NA-VENDOR-DOC', engine: 'metadata', triggers: ['submit'], severity: 'medium' },
];
const W4B_CONTENT_RULES: readonly QcRule[] = [
  {
    ruleId: 'ACC-METRIC-CITED',
    engine: 'content',
    triggers: ['approve_attempt', 'upload'],
    severity: 'medium',
  },
  {
    ruleId: 'ACC-EXTRACTION-NOT-HALLUCINATION',
    engine: 'content',
    triggers: ['approve_attempt'],
    severity: 'high',
  },
  { ruleId: 'ACC-BAND-V1-SHEET3', engine: 'content', triggers: ['approve_attempt'], severity: 'high' },
  { ruleId: 'ACC-CLASSIC-ML-METRIC', engine: 'content', triggers: ['approve_attempt'], severity: 'medium' },
];
const V1_SHEET3_RULES = [...W4A_METADATA_RULES, ...W4B_CONTENT_RULES];

export const CONFIGURATION_SEED: Readonly<ConfigurationSeed> = Object.freeze({
  checklist_templates: { versions: ['v1.0 Sheet3', 'v2.0'] },
  sla: { dpo: 3, ai_coe: 5, it_security: 5 },
  calendar: {
    timezone: 'Asia/Bangkok',
    // Placeholder until W6: fixed-date Thai public holidays of 2026 (New Year, Songkran, New Year's Eve).
    holidays: ['2026-01-01', '2026-04-13', '2026-04-14', '2026-04-15', '2026-12-31'],
  },
  operator_recipients: { addresses: ['operator-digest@rai-desk.example'] },
  use_case_groups: { groups: ['customer-analytics', 'customer-service', 'field-operations'] },
  qc_rules: {
    label: 'w4a.1',
    templates: {
      'v1.0 Sheet3': { rules: V1_SHEET3_RULES },
      // Other versions never inherit the v1.0 Sheet-3 bands (source spec, L12).
      'v2.0': { rules: V1_SHEET3_RULES.filter((rule) => rule.ruleId !== 'ACC-BAND-V1-SHEET3') },
    },
  },
});

export const SEED_KINDS = Object.freeze(Object.keys(CONFIGURATION_SEED) as Array<keyof ConfigurationSeed>);

/**
 * Publishes every seed kind as revision 1 inside the caller's transaction. `publishedAt` defaults to now; the
 * fixture loader passes an instant slightly in the past so a submission made immediately afterwards is "after
 * its publish time" under the provisional activation rule.
 */
export async function applyConfigurationSeed(
  tx: Tx,
  options: { correlationId: string; publishedAt?: Date },
): Promise<Record<keyof ConfigurationSeed, ConfigurationRevisionRow>> {
  const out = {} as Record<keyof ConfigurationSeed, ConfigurationRevisionRow>;
  for (const kind of SEED_KINDS) {
    const base = {
      kind,
      body: CONFIGURATION_SEED[kind],
      publishedBy: SEED_ACTOR.subjectId,
      publishedRole: SEED_ACTOR.role,
      correlationId: options.correlationId,
    };
    out[kind] = await publishRevision(
      tx,
      options.publishedAt === undefined ? base : { ...base, publishedAt: options.publishedAt },
    );
  }
  return out;
}
