// W4-06a: the content rules the content runner implements, by catalogue rule ID (W4b plan section 3.3). W4-06b-d add
// ACC-EXTRACTION-NOT-HALLUCINATION, ACC-CLASSIC-ML-METRIC, ACC-BAND-V1-SHEET3 and PACK-CONTRADICTION.
import { ACC_METRIC_CITED } from './acc-metric-cited.js';
import type { ContentRule } from './rule.js';

export const CONTENT_RULES: Readonly<Record<string, ContentRule>> = Object.freeze({
  'ACC-METRIC-CITED': ACC_METRIC_CITED,
});
