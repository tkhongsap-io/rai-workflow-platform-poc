// W0-04 `artifact_slot`: nine rows per version, mutable while the parent version is a draft, frozen with it
// (trigger artifact_slot_frozen joins the parent).
import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { artifact } from './artifact.js';
import { packVersion } from './pack-version.js';

export const SLOT_STATES = ['attached', 'not_yet', 'not_applicable', 'missing'] as const;

export const artifactSlot = pgTable(
  'artifact_slot',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references((): AnyPgColumn => packVersion.id),
    slot: smallint('slot').notNull(), // 1-9
    state: text('state').notNull(), // attached, not_yet, not_applicable, missing (four distinct facts)
    reason: text('reason'), // required when not_applicable; the slot 3/4 non-vendor default writes a locale key here (D12)
    artifactId: uuid('artifact_id').references((): AnyPgColumn => artifact.id), // required when attached; must belong to the version's case (DAL check, W1-04)
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('artifact_slot_version_id_slot_key').on(t.versionId, t.slot),
    check('artifact_slot_slot_check', sql`${t.slot} BETWEEN 1 AND 9`),
    check(
      'artifact_slot_state_check',
      sql`${t.state} IN ('attached', 'not_yet', 'not_applicable', 'missing')`,
    ),
    check('artifact_slot_reason_check', sql`${t.state} <> 'not_applicable' OR ${t.reason} IS NOT NULL`),
    check(
      'artifact_slot_artifact_check',
      sql`(${t.state} = 'attached' AND ${t.artifactId} IS NOT NULL) OR (${t.state} <> 'attached' AND ${t.artifactId} IS NULL)`,
    ),
  ],
);
