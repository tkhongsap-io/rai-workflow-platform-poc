// W0-03 section 6.3 `session`: one row per server-side session, looked up by the SHA-256 of the opaque cookie value
// (the value itself is never stored; no signing key exists). Operational data, not audit: expired and revoked rows
// are inert (they never authenticate) and are removed by the operator sweep (`db:cleanup`, rai_operator) and by
// `reset`. rai_app has SELECT, INSERT and UPDATE (last_seen_at, revoked_at, locale); DELETE is rai_operator's, as
// for idempotency_key (W0-04 "Database roles": rai_app deletes nothing).
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    tokenHash: text('token_hash').notNull(), // sha256 (hex) of the 256-bit random cookie value
    subjectId: text('subject_id').notNull(), // '<issuerKey>:<subject>' (W0-03 section 2.2); never the email
    principal: jsonb('principal').notNull(), // the Principal snapshot returned at sign-in; roles change at the next sign-in
    identityMode: text('identity_mode').notNull(), // 'fixture' | 'local-google' | 'network' | 'production'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(), // updated at most once per minute
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // created_at + RAI_SESSION_ABSOLUTE_HOURS
    revokedAt: timestamp('revoked_at', { withTimezone: true }), // sign-out
    locale: text('locale').notNull().default('th'), // 'th' | 'en' (D12); POST /api/session/locale
  },
  (t) => [
    uniqueIndex('session_token_hash_key').on(t.tokenHash),
    index('session_subject_id_idx').on(t.subjectId),
    index('session_expires_at_idx').on(t.expiresAt),
    check(
      'session_identity_mode_check',
      sql`${t.identityMode} IN ('fixture', 'local-google', 'network', 'production')`,
    ),
    check('session_locale_check', sql`${t.locale} IN ('th', 'en')`),
    check('session_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
