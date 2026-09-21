// W0-04 `configuration_revision`: L12 configuration, versioned and immutable once published (trigger
// configuration_revision_frozen). Slice 1 seeds published revisions (W1-00); W6 adds drafting and publishing.
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

export const CONFIGURATION_KINDS = [
  'checklist_templates',
  'qc_rules',
  'sla',
  'calendar',
  'operator_recipients',
  'use_case_groups',
  'risk_rubric', // W5
  'group_role_mapping', // W6/W8
] as const;
export type ConfigurationKind = (typeof CONFIGURATION_KINDS)[number];

export const ACTIVATION_RULES = ['after_publish'] as const; // W1-00 provisional rule; W6 may add values by migration
export type ActivationRule = (typeof ACTIVATION_RULES)[number];

export const configurationRevision = pgTable(
  'configuration_revision',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(), // one kind per revision keeps activation independent
    revisionNumber: integer('revision_number').notNull(),
    body: jsonb('body').notNull(), // schema per kind in @rai/shared (schemas/cases.ts), validated on write
    publishedBy: text('published_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(), // NOT NULL until W6 adds drafts by a migration
    activationRule: text('activation_rule').notNull(), // 'after_publish': applies to submissions after published_at
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => configurationRevision.id), // previous revision of the same kind
  },
  (t) => [
    uniqueIndex('configuration_revision_kind_revision_number_key').on(t.kind, t.revisionNumber),
    index('configuration_revision_kind_published_at_idx').on(t.kind, t.publishedAt),
    check(
      'configuration_revision_kind_check',
      sql`${t.kind} IN ('checklist_templates', 'qc_rules', 'sla', 'calendar', 'operator_recipients', 'use_case_groups', 'risk_rubric', 'group_role_mapping')`,
    ),
    check('configuration_revision_activation_rule_check', sql`${t.activationRule} IN ('after_publish')`),
    check('configuration_revision_revision_number_check', sql`${t.revisionNumber} >= 1`),
  ],
);
