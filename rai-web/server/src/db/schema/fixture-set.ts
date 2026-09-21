// `fixture_set` (W0-02 section 8.3; W0-08 8.7; added by W1-09): the identity of the synthetic fixture set that
// `npm run fixtures:load` wrote into this database, so an evidence record's `fixture set <name>@<version>
// <sha256[0:12]>` can be checked against the database it ran on. Written only by the loader in development and
// test; no route reads or writes it; rai_app may only SELECT and INSERT. Empty in every other database.
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const fixtureSet = pgTable(
  'fixture_set',
  {
    name: text('name').notNull(), // manifest.json name, e.g. slice1-synthetic
    version: text('version').notNull(), // manifest.json version
    sha256: text('sha256').notNull(), // manifest.json sha256: the set hash over the sorted data files and document digests
    loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
    correlationId: text('correlation_id').notNull(), // the loader run; the same value is on its seed audit events
  },
  (t) => [
    primaryKey({ columns: [t.name, t.version] }),
    check('fixture_set_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
