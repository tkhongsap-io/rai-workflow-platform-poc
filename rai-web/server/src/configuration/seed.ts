// The minimal slice-1 configuration seed (W1-00). Published revisions; W6 adds Admin editing. Values:
//   checklist_templates  the checklist_template_version list W0-08 section 8.3 names ('v1.0 Sheet3', 'v2.0')
//   sla                  working days per lane (D01: DPO 3, others 5)
//   calendar             Asia/Bangkok (D06) with a placeholder holiday list until Admin publishes the Thai
//                        public-holiday list (W6); the dates are widely published fixed-date holidays, not a claim
//   operator_recipients  the single synthetic address of W0-08 section 8.2 (D06); never a real operator address
//   use_case_groups      the D11 value list the W0-08 fixture cases use
// The lane mapping is not configuration (D02; shared/src/constants.ts) and is never seeded here.

import type { ConfigurationBodies, SeedableConfigurationKind } from '@rai/shared/schemas/cases';
import type { Tx } from '../db/client.js';
import { publishRevision, type ConfigurationRevisionRow } from './store.js';

export const SEED_ACTOR = { subjectId: 'system', role: 'system' } as const;

export type ConfigurationSeed = {
  [K in Exclude<SeedableConfigurationKind, 'qc_rules'>]: ConfigurationBodies[K];
};

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
