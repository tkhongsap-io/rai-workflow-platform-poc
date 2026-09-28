// W4-06a: the content rules the content runner implements, by catalogue rule ID (W4b plan section 3.3). W4-06b adds
// ACC-EXTRACTION-NOT-HALLUCINATION and ACC-CLASSIC-ML-METRIC; W4-06c ACC-BAND-V1-SHEET3; W4-06d PACK-CONTRADICTION.
import { ACC_BAND_V1_SHEET3 } from './acc-band-v1-sheet3.js';
import { ACC_CLASSIC_ML_METRIC } from './acc-classic-ml-metric.js';
import { ACC_EXTRACTION_NOT_HALLUCINATION } from './acc-extraction-not-hallucination.js';
import { ACC_METRIC_CITED } from './acc-metric-cited.js';
import type { ContentRule } from './rule.js';

export const CONTENT_RULES: Readonly<Record<string, ContentRule>> = Object.freeze({
  'ACC-METRIC-CITED': ACC_METRIC_CITED,
  'ACC-EXTRACTION-NOT-HALLUCINATION': ACC_EXTRACTION_NOT_HALLUCINATION,
  'ACC-BAND-V1-SHEET3': ACC_BAND_V1_SHEET3,
  'ACC-CLASSIC-ML-METRIC': ACC_CLASSIC_ML_METRIC,
});
