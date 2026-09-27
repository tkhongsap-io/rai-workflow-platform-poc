// W0-04 `risk_proposal` (W5 plan section 5, migration 0010_w5_03_risk): one proposed risk tier per proposal, append-only
// (trigger risk_proposal_append_only). W5-05 writes the `submit` row inside the submit transaction; `recheck` is W6's.
// At most one `submit` proposal per version. `explanation` holds ids and enums only (never attribution or free text).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { cases } from './case.js';
import { configurationRevision } from './configuration-revision.js';
import { packVersion } from './pack-version.js';

export const RISK_PROPOSAL_TRIGGERS = ['submit', 'recheck'] as const;
export const RISK_PROPOSAL_STATUSES = ['proposed', 'unavailable'] as const;
export const RISK_PROPOSAL_UNAVAILABLE_REASONS = [
  'not_configured',
  'rubric_invalid',
  'engine_error',
] as const;
export const RISK_PROPOSAL_TIERS = ['high', 'medium', 'low', 'unknown'] as const;
export const RISK_PROPOSAL_BOUND_TIERS = ['high', 'medium', 'low'] as const;

export const riskProposal = pgTable(
  'risk_proposal',
  {
    id: uuid('id').primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references((): AnyPgColumn => cases.id),
    versionId: uuid('version_id')
      .notNull()
      .references((): AnyPgColumn => packVersion.id),
    trigger: text('trigger').notNull(), // W5 writes 'submit'; 'recheck' is W6's
    status: text('status').notNull(),
    unavailableReason: text('unavailable_reason'),
    tier: text('tier'), // NULL only when unavailable
    lowestTier: text('lowest_tier'),
    highestTier: text('highest_tier'),
    rubricRevisionId: uuid('rubric_revision_id').references((): AnyPgColumn => configurationRevision.id), // NULL only when not_configured
    rubricLabel: text('rubric_label'),
    engineVersion: text('engine_version').notNull(),
    inputsHash: text('inputs_hash'),
    explanation: jsonb('explanation'), // RiskScore minus attribution text; ids and enums only
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('risk_proposal_one_submit_per_version_key')
      .on(t.versionId)
      .where(sql`${t.trigger} = 'submit'`),
    index('risk_proposal_case_id_idx').on(t.caseId),
    check('risk_proposal_trigger_check', sql`${t.trigger} IN ('submit', 'recheck')`),
    check('risk_proposal_status_check', sql`${t.status} IN ('proposed', 'unavailable')`),
    check(
      'risk_proposal_unavailable_reason_check',
      sql`${t.unavailableReason} IN ('not_configured', 'rubric_invalid', 'engine_error')`,
    ),
    check('risk_proposal_tier_check', sql`${t.tier} IN ('high', 'medium', 'low', 'unknown')`),
    check('risk_proposal_lowest_tier_check', sql`${t.lowestTier} IN ('high', 'medium', 'low')`),
    check('risk_proposal_highest_tier_check', sql`${t.highestTier} IN ('high', 'medium', 'low')`),
    check(
      'risk_proposal_status_consistency_check',
      sql`(${t.status} = 'proposed' AND ${t.tier} IS NOT NULL AND ${t.rubricRevisionId} IS NOT NULL AND ${t.unavailableReason} IS NULL) OR (${t.status} = 'unavailable' AND ${t.tier} IS NULL AND ${t.unavailableReason} IS NOT NULL)`,
    ),
  ],
);
