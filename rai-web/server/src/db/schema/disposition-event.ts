// W0-04 `disposition_event`: append-only. Effective disposition = latest event per finding (W0-06 4.7 / 4.8).
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { qcFinding } from './qc-finding.js';

export const DISPOSITION_KINDS = [
  'fixed_proposed',
  'fixed',
  'fixed_confirmed',
  'waived',
  'not_applicable',
] as const;

export const dispositionEvent = pgTable(
  'disposition_event',
  {
    id: uuid('id').primaryKey(),
    findingId: uuid('finding_id')
      .notNull()
      .references((): AnyPgColumn => qcFinding.id),
    kind: text('kind').notNull(),
    reason: text('reason'),
    evidenceRef: jsonb('evidence_ref'),
    actorSubjectId: text('actor_subject_id').notNull(),
    actorRole: text('actor_role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    correlationId: text('correlation_id').notNull(),
    idempotencyKeyId: uuid('idempotency_key_id'),
  },
  (t) => [
    index('disposition_event_finding_id_created_at_idx').on(t.findingId, t.createdAt),
    index('disposition_event_correlation_id_idx').on(t.correlationId),
    check(
      'disposition_event_kind_check',
      sql`${t.kind} IN ('fixed_proposed', 'fixed', 'fixed_confirmed', 'waived', 'not_applicable')`,
    ),
    check(
      'disposition_event_reason_check',
      sql`${t.kind} NOT IN ('waived', 'not_applicable') OR ${t.reason} IS NOT NULL`,
    ),
  ],
);
