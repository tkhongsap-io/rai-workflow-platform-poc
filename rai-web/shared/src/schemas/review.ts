// W0-02 section 7.7: W2 shapes — lane decision and send-back feedback (W2-02). Findings/dispositions arrive with
// W2-05; history/successor-draft read shapes with W2-03. Request bodies carry ExpectedVersion (W0-06 5.1) and the
// Idempotency-Key header (W0-06 5.3). Approve requires the qc_run_id the reviewer saw (W0-06 4.4); send-back
// requires feedback that names at least one artifact slot (A09).

import { Type, type Static } from 'typebox';
import { LANES, type Lane } from '../constants.js';
import { ExpectedVersionSchema } from './versions.js';
import { SlotNumberSchema } from './slots.js';

export const LaneSchema = Type.Union([
  Type.Literal(LANES[0]),
  Type.Literal(LANES[1]),
  Type.Literal(LANES[2]),
]);
export type { Lane };

/** Derived lane state on a submitted version (W0-04: no stored lane row until a decision). */
export const LANE_STATES = ['pending', 'approved', 'sent_back'] as const;
export type LaneStateName = (typeof LANE_STATES)[number];

export const LaneStateSchema = Type.Object({
  lane: LaneSchema,
  state: Type.Union([
    Type.Literal(LANE_STATES[0]),
    Type.Literal(LANE_STATES[1]),
    Type.Literal(LANE_STATES[2]),
  ]),
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

/** POST …/lanes/{lane}/approve — W0-06 4.4. */
export const ApproveLaneRequestSchema = Type.Object({
  expectedVersion: ExpectedVersionSchema,
  qcRunId: Type.String({ minLength: 1 }), // required; missing/empty → invalid_input lane_qc_not_run
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
  decision: Type.Union([Type.Literal(LANE_DECISIONS[0]), Type.Literal(LANE_DECISIONS[1])]),
  decidedAt: Type.String(),
  /** Present when this send-back created the successor draft; null when reusing an existing one or on approve. */
  successorDraftVersionId: Type.Union([Type.String(), Type.Null()]),
  caseRevision: Type.Integer({ minimum: 1 }),
});
export type LaneDecisionResponse = Static<typeof LaneDecisionResponseSchema>;
