// W0-04 `audit_event`: append-only. The data-access layer (src/audit/store.ts) has no update or delete function;
// the migration adds a trigger that raises on UPDATE and DELETE and grants rai_app neither. Fields are references,
// never document bytes or free text (validated at append).
import { bigint, index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { cases } from './case.js';
import { packVersion } from './pack-version.js';

export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey(),
    seq: bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(), // total order for reconstruction (A11); never in URLs
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorSubjectId: text('actor_subject_id').notNull(), // 'system' for the breach digest and mail retry outcomes
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(), // W0-06 9.4 names plus the W0-04 and W0-03 additions (src/audit/store.ts AUDIT_ACTIONS)
    targetCaseId: uuid('target_case_id').references((): AnyPgColumn => cases.id), // no cascade delete: audit rows outlive nothing
    targetVersionId: uuid('target_version_id').references((): AnyPgColumn => packVersion.id),
    targetRef: jsonb('target_ref'), // {slot, artifact_id, finding_id, disposition_id, decision_id, configuration_revision_id, notification_id}; IDs only
    beforeRef: jsonb('before_ref'), // state references; never bytes, filenames, feedback or finding text
    afterRef: jsonb('after_ref'),
    correlationId: text('correlation_id').notNull(),
  },
  (t) => [
    index('audit_event_target_case_id_seq_idx').on(t.targetCaseId, t.seq),
    index('audit_event_correlation_id_idx').on(t.correlationId),
    index('audit_event_seq_idx').on(t.seq),
  ],
);
