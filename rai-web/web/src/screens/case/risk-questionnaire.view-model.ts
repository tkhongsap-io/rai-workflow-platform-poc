// W5-07 (W5 plan section 7): the risk questionnaire's view model. The rubric read is optional to the screen (R-16):
// a 404 is "not configured" and any other failure "unavailable"; neither blocks save, submit or any slot control.
// Pending answers are held with the pending pack settings and sent in the one save-draft request (W5-04). The
// preview runs the shared engine (`@rai/shared/risk/score`, the code the server runs at submit) over the saved answers
// merged with the pending ones and the editor's current slot states; it is never recorded (R-4).

import type { Locale, LocaleKey } from '@rai/shared/locales/keys';
import { scoreRisk } from '@rai/shared/risk/score';
import { EXPLICIT_UNKNOWN, type RiskScore, type ScoredTier } from '@rai/shared/risk/types';
import type { RiskRubricBody, RiskRubricView } from '@rai/shared/schemas/cases';
import type { PackDraft, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { ApiError } from '../../api/client.js';

export type RubricState =
  | { kind: 'loading' }
  | { kind: 'ready'; rubric: RiskRubricView }
  | { kind: 'not_configured' }
  | { kind: 'unavailable' };

/** The client's answer: a view, or `null` for a 404 (none in force, or no such route). */
export function rubricStateFromValue(view: RiskRubricView | null): RubricState {
  return view === null ? { kind: 'not_configured' } : { kind: 'ready', rubric: view };
}

/** A failed read: a 404 is still "not configured"; anything else is "unavailable". Never an error banner. */
export function rubricStateFromError(err: unknown): RubricState {
  return err instanceof ApiError && err.status === 404 ? { kind: 'not_configured' } : { kind: 'unavailable' };
}

/** Question ID → option value or `'unknown'`, or `null` to clear a saved answer. Only changed answers are held. */
export type PendingRiskAnswers = Readonly<Record<string, string | null>>;

/**
 * Records one change against the saved answers: a value equal to the saved one (or a clear of an answer that was
 * never saved) drops the pending entry, so the unsaved count and the request carry real changes only.
 */
export function applyRiskAnswerChange(
  saved: PackDraft['riskAnswers'],
  pending: PendingRiskAnswers | undefined,
  questionId: string,
  next: string | null,
): PendingRiskAnswers {
  const out: Record<string, string | null> = { ...pending };
  const savedValue = Object.hasOwn(saved, questionId) ? saved[questionId]?.value : undefined;
  if ((next === null && savedValue === undefined) || next === savedValue) delete out[questionId];
  else out[questionId] = next;
  return out;
}

export function riskPendingCount(pending: PendingRiskAnswers | undefined): number {
  return pending === undefined ? 0 : Object.keys(pending).length;
}

/** The answers as they would be after a save: saved values, overridden by pending ones; `null` removes. */
export function effectiveRiskAnswers(
  saved: PackDraft['riskAnswers'],
  pending: PendingRiskAnswers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(saved)) out[questionId] = answer.value;
  for (const [questionId, value] of Object.entries(pending ?? {})) {
    if (value === null) delete out[questionId];
    else out[questionId] = value;
  }
  return out;
}

/** The live, non-recorded preview: the same engine the submit runs, over the editor's current slot states. */
export function previewRiskScore(
  body: RiskRubricBody,
  answers: Readonly<Record<string, string>>,
  slots: Readonly<Record<SlotNumber, SlotState>>,
): RiskScore {
  const states: Partial<Record<SlotNumber, SlotState['state']>> = {};
  for (const [slot, state] of Object.entries(slots)) states[Number(slot) as SlotNumber] = state.state;
  return scoreRisk(body, answers, states);
}

/** High needs RAI Council confirmation; an Unknown that could be High may. The desk records neither. */
export function councilNoticeOf(score: Pick<RiskScore, 'tier' | 'bounds'>): 'required' | 'possible' | null {
  if (score.tier === 'high') return 'required';
  if (score.tier === 'unknown' && score.bounds.highest === 'high') return 'possible';
  return null;
}

export const RISK_TIER_KEY: Readonly<Record<ScoredTier, LocaleKey>> = Object.freeze({
  high: 'risk.tier.high',
  medium: 'risk.tier.medium',
  low: 'risk.tier.low',
  unknown: 'risk.tier.unknown',
});

/** The rubric's `tierLabels` win (D07's labels); the `risk.tier.*` keys are the fallback. */
export function riskTierLabel(
  body: RiskRubricBody | undefined,
  tier: ScoredTier,
  locale: Locale,
  t: (key: LocaleKey) => string,
): string {
  const label = body?.tierLabels[tier]?.[locale];
  return label !== undefined && label !== '' ? label : t(RISK_TIER_KEY[tier]);
}

export interface RiskAnswerChoice {
  value: string;
  /** The rubric's bilingual option label; `null` for Unknown, which is labelled from the locale catalogue. */
  label: { th: string; en: string } | null;
}

/** A question's options in rubric order, then the reserved Unknown every question accepts. */
export function riskAnswerChoices(question: RiskRubricBody['questions'][number]): RiskAnswerChoice[] {
  return [
    ...question.options.map((option) => ({ value: option.value, label: option.label })),
    { value: EXPLICIT_UNKNOWN, label: null },
  ];
}

/** `body.riskAnswers.RQ3` → `RQ3`, for an inline field error; any other path → null. */
export function riskQuestionOfFieldPath(path: string): string | null {
  const match = /^body\.riskAnswers\.(RQ[1-9])$/.exec(path);
  return match === null ? null : match[1]!;
}
