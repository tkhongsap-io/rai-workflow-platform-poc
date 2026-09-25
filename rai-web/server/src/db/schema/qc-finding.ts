// W0-04 `qc_finding`: append-only. owning_lane is NOT NULL and follows W0-06 section 7 as recorded on 2026-09-25 (#35).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { packVersion } from './pack-version.js';
import { qcRun } from './qc-run.js';

export const QC_FINDING_KINDS = ['defect', 'unavailable'] as const;
export const QC_FINDING_SEVERITIES = ['high', 'medium', 'low', 'info'] as const;

export const qcFinding = pgTable(
  'qc_finding',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references((): AnyPgColumn => qcRun.id),
    versionId: uuid('version_id')
      .notNull()
      .references((): AnyPgColumn => packVersion.id),
    slot: smallint('slot'),
    kind: text('kind').notNull(),
    ruleId: text('rule_id').notNull(),
    ruleRevision: text('rule_revision').notNull(),
    severity: text('severity').notNull(),
    owningLane: text('owning_lane').notNull(),
    evidence: jsonb('evidence').notNull(),
    metric: text('metric'),
    denominator: numeric('denominator'),
    threshold: numeric('threshold'),
    messageKey: text('message_key').notNull(),
    messageParams: jsonb('message_params').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('qc_finding_version_id_idx').on(t.versionId),
    index('qc_finding_run_id_idx').on(t.runId),
    index('qc_finding_owning_lane_idx').on(t.owningLane),
    check('qc_finding_kind_check', sql`${t.kind} IN ('defect', 'unavailable')`),
    check('qc_finding_severity_check', sql`${t.severity} IN ('high', 'medium', 'low', 'info')`),
    check('qc_finding_owning_lane_check', sql`${t.owningLane} IN ('ai_coe', 'dpo', 'it_security')`),
    check('qc_finding_slot_check', sql`${t.slot} IS NULL OR (${t.slot} >= 1 AND ${t.slot} <= 9)`),
  ],
);
