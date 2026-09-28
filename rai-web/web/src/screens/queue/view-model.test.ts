import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQueueForm,
  drilldownLabels,
  drilldownOf,
  parseQueueQuery,
  queueParams,
  withoutDrilldown,
  NEXT_ACTION_LABELS,
} from './view-model.js';
import type { QueueItem } from '@rai/shared/schemas/queue';
import { riskTierChipOf, showsPlaceholderBanner } from '../cases/case-list.view-model.js';

test('URL values round-trip without dropping literal Thai/wildcard filters', () => {
  const query = {
    search: 'ชื่อ%_\\',
    searchBy: 'owner' as const,
    status: 'sent_back' as const,
    owner: 'synthetic:owner',
    useCaseGroup: 'g & x',
    page: 2,
    pageSize: 1,
  };
  assert.deepEqual(parseQueueQuery(queueParams(query).toString()), { valid: true, query });
  assert.deepEqual(parseQueueQuery(''), { valid: true, query: { page: 1, pageSize: 25, searchBy: 'all' } });
});
test('malformed, duplicate and unknown restrictions never widen a URL silently', () => {
  for (const q of [
    'page=0',
    'page=1.5',
    'page=-1',
    'page=NaN',
    'page=1e2',
    'page=1000001',
    'pageSize=101',
    'owner=',
    'status=ready',
    'searchBy=email',
    'allCases=true',
    'status=draft&status=in_review',
    '__proto__=x',
  ])
    assert.deepEqual(parseQueueQuery(q), { valid: false }, q);
  assert.equal(parseQueueQuery('search=' + 'x'.repeat(201)).valid, false);
});
test('pagination preserves applied restrictions and action labels use the API cue', () => {
  const parsed = parseQueueQuery('owner=x&search=abc&page=3');
  assert.ok(parsed.valid);
  const next = parseQueueQuery(queueParams({ ...parsed.query, page: 4 }).toString());
  assert.deepEqual(next, {
    valid: true,
    query: { owner: 'x', search: 'abc', page: 4, pageSize: 25, searchBy: 'all' },
  });
  assert.equal(NEXT_ACTION_LABELS.resolve_findings, 'queue.next.resolve_findings');
  assert.equal(NEXT_ACTION_LABELS.review_complete, 'queue.next.review_complete');
});

// W6-14 (W6 plan section 8.2): the dashboard drill-down filters live in the URL, so a dashboard link opens the
// filtered list, and the search form never drops them.
test('drill-down filters round-trip through the URL with the base filters', () => {
  const query = {
    search: 'x',
    searchBy: 'all' as const,
    lane: 'dpo' as const,
    laneStatus: 'pending' as const,
    sla: 'breached' as const,
    findingLane: 'it_security' as const,
    findingSeverity: 'high' as const,
    findingKind: 'unavailable' as const,
    page: 1,
    pageSize: 25,
  };
  assert.deepEqual(parseQueueQuery(queueParams(query).toString()), { valid: true, query });
  assert.deepEqual(parseQueueQuery('lane=dpo&sla=breached'), {
    valid: true,
    query: { page: 1, pageSize: 25, searchBy: 'all', lane: 'dpo', sla: 'breached' },
  });
});
test('malformed or repeated drill-down values never widen the list', () => {
  for (const q of [
    'lane=hr',
    'lane=',
    'laneStatus=ready',
    'sla=overdue',
    'findingSeverity=info',
    'findingKind=advisory',
    'riskTier=high',
    'lane=dpo&lane=ai_coe',
    'sla=breached&sla=due_soon',
  ])
    assert.deepEqual(parseQueueQuery(q), { valid: false }, q);
});
test('applying the form keeps the drill-down; clearing it keeps the base filters', () => {
  const parsed = parseQueueQuery('lane=dpo&laneStatus=pending&findingKind=defect&owner=x&page=3');
  assert.ok(parsed.valid);
  assert.deepEqual(drilldownOf(parsed.query), { lane: 'dpo', laneStatus: 'pending', findingKind: 'defect' });
  assert.deepEqual(
    applyQueueForm(parsed.query, {
      search: 'abc',
      searchBy: 'all',
      status: 'in_review',
      page: 1,
      pageSize: 10,
    }),
    {
      lane: 'dpo',
      laneStatus: 'pending',
      findingKind: 'defect',
      search: 'abc',
      searchBy: 'all',
      status: 'in_review',
      page: 1,
      pageSize: 10,
    },
  );
  assert.deepEqual(withoutDrilldown(parsed.query), {
    owner: 'x',
    page: 1,
    pageSize: 25,
    searchBy: 'all',
  });
  assert.deepEqual(drilldownOf({ page: 1 }), {});
});
test('each drill-down key has a th/en label, in the fixed key order', () => {
  const parsed = parseQueueQuery(
    'findingKind=unavailable&findingSeverity=low&findingLane=ai_coe&sla=due_soon&laneStatus=sent_back&lane=dpo',
  );
  assert.ok(parsed.valid);
  assert.deepEqual(drilldownLabels(parsed.query), [
    { key: 'lane', label: 'queue.drill.lane', params: { lane: 'lane.dpo' } },
    { key: 'laneStatus', label: 'queue.drill.lane_status', params: { state: 'projection.sent_back' } },
    { key: 'sla', label: 'queue.drill.sla.due_soon', params: { days: 2 } },
    { key: 'findingLane', label: 'queue.drill.finding_lane', params: { lane: 'lane.ai_coe' } },
    {
      key: 'findingSeverity',
      label: 'queue.drill.finding_severity',
      params: { severity: 'finding.severity.low' },
    },
    { key: 'findingKind', label: 'queue.drill.finding_kind.unavailable', params: {} },
  ]);
  assert.deepEqual(drilldownLabels({ page: 1 }), []);
  assert.deepEqual(drilldownLabels({ sla: 'breached' })[0]!.label, 'queue.drill.sla.breached');
});

// W5-09: a queue card reads the same chip; a substitute item without the key shows none (W5 plan section 6).
test('queue items: the tier chip reads riskTier, and an item without the key shows no chip and no banner', () => {
  const item: QueueItem = {
    caseId: 'c1',
    registryId: 'RAI-2000-0001',
    useCaseName: 'x',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    businessOwner: 'fixture:o',
    ownerDisplayName: 'O',
    useCaseGroup: 'g',
    status: 'in_review',
    currentVersionNumber: 1,
    latestVersionNumber: 1,
    sourceRecordId: { kind: 'unknown' },
    lanes: [],
    nextAction: 'review_lanes',
    updatedAt: '2026-09-21T00:00:00.000Z',
  };
  assert.equal(riskTierChipOf(item.riskTier), null);
  assert.equal(showsPlaceholderBanner([item]), false);
  const high: QueueItem = { ...item, riskTier: 'high' };
  assert.equal(riskTierChipOf(high.riskTier)?.labelKey, 'risk.tier.high');
  assert.equal(showsPlaceholderBanner([item, high]), true);
});
