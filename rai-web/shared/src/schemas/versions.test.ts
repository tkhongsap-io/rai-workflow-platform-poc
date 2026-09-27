// W6-01 (W6 plan section 4.3): the "configuration used" entry of a submitted version. The field is optional on
// SubmittedVersion until W6-09 serves it; W6-09 declares this schema in the route-local response schema. The schema
// lives in configuration-admin.ts because versions.ts may import cases.ts only as a type (cases.ts loads versions.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { FrozenConfigurationEntrySchema } from './configuration-admin.js';
import type { SubmittedVersion } from './versions.js';

const entry = {
  kind: 'qc_rules',
  revisionId: '11111111-2222-4333-8444-555555555555',
  revisionNumber: 1,
  label: 'w4a.1',
};

test('a frozen configuration entry names kind, revision, number and label (null outside qc_rules)', () => {
  assert.equal(Value.Check(FrozenConfigurationEntrySchema, entry), true);
  assert.equal(Value.Check(FrozenConfigurationEntrySchema, { ...entry, kind: 'sla', label: null }), true);
  for (const bad of [
    { ...entry, kind: 'lane_mapping' },
    { ...entry, revisionNumber: 0 },
    { ...entry, label: undefined },
    { ...entry, body: {} },
  ])
    assert.equal(Value.Check(FrozenConfigurationEntrySchema, bad), false, JSON.stringify(bad));
});

test('SubmittedVersion.frozenConfiguration is optional, so a pre-W6 body still type-checks', () => {
  type Field = SubmittedVersion['frozenConfiguration'];
  const absent: Field = undefined;
  const present: Field = [{ ...entry, kind: 'qc_rules' }] as Field;
  assert.equal(absent, undefined);
  assert.equal(present?.length, 1);
});
