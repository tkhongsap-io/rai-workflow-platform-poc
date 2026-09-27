// W3-01 contract: queue reads are scoped before search, counts, options and pagination.
import { Type, type Static } from 'typebox';
import type { Lane } from '../constants.js';
import { LaneSchema } from './review.js';
import type { CaseSummary, CaseStatus, SourceRecordId, LaneProjectionStatus } from './cases.js';
import type { LaneDue } from './sla.js';

export const QueueStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('in_review'),
  Type.Literal('sent_back'),
  Type.Literal('awaiting_disposition'),
  Type.Literal('ready_for_launch'),
]);
export const QueueSearchBySchema = Type.Union([
  Type.Literal('all'),
  Type.Literal('sourceRecordId'),
  Type.Literal('status'),
  Type.Literal('owner'),
  Type.Literal('useCaseGroup'),
]);
/**
 * W6-01 contract (W6 plan section 8.2): the dashboard drill-down filters. Each is applied inside the scoped `visible`
 * sub-select before counts and pagination (A06). W6-14 joined them to the served `QueueQuerySchema` in the PR that
 * applies them (`server/src/queue/repository.ts`), so no filter is ever accepted and ignored (a list labelled "DPO
 * breached" must never show every case). W6-16 adds `riskTier`.
 */
export const QueueDrilldownQuerySchema = Type.Object(
  {
    lane: Type.Optional(LaneSchema),
    laneStatus: Type.Optional(Type.Enum(['pending', 'approved', 'sent_back'] as const)),
    sla: Type.Optional(Type.Enum(['due_soon', 'breached'] as const)), // with `lane`, that lane; else any lane
    findingLane: Type.Optional(LaneSchema),
    findingSeverity: Type.Optional(Type.Enum(['high', 'medium', 'low'] as const)),
    findingKind: Type.Optional(Type.Enum(['defect', 'unavailable'] as const)),
  },
  { additionalProperties: false },
);
export type QueueDrilldownQuery = Static<typeof QueueDrilldownQuerySchema>;
/** The drill-down keys, in display order; the queue screen keeps them when the search form is applied. */
export const QUEUE_DRILLDOWN_KEYS = Object.freeze(
  Object.keys(QueueDrilldownQuerySchema.properties) as (keyof QueueDrilldownQuery)[],
);
export const QueueQuerySchema = Type.Object(
  {
    search: Type.Optional(Type.String({ maxLength: 200 })),
    searchBy: Type.Optional(QueueSearchBySchema),
    status: Type.Optional(QueueStatusSchema),
    owner: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    useCaseGroup: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    ...QueueDrilldownQuerySchema.properties,
  },
  { additionalProperties: false },
);
export type QueueQuery = Static<typeof QueueQuerySchema>;

export const QUEUE_DEFAULTS = Object.freeze({ page: 1, pageSize: 25, searchBy: 'all' as const });

export interface QueueLane {
  lane: Lane;
  status: LaneProjectionStatus;
  due: LaneDue;
}
export interface QueueItem extends CaseSummary {
  sourceRecordId: SourceRecordId;
  /** Descriptive name for display/search only; businessOwner remains the subject ID for exact filters. */
  ownerDisplayName: string;
  latestVersionNumber: number;
  /** Empty until first submission; otherwise the current submitted version's decisions and frozen SLA. */
  lanes: QueueLane[];
  nextAction: 'prepare_pack' | 'correct_pack' | 'review_lanes' | 'resolve_findings' | 'review_complete';
}
/** `value` is the owner subject ID the `owner` filter matches; `label` is the owner name shown on the cards. */
export interface QueueOwnerOption {
  value: string;
  label: string;
}
export interface QueueResponse {
  items: QueueItem[];
  page: number;
  pageSize: number;
  /** All matching rows before pagination, always within actor scope. */
  total: number;
  /**
   * Options are drawn from actor-visible cases before the optional search/status/owner/group filters, never global
   * configuration. Drill-down filters (W6-14) narrow the visible population first, so they apply here too.
   */
  filterOptions: { statuses: CaseStatus[]; owners: QueueOwnerOption[]; useCaseGroups: string[] };
  /** Counts apply like `filterOptions` (after drill-down, before the other optional filters); all statuses present. */
  statusCounts: Record<CaseStatus, number>;
}

// W0-10 names the W3 shapes surface; definitions live separately to keep queue consumers stable.
export * from './observability.js';
