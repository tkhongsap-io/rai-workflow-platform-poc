// W5-06 (W5 plan section 6, R-14): `GET /api/cases/{caseId}/versions/{versionId}/risk-proposal` →
// `200 { proposal: RiskProposalView | null }`. The view is the risk proposal the desk RECORDED for that version at
// submit (W5-05): a proposal and a QC input, never a governance decision, never a routing switch. `rubric` is the
// revision the version froze, not the one in force today. The rubric is a SYNTHETIC PLACEHOLDER until D07 (AI/COE).

import { Type, type Static } from 'typebox';
import { RiskRubricBodySchema } from './cases.js';
import { RiskAnswerSchema } from './pack.js';

const LevelSchema = Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]);
const RaisedTierSchema = Type.Union([Type.Literal('high'), Type.Literal('medium')]);
// A literal tuple, not SlotNumberSchema: that mapped union infers `never` (see StageContextSchema in slots.ts).
const EvidenceSlotSchema = Type.Union([
  Type.Literal(1),
  Type.Literal(2),
  Type.Literal(3),
  Type.Literal(4),
  Type.Literal(5),
  Type.Literal(6),
  Type.Literal(7),
  Type.Literal(8),
  Type.Literal(9),
]);
const SlotStateNameSchema = Type.Union([
  Type.Literal('attached'),
  Type.Literal('not_yet'),
  Type.Literal('not_applicable'),
  Type.Literal('missing'),
]);

export const RISK_COUNCIL_CONFIRMATIONS = ['required', 'possible', 'not_indicated'] as const;
export type RiskCouncilConfirmation = (typeof RISK_COUNCIL_CONFIRMATIONS)[number];

/** One question of the stored explanation, plus the frozen answer's attribution (display only, W3-F1 name). */
export const RiskProposalQuestionSchema = Type.Object(
  {
    questionId: Type.String(),
    status: Type.Union([Type.Literal('answered'), Type.Literal('unknown')]),
    unknownReason: Type.Optional(
      Type.Union([
        Type.Literal('unanswered'),
        Type.Literal('explicit_unknown'),
        Type.Literal('evidence_not_attached'),
        Type.Literal('not_in_rubric'),
      ]),
    ),
    value: Type.Optional(Type.String()),
    level: Type.Optional(LevelSchema),
    escalatesTo: Type.Optional(RaisedTierSchema),
    answeredBy: Type.Optional(Type.String()),
    answeredByName: Type.Optional(Type.String()),
    answeredRole: Type.Optional(RiskAnswerSchema.properties.answeredRole),
    answeredAt: Type.Optional(Type.String()),
    // `state` is null only when the version holds no row for the slot (the engine counts it as not attached).
    evidence: Type.Optional(
      Type.Object(
        { slot: EvidenceSlotSchema, state: Type.Union([SlotStateNameSchema, Type.Null()]) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const RiskProposalViewSchema = Type.Object(
  {
    proposalId: Type.String(),
    versionId: Type.String(),
    trigger: Type.Union([Type.Literal('submit'), Type.Literal('recheck')]),
    status: Type.Union([Type.Literal('proposed'), Type.Literal('unavailable')]),
    unavailableReason: Type.Union([
      Type.Literal('not_configured'),
      Type.Literal('rubric_invalid'),
      Type.Literal('engine_error'),
      Type.Null(),
    ]),
    tier: Type.Union([
      Type.Literal('high'),
      Type.Literal('medium'),
      Type.Literal('low'),
      Type.Literal('unknown'),
      Type.Null(),
    ]),
    bounds: Type.Union([
      Type.Object({ lowest: LevelSchema, highest: LevelSchema }, { additionalProperties: false }),
      Type.Null(),
    ]),
    // required: tier high; possible: tier unknown whose highest bound is high; not_indicated otherwise (unavailable too).
    councilConfirmation: Type.Union([
      Type.Literal('required'),
      Type.Literal('possible'),
      Type.Literal('not_indicated'),
    ]),
    rubric: Type.Union([
      Type.Object(
        {
          revisionId: Type.String(),
          label: Type.String(),
          provenance: RiskRubricBodySchema.properties.provenance,
          questions: RiskRubricBodySchema.properties.questions,
          tierLabels: RiskRubricBodySchema.properties.tierLabels,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    engineVersion: Type.String(),
    inputsHash: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String(),
    explanation: Type.Union([
      Type.Object(
        {
          questions: Type.Array(RiskProposalQuestionSchema),
          counts: Type.Object(
            { low: Type.Integer(), medium: Type.Integer(), high: Type.Integer() },
            { additionalProperties: false },
          ),
          matchedRule: Type.Union([
            Type.Object(
              { tier: RaisedTierSchema, index: Type.Integer({ minimum: 0 }) },
              { additionalProperties: false },
            ),
            Type.Literal('default'),
            Type.Null(),
          ]),
          escalation: Type.Union([
            Type.Object({ questionId: Type.String(), to: RaisedTierSchema }, { additionalProperties: false }),
            Type.Null(),
          ]),
          unknownCount: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type RiskProposalView = Static<typeof RiskProposalViewSchema>;
export type RiskProposalQuestion = Static<typeof RiskProposalQuestionSchema>;

/** `null` for a submitted version with no proposal (submitted before W5); a draft is 404, never `null`. */
export const RiskProposalResponseSchema = Type.Object(
  { proposal: Type.Union([RiskProposalViewSchema, Type.Null()]) },
  { additionalProperties: false },
);
export type RiskProposalResponse = Static<typeof RiskProposalResponseSchema>;
