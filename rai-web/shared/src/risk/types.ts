// W5-01 (W5 plan section 3): the vocabulary of the pure risk scoring engine. No Node or DOM import anywhere under
// shared/src/risk, so the server (submit, W5-05) and the browser (preview, W5-07) run the same code
// (module-graph.test.ts). The rubric's content is D07's (AI/COE); W5 scores against a labelled synthetic placeholder.

import type { SlotNumber, SlotStateName } from '../schemas/slots.js';

/** Any change to scoring semantics bumps this in the same PR; every proposal records it. */
export const ENGINE_VERSION = 'risk-engine/1';

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * The tier codes a score can carry (R-9): the three levels plus `unknown` when the Unknown questions leave more than
 * one tier possible. W5-05 widens `RiskTier` in schemas/cases.ts to this union; display labels come from the rubric.
 */
export const SCORED_TIERS = ['high', 'medium', 'low', 'unknown'] as const;
export type ScoredTier = (typeof SCORED_TIERS)[number];

/** Why a question is Unknown (R-5). Missing evidence is never scored as Low. */
export const UNKNOWN_REASONS = [
  'unanswered',
  'explicit_unknown',
  'evidence_not_attached',
  'not_in_rubric',
] as const;
export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

/** The answer value a person gives when they do not know; reserved, never a rubric option. */
export const EXPLICIT_UNKNOWN = 'unknown';

/**
 * Question ID → option value (or `'unknown'`). Values only: attribution and text never reach the engine (R-13), so
 * they cannot enter a score, an explanation or the inputs hash.
 */
export type RiskAnswerValues = Readonly<Record<string, string>>;

/** The version's slot states the engine reads for `evidenceSlot`; an absent slot counts as not attached. */
export type EvidenceSlotStates = Readonly<Partial<Record<SlotNumber, SlotStateName>>>;

export type MatchedRule = { tier: 'high' | 'medium'; index: number } | 'default';

export interface RiskQuestionScore {
  questionId: string;
  status: 'answered' | 'unknown';
  unknownReason?: UnknownReason;
  value?: string; // the stored value, including 'unknown' or one the rubric does not have
  level?: RiskLevel; // the option's level when the value is one of the question's options
  escalatesTo?: 'medium' | 'high';
  evidence?: { slot: SlotNumber; state: SlotStateName | null }; // only for a question with an evidenceSlot
}

export interface RiskScore {
  engineVersion: string;
  /** The determinate tier, or `unknown` when `bounds.lowest` and `bounds.highest` differ. */
  tier: ScoredTier;
  /** The lowest and highest tier over every combination of the Unknown questions' options (R-6, exact). */
  bounds: { lowest: RiskLevel; highest: RiskLevel };
  /** Answered questions per level. */
  counts: Record<RiskLevel, number>;
  /** The rule every combination matches; `null` when combinations match different rules. */
  matchedRule: MatchedRule | null;
  /** The highest `escalatesTo` among answered questions (first in rubric order on a tie). */
  escalation: { questionId: string; to: 'medium' | 'high' } | null;
  unknownCount: number;
  questions: RiskQuestionScore[]; // rubric order
}
