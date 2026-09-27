// W4-02 (W4a plan section 3): the `qc_rules` catalogue body is validated on write, like every configuration kind.
// Beyond the shared schema, a template may not list one rule ID twice and `params` are checked per rule ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACC_METRIC_CITED_PARAMS } from './seed.js';
import { ConfigurationBodyInvalid, validateConfigurationBody } from './store.js';

const stageParams = { attachedForbiddenAt: { idea: [8] }, notYetForbiddenAt: { pre_launch: [1, 2, 3] } };

function body(rules: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { label: 'w4a.test', templates: { 'v1.0 Sheet3': { rules } }, ...extra };
}

const slotMissing = {
  ruleId: 'PACK-SLOT-MISSING',
  engine: 'metadata',
  triggers: ['submit', 'approve_attempt'],
  severity: 'medium',
};

function refused(value: unknown, pattern: RegExp): void {
  assert.throws(
    () => validateConfigurationBody('qc_rules', value),
    (error: unknown) => error instanceof ConfigurationBodyInvalid && pattern.test(error.message),
  );
}

test('a catalogue body with a label and rules per template version validates', () => {
  assert.doesNotThrow(() =>
    validateConfigurationBody(
      'qc_rules',
      body([
        slotMissing,
        {
          ruleId: 'PACK-STAGE-MISMATCH',
          engine: 'metadata',
          triggers: ['submit'],
          severity: 'medium',
          params: stageParams,
        },
        {
          ruleId: 'ACC-METRIC-CITED',
          engine: 'content',
          triggers: ['approve_attempt', 'upload'],
          severity: 'low',
          // W4-06a: the rule's params schema is registered, so its entry carries params (plan section 3.3).
          params: ACC_METRIC_CITED_PARAMS,
        },
      ]),
    ),
  );
  // An empty rule list is a real (zero-rule) template, not a missing one.
  assert.doesNotThrow(() => validateConfigurationBody('qc_rules', body([])));
});

test('the slice-1 placeholder shape and unknown keys are refused', () => {
  refused({ rulesRevision: 'w1' }, /label|templates/);
  refused(body([slotMissing], { extra: true }), /extra|additional/i);
  refused(body([{ ...slotMissing, note: 'x' }]), /note|additional/i);
  refused({ label: '', templates: {} }, /label/);
});

test('each rule entry is typed: rule ID pattern, engine, triggers, severity', () => {
  refused(body([{ ...slotMissing, ruleId: 'pack-slot-missing' }]), /ruleId/);
  refused(body([{ ...slotMissing, ruleId: 'QC-UNAVAILABLE' }]), /QC-UNAVAILABLE/);
  refused(body([{ ...slotMissing, engine: 'model' }]), /engine/);
  refused(body([{ ...slotMissing, triggers: [] }]), /triggers/);
  refused(body([{ ...slotMissing, triggers: ['submit', 'submit'] }]), /triggers/);
  refused(body([{ ...slotMissing, triggers: ['send_back'] }]), /triggers/);
  refused(body([{ ...slotMissing, severity: 'critical' }]), /severity/);
});

test('a template may not list one rule ID twice', () => {
  refused(body([slotMissing, { ...slotMissing, triggers: ['submit'] }]), /PACK-SLOT-MISSING.*twice/);
});

test('params are checked per rule ID; a rule without a params schema carries none', () => {
  const stage = {
    ruleId: 'PACK-STAGE-MISMATCH',
    engine: 'metadata',
    triggers: ['submit'],
    severity: 'medium',
  };
  refused(body([stage]), /PACK-STAGE-MISMATCH.*params/);
  refused(
    body([{ ...stage, params: { attachedForbiddenAt: { idea: [8] } } }]),
    /PACK-STAGE-MISMATCH.*params/,
  );
  refused(
    body([{ ...stage, params: { ...stageParams, notYetForbiddenAt: { pre_launch: [10] } } }]),
    /PACK-STAGE-MISMATCH.*params/,
  );
  refused(
    body([{ ...stage, params: { ...stageParams, attachedForbiddenAt: { launched: [8] } } }]),
    /PACK-STAGE-MISMATCH.*params/,
  );
  refused(body([{ ...slotMissing, params: { slots: [1] } }]), /PACK-SLOT-MISSING.*params/);
});

test('W4-06a: ACC-METRIC-CITED params are required and schema-checked (slots, bilingual labels, items, metrics, source)', () => {
  const cited = {
    ruleId: 'ACC-METRIC-CITED',
    engine: 'content',
    triggers: ['approve_attempt', 'upload'],
    severity: 'medium',
  };
  const valid = structuredClone(ACC_METRIC_CITED_PARAMS) as unknown as Record<string, unknown>;
  assert.doesNotThrow(() => validateConfigurationBody('qc_rules', body([{ ...cited, params: valid }])));
  assert.doesNotThrow(() =>
    validateConfigurationBody(
      'qc_rules',
      body([{ ...cited, params: { ...valid, claimSource: 'grammar+model' } }]),
    ),
  );
  refused(body([cited]), /ACC-METRIC-CITED.*params/);
  const broken = (patch: (p: Record<string, unknown>) => void) => {
    const params = structuredClone(valid);
    patch(params);
    return body([{ ...cited, params }]);
  };
  const labels = (p: Record<string, unknown>) => p['labels'] as Record<string, Record<string, unknown>>;
  for (const [name, patch] of [
    ['slot 9 (no content rule reads slot 9)', (p) => (p['slots'] = [1, 9])],
    ['no slot', (p) => (p['slots'] = [])],
    ['a repeated slot', (p) => (p['slots'] = [1, 1])],
    ['an unknown claim source', (p) => (p['claimSource'] = 'model')],
    ['a metric that is not a key', (p) => (p['acceptedMetrics'] = ['Hallucination rate'])],
    ['no accepted metric', (p) => (p['acceptedMetrics'] = [])],
    ['a missing column key', (p) => delete labels(p)['keys']!['denominator']],
    ['an unknown column key', (p) => (labels(p)['keys']!['comment'] = { en: ['comment'], th: ['หมายเหตุ'] })],
    ['a label list without Thai', (p) => (labels(p)['keys']!['answer'] = { en: ['answer'] })],
    ['an empty label', (p) => (labels(p)['answers']!['yes'] = { en: [''], th: ['ใช่'] })],
    ['a missing answer word list', (p) => delete labels(p)['answers']!['na']],
    ['a missing item', (p) => delete (p['items'] as Record<string, unknown>)['accuracy']],
    ['an unknown key', (p) => (p['note'] = 'x')],
  ] as Array<[string, (p: Record<string, unknown>) => void]>)
    assert.throws(
      () => validateConfigurationBody('qc_rules', broken(patch)),
      (error: unknown) =>
        error instanceof ConfigurationBodyInvalid && /ACC-METRIC-CITED.*params/.test(error.message),
      name,
    );
});
