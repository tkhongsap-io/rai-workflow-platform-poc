// W0-02 section 7.7: W2 shapes — lane decision and send-back feedback (W2-02). Findings/dispositions arrive with
// W2-05; history/successor-draft read shapes with W2-03. Request bodies carry ExpectedVersion (W0-06 5.1) and the
// Idempotency-Key header (W0-06 5.3). Approve requires the qc_run_id the reviewer saw (W0-06 4.4); send-back
// requires feedback that names at least one artifact slot (A09).

import { Type, type Static } from 'typebox';
import type { Lane } from '../constants.js';
import { ExpectedVersionSchema } from './versions.js';
import { SlotNumberSchema } from './slots.js';

// Explicit literals (not LANES[i]): noUncheckedIndexedAccess makes indexed access `Lane | undefined`.
export const LaneSchema = Type.Union([
  Type.Literal('ai_coe'),
  Type.Literal('dpo'),
  Type.Literal('it_security'),
]);
export type { Lane };

/** Derived lane state on a submitted version (W0-04: no stored lane row until a decision). */
export const LANE_STATES = ['pending', 'approved', 'sent_back'] as const;
export type LaneStateName = (typeof LANE_STATES)[number];

export const LaneStateSchema = Type.Object({
  lane: LaneSchema,
  state: Type.Union([Type.Literal('pending'), Type.Literal('approved'), Type.Literal('sent_back')]),
});
export type LaneState = Static<typeof LaneStateSchema>;

/** One feedback item: names an artifact slot (and optional artifact id) with a deficiency message (A09). */
export const SendBackFeedbackItemSchema = Type.Object({
  slot: SlotNumberSchema,
  deficiency: Type.String({ minLength: 1, maxLength: 2000 }),
  artifactId: Type.Optional(Type.String({ minLength: 1 })),
});
export type SendBackFeedbackItem = Static<typeof SendBackFeedbackItemSchema>;

export const SendBackFeedbackSchema = Type.Object({
  items: Type.Array(SendBackFeedbackItemSchema, { minItems: 1 }),
  summary: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type SendBackFeedback = Static<typeof SendBackFeedbackSchema>;

/**
 * POST …/lanes/{lane}/approve — W0-06 4.4.
 * `qcRunId` is optional at the schema layer so a missing value reaches the service check
 * (`invalid_input` `lane_qc_not_run`); do not rely on minLength alone.
 */
export const ApproveLaneRequestSchema = Type.Object({
  expectedVersion: ExpectedVersionSchema,
  qcRunId: Type.Optional(Type.String()),
});
export type ApproveLaneRequest = Static<typeof ApproveLaneRequestSchema>;

/** POST …/lanes/{lane}/send-back — W0-06 4.5. */
export const SendBackLaneRequestSchema = Type.Object({
  expectedVersion: ExpectedVersionSchema,
  feedback: SendBackFeedbackSchema,
});
export type SendBackLaneRequest = Static<typeof SendBackLaneRequestSchema>;

export const LANE_DECISIONS = ['approve', 'send_back'] as const;
export type LaneDecisionKind = (typeof LANE_DECISIONS)[number];
const LaneDecisionKindSchema = Type.Union([Type.Literal('approve'), Type.Literal('send_back')]);

/** One decided lane of a submitted version, as the version read serves it (W0-02 7.6 `decisions`). */
export const LaneDecisionSchema = Type.Object({
  lane: LaneSchema,
  decision: LaneDecisionKindSchema,
  decidedBy: Type.String(), // subject id, as `SubmittedVersion.submittedBy`
  decidedAt: Type.String(),
  feedback: Type.Union([SendBackFeedbackSchema, Type.Null()]), // null on approve
});
export type LaneDecision = Static<typeof LaneDecisionSchema>;

/** Success body for both decide routes (201). */
export const LaneDecisionResponseSchema = Type.Object({
  decisionId: Type.String(),
  versionId: Type.String(),
  lane: LaneSchema,
  decision: LaneDecisionKindSchema,
  decidedAt: Type.String(),
  /** Successor draft id when this send-back created or reused N+1; null on approve. */
  successorDraftVersionId: Type.Union([Type.String(), Type.Null()]),
  /** case.row_version at decision time (unchanged by the decision; W0-06 5.1 frozen for submitted versions). */
  caseRevision: Type.Integer({ minimum: 1 }),
  /** True when this approve applied Ready in the same transaction (W2-06); always false on send-back. */
  ready: Type.Boolean(),
});
export type LaneDecisionResponse = Static<typeof LaneDecisionResponseSchema>;

/** W0-06 4.8 disposition kinds. */
export const DISPOSITION_KINDS = [
  'fixed_proposed',
  'fixed',
  'fixed_confirmed',
  'waived',
  'not_applicable',
] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

export const DispositionKindSchema = Type.Union([
  Type.Literal('fixed_proposed'),
  Type.Literal('fixed'),
  Type.Literal('fixed_confirmed'),
  Type.Literal('waived'),
  Type.Literal('not_applicable'),
]);

/** POST …/findings/{findingId}/dispositions — W0-06 4.7. */
export const DispositionRequestSchema = Type.Object({
  expectedVersion: ExpectedVersionSchema,
  kind: DispositionKindSchema,
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
  evidence: Type.Optional(
    Type.Object(
      {
        slot: Type.Optional(SlotNumberSchema),
        artifactId: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
  ),
});
export type DispositionRequest = Static<typeof DispositionRequestSchema>;

export const DispositionResponseSchema = Type.Object({
  dispositionId: Type.String(),
  findingId: Type.String(),
  kind: DispositionKindSchema,
  recordedAt: Type.String(),
  caseRevision: Type.Integer({ minimum: 1 }),
  /** True when this disposition applied Ready in the same transaction (W2-06). */
  ready: Type.Boolean(),
});
export type DispositionResponse = Static<typeof DispositionResponseSchema>;

/** POST …/lanes/{lane}/qc-run — W0-06 4.4 lane-QC run (W2-05 persistence). */
export const LaneQcRunRequestSchema = Type.Object({
  expectedVersion: ExpectedVersionSchema,
});
export type LaneQcRunRequest = Static<typeof LaneQcRunRequestSchema>;

export const StoredFindingSummarySchema = Type.Object({
  findingId: Type.String(),
  ruleId: Type.String(),
  slot: Type.Union([
    Type.Literal(1),
    Type.Literal(2),
    Type.Literal(3),
    Type.Literal(4),
    Type.Literal(5),
    Type.Literal(6),
    Type.Literal(7),
    Type.Literal(8),
    Type.Literal(9),
    Type.Null(),
  ]),
  severity: Type.Union([
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
    Type.Literal('info'),
  ]),
  owningLane: LaneSchema,
  messageKey: Type.String(),
  /** D12 message params from the QC finding; optional so older rows without them still type-check. */
  messageParams: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
});
export type StoredFindingSummary = Static<typeof StoredFindingSummarySchema>;

/**
 * GET …/versions/{versionId}/findings — read-only list of stored findings for a version with each finding's
 * latest disposition kind (W2-09). Separate from StoredFindingSummary so qc-run stays unchanged.
 */
export const FindingWithDispositionSchema = Type.Object({
  findingId: Type.String(),
  ruleId: Type.String(),
  slot: Type.Union([
    Type.Literal(1),
    Type.Literal(2),
    Type.Literal(3),
    Type.Literal(4),
    Type.Literal(5),
    Type.Literal(6),
    Type.Literal(7),
    Type.Literal(8),
    Type.Literal(9),
    Type.Null(),
  ]),
  severity: Type.Union([
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
    Type.Literal('info'),
  ]),
  owningLane: LaneSchema,
  messageKey: Type.String(),
  messageParams: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
  latestDisposition: Type.Union([DispositionKindSchema, Type.Null()]),
});
export type FindingWithDisposition = Static<typeof FindingWithDispositionSchema>;

export const VersionFindingsResponseSchema = Type.Object({
  findings: Type.Array(FindingWithDispositionSchema),
});
export type VersionFindingsResponse = Static<typeof VersionFindingsResponseSchema>;

export const LaneQcRunResponseSchema = Type.Object({
  runId: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([Type.Literal('completed'), Type.Literal('unavailable')]),
  reason: Type.Optional(
    Type.Union([
      Type.Literal('timeout'),
      Type.Literal('runner_error'),
      Type.Literal('not_configured'),
      Type.Literal('artifact_unreadable'),
    ]),
  ),
  findings: Type.Array(StoredFindingSummarySchema),
});
export type LaneQcRunResponse = Static<typeof LaneQcRunResponseSchema>;
