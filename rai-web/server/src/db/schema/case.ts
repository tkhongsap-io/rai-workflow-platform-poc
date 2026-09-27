// W0-04 `case`: one review case. Mutable columns are the inherited descriptive fields, the desk-local fields
// (W0-04 fields) and the workflow-written projections, which a BEFORE UPDATE trigger (migration) gates.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { packVersion } from './pack-version.js';

export const CASE_MODEL_TYPES = ['llm', 'classic_ml', 'other'] as const;
export const CASE_DESK_STATUSES = ['draft', 'in_review', 'ready'] as const;
export const CASE_LANE_PROJECTIONS = ['pending', 'approved', 'sent_back'] as const;
export const CASE_READINESS = ['not_ready', 'ready'] as const;
// Written only by W5 (the submit transaction, W5-05); 'unknown' added by migration 0010_w5_03_risk (W5-03).
export const CASE_RISK_TIERS = ['high', 'medium', 'low', 'unknown'] as const;

export const cases = pgTable(
  'case',
  {
    id: uuid('id').primaryKey(),
    registryId: text('registry_id').notNull(), // desk-local human ID, RAI-YYYY-NNNN (L3: not an external ID)
    sourceRecordId: text('source_record_id').notNull(), // TPM-…, VRO-… or the literal Unknown (L10); never validated externally
    useCaseName: text('use_case_name').notNull(),
    businessUnit: text('business_unit').notNull(), // descriptive text; never read for access
    businessOwner: text('business_owner').notNull(), // display name of owner_subject_id; never read for access
    technicalOwner: text('technical_owner').notNull(),
    useCaseGroup: text('use_case_group').notNull(), // D11; checked against the current use_case_groups revision in the application
    riskTier: text('risk_tier'), // W5; workflow-gated like the projections
    privacyStatus: text('privacy_status').notNull().default('pending'), // projection: DPO lane decision
    securityStatus: text('security_status').notNull().default('pending'), // projection: IT/Security lane decision
    raiStatus: text('rai_status').notNull().default('pending'), // projection: AI/COE lane decision
    aiReadinessStatus: text('ai_readiness_status').notNull().default('not_ready'), // projection: Ready transition
    vendorInvolved: boolean('vendor_involved').notNull(), // desk-local (W0-04 fields)
    modelType: text('model_type').notNull(), // desk-local (W0-04 fields)
    ownerSubjectId: text('owner_subject_id').notNull(), // scope for the Owner role (W0-05)
    businessUnitId: text('business_unit_id').notNull(), // scope for the BU SPOC role (W0-05)
    deskStatus: text('desk_status').notNull().default('draft'), // coarse stored mirror for the queue index; never returned as CaseStatus
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => packVersion.id), // latest submitted version; NULL until first submit
    draftVersionId: uuid('draft_version_id').references((): AnyPgColumn => packVersion.id), // the single open draft, or NULL
    rowVersion: integer('row_version').notNull().default(1), // optimistic-concurrency counter (caseRevision / draftRevision / ExpectedVersion.revision)
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('case_registry_id_key').on(t.registryId),
    index('case_owner_subject_id_idx').on(t.ownerSubjectId),
    index('case_business_unit_id_idx').on(t.businessUnitId),
    index('case_desk_status_idx').on(t.deskStatus),
    check('case_model_type_check', sql`${t.modelType} IN ('llm', 'classic_ml', 'other')`),
    check('case_desk_status_check', sql`${t.deskStatus} IN ('draft', 'in_review', 'ready')`),
    check(
      'case_risk_tier_check',
      sql`${t.riskTier} IS NULL OR ${t.riskTier} IN ('high', 'medium', 'low', 'unknown')`,
    ),
    check('case_privacy_status_check', sql`${t.privacyStatus} IN ('pending', 'approved', 'sent_back')`),
    check('case_security_status_check', sql`${t.securityStatus} IN ('pending', 'approved', 'sent_back')`),
    check('case_rai_status_check', sql`${t.raiStatus} IN ('pending', 'approved', 'sent_back')`),
    check('case_ai_readiness_status_check', sql`${t.aiReadinessStatus} IN ('not_ready', 'ready')`),
    check('case_row_version_check', sql`${t.rowVersion} >= 1`),
  ],
);
