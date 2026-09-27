// W4-02 (W4a plan section 3): the `qc_rules` catalogue body is validated on write, like every configuration kind.
// Beyond the shared schema, a template may not list one rule ID twice and `params` are checked per rule ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
