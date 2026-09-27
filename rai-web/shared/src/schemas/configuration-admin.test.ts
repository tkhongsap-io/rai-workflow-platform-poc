// W6-01 (W6 plan section 4.2): the Admin configuration API shapes, before any route exists (W6-04 serves them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { CONFIGURATION_KINDS } from './cases.js';
import {
  CHANGE_NOTE_MAX_LENGTH,
  CONFIGURATION_DRAFT_MAX_BYTES,
  CONFIGURATION_REVISION_LIST_DEFAULTS,
  CONFIGURATION_VALUES_OWNER,
  CONFIGURATION_VALUES_OWNERS,
  ConfigurationDraftDetailSchema,
  ConfigurationDraftResponseSchema,
  ConfigurationIndexResponseSchema,
  ConfigurationKindParamsSchema,
  ConfigurationRevisionDetailSchema,
  ConfigurationRevisionListQuerySchema,
  ConfigurationRevisionListResponseSchema,
  ConfigurationRevisionParamsSchema,
  ConfigurationRevisionSummarySchema,
  DiscardConfigurationDraftRequestSchema,
  PublishConfigurationDraftRequestSchema,
  RestoreConfigurationRevisionRequestSchema,
  SaveConfigurationDraftRequestSchema,
  type ConfigurationRevisionSummary,
  type ConfigurationDraftDetail,
} from './configuration-admin.js';

const revisionId = '11111111-2222-4333-8444-555555555555';
const summary: ConfigurationRevisionSummary = {
  revisionId,
  kind: 'sla',
  revisionNumber: 2,
  publishedAt: '2026-09-27T03:00:00.000Z',
  publishedBy: 'fixture:admin',
  publishedByDisplayName: 'Synthetic Admin',
  changeNote: 'DPO SLA to 4 working days (synthetic)',
  restoresRevisionNumber: null,
  inForce: true,
  frozenOnVersionCount: 0,
};
const draft: ConfigurationDraftDetail = {
  kind: 'sla',
  baseRevisionId: revisionId,
  draftVersion: 1,
  updatedBy: 'fixture:admin',
  updatedAt: '2026-09-27T03:05:00.000Z',
  changeNote: null,
  problemCount: 1,
  body: { dpo: 0, ai_coe: 5, it_security: 5 },
  problems: [{ path: '/dpo', messageKey: 'validation.configuration.out_of_range', params: { min: 1 } }],
};

test('limits and defaults are the plan values', () => {
  assert.equal(CHANGE_NOTE_MAX_LENGTH, 500);
  assert.equal(CONFIGURATION_DRAFT_MAX_BYTES, 64 * 1024);
  assert.deepEqual(CONFIGURATION_REVISION_LIST_DEFAULTS, { page: 1, pageSize: 25 });
});

test('every configuration kind names who owns its values; D07, D09 and D10 values stay provisional', () => {
  assert.deepEqual([...CONFIGURATION_VALUES_OWNERS], ['admin', 'D07', 'D09', 'D10']);
  assert.deepEqual(Object.keys(CONFIGURATION_VALUES_OWNER).sort(), [...CONFIGURATION_KINDS].sort());
  assert.equal(CONFIGURATION_VALUES_OWNER.risk_rubric, 'D07');
  assert.equal(CONFIGURATION_VALUES_OWNER.group_role_mapping, 'D10');
  for (const kind of [
    'checklist_templates',
    'qc_rules',
    'sla',
    'calendar',
    'operator_recipients',
    'use_case_groups',
  ] as const)
    assert.equal(CONFIGURATION_VALUES_OWNER[kind], 'admin', kind);
  assert.ok(Object.isFrozen(CONFIGURATION_VALUES_OWNER));
});

test('revision summary and detail: every plan field, nullable note and restore, no extra field', () => {
  assert.equal(Value.Check(ConfigurationRevisionSummarySchema, summary), true);
  const { publishedByDisplayName: _name, ...withoutName } = summary;
  assert.equal(Value.Check(ConfigurationRevisionSummarySchema, withoutName), true);
  assert.equal(
    Value.Check(ConfigurationRevisionSummarySchema, { ...withoutName, revisionNumber: 1, changeNote: null }),
    true,
    'a seed row has no change note',
  );
  assert.equal(
    Value.Check(ConfigurationRevisionSummarySchema, { ...summary, restoresRevisionNumber: 1 }),
    true,
  );
  for (const bad of [
    { ...summary, kind: 'lane_mapping' }, // D02: never configuration
    { ...summary, revisionNumber: 0 },
    { ...summary, frozenOnVersionCount: -1 },
    { ...summary, changeNote: '' },
    { ...summary, changeNote: 'x'.repeat(501) },
    { ...summary, inForce: 'yes' },
    { ...summary, extra: true },
  ])
    assert.equal(Value.Check(ConfigurationRevisionSummarySchema, bad), false, JSON.stringify(bad));
  assert.equal(Value.Check(ConfigurationRevisionDetailSchema, { ...summary, body: { dpo: 3 } }), true);
  assert.equal(Value.Check(ConfigurationRevisionDetailSchema, summary), false, 'detail carries the body');
});

test('draft detail lists problems as field errors; the draft response may be null', () => {
  assert.equal(Value.Check(ConfigurationDraftDetailSchema, draft), true);
  assert.equal(Value.Check(ConfigurationDraftResponseSchema, { draft }), true);
  assert.equal(Value.Check(ConfigurationDraftResponseSchema, { draft: null }), true);
  assert.equal(Value.Check(ConfigurationDraftDetailSchema, { ...draft, draftVersion: 0 }), false);
  assert.equal(
    Value.Check(ConfigurationDraftDetailSchema, { ...draft, problems: [{ path: '/dpo' }] }),
    false,
  );
  assert.equal(Value.Check(ConfigurationDraftDetailSchema, { ...draft, baseRevisionId: null }), true);
});

test('index lists each kind with editable, valuesOwner, current and draft', () => {
  const { body: _body, problems: _problems, ...draftSummary } = draft;
  const index = {
    kinds: [
      { kind: 'sla', editable: true, valuesOwner: 'admin', current: summary, draft: draftSummary },
      { kind: 'group_role_mapping', editable: false, valuesOwner: 'D10', current: null, draft: null },
    ],
  };
  assert.equal(Value.Check(ConfigurationIndexResponseSchema, index), true);
  assert.equal(
    Value.Check(ConfigurationIndexResponseSchema, {
      kinds: [{ ...index.kinds[0], valuesOwner: 'ta' }],
    }),
    false,
  );
  assert.equal(Value.Check(ConfigurationRevisionListResponseSchema, { items: [summary], total: 1 }), true);
  assert.equal(Value.Check(ConfigurationRevisionListResponseSchema, { items: [], total: -1 }), false);
});

test('paths are plain strings so an unknown kind or malformed id is answered 404, never a validation 422', () => {
  assert.equal(Value.Check(ConfigurationKindParamsSchema, { kind: 'no_such_kind' }), true);
  assert.equal(
    Value.Check(ConfigurationRevisionParamsSchema, { kind: 'sla', revisionId: 'not-a-uuid' }),
    true,
  );
  assert.equal(Value.Check(ConfigurationRevisionListQuerySchema, {}), true);
  assert.equal(Value.Check(ConfigurationRevisionListQuerySchema, { page: 2, pageSize: 100 }), true);
  for (const bad of [{ page: 0 }, { pageSize: 101 }, { page: 1.5 }, { sort: 'asc' }])
    assert.equal(Value.Check(ConfigurationRevisionListQuerySchema, bad), false, JSON.stringify(bad));
});

test('save draft: optimistic fields, an object body, an optional bounded note', () => {
  const first = {
    baseRevisionId: revisionId,
    expectedDraftVersion: null,
    body: { dpo: 4, ai_coe: 5, it_security: 5 },
  };
  assert.equal(Value.Check(SaveConfigurationDraftRequestSchema, first), true);
  assert.equal(
    Value.Check(SaveConfigurationDraftRequestSchema, {
      ...first,
      expectedDraftVersion: 2,
      changeNote: 'note',
    }),
    true,
  );
  assert.equal(
    Value.Check(SaveConfigurationDraftRequestSchema, { ...first, baseRevisionId: null, body: {} }),
    true,
    'a half-finished body is saved (Q18); only publish refuses',
  );
  for (const bad of [
    { ...first, body: [1, 2] },
    { ...first, body: 'text' },
    { ...first, body: null },
    { ...first, expectedDraftVersion: 0 },
    { ...first, changeNote: '' },
    { ...first, changeNote: 'x'.repeat(501) },
    { body: first.body, expectedDraftVersion: null },
    { ...first, extra: 1 },
  ])
    assert.equal(Value.Check(SaveConfigurationDraftRequestSchema, bad), false, JSON.stringify(bad));
});

test('discard, publish and restore carry the optimistic checks; restore needs a change note', () => {
  assert.equal(Value.Check(DiscardConfigurationDraftRequestSchema, { expectedDraftVersion: 3 }), true);
  assert.equal(Value.Check(DiscardConfigurationDraftRequestSchema, {}), false);
  const publish = { expectedDraftVersion: 1, expectedCurrentRevisionId: revisionId };
  assert.equal(Value.Check(PublishConfigurationDraftRequestSchema, publish), true);
  assert.equal(
    Value.Check(PublishConfigurationDraftRequestSchema, { ...publish, expectedCurrentRevisionId: null }),
    true,
    'first publish of an unseeded kind',
  );
  assert.equal(
    Value.Check(PublishConfigurationDraftRequestSchema, { ...publish, changeNote: 'publish note' }),
    true,
  );
  assert.equal(Value.Check(PublishConfigurationDraftRequestSchema, { expectedDraftVersion: 1 }), false);
  assert.equal(Value.Check(PublishConfigurationDraftRequestSchema, { ...publish, changeNote: '' }), false);
  const restore = { expectedCurrentRevisionId: revisionId, changeNote: 'restore revision 1 (synthetic)' };
  assert.equal(Value.Check(RestoreConfigurationRevisionRequestSchema, restore), true);
  assert.equal(
    Value.Check(RestoreConfigurationRevisionRequestSchema, { expectedCurrentRevisionId: revisionId }),
    false,
  );
  assert.equal(Value.Check(RestoreConfigurationRevisionRequestSchema, { ...restore, changeNote: '' }), false);
});
