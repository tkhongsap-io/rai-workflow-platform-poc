// W6-02 `configuration_draft` (W6 plan section 2.3, Q1): the one mutable Admin working copy per kind. A draft is not
// evidence: it is saved half-finished, replaced, discarded, and consumed by publish, which copies it into an immutable
// `configuration_revision`. `rai_app` holds DELETE here and on no other table; each delete is audited by the store
// (`discardDraft`, `publishDraft`).
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  CHANGE_NOTE_CHECK_MAX,
  CONFIGURATION_KINDS_SQL,
  configurationRevision,
} from './configuration-revision.js';

export const configurationDraft = pgTable(
  'configuration_draft',
  {
    kind: text('kind').primaryKey(), // one draft per kind
    baseRevisionId: uuid('base_revision_id').references(() => configurationRevision.id), // null before any publish
    body: jsonb('body').notNull(), // any JSON object up to 64 KiB (Q18); validated only on publish
    changeNote: text('change_note'),
    draftVersion: integer('draft_version').notNull(), // optimistic counter (Q5), 1 on create
    updatedBy: text('updated_by').notNull(),
    updatedRole: text('updated_role').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('configuration_draft_kind_check', sql`${t.kind} IN (${CONFIGURATION_KINDS_SQL})`),
    check(
      'configuration_draft_change_note_check',
      sql`${t.changeNote} IS NULL OR char_length(${t.changeNote}) BETWEEN 1 AND ${sql.raw(String(CHANGE_NOTE_CHECK_MAX))}`,
    ),
    check('configuration_draft_draft_version_check', sql`${t.draftVersion} >= 1`),
  ],
);
