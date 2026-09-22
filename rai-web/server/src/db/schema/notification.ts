// W0-04 `notification`: outbox row written in the same transaction as the committed event (W2-01 lane_open on
// submit; later send_back / ready / digest). The mail sink (W3-04) updates only the four delivery columns; the
// migration trigger raises on any other UPDATE or any DELETE. Dedup identity is UNIQUE (event, version_id, lane,
// recipient) (D06).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { cases } from './case.js';
import { packVersion } from './pack-version.js';

export const NOTIFICATION_EVENTS = ['lane_open', 'send_back', 'ready', 'sla_breach_digest'] as const;
export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed'] as const;

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey(),
    event: text('event').notNull(), // lane_open | send_back | ready | sla_breach_digest (W0-04 stored values)
    versionId: uuid('version_id').references((): AnyPgColumn => packVersion.id), // NULL for sla_breach_digest
    caseId: uuid('case_id').references((): AnyPgColumn => cases.id), // NULL for sla_breach_digest
    lane: text('lane').notNull(), // opened/deciding lane name, or '-' for ready / sla_breach_digest
    recipient: text('recipient').notNull(), // email address (fixture addresses in slice 1)
    deepLinkPath: text('deep_link_path').notNull(), // path only; never a token
    templateKey: text('template_key').notNull(), // D12 locale key, e.g. mail.lane_opened
    templateParams: jsonb('template_params').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    correlationId: text('correlation_id').notNull(),
  },
  (t) => [
    uniqueIndex('notification_event_version_lane_recipient_key').on(
      t.event,
      t.versionId,
      t.lane,
      t.recipient,
    ),
    index('notification_status_next_attempt_at_idx').on(t.status, t.nextAttemptAt),
    index('notification_correlation_id_idx').on(t.correlationId),
    check(
      'notification_event_check',
      sql`${t.event} IN ('lane_open', 'send_back', 'ready', 'sla_breach_digest')`,
    ),
    check('notification_status_check', sql`${t.status} IN ('queued', 'sent', 'failed')`),
    check('notification_attempts_check', sql`${t.attempts} >= 0`),
  ],
);
