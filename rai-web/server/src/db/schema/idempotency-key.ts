// W0-04 `idempotency_key`: (actor, key) → the exact success response, replayed verbatim (A07). Rows expire after
// IDEMPOTENCY_TTL_HOURS through the operator cleanup command (rai_operator has DELETE; rai_app has none).
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { cases } from './case.js';

export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    actorSubjectId: text('actor_subject_id').notNull(),
    key: text('key').notNull(), // client-generated UUID from the Idempotency-Key header (W0-06 5.3)
    action: text('action').notNull(), // the route or service name
    targetCaseId: uuid('target_case_id')
      .notNull()
      .references((): AnyPgColumn => cases.id),
    requestDigest: text('request_digest').notNull(), // SHA-256 of the canonical request body plus the expected version
    responseStatus: smallint('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.actorSubjectId, t.key] }),
    index('idempotency_key_created_at_idx').on(t.createdAt),
  ],
);
