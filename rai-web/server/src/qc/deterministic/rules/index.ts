// W4-03: the metadata rules the deterministic runner implements, by catalogue rule ID (W4a plan section 4).
import { PACK_NA_VENDOR_DOC } from './pack-na-vendor-doc.js';
import { PACK_SLOT_MISSING } from './pack-slot-missing.js';
import { PACK_STAGE_MISMATCH } from './pack-stage-mismatch.js';
import type { MetadataRule } from './rule.js';

export const METADATA_RULES: Readonly<Record<string, MetadataRule>> = Object.freeze({
  'PACK-SLOT-MISSING': PACK_SLOT_MISSING,
  'PACK-STAGE-MISMATCH': PACK_STAGE_MISMATCH,
  'PACK-NA-VENDOR-DOC': PACK_NA_VENDOR_DOC,
});
