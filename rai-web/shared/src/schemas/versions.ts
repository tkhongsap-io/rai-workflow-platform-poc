// W0-02 section 7.6: submit and version navigation (W1-05 serves; W1-06, W2-07 consume). ExpectedVersion: W0-06 5.1.

import { Type, type Static } from 'typebox';
import type { ConfigurationRevisionId } from '../ids.js';
import type { FrozenConfigurationEntry } from './configuration-admin.js';
import { ArtifactRefSchema } from './artifacts.js';
import type { LaneDecision } from './review.js';
import { NotApplicableReasonSchema, type StageContextSchema, type SlotNumber } from './slots.js';

/** W0-06 section 5.1, verbatim; versionId = draftId for draft actions. */
export const ExpectedVersionSchema = Type.Object({
  versionId: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 1 }),
});
export type ExpectedVersion = Static<typeof ExpectedVersionSchema>;

export const FrozenSlotSchema = Type.Union([
  Type.Object({ state: Type.Literal('attached'), artifact: ArtifactRefSchema }), // embedded, immutable copy of the reference
  Type.Object({ state: Type.Literal('not_yet') }),
  Type.Object({ state: Type.Literal('missing') }),
  Type.Object({ state: Type.Literal('not_applicable'), reason: NotApplicableReasonSchema }),
]);
export type FrozenSlot = Static<typeof FrozenSlotSchema>;

export const VersionSummarySchema = Type.Object({
  versionId: Type.String(),
  versionNumber: Type.Integer({ minimum: 1 }),
  submittedBy: Type.String(),
  submittedByDisplayName: Type.Optional(Type.String()), // display only (W3-F1); absent when the subject is unknown
  submittedAt: Type.String(),
  isLatest: Type.Boolean(),
});
export type VersionSummary = Static<typeof VersionSummarySchema>;

export interface SubmittedVersion {
  versionId: string;
  caseId: string;
  versionNumber: number;
  parentVersionId: string | null;
  submittedBy: string; // the actor; a BU SPOC submitting on the owner's behalf is recorded as itself
  submittedByDisplayName?: string; // display only (W3-F1); not part of the frozen record
  submittedAt: string;
  checklistTemplateVersion: string;
  stageContext: Static<typeof StageContextSchema>;
  configurationRevisionId: ConfigurationRevisionId; // QC, risk and SLA rules frozen with the version (L12)
  laneMappingVersion: string; // the D02 constant's version, e.g. 'lane-mapping/v1'
  slots: Record<SlotNumber, FrozenSlot>;
  isLatest: boolean;
  decisions: LaneDecision[]; // the version's decided lanes as of the read, ascending by decidedAt then lane
  /**
   * W6 plan section 4.3: the configuration revisions frozen on this version ("configuration used"). Optional: W6-01
   * declares it and W6-09 serves it; an idempotent submit replay stored before W6 has no such field.
   */
  frozenConfiguration?: FrozenConfigurationEntry[];
}

export const SubmitRequestSchema = Type.Object({ expectedVersion: ExpectedVersionSchema });
export type SubmitRequest = Static<typeof SubmitRequestSchema>;

export interface VersionListResponse {
  items: VersionSummary[]; // ascending by versionNumber
}
