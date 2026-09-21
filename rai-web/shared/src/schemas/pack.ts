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
});
export type PackDraftUpdateRequest = Static<typeof PackDraftUpdateRequestSchema>;
