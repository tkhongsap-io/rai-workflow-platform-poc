// W0-04 `artifact`: metadata for one accepted upload. Immutable once inserted (trigger artifact_frozen; the
// bytes_state column is the single D08 exception, gated by rai.retention_write). Created here because
// artifact_slot.artifact_id references it; the blob store, safety pipeline and routes are W1-03a/b.
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { cases } from './case.js';

export const artifact = pgTable(
  'artifact',
  {
    id: uuid('id').primaryKey(), // the reference used in URLs and slot rows; the hash is never a URL
    contentHash: text('content_hash').notNull(), // lowercase hex SHA-256 of the bytes; index, not unique
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    filename: text('filename').notNull(), // W0-08-normalised client filename (NFC, no path/control characters); Thai preserved
    mediaType: text('media_type').notNull(), // the sniffed type (W0-08), never the client's Content-Type
    uploadedBy: text('uploaded_by').notNull(),
    uploadedRole: text('uploaded_role').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    caseId: uuid('case_id')
      .notNull()
      .references((): AnyPgColumn => cases.id), // the case the upload was authorised against (case binding)
    correlationId: text('correlation_id').notNull(),
    bytesState: text('bytes_state').notNull().default('present'), // present | destroyed (D08 reserved; slice 1 never writes destroyed)
  },
  (t) => [
    index('artifact_content_hash_idx').on(t.contentHash),
    index('artifact_case_id_idx').on(t.caseId),
    check('artifact_content_hash_check', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('artifact_size_bytes_check', sql`${t.sizeBytes} > 0`),
    check('artifact_bytes_state_check', sql`${t.bytesState} IN ('present', 'destroyed')`),
  ],
);
