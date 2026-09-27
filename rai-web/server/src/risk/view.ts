// W5-06 (W5 plan section 6): the pure builder of `RiskProposalView` for the risk proposal read. It serves what W5-05
// recorded, nothing recomputed: the stored tier, bounds and explanation (ids and enums), the rubric revision the
// proposal names (the version's frozen revision, never today's) and, for display, each frozen answer's attribution
// from `pack_version.risk_answers` (names resolved on read, W3-F1). A proposal is not a governance decision; the
// Council indication only says whether the recorded tier is or could be High. The rubric is the SYNTHETIC
// PLACEHOLDER until D07 (AI/COE).

import { Value } from 'typebox/value';
import { RiskRubricBodySchema, riskRubricBodyProblems, type RiskRubricBody } from '@rai/shared/schemas/cases';
import type {
  RiskCouncilConfirmation,
  RiskProposalQuestion,
  RiskProposalView,
} from '@rai/shared/schemas/risk';
import { storedRiskAnswers } from '../pack/risk-answers.js';
import type { RiskExplanation } from './propose.js';
import type { RiskProposalRow } from './repository.js';

export interface RiskProposalViewInput {
  row: RiskProposalRow;
  /** The configuration revision `row.rubricRevisionId` names, if the row names one and it exists. */
  rubric: { id: string; body: unknown } | undefined;
  /** The frozen version's `pack_version.risk_answers` column. */
  riskAnswers: unknown;
  /** Resolved display names by subject id; a subject missing here gets no `answeredByName`. */
  names: ReadonlyMap<string, string>;
}

/** Required for a High tier; possible when the tier is Unknown and High is still reachable; otherwise not indicated. */
export function councilConfirmationOf(tier: string | null, highest: string | null): RiskCouncilConfirmation {
  if (tier === 'high') return 'required';
  if (tier === 'unknown' && highest === 'high') return 'possible';
  return 'not_indicated';
}

function validRubric(body: unknown): body is RiskRubricBody {
  return Value.Check(RiskRubricBodySchema, body) && riskRubricBodyProblems(body).length === 0;
}

/** The subject ids whose names the view would show (answerers of the frozen answers). */
export function answererIds(riskAnswers: unknown): string[] {
  return [...new Set(Object.values(storedRiskAnswers(riskAnswers)).map((a) => a.answeredBy))];
}

export function riskProposalView(input: RiskProposalViewInput): RiskProposalView {
  const { row } = input;
  const body = input.rubric?.body;
  const rubric =
    input.rubric !== undefined && validRubric(body)
      ? {
          revisionId: input.rubric.id,
          label: body.label,
          provenance: body.provenance,
          questions: body.questions,
          tierLabels: body.tierLabels,
        }
      : null;
  const stored = storedRiskAnswers(input.riskAnswers);
  const explanation = row.explanation as RiskExplanation | null;
  return {
    proposalId: row.id,
    versionId: row.versionId,
    trigger: row.trigger as RiskProposalView['trigger'],
    status: row.status as RiskProposalView['status'],
    unavailableReason: row.unavailableReason as RiskProposalView['unavailableReason'],
    tier: row.tier as RiskProposalView['tier'],
    bounds:
      row.lowestTier === null || row.highestTier === null
        ? null
        : ({ lowest: row.lowestTier, highest: row.highestTier } as NonNullable<RiskProposalView['bounds']>),
    councilConfirmation: councilConfirmationOf(row.tier, row.highestTier),
    rubric,
    engineVersion: row.engineVersion,
    inputsHash: row.inputsHash,
    createdAt: row.createdAt.toISOString(),
    explanation:
      explanation === null
        ? null
        : {
            questions: explanation.questions.map((q): RiskProposalQuestion => {
              const answer = stored[q.questionId];
              if (answer === undefined) return { ...q };
              const name = input.names.get(answer.answeredBy);
              return {
                ...q,
                answeredBy: answer.answeredBy,
                ...(name === undefined ? {} : { answeredByName: name }),
                answeredRole: answer.answeredRole,
                answeredAt: answer.answeredAt,
              };
            }),
            counts: explanation.counts,
            matchedRule: explanation.matchedRule,
            escalation: explanation.escalation,
            unknownCount: explanation.unknownCount,
          },
  };
}
