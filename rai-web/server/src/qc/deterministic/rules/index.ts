// W4-03: the metadata rules the deterministic runner implements, by catalogue rule ID (W4a plan section 4); W5-10 adds
// RISK-TIER-UNKNOWN (W5 plan R-11).
import { PACK_NA_VENDOR_DOC } from './pack-na-vendor-doc.js';
import { PACK_SLOT_MISSING } from './pack-slot-missing.js';
import { PACK_STAGE_MISMATCH } from './pack-stage-mismatch.js';
import { RISK_TIER_UNKNOWN } from './risk-tier-unknown.js';
import type { MetadataRule } from './rule.js';

export const METADATA_RULES: Readonly<Record<string, MetadataRule>> = Object.freeze({
  'PACK-SLOT-MISSING': PACK_SLOT_MISSING,
  'PACK-STAGE-MISMATCH': PACK_STAGE_MISMATCH,
  'PACK-NA-VENDOR-DOC': PACK_NA_VENDOR_DOC,
  'RISK-TIER-UNKNOWN': RISK_TIER_UNKNOWN,
});
