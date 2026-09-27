// W5-04 (W5 plan sections 2, 4 and 6): the pure half of the draft risk answers, used by the save-draft transaction
// (service.ts). Validation against the `risk_rubric` revision in force (step 4), the merge into the stored answers with
// attribution (step 7), and the `draft.saved` refs. Answers are option values only (R-13): no free text, and no name
// or attribution ever enters an audit ref. The rubric is D07's (AI/COE); W5 validates against a labelled synthetic
// placeholder. Scoring is W5-05's (shared/src/risk), not this file's.

import type { FieldError } from '@rai/shared/errors';
import { EXPLICIT_UNKNOWN } from '@rai/shared/risk/types';
import type { RiskRubricBody } from '@rai/shared/schemas/cases';
import {
  RISK_ANSWER_VALUE_PATTERN,
  RISK_QUESTION_ID_PATTERN,
  type PackDraftUpdateRequest,
  type RiskAnswer,
} from '@rai/shared/schemas/pack';
import { ROLES, type Role } from '@rai/shared/schemas/auth';
import type { AuditRefValue } from '../audit/store.js';

export const RISK_NOT_CONFIGURED = 'error.risk.not_configured' as const;
const NOT_IN_LIST = 'validation.not_in_configured_list' as const; // service.ts NOT_IN_LIST (not imported: a cycle)

export type RiskAnswersRequest = NonNullable<PackDraftUpdateRequest['riskAnswers']>;
/** The `pack_version.risk_answers` column: attribution without a name (names are resolved on read). */
export type StoredRiskAnswer = Omit<RiskAnswer, 'answeredByName'>;
export type StoredRiskAnswers = Record<string, StoredRiskAnswer>;
export interface RiskAttribution {
  answeredBy: string;
  answeredRole: Role;
  answeredAt: string;
}

const QUESTION_ID = new RegExp(RISK_QUESTION_ID_PATTERN);
const ANSWER_VALUE = new RegExp(RISK_ANSWER_VALUE_PATTERN);
const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

/**
 * Step 4 for `riskAnswers`: every non-null answer needs a rubric in force (else one `error.risk.not_configured` at
 * `body.riskAnswers`), a question of that rubric and one of its options or `unknown` (else
 * `validation.not_in_configured_list` at `body.riskAnswers.<questionId>`). `null` always passes, so an answer left from an
 * earlier rubric can always be cleared. Errors are in question-ID order.
 */
export function riskAnswerProblems(
  request: RiskAnswersRequest,
  rubric: RiskRubricBody | undefined,
): FieldError[] {
  const answered = Object.keys(request)
    .filter((id) => request[id] !== null)
    .sort();
  if (answered.length === 0) return [];
  if (rubric === undefined) return [{ path: 'body.riskAnswers', messageKey: RISK_NOT_CONFIGURED }];
  const errors: FieldError[] = [];
  for (const questionId of answered) {
    const value = request[questionId];
    const question = rubric.questions.find((q) => q.questionId === questionId);
    const allowed =
      question !== undefined &&
      (value === EXPLICIT_UNKNOWN || question.options.some((option) => option.value === value));
    if (!allowed) errors.push({ path: `body.riskAnswers.${questionId}`, messageKey: NOT_IN_LIST });
  }
  return errors;
}

/**
 * Step 7: the request merged into the stored answers. A new or changed value takes `attribution`; an unchanged value
 * keeps its original answerer, role and instant; `null` removes the answer. `changed` is false when nothing differs.
 * The stored object is not mutated.
 */
export function mergeRiskAnswers(
  stored: StoredRiskAnswers,
  request: RiskAnswersRequest,
  attribution: RiskAttribution,
): { merged: StoredRiskAnswers; changed: boolean } {
  const merged: StoredRiskAnswers = { ...stored };
  let changed = false;
  for (const questionId of Object.keys(request).sort()) {
    const value = request[questionId];
    if (value === null || value === undefined) {
      if (questionId in merged) {
        delete merged[questionId];
        changed = true;
      }
      continue;
    }
    if (merged[questionId]?.value === value) continue;
    merged[questionId] = { value, ...attribution };
    changed = true;
  }
  return { merged, changed };
}

/** `draft.saved` `targetRef.risk_answers`: every answer the request carried, by question ID, `null` for a clear. */
export function riskAnswerAuditRefs(request: RiskAnswersRequest): AuditRefValue[] {
  return Object.keys(request)
    .sort()
    .map((questionId) => ({ question_id: questionId, value: request[questionId] ?? null }));
}

/** Reads the jsonb column defensively: keeps well-formed entries only (the column is written only by this ticket). */
export function storedRiskAnswers(raw: unknown): StoredRiskAnswers {
  const out: StoredRiskAnswers = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [questionId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!QUESTION_ID.test(questionId) || entry === null || typeof entry !== 'object') continue;
    const { value, answeredBy, answeredRole, answeredAt } = entry as Record<string, unknown>;
    if (
      typeof value !== 'string' ||
      !ANSWER_VALUE.test(value) ||
      typeof answeredBy !== 'string' ||
      typeof answeredRole !== 'string' ||
      !ROLE_SET.has(answeredRole) ||
      typeof answeredAt !== 'string'
    )
      continue;
    out[questionId] = { value, answeredBy, answeredRole: answeredRole as Role, answeredAt };
  }
  return out;
}
