// W0-04 `configuration_revision`: L12 configuration, versioned and immutable once published (trigger
// configuration_revision_frozen). Slice 1 seeds published revisions (W1-00). W6-02 adds the change note, the restore
// link and the `desk_controls` kind; drafts live in their own mutable table (configuration-draft.ts), never here.
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
  'desk_controls', // W6-02 (0012_w6_02_configuration_admin)
] as const;
/** The kind CHECK's SQL list, shared by `configuration_revision` and `configuration_draft`. */
export const CONFIGURATION_KINDS_SQL = sql.raw(CONFIGURATION_KINDS.map((k) => `'${k}'`).join(', '));
/** W6 plan section 2.3: a person's change note, 1-500 characters; NULL on seed rows. */
export const CHANGE_NOTE_CHECK_MAX = 500;
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
    changeNote: text('change_note'), // W6-02: required on every publish and restore by a person; NULL on seed rows
    restoresId: uuid('restores_id').references((): AnyPgColumn => configurationRevision.id), // W6-02: the revision K a restore copied (Q3)
  },
  (t) => [
    uniqueIndex('configuration_revision_kind_revision_number_key').on(t.kind, t.revisionNumber),
    index('configuration_revision_kind_published_at_idx').on(t.kind, t.publishedAt),
    check('configuration_revision_kind_check', sql`${t.kind} IN (${CONFIGURATION_KINDS_SQL})`),
    check(
      'configuration_revision_change_note_check',
      sql`${t.changeNote} IS NULL OR char_length(${t.changeNote}) BETWEEN 1 AND ${sql.raw(String(CHANGE_NOTE_CHECK_MAX))}`,
    ),
    check('configuration_revision_activation_rule_check', sql`${t.activationRule} IN ('after_publish')`),
    check('configuration_revision_revision_number_check', sql`${t.revisionNumber} >= 1`),
  ],
);
