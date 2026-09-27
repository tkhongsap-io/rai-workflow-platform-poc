// The dev split's rendering of the synthetic claim grammar (W4b plan section 3.2, decision 10, WA-D09). The rule
// label lists are catalogue `params` written by W4-06a-d; this file lists every key, answer word, item keyword and
// metric the dev documents use, so those lists can be checked against it. The held-out split (W4-09b) uses
// renderings this file never shows: other key order, spacing, case, Thai keys and ratio values for the bands.

import type { ClaimItem, EvalLanguage } from './types.js';

/** Column keys in the dev order: one `key: value` pair each (DOCX, PDF), or one XLSX column each. */
export const DEV_KEY_ORDER = Object.freeze([
  'item',
  'question',
  'answer',
  'metric',
  'value',
  'denominator',
  'threshold',
  'evidence',
  'tier',
] as const);
export type ClaimKey = (typeof DEV_KEY_ORDER)[number];

/** DOCX and PDF: pairs joined by this separator; each pair is `key: value`. */
export const DEV_PAIR_SEPARATOR = '; ';

export const DEV_ANSWERS: Readonly<Record<EvalLanguage, Readonly<Record<'yes' | 'no' | 'na', string>>>> =
  Object.freeze({
    en: Object.freeze({ yes: 'Yes', no: 'No', na: 'N/A' }),
    th: Object.freeze({ yes: 'ใช่', no: 'ไม่ใช่', na: 'ไม่เกี่ยวข้อง' }),
  });

/** The question each item is asked with; the item keyword (ITEM_KEYWORDS) is a substring of it. */
export const DEV_QUESTIONS: Readonly<Record<EvalLanguage, Readonly<Record<ClaimItem, string>>>> =
  Object.freeze({
    en: Object.freeze({
      hallucination: 'Hallucination rate measured on the evaluation set?',
      accuracy: 'Answer accuracy measured on the evaluation set?',
      classic_ml_performance: 'Model performance measured with a matching metric?',
      personal_data: 'Does the use case process personal data?',
      external_vendor: 'Does an external vendor operate any part of the use case?',
    }),
    th: Object.freeze({
      hallucination: 'มีการวัดอัตราการหลอนบนชุดข้อมูลประเมินหรือไม่',
      accuracy: 'มีการวัดความแม่นยำของคำตอบบนชุดข้อมูลประเมินหรือไม่',
      classic_ml_performance: 'มีการวัดประสิทธิภาพของโมเดลด้วยตัวชี้วัดที่เหมาะสมหรือไม่',
      personal_data: 'ระบบมีการประมวลผลข้อมูลส่วนบุคคลหรือไม่',
      external_vendor: 'มีผู้ให้บริการภายนอกดำเนินการส่วนใดของระบบหรือไม่',
    }),
  });

/** Item keywords the dev questions contain, per language (the rules' `params.items` must match them). */
export const DEV_ITEM_KEYWORDS: Readonly<Record<EvalLanguage, Readonly<Record<ClaimItem, string>>>> =
  Object.freeze({
    en: Object.freeze({
      hallucination: 'hallucination rate',
      accuracy: 'accuracy',
      classic_ml_performance: 'model performance',
      personal_data: 'personal data',
      external_vendor: 'external vendor',
    }),
    th: Object.freeze({
      hallucination: 'อัตราการหลอน',
      accuracy: 'ความแม่นยำ',
      classic_ml_performance: 'ประสิทธิภาพของโมเดล',
      personal_data: 'ข้อมูลส่วนบุคคล',
      external_vendor: 'ผู้ให้บริการภายนอก',
    }),
  });

/**
 * Metric names the dev documents write. `hallucination_rate` and `accuracy` are the accepted metrics of
 * ACC-METRIC-CITED; `extraction_accuracy` is an extraction metric (ACC-EXTRACTION-NOT-HALLUCINATION); `f1` is a
 * matching classic-ML metric (ACC-CLASSIC-ML-METRIC).
 */
export const DEV_METRICS = Object.freeze({
  accepted: Object.freeze(['hallucination_rate', 'accuracy']),
  extraction: Object.freeze(['extraction_accuracy']),
  classicMatching: Object.freeze(['f1']),
});

/** Tier words (English in every dev document). */
export const DEV_TIERS = Object.freeze(['high', 'medium', 'low'] as const);

/** XLSX sheet names the dev documents use. */
export const DEV_SHEET_NAMES: Readonly<Record<EvalLanguage, readonly string[]>> = Object.freeze({
  en: Object.freeze(['Evidence', 'Claims']),
  th: Object.freeze(['หลักฐาน', 'ข้อกล่าวอ้าง']),
});
