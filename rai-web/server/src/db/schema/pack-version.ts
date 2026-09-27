// W0-04 `pack_version`: a draft becomes a submitted version in place; frozen once submitted_at is set
// (trigger pack_version_frozen in the migration; W0-06 section 9.2 exception for ready_at).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
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

export const STAGE_CONTEXTS = ['idea', 'pre_build', 'pre_launch'] as const;

export const packVersion = pgTable(
  'pack_version',
  {
    id: uuid('id').primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references((): AnyPgColumn => cases.id),
    versionNumber: integer('version_number').notNull(), // 1, 2, 3…; UNIQUE (case_id, version_number)
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => packVersion.id), // the submitted version this draft corrects; NULL for v1
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    stageContext: text('stage_context').notNull(), // D11: idea, pre_build, pre_launch; frozen at submit
    checklistTemplateVersion: text('checklist_template_version').notNull(), // L12; frozen at submit
    configurationRevisionId: uuid('configuration_revision_id').references(
      (): AnyPgColumn => configurationRevision.id,
    ), // NOT NULL at submit
    frozenConfiguration: jsonb('frozen_configuration'), // {kind: revision_id} for every kind in force at submit
    laneMappingVersion: text('lane_mapping_version'), // D02 constant version, e.g. lane-mapping/v1; NOT NULL at submit
    laneMapping: jsonb('lane_mapping'), // the constant's content, so a restored backup is self-describing
    submittedBy: text('submitted_by'),
    submittedRole: text('submitted_role'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }), // non-NULL means frozen (W0-06 state = submitted)
    readyAt: timestamp('ready_at', { withTimezone: true }), // set once by the Ready transition (W0-06 4.9)
    manifestHash: text('manifest_hash'), // SHA-256 over the canonical JSON of the nine slot rows; NOT NULL at submit
    submitCorrelationId: text('submit_correlation_id'),
    // W5-03: questionnaire answers with attribution (W5 plan section 6 shape, validated on write by W5-04); editable on
    // the draft, frozen at submit by the whole-row comparison in pack_version_frozen.
    riskAnswers: jsonb('risk_answers')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex('pack_version_case_id_version_number_key').on(t.caseId, t.versionNumber),
    uniqueIndex('pack_version_one_open_draft_key')
      .on(t.caseId)
      .where(sql`${t.submittedAt} IS NULL`), // one draft per case (W0-06 9.3)
    index('pack_version_case_id_idx').on(t.caseId),
    check('pack_version_stage_context_check', sql`${t.stageContext} IN ('idea', 'pre_build', 'pre_launch')`),
    check(
      'pack_version_submitted_consistency_check',
      sql`(${t.submittedAt} IS NULL) OR (${t.submittedBy} IS NOT NULL AND ${t.submittedRole} IS NOT NULL AND ${t.configurationRevisionId} IS NOT NULL AND ${t.frozenConfiguration} IS NOT NULL AND ${t.laneMappingVersion} IS NOT NULL AND ${t.laneMapping} IS NOT NULL AND ${t.manifestHash} IS NOT NULL)`,
    ),
  ],
);
