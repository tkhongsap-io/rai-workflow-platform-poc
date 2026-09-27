// W5-05 (W5 plan sections 2, 4 and 8; R-4 to R-6, R-10): the risk proposal recorded inside the submit transaction.
// `versions/service.ts` `submitDraft` calls `proposeAtSubmit` right after the freeze. It scores the frozen answers
// against the frozen `risk_rubric` revision and the frozen slot states with the shared engine (the same code the
// browser preview runs), inserts the append-only `risk_proposal` row and returns what the case projection
// (`case.risk_tier`), the `risk.proposed` audit event and the post-commit log line need.
//
// Fail-closed (section 2): no rubric frozen → `unavailable` `not_configured`; a frozen body that fails
// `RiskRubricBodySchema` or `riskRubricBodyProblems` → `rubric_invalid`; the engine throws → `engine_error`, the error
// handed back for `errors.internal`. None of them throws, so a proposal problem never fails a submit, and none is
// ever a Low. The tier is a proposal and a QC input, never a routing switch: nothing here opens, skips or gates a lane,
// and `workflow/ready.ts` and `authz/policy.ts` import nothing from this directory (module-graph.test.ts).
// The rubric is the seeded SYNTHETIC PLACEHOLDER until AI/COE records D07.

import { Value } from 'typebox/value';
import { uuidv7 } from '@rai/shared/ids';
import { inputsHash } from '@rai/shared/risk/inputs';
import { scoreRisk } from '@rai/shared/risk/score';
import {
  ENGINE_VERSION,
  type EvidenceSlotStates,
  type RiskAnswerValues,
  type RiskLevel,
  type RiskScore,
  type ScoredTier,
} from '@rai/shared/risk/types';
import {
  RiskRubricBodySchema,
  riskRubricBodyProblems,
  type RiskRubricBody,
  type RiskTier,
} from '@rai/shared/schemas/cases';
import { SLOT_STATE_NAMES, type SlotNumber, type SlotStateName } from '@rai/shared/schemas/slots';
import { AUDIT_REF_MAX_STRING, type AuditRef } from '../audit/store.js';
import { readRevisionById } from '../configuration/store.js';
import type { Tx } from '../db/client.js';
import { storedRiskAnswers } from '../pack/risk-answers.js';
import type { SlotColumnsIn } from '../versions/freeze.js';
import { insertRiskProposal, type RiskProposalRow } from './repository.js';

/** The engine's signature; `submitDraft` takes another only as a test seam (the injected engine error). */
export type RiskEngine = typeof scoreRisk;

export type UnavailableReason = 'not_configured' | 'rubric_invalid' | 'engine_error';

/** The stored explanation (section 6 `RiskProposalView.explanation` minus attribution): ids, enums and numbers. */
export type RiskExplanation = Pick<
  RiskScore,
  'questions' | 'counts' | 'matchedRule' | 'escalation' | 'unknownCount'
>;

/** The proposal's columns, before the row gets its id, case, version, trigger, correlation and instant. */
export interface ProposalOutcome {
  status: 'proposed' | 'unavailable';
  unavailableReason: UnavailableReason | null;
  tier: ScoredTier | null;
  lowestTier: RiskLevel | null;
  highestTier: RiskLevel | null;
  rubricRevisionId: string | null;
  rubricLabel: string | null;
  engineVersion: string;
  inputsHash: string | null;
  explanation: RiskExplanation | null;
  unknownCount: number | null;
  /** Only for `engine_error`: what the engine threw, for the error capture; never stored. */
  engineError?: unknown;
}

function unavailable(
  reason: UnavailableReason,
  rubric: { id: string; label: string | null } | null,
): ProposalOutcome {
  return {
    status: 'unavailable',
    unavailableReason: reason,
    tier: null,
    lowestTier: null,
    highestTier: null,
    rubricRevisionId: rubric?.id ?? null,
    rubricLabel: rubric?.label ?? null,
    engineVersion: ENGINE_VERSION,
    inputsHash: null,
    explanation: null,
    unknownCount: null,
  };
}

function validRubric(body: unknown): body is RiskRubricBody {
  return Value.Check(RiskRubricBodySchema, body) && riskRubricBodyProblems(body).length === 0;
}

/**
 * The pure half: the frozen rubric revision (`undefined` when the version froze none), the frozen answer values and
 * slot states → the proposal's columns. Never throws; the engine's error is returned in `engineError`.
 */
export function proposalOutcome(
  rubric: { id: string; body: unknown } | undefined,
  answers: RiskAnswerValues,
  slotStates: EvidenceSlotStates,
  engine: RiskEngine = scoreRisk,
): ProposalOutcome {
  if (rubric === undefined) return unavailable('not_configured', null);
  const { id, body } = rubric;
  if (!validRubric(body)) {
    const label =
      body !== null && typeof body === 'object' && typeof (body as { label?: unknown }).label === 'string'
        ? (body as { label: string }).label
        : null;
    return unavailable('rubric_invalid', { id, label });
  }
  let score: RiskScore;
  let hash: string;
  try {
    score = engine(body, answers, slotStates);
    hash = inputsHash(body, answers, slotStates);
  } catch (error) {
    return { ...unavailable('engine_error', { id, label: body.label }), engineError: error };
  }
  return {
    status: 'proposed',
    unavailableReason: null,
    tier: score.tier,
    lowestTier: score.bounds.lowest,
    highestTier: score.bounds.highest,
    rubricRevisionId: id,
    rubricLabel: body.label,
    engineVersion: score.engineVersion,
    inputsHash: hash,
    explanation: {
      questions: score.questions,
      counts: score.counts,
      matchedRule: score.matchedRule,
      escalation: score.escalation,
      unknownCount: score.unknownCount,
    },
    unknownCount: score.unknownCount,
  };
}

/** R-10: `case.risk_tier` holds the proposed tier (including `unknown`); NULL when the proposal is unavailable. */
export function tierForCase(outcome: ProposalOutcome): RiskTier | null {
  return outcome.status === 'proposed' ? outcome.tier : null;
}

/** The frozen `pack_version.risk_answers` column → question ID to value; attribution never reaches the engine. */
export function answerValuesOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(storedRiskAnswers(raw))) out[questionId] = answer.value;
  return out;
}

const STATE_SET: ReadonlySet<string> = new Set(SLOT_STATE_NAMES);

/** The version's slot rows → slot number to state (the engine reads `evidenceSlot` from it). */
export function slotStatesOf(rows: readonly SlotColumnsIn[]): EvidenceSlotStates {
  const out: Partial<Record<SlotNumber, SlotStateName>> = {};
  for (const row of rows)
    if (STATE_SET.has(row.state)) out[row.slot as SlotNumber] = row.state as SlotStateName;
  return out;
}

const REF_STRING = /^[A-Za-z0-9_.:/@-]+$/; // the audit store's ref-string rule (audit/store.ts)

/**
 * The `risk.proposed` target ref (W5 plan section 8): ids, enums and numbers only. The rubric label is Admin text
 * (up to 100 characters); it is recorded only when it is also a valid ref string, otherwise null (the revision id
 * identifies the rubric either way).
 */
export function riskAuditRef(proposalId: string, outcome: ProposalOutcome): AuditRef {
  const label = outcome.rubricLabel;
  return {
    proposal_id: proposalId,
    status: outcome.status,
    unavailable_reason: outcome.unavailableReason,
    tier: outcome.tier,
    lowest_tier: outcome.lowestTier,
    highest_tier: outcome.highestTier,
    unknown_count: outcome.unknownCount,
    rubric_revision_id: outcome.rubricRevisionId,
    rubric_label:
      label !== null && label.length <= AUDIT_REF_MAX_STRING && REF_STRING.test(label) ? label : null,
    engine_version: outcome.engineVersion,
    inputs_hash: outcome.inputsHash,
  };
}

export interface ProposeAtSubmitInput {
  caseId: string;
  versionId: string;
  /** The frozen `pack_version.risk_answers` column of the version just frozen. */
  riskAnswers: unknown;
  /** The `risk_rubric` revision the version froze (`frozen_configuration.risk_rubric`), if any. */
  rubricRevisionId: string | undefined;
  slotRows: readonly SlotColumnsIn[];
  now: Date;
  correlationId: string;
  engine?: RiskEngine;
}

export interface ProposeAtSubmitResult {
  row: RiskProposalRow;
  outcome: ProposalOutcome;
  /** Scoring time in milliseconds (the `risk.proposal.recorded` `durationMs`). */
  durationMs: number;
}

/** Inside the submit transaction: score, insert the `submit` proposal, return it for the projection, audit and log. */
export async function proposeAtSubmit(tx: Tx, input: ProposeAtSubmitInput): Promise<ProposeAtSubmitResult> {
  const revision =
    input.rubricRevisionId === undefined ? undefined : await readRevisionById(tx, input.rubricRevisionId);
  const started = performance.now();
  const outcome =
    input.rubricRevisionId !== undefined && revision === undefined
      ? unavailable('rubric_invalid', { id: input.rubricRevisionId, label: null }) // the frozen id names no row: corruption
      : proposalOutcome(
          revision === undefined ? undefined : { id: revision.id, body: revision.body },
          answerValuesOf(input.riskAnswers),
          slotStatesOf(input.slotRows),
          input.engine,
        );
  const durationMs = Math.round((performance.now() - started) * 1000) / 1000;
  const row = await insertRiskProposal(tx, {
    id: uuidv7(input.now.getTime()),
    caseId: input.caseId,
    versionId: input.versionId,
    trigger: 'submit',
    status: outcome.status,
    unavailableReason: outcome.unavailableReason,
    tier: outcome.tier,
    lowestTier: outcome.lowestTier,
    highestTier: outcome.highestTier,
    rubricRevisionId: outcome.rubricRevisionId,
    rubricLabel: outcome.rubricLabel,
    engineVersion: outcome.engineVersion,
    inputsHash: outcome.inputsHash,
    explanation: outcome.explanation,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
  return { row, outcome, durationMs };
}
