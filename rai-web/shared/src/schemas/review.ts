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

/** Success body for both decide routes (201). */
export const LaneDecisionResponseSchema = Type.Object({
  decisionId: Type.String(),
  versionId: Type.String(),
  lane: LaneSchema,
  decision: Type.Union([Type.Literal('approve'), Type.Literal('send_back')]),
  decidedAt: Type.String(),
  /** Successor draft id when this send-back created or reused N+1; null on approve. */
  successorDraftVersionId: Type.Union([Type.String(), Type.Null()]),
  /** case.row_version at decision time (unchanged by the decision; W0-06 5.1 frozen for submitted versions). */
  caseRevision: Type.Integer({ minimum: 1 }),
});
export type LaneDecisionResponse = Static<typeof LaneDecisionResponseSchema>;
