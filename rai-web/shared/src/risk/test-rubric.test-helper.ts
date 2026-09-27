// W5-01 test support: an agent-team synthetic rubric for the engine and schema unit tests. It is NOT the W5-02
// placeholder seed and NOT the D07 instrument (AI/COE): its questions, options and thresholds are invented for the
// tests. Thresholds follow the shape the W5 plan section 3 gives the placeholder (High at >= 3 high answers; Medium
// at >= 1 high or >= 2 medium; otherwise Low; personal data escalates only to Medium), deliberately unlike the
// operating-model section 7 summary.

import type { RiskRubricBody } from '../schemas/cases.js';

const bi = (en: string) => ({ th: `[ทดสอบ] ${en}`, en: `[TEST] ${en}` });

function levelled(questionId: string, topic: string) {
  return {
    questionId,
    text: bi(`${topic}?`),
    evidenceSlot: 1 as const,
    options: [
      { value: 'low', label: bi('Low'), level: 'low' as const },
      { value: 'medium', label: bi('Medium'), level: 'medium' as const },
      { value: 'high', label: bi('High'), level: 'high' as const },
    ],
  };
}

/** A fresh copy on every call, so a test may edit it freely. */
export function testRubric(): RiskRubricBody {
  return {
    label: 'synthetic-test.1',
    provenance: 'synthetic_placeholder',
    questions: [
      levelled('RQ1', 'People affected'),
      levelled('RQ2', 'Automation of decisions'),
      {
        questionId: 'RQ3',
        text: bi('Personal data?'),
        help: bi('Synthetic help text'),
        evidenceSlot: 1,
        options: [
          { value: 'no', label: bi('No'), level: 'low' },
          { value: 'limited', label: bi('Limited'), level: 'medium' },
          { value: 'yes', label: bi('Yes'), level: 'low', escalatesTo: 'medium' },
        ],
      },
      levelled('RQ4', 'External exposure'),
      levelled('RQ5', 'Vendor or model provenance'),
      levelled('RQ6', 'Reversibility'),
      levelled('RQ7', 'Monitoring'),
    ],
    tierRules: [
      { tier: 'high', anyOf: [{ allOf: [{ level: 'high', atLeast: 3 }] }] },
      {
        tier: 'medium',
        anyOf: [{ allOf: [{ level: 'high', atLeast: 1 }] }, { allOf: [{ level: 'medium', atLeast: 2 }] }],
      },
    ],
    defaultTier: 'low',
    tierLabels: {
      high: { th: 'สูง', en: 'High' },
      medium: { th: 'ปานกลาง', en: 'Medium' },
      low: { th: 'ต่ำ', en: 'Low' },
      unknown: { th: 'ไม่ทราบ', en: 'Unknown' },
    },
  };
}

export const QUESTION_IDS = ['RQ1', 'RQ2', 'RQ3', 'RQ4', 'RQ5', 'RQ6', 'RQ7'] as const;

/** Slot 1 attached: every answer in the test rubric may count. */
export const EVIDENCE_ATTACHED = Object.freeze({ 1: 'attached' as const });
