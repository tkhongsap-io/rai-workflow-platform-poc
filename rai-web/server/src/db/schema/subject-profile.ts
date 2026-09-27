// `subject_profile` (W7-06; W7 plan section 4.1, register row "W7 delegated rulings (provisional)" W7-D10 option A):
// one row per subject that has signed in outside `fixture` mode, upserted by the session store inside the sign-in
// transaction (identity/session.ts `create`). It lets the desk name a subject (cases/subject-directory.ts) and, from
// W7-07, address mail to the holders of a role after `db:cleanup` has removed the session rows. Operational data, not
// evidence and not audit: no trigger, not in the frozen digest, no audit event of its own (the `identity.signed_in`
// row in the same transaction is the audit). rai_app has SELECT, INSERT and UPDATE; nobody deletes at runtime
// (removal is D08's retention question; working assumption: kept while the deployment lives). In the backup.
// Email and name are those of synthetic principals only until D08.
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const subjectProfile = pgTable(
  'subject_profile',
  {
    subjectId: text('subject_id').primaryKey(), // '<issuerKey>:<subject>' (W0-03 section 2.2)
    identityMode: text('identity_mode').notNull(), // never 'fixture': fixture identities are known at start-up
    email: text('email').notNull(), // lower-cased, from the principal minted at sign-in
    displayName: text('display_name').notNull(),
    roles: jsonb('roles').notNull(), // the principal's RoleScope[] at the latest sign-in
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(), // the first sign-in; never updated
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'subject_profile_identity_mode_check',
      sql`${t.identityMode} IN ('local-google', 'network', 'production')`,
    ),
  ],
);
