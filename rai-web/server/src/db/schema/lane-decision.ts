// W0-04 `lane_decision`: append-only; one row per (version, lane). Written by W2-02 decide; never updated.
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
import type { RoleScope } from '@rai/shared/schemas/auth';
import { packVersion } from './pack-version.js';
import { qcRun } from './qc-run.js';

export const LANE_DECISION_KINDS = ['approve', 'send_back'] as const;
export const LANE_DECISION_LANES = ['ai_coe', 'dpo', 'it_security'] as const;

export const laneDecision = pgTable(
  'lane_decision',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references((): AnyPgColumn => packVersion.id),
    lane: text('lane').notNull(),
    decision: text('decision').notNull(),
    actorSubjectId: text('actor_subject_id').notNull(),
    actorRole: text('actor_role').notNull(),
    /** The actor's RoleScope grants when deciding; Ready judges self-approval on these, not on later grants. */
    actorScopes: jsonb('actor_scopes').$type<RoleScope[]>(),
    /** Send-back feedback JSON; NULL on approve. Shape: { items: [...], summary? }. */
    feedback: jsonb('feedback'),
    /** Approve: the latest lane-QC run the reviewer saw (W0-06 4.4), checked by approveLane. NULL on send_back. */
    observedQcRunId: uuid('observed_qc_run_id').references((): AnyPgColumn => qcRun.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    correlationId: text('correlation_id').notNull(),
    idempotencyKeyId: uuid('idempotency_key_id'),
  },
  (t) => [
    uniqueIndex('lane_decision_version_id_lane_key').on(t.versionId, t.lane),
    index('lane_decision_correlation_id_idx').on(t.correlationId),
    check('lane_decision_lane_check', sql`${t.lane} IN ('ai_coe', 'dpo', 'it_security')`),
    check('lane_decision_decision_check', sql`${t.decision} IN ('approve', 'send_back')`),
    check('lane_decision_feedback_check', sql`${t.decision} <> 'send_back' OR ${t.feedback} IS NOT NULL`),
    check('lane_decision_qc_run_check', sql`${t.decision} <> 'approve' OR ${t.observedQcRunId} IS NOT NULL`),
  ],
);
