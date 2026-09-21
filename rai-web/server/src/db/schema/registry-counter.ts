// W0-04 `case.registry_id`: "RAI-YYYY-NNNN, allocated from a per-year sequence inside the create transaction". One
// row per year holds the last number handed out; the create transaction (W1-02) upserts it and takes `last + 1`
// under the row lock the UPDATE acquires, so two concurrent creates in one year never share a number. Not an
// external id (L3); fixtures use the reserved year 2000 (W0-02 section 8.3) and never touch this table.
import { sql } from 'drizzle-orm';
import { check, integer, pgTable } from 'drizzle-orm/pg-core';

export const registryCounter = pgTable(
  'registry_counter',
  {
    year: integer('year').primaryKey(),
    last: integer('last').notNull(),
  },
  (t) => [
    check('registry_counter_year_check', sql`${t.year} BETWEEN 2001 AND 9999`), // 2000 is the fixture year
    check('registry_counter_last_check', sql`${t.last} BETWEEN 0 AND 9999`), // four digits (W0-04)
  ],
);
