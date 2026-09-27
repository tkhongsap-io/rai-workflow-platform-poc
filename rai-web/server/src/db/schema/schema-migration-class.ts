// `schema_migration_class` (W7-03; W7 plan section 3.3, W0-04 "Schema evolution"): the rollback class of every
// migration applied to this database, written only by `npm run migrate` (db/migrate.ts `recordMigrationClasses`)
// from the build's MIGRATION_CLASSES. Readiness and `release:check-rollback` read it by hash, so an older build can
// learn the class of a newer migration it has never seen. rai_app and rai_operator may only SELECT; the guard
// trigger (hand-written in the migration) refuses UPDATE and DELETE. Not a business table.
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const schemaMigrationClass = pgTable(
  'schema_migration_class',
  {
    hash: text('hash').primaryKey(), // drizzle.__drizzle_migrations.hash (SHA-256 of the migration file)
    tag: text('tag').notNull().unique(), // the journal tag, e.g. 0011_w7_03_migration_class
    rollbackClass: text('rollback_class').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'schema_migration_class_rollback_class_check',
      sql`${t.rollbackClass} IN ('additive', 'restore-required', 'copy-forward')`,
    ),
  ],
);
