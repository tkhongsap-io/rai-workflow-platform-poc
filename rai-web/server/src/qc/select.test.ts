// W4-02 (W4a plan section 3): `selectRules` picks the rules of the version's checklist template for one trigger and
// model type. Template isolation (v2.0 never selects the v1.0 Sheet-3 bands) and model_type routing are proven here,
// because content rules do not execute until W4b. An unknown template version is an error, never a clean pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigurationBodies } from '@rai/shared/schemas/cases';
import type { ModelType, QcTrigger } from '@rai/shared/qc/types';
import { CONFIGURATION_SEED } from '../configuration/seed.js';
import { RuleSelectionError, selectRules } from './select.js';

const SEED = CONFIGURATION_SEED.qc_rules;
const MODEL_TYPES: ModelType[] = ['llm', 'classic_ml', 'other'];
const TRIGGERS: QcTrigger[] = ['upload', 'submit', 'approve_attempt'];

const ids = (body: ConfigurationBodies['qc_rules'], template: string, trigger: QcTrigger, model: ModelType) =>
  selectRules(body, template, trigger, model).map((r) => r.ruleId);

test('selection returns the template rules for the trigger, in catalogue order, without triggers', () => {
  assert.deepEqual(ids(SEED, 'v1.0 Sheet3', 'submit', 'llm'), [
    'PACK-SLOT-MISSING',
    'PACK-STAGE-MISMATCH',
    'PACK-NA-VENDOR-DOC',
  ]);
  assert.deepEqual(ids(SEED, 'v1.0 Sheet3', 'approve_attempt', 'llm'), [
    'PACK-SLOT-MISSING',
    'ACC-METRIC-CITED',
    'ACC-EXTRACTION-NOT-HALLUCINATION',
    'ACC-BAND-V1-SHEET3',
  ]);
  assert.deepEqual(ids(SEED, 'v1.0 Sheet3', 'upload', 'llm'), ['ACC-METRIC-CITED']);
  const [stage] = selectRules(SEED, 'v1.0 Sheet3', 'submit', 'llm').filter(
    (r) => r.ruleId === 'PACK-STAGE-MISMATCH',
  );
  assert.deepEqual(stage, {
    ruleId: 'PACK-STAGE-MISMATCH',
    engine: 'metadata',
    severity: 'medium',
    params: {
      attachedForbiddenAt: { idea: [8] },
      notYetForbiddenAt: { pre_launch: [1, 2, 3, 4, 5, 6, 7, 8] },
    },
  });
  assert.ok(!('triggers' in stage));
});

test('template isolation: v2.0 never selects ACC-BAND-V1-SHEET3, whatever the trigger or model type', () => {
  for (const trigger of TRIGGERS)
    for (const model of MODEL_TYPES)
      assert.ok(!ids(SEED, 'v2.0', trigger, model).includes('ACC-BAND-V1-SHEET3'));
  assert.deepEqual(ids(SEED, 'v2.0', 'approve_attempt', 'llm'), [
    'PACK-SLOT-MISSING',
    'ACC-METRIC-CITED',
    'ACC-EXTRACTION-NOT-HALLUCINATION',
  ]);
  assert.deepEqual(ids(SEED, 'v2.0', 'submit', 'llm'), ids(SEED, 'v1.0 Sheet3', 'submit', 'llm'));
});

test('model_type routing: classic_ml gets ACC-CLASSIC-ML-METRIC and none of the LLM accuracy rules', () => {
  assert.deepEqual(ids(SEED, 'v1.0 Sheet3', 'approve_attempt', 'classic_ml'), [
    'PACK-SLOT-MISSING',
    'ACC-CLASSIC-ML-METRIC',
  ]);
  assert.deepEqual(ids(SEED, 'v2.0', 'approve_attempt', 'classic_ml'), [
    'PACK-SLOT-MISSING',
    'ACC-CLASSIC-ML-METRIC',
  ]);
  assert.deepEqual(ids(SEED, 'v1.0 Sheet3', 'upload', 'classic_ml'), []);
  for (const template of ['v1.0 Sheet3', 'v2.0'])
    for (const model of ['llm', 'other'] as const)
      for (const trigger of TRIGGERS)
        assert.ok(!ids(SEED, template, trigger, model).includes('ACC-CLASSIC-ML-METRIC'));
  // Metadata rules are not routed by model type.
  for (const model of MODEL_TYPES)
    assert.deepEqual(ids(SEED, 'v2.0', 'submit', model), [
      'PACK-SLOT-MISSING',
      'PACK-STAGE-MISMATCH',
      'PACK-NA-VENDOR-DOC',
    ]);
});

test('an unknown template version is a selection error, never an empty (clean) selection', () => {
  for (const template of ['v3.0', '', 'constructor', '__proto__', 'toString']) {
    assert.throws(
      () => selectRules(SEED, template, 'submit', 'llm'),
      (error: unknown) => error instanceof RuleSelectionError && error.detail === 'unknown_template_version',
      template,
    );
  }
});

test('a template with no rule for the trigger selects nothing (a zero-rule run, not an error)', () => {
  const body = { label: 'w4a.test', templates: { 'v2.0': { rules: [] } } };
  assert.deepEqual(selectRules(body, 'v2.0', 'submit', 'llm'), []);
});

test('selection copies: the catalogue body is never mutated through the selected rules', () => {
  const before = JSON.stringify(SEED);
  const [stage] = selectRules(SEED, 'v1.0 Sheet3', 'submit', 'llm').filter(
    (r) => r.ruleId === 'PACK-STAGE-MISMATCH',
  );
  (stage!.params as Record<string, unknown>)['attachedForbiddenAt'] = {};
  assert.equal(JSON.stringify(SEED), before);
});
