// W5-01 (W5 plan section 3, R-5 to R-7): the pure scoring engine. `tierOf` evaluates the count rules for one fully
// known answer set; `scoreRisk` resolves each question (answered, or Unknown with its reason), then computes the
// exact lowest and highest tier the Unknown questions could still produce (R-6). No Node or DOM import
// (module-graph.test.ts).
//
// Exactness without brute force: the rules read only the per-level counts, and escalation reads only the highest
// `escalatesTo`, so the reachable outcomes are the reachable (high count, medium count, escalation) states. They are
// built one Unknown question at a time; at most 8 x 8 x 3 states exist, whatever the options (brute-force cross-check
// in score.test.ts).

import type { RiskRubricBody } from '../schemas/cases.js';
import {
  ENGINE_VERSION,
  EXPLICIT_UNKNOWN,
  type EvidenceSlotStates,
  type MatchedRule,
  type RiskAnswerValues,
  type RiskLevel,
  type RiskQuestionScore,
  type RiskScore,
} from './types.js';

const RANK: Readonly<Record<RiskLevel, number>> = { low: 0, medium: 1, high: 2 };
const BY_RANK: readonly RiskLevel[] = ['low', 'medium', 'high'];

type Counts = Record<RiskLevel, number>;

function matchRule(rubric: RiskRubricBody, counts: Counts): { tier: RiskLevel; matchedRule: MatchedRule } {
  for (const [index, rule] of rubric.tierRules.entries()) {
    const matches = rule.anyOf.some((group) => group.allOf.every((c) => counts[c.level] >= c.atLeast));
    if (matches) return { tier: rule.tier, matchedRule: { tier: rule.tier, index } };
  }
  return { tier: rubric.defaultTier, matchedRule: 'default' };
}

/**
 * The tier of one fully known answer set, from the count rules alone: each level is counted exactly (a high answer
 * is not also a medium one) and the first matching rule wins, else `defaultTier`. Escalation is not applied here.
 */
export function tierOf(
  rubric: RiskRubricBody,
  levels: readonly RiskLevel[],
): { tier: RiskLevel; counts: Counts; matchedRule: MatchedRule } {
  const counts: Counts = { high: 0, medium: 0, low: 0 };
  for (const level of levels) counts[level] += 1;
  return { ...matchRule(rubric, counts), counts };
}

interface Resolved {
  score: RiskQuestionScore;
  /** Answered: the one option; Unknown: every option the question offers. */
  candidates: ReadonlyArray<{ level: RiskLevel; escalatesTo?: 'medium' | 'high' }>;
}

function resolveQuestion(
  question: RiskRubricBody['questions'][number],
  value: string | undefined,
  slotStates: EvidenceSlotStates,
): Resolved {
  const score: RiskQuestionScore = { questionId: question.questionId, status: 'unknown' };
  const evidence =
    question.evidenceSlot === undefined
      ? undefined
      : { slot: question.evidenceSlot, state: slotStates[question.evidenceSlot] ?? null };
  const option =
    value === undefined || value === EXPLICIT_UNKNOWN
      ? undefined
      : question.options.find((o) => o.value === value);
  if (value !== undefined) score.value = value;
  if (option !== undefined) {
    score.level = option.level;
    if (option.escalatesTo !== undefined) score.escalatesTo = option.escalatesTo;
  }
  if (value === undefined) score.unknownReason = 'unanswered';
  else if (value === EXPLICIT_UNKNOWN) score.unknownReason = 'explicit_unknown';
  else if (option === undefined) score.unknownReason = 'not_in_rubric';
  else if (evidence !== undefined && evidence.state !== 'attached')
    score.unknownReason = 'evidence_not_attached';
  else score.status = 'answered';
  if (evidence !== undefined) score.evidence = evidence;
  return {
    score,
    candidates: score.status === 'answered' && option !== undefined ? [option] : question.options,
  };
}

/**
 * Scores one answer set against one rubric. `answers` holds option values (or `'unknown'`) by question ID; answers to
 * questions the rubric does not have are ignored. `slotStates` are the version's slot states for `evidenceSlot`.
 * Pure: the inputs are not mutated and the result depends on nothing else.
 */
export function scoreRisk(
  rubric: RiskRubricBody,
  answers: RiskAnswerValues,
  slotStates: EvidenceSlotStates,
): RiskScore {
  const resolved = rubric.questions.map((q) =>
    resolveQuestion(q, Object.hasOwn(answers, q.questionId) ? answers[q.questionId] : undefined, slotStates),
  );

  const counts: Counts = { high: 0, medium: 0, low: 0 };
  let escalation: RiskScore['escalation'] = null;
  for (const { score } of resolved) {
    if (score.status !== 'answered' || score.level === undefined) continue;
    counts[score.level] += 1;
    const to = score.escalatesTo;
    if (to !== undefined && (escalation === null || RANK[to] > RANK[escalation.to]))
      escalation = { questionId: score.questionId, to };
  }

  // Reachable (high, medium, escalation rank) states over every combination of the Unknown questions' options.
  let states = new Map<string, [number, number, number]>();
  const start: [number, number, number] = [counts.high, counts.medium, escalation ? RANK[escalation.to] : 0];
  states.set(start.join(), start);
  for (const { score, candidates } of resolved) {
    if (score.status === 'answered') continue;
    const next = new Map<string, [number, number, number]>();
    for (const [high, medium, esc] of states.values())
      for (const option of candidates) {
        const state: [number, number, number] = [
          high + (option.level === 'high' ? 1 : 0),
          medium + (option.level === 'medium' ? 1 : 0),
          Math.max(esc, option.escalatesTo ? RANK[option.escalatesTo] : 0),
        ];
        next.set(state.join(), state);
      }
    states = next;
  }

  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  const rules = new Map<string, MatchedRule>();
  const unknownCount = resolved.filter((r) => r.score.status === 'unknown').length;
  const total = rubric.questions.length;
  for (const [high, medium, esc] of states.values()) {
    const match = matchRule(rubric, { high, medium, low: total - high - medium });
    const rank = Math.max(RANK[match.tier], esc);
    lowest = Math.min(lowest, rank);
    highest = Math.max(highest, rank);
    const key =
      match.matchedRule === 'default' ? 'default' : `${match.matchedRule.tier}:${match.matchedRule.index}`;
    rules.set(key, match.matchedRule);
  }
  const bounds = { lowest: BY_RANK[lowest]!, highest: BY_RANK[highest]! };

  return {
    engineVersion: ENGINE_VERSION,
    tier: bounds.lowest === bounds.highest ? bounds.lowest : 'unknown',
    bounds,
    counts,
    matchedRule: rules.size === 1 ? [...rules.values()][0]! : null,
    escalation,
    unknownCount,
    questions: resolved.map((r) => r.score),
  };
}
