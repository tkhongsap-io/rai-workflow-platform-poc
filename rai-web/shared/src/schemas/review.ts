// W0-02 section 7.7: W2 shapes — lane decision and send-back feedback (W2-02). Findings/dispositions arrive with
// W2-05; history/successor-draft read shapes with W2-03. Request bodies carry ExpectedVersion (W0-06 5.1) and the
// Idempotency-Key header (W0-06 5.3). Approve requires the qc_run_id the reviewer saw (W0-06 4.4); send-back
// requires feedback that names at least one artifact slot (A09).

import { Type, type Static } from 'typebox';
import type { Lane } from '../constants.js';
import { ExpectedVersionSchema } from './versions.js';
import { SlotNumberSchema } from './slots.js';
import { QC_ENGINE_LABEL_PATTERN, QC_UNAVAILABLE_DETAIL_PATTERN } from '../qc/types.js';

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
  decidedByDisplayName: Type.Optional(Type.String()), // display only (W3-F1)
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

/**
 * W4-12: where a finding's evidence points (W0-07 3.3 `EvidenceLocator`). References only: the runner never returns
 * an excerpt, and the read shapes never carry `excerptHash` or `contentHash`.
 */
export const EvidenceLocatorSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('page'),
    page: Type.Number(),
    region: Type.Optional(
      Type.Object({ x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() }),
    ),
  }),
  Type.Object({ kind: Type.Literal('text_range'), start: Type.Number(), end: Type.Number() }),
  Type.Object({ kind: Type.Literal('cell'), sheet: Type.String(), cell: Type.String() }),
  Type.Object({ kind: Type.Literal('section'), heading: Type.String() }),
  Type.Object({ kind: Type.Literal('absent') }),
]);
export type EvidenceLocatorView = Static<typeof EvidenceLocatorSchema>;
export const EVIDENCE_LOCATOR_KINDS = ['page', 'text_range', 'cell', 'section', 'absent'] as const;
export type EvidenceLocatorKind = (typeof EVIDENCE_LOCATOR_KINDS)[number];

const FindingSlotSchema = Type.Union([
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
]);

/** W4-12: one evidence entry of a stored finding as the read shapes serve it (locators only). */
export const FindingEvidenceSchema = Type.Object({
  slot: FindingSlotSchema,
  artifactId: Type.Union([Type.String(), Type.Null()]),
  locator: EvidenceLocatorSchema,
});
export type FindingEvidence = Static<typeof FindingEvidenceSchema>;

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
  /**
   * W4-12: where the evidence points. The real server always serves it; optional so the in-memory API substitute,
   * which W4a does not extend (W4a plan section 11), still validates.
   */
  evidence: Type.Optional(Type.Array(FindingEvidenceSchema)),
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
  evidence: Type.Optional(Type.Array(FindingEvidenceSchema)), // W4-12; see StoredFindingSummary
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

export const QC_UNAVAILABLE_REASONS = [
  'timeout',
  'runner_error',
  'not_configured',
  'artifact_unreadable',
] as const;
export type QcUnavailableReasonName = (typeof QC_UNAVAILABLE_REASONS)[number];

/**
 * W4-12: one QC run of a version as GET …/versions/{versionId}/qc-runs serves it (W4a plan section 7). `runner` is
 * `qc_run.engine_id`; `ruleRevision` the recorded revision ID; `rulesLabel` the `label` of the `qc_rules` revision
 * with that ID (null when it names none); `rulesEvaluated` is null on rows written before migration 0009. W4-11b
 * (W4b plan section 9): `extractorVersion`, `model` and `modelUsage` are what the run recorded (null without
 * extraction or model use, and on rows written before migration 0014); `unavailableDetail` is the stored detail of an
 * unavailable run (a bounded code or `unspecified`; null when none). The model cost is not served. The identity
 * labels use the `QcEngineIdentitySchema` label bound and the detail the qc_run CHECK pattern (review round 1).
 */
const QC_RUN_ENGINE_LABEL = Type.String({ pattern: QC_ENGINE_LABEL_PATTERN });
const QC_RUN_UNAVAILABLE_DETAIL = Type.String({ pattern: QC_UNAVAILABLE_DETAIL_PATTERN });

export const QcRunSummarySchema = Type.Object({
  runId: Type.String(),
  trigger: Type.Union([Type.Literal('upload'), Type.Literal('submit'), Type.Literal('approve_attempt')]),
  lane: Type.Union([LaneSchema, Type.Null()]),
  slot: FindingSlotSchema,
  status: Type.Union([Type.Literal('completed'), Type.Literal('unavailable')]),
  unavailableReason: Type.Union([
    Type.Literal('timeout'),
    Type.Literal('runner_error'),
    Type.Literal('not_configured'),
    Type.Literal('artifact_unreadable'),
    Type.Null(),
  ]),
  runner: Type.String(),
  runnerVersion: Type.String(),
  ruleRevision: Type.String(),
  rulesLabel: Type.Union([Type.String(), Type.Null()]),
  rulesEvaluated: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  findingCount: Type.Integer({ minimum: 0 }),
  requestedAt: Type.String(),
  completedAt: Type.String(),
  extractorVersion: Type.Union([QC_RUN_ENGINE_LABEL, Type.Null()]),
  model: Type.Union([
    Type.Object({
      provider: QC_RUN_ENGINE_LABEL,
      modelId: QC_RUN_ENGINE_LABEL,
      promptRevision: QC_RUN_ENGINE_LABEL,
    }),
    Type.Null(),
  ]),
  modelUsage: Type.Union([
    Type.Object({
      inputTokens: Type.Integer({ minimum: 0 }),
      outputTokens: Type.Integer({ minimum: 0 }),
      latencyMs: Type.Integer({ minimum: 0 }),
    }),
    Type.Null(),
  ]),
  unavailableDetail: Type.Union([QC_RUN_UNAVAILABLE_DETAIL, Type.Null()]),
});
export type QcRunSummary = Static<typeof QcRunSummarySchema>;

export const VersionQcRunsResponseSchema = Type.Object({
  runs: Type.Array(QcRunSummarySchema),
});
export type VersionQcRunsResponse = Static<typeof VersionQcRunsResponseSchema>;
