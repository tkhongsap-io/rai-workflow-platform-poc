import { Value } from 'typebox/value';
import { QUEUE_DEFAULTS, QueueQuerySchema, type QueueQuery, type QueueItem } from '@rai/shared/schemas/queue';
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
