// W6-03 (W6 plan section 2.4): the implemented-rule registry lives in @rai/shared (shared cannot import server code),
// so this test ties it to what the server really runs: its `metadata` entries are exactly METADATA_RULES, with the
// triggers each rule is defined for. A catalogue entry the registry does not know is refused on an Admin publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPLEMENTED_RULES } from '@rai/shared/qc/rule-registry';
import { CONFIGURATION_SEED } from '../configuration/seed.js';
import { METADATA_RULES } from './deterministic/rules/index.js';

const entries = Object.entries(IMPLEMENTED_RULES);

test("the registry's metadata entries equal METADATA_RULES, rule for rule and trigger for trigger", () => {
  const metadata = entries.filter(([, rule]) => rule.engine === 'metadata');
  assert.deepEqual(metadata.map(([id]) => id).sort(), Object.keys(METADATA_RULES).sort());
  for (const [id, rule] of metadata)
    assert.deepEqual([...rule.triggers].sort(), [...METADATA_RULES[id]!.triggers].sort(), id);
});

test('the four catalogued ACC-* rules are listed as content rules until W4b implements them', () => {
  const content = entries.filter(([, rule]) => rule.engine === 'content').map(([id]) => id);
  for (const id of [
    'ACC-METRIC-CITED',
    'ACC-EXTRACTION-NOT-HALLUCINATION',
    'ACC-BAND-V1-SHEET3',
    'ACC-CLASSIC-ML-METRIC',
  ])
    assert.ok(content.includes(id), `${id} is a content rule`);
});

test('ACC-BAND-V1-SHEET3 is isolated to the v1.0 Sheet-3 template (L12); no other rule is restricted', () => {
  assert.deepEqual(IMPLEMENTED_RULES['ACC-BAND-V1-SHEET3']?.templates, ['v1.0 Sheet3']);
  for (const [id, rule] of entries)
    if (id !== 'ACC-BAND-V1-SHEET3') assert.equal(rule.templates, undefined, id);
});

test('every rule of the seeded catalogue is registered, with its engine and triggers', () => {
  for (const [template, { rules }] of Object.entries(CONFIGURATION_SEED.qc_rules.templates))
    for (const rule of rules) {
      const known = IMPLEMENTED_RULES[rule.ruleId];
      assert.ok(known, `${template}: ${rule.ruleId} is registered`);
      assert.equal(known.engine, rule.engine, rule.ruleId);
      for (const trigger of rule.triggers) assert.ok(known.triggers.includes(trigger), rule.ruleId);
    }
});

test('the registry is frozen and names no orchestrator-only rule', () => {
  assert.ok(Object.isFrozen(IMPLEMENTED_RULES));
  assert.equal(Object.hasOwn(IMPLEMENTED_RULES, 'QC-UNAVAILABLE'), false);
});
