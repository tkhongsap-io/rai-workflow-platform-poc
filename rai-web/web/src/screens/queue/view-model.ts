import { Value } from 'typebox/value';
import { DASHBOARD_DUE_SOON_WORKING_DAYS } from '@rai/shared/constants';
import {
  QUEUE_DEFAULTS,
  QUEUE_DRILLDOWN_KEYS,
  QueueQuerySchema,
  type QueueDrilldownQuery,
  type QueueQuery,
  type QueueItem,
} from '@rai/shared/schemas/queue';
import type { LocaleKey } from '@rai/shared/locales/keys';

export type ParsedQueueQuery = { valid: true; query: QueueQuery } | { valid: false };
/** Reject malformed URLs rather than dropping a restrictive filter and silently widening the query. */
export function parseQueueQuery(search: string): ParsedQueueQuery {
  const params = new URLSearchParams(search);
  const values = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of params) {
    if (Object.hasOwn(values, key)) return { valid: false };
    if (key === 'page' || key === 'pageSize') {
      if (!/^\d+$/.test(value)) return { valid: false };
      values[key] = Number(value);
    } else values[key] = value;
  }
  if (!Value.Check(QueueQuerySchema, values)) return { valid: false };
  return { valid: true, query: { ...QUEUE_DEFAULTS, ...values } };
}

export function queueParams(query: QueueQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params;
}

export const SEARCH_LABELS: Readonly<Record<NonNullable<QueueQuery['searchBy']>, LocaleKey>> = {
  all: 'queue.all_fields',
  sourceRecordId: 'case.field.source_record_id',
  status: 'queue.status',
  owner: 'cases.owner',
  useCaseGroup: 'cases.use_case_group',
};
export const NEXT_ACTION_LABELS: Readonly<Record<QueueItem['nextAction'], LocaleKey>> = {
  prepare_pack: 'queue.next.prepare_pack',
  correct_pack: 'queue.next.correct_pack',
  review_lanes: 'queue.next.review_lanes',
  resolve_findings: 'queue.next.resolve_findings',
  review_complete: 'queue.next.review_complete',
};

/** W6-14: the dashboard drill-down keys present in a query (W6 plan section 8.2). */
export function drilldownOf(query: QueueQuery): QueueDrilldownQuery {
  const drill: Record<string, unknown> = {};
  for (const key of QUEUE_DRILLDOWN_KEYS) if (query[key] !== undefined) drill[key] = query[key];
  return drill;
}

/** The query without its drill-down; the population changes, so the list starts again at page 1. */
export function withoutDrilldown(query: QueueQuery): QueueQuery {
  const rest: Record<string, unknown> = { ...query, page: 1 };
  for (const key of QUEUE_DRILLDOWN_KEYS) delete rest[key];
  return rest;
}

/** The search form edits only the base filters; applying it keeps the drill-down the dashboard link opened. */
export function applyQueueForm(current: QueueQuery, form: QueueQuery): QueueQuery {
  return { ...drilldownOf(current), ...withoutDrilldown(form), page: form.page ?? 1 };
}

export interface DrilldownLabel {
  key: keyof QueueDrilldownQuery;
  label: LocaleKey;
  /** A string value is itself a locale key, rendered before substitution; a number is substituted as is. */
  params: Record<string, LocaleKey | number>;
}

/** One label per drill-down key present, in `QUEUE_DRILLDOWN_KEYS` order (th and en keys, D12). */
export function drilldownLabels(query: QueueQuery): DrilldownLabel[] {
  const labels: DrilldownLabel[] = [];
  for (const key of QUEUE_DRILLDOWN_KEYS) {
    switch (key) {
      case 'lane':
        if (query.lane !== undefined)
          labels.push({ key, label: 'queue.drill.lane', params: { lane: `lane.${query.lane}` } });
        break;
      case 'laneStatus':
        if (query.laneStatus !== undefined)
          labels.push({
            key,
            label: 'queue.drill.lane_status',
            params: { state: `projection.${query.laneStatus}` },
          });
        break;
      case 'sla':
        if (query.sla !== undefined)
          labels.push({
            key,
            label: `queue.drill.sla.${query.sla}`,
            params: query.sla === 'due_soon' ? { days: DASHBOARD_DUE_SOON_WORKING_DAYS } : {},
          });
        break;
      case 'findingLane':
        if (query.findingLane !== undefined)
          labels.push({
            key,
            label: 'queue.drill.finding_lane',
            params: { lane: `lane.${query.findingLane}` },
          });
        break;
      case 'findingSeverity':
        if (query.findingSeverity !== undefined)
          labels.push({
            key,
            label: 'queue.drill.finding_severity',
            params: { severity: `finding.severity.${query.findingSeverity}` },
          });
        break;
      case 'findingKind':
        if (query.findingKind !== undefined)
          labels.push({ key, label: `queue.drill.finding_kind.${query.findingKind}`, params: {} });
        break;
    }
  }
  return labels;
}
