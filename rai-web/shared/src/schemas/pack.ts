// W0-02 section 7.5: the nine-slot pack draft (W1-04 serves; W1-06 consumes). Slot vocabulary: slots.ts (re-exported).

import { Type, type Static } from 'typebox';
import { SlotStateSchema, StageContextSchema, slotRecord } from './slots.js';
import { ExpectedVersionSchema } from './versions.js';

export {
  NON_VENDOR_DEFAULT_REASON_KEY,
  NotApplicableReasonSchema,
  SLOT_STATE_NAMES,
  STAGE_CONTEXTS,
  SlotNumberSchema,
  SlotStateSchema,
  StageContextSchema,
  type NotApplicableReason,
  type SlotNumber,
  type SlotState,
  type SlotStateName,
  type StageContext,
} from './slots.js';

// W5-04 (W5 plan section 6, R-3, R-13): questionnaire answers on the draft, frozen with the version at submit. The
// patterns are the risk rubric schema's (`^RQ[1-9]$` question IDs, option values); `unknown` is the reserved answer
// every question accepts. Values only: no free text can enter an answer.
export const RISK_QUESTION_ID_PATTERN = '^RQ[1-9]$';
export const RISK_ANSWER_VALUE_PATTERN = '^[a-z][a-z0-9_]{0,39}$';
export const RISK_ANSWER_MAX_KEYS = 20;
const RiskQuestionIdSchema = Type.String({ pattern: RISK_QUESTION_ID_PATTERN });
const RiskAnswerValueSchema = Type.String({ pattern: RISK_ANSWER_VALUE_PATTERN });
// The six ROLES (auth.ts) as a literal tuple, not ROLES.map(): a mapped array widens the inferred type to never.
const AnsweredRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('bu_spoc'),
  Type.Literal('ai_coe'),
  Type.Literal('dpo'),
  Type.Literal('it_security'),
  Type.Literal('admin'),
]);
export const RiskAnswerSchema = Type.Object(
  {
    value: RiskAnswerValueSchema, // an option value of the rubric in force when it was given, or 'unknown'
    answeredBy: Type.String({ minLength: 1 }), // SubjectId
    answeredByName: Type.Optional(Type.String()), // display only (W3-F1); omitted when the subject does not resolve
    answeredRole: AnsweredRoleSchema, // the acting role (owner or bu_spoc: the case.edit_draft rows)
    answeredAt: Type.String(),
  },
  { additionalProperties: false },
);
export type RiskAnswer = Static<typeof RiskAnswerSchema>;

export const PackDraftSchema = Type.Object({
  draftId: Type.String(),
  caseId: Type.String(),
  versionNumber: Type.Integer({ minimum: 1 }),
  parentVersionId: Type.Union([Type.String(), Type.Null()]),
  checklistTemplateVersion: Type.String(), // must be in ConfigurationView.checklistTemplateVersions
  stageContext: StageContextSchema,
  slots: slotRecord(SlotStateSchema),
  draftRevision: Type.Integer({ minimum: 1 }), // = CaseView.caseRevision (one counter per case)
  updatedAt: Type.String(),
  riskAnswers: Type.Record(RiskQuestionIdSchema, RiskAnswerSchema, { additionalProperties: false }), // W5-04; {} when none
});
export type PackDraft = Static<typeof PackDraftSchema>;

export const DraftSummarySchema = Type.Object({
  draftId: Type.String(),
  versionNumber: Type.Integer(),
  updatedAt: Type.String(),
});
export type DraftSummary = Static<typeof DraftSummarySchema>;

export const PackDraftUpdateRequestSchema = Type.Object({
  expectedVersion: ExpectedVersionSchema, // { versionId: draftId, revision: draftRevision } (W0-06 5.1)
  checklistTemplateVersion: Type.Optional(Type.String({ minLength: 1 })),
  stageContext: Type.Optional(StageContextSchema),
  slots: Type.Optional(Type.Partial(slotRecord(SlotStateSchema), { additionalProperties: false })), // only the slots being changed
  // W5-04: only the answers being changed; null clears one. Validated against the rubric in force (pack/service.ts).
  riskAnswers: Type.Optional(
    Type.Record(RiskQuestionIdSchema, Type.Union([RiskAnswerValueSchema, Type.Null()]), {
      additionalProperties: false,
      maxProperties: RISK_ANSWER_MAX_KEYS,
    }),
  ),
});
export type PackDraftUpdateRequest = Static<typeof PackDraftUpdateRequestSchema>;
