// W3-01 contract: queue reads are scoped before search, counts, options and pagination.
import { Type, type Static } from 'typebox';
import type { Lane } from '../constants.js';
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
export const QueueQuerySchema = Type.Object(
  {
    search: Type.Optional(Type.String({ maxLength: 200 })),
    searchBy: Type.Optional(QueueSearchBySchema),
    status: Type.Optional(QueueStatusSchema),
    owner: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    useCaseGroup: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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
  /** Options are drawn from actor-visible cases before optional filters, never global configuration. */
  filterOptions: { statuses: CaseStatus[]; owners: QueueOwnerOption[]; useCaseGroups: string[] };
  /** Counts apply to actor-visible cases before optional filters; all statuses are present. */
  statusCounts: Record<CaseStatus, number>;
}

// W0-10 names the W3 shapes surface; definitions live separately to keep queue consumers stable.
export * from './observability.js';
