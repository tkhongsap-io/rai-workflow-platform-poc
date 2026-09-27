import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_SEED, SEED_KINDS } from './seed.js';
import { ConfigurationBodyInvalid, validateConfigurationBody } from './store.js';

test('the seed holds the ticket-named kinds with the recorded values (D01, D06, D11, W0-08)', () => {
  assert.deepEqual([...SEED_KINDS].sort(), [
    'calendar',
    'checklist_templates',
    'operator_recipients',
    'qc_rules',
    'sla',
    'use_case_groups',
  ]);
  assert.deepEqual(CONFIGURATION_SEED.sla, { dpo: 3, ai_coe: 5, it_security: 5 });
  assert.equal(CONFIGURATION_SEED.calendar.timezone, 'Asia/Bangkok');
  assert.deepEqual(CONFIGURATION_SEED.operator_recipients.addresses, ['operator-digest@rai-desk.example']);
  assert.deepEqual(CONFIGURATION_SEED.checklist_templates.versions, ['v1.0 Sheet3', 'v2.0']);
  assert.deepEqual(CONFIGURATION_SEED.use_case_groups.groups, [
    'customer-analytics',
    'customer-service',
    'field-operations',
  ]);
  assert.ok(
    !('lane_mapping' in CONFIGURATION_SEED),
    'the lane mapping is a versioned constant, never configuration (D02)',
  );
});

test('qc_rules revision 1 (w4a.1) catalogues both template versions; v2.0 has no v1.0 Sheet-3 bands (W4-02)', () => {
  const qc = CONFIGURATION_SEED.qc_rules;
  assert.equal(qc.label, 'w4a.1');
  assert.deepEqual(
    Object.keys(qc.templates).sort(),
    [...CONFIGURATION_SEED.checklist_templates.versions].sort(),
  );
  const rows = (template: string) =>
    qc.templates[template]!.rules.map((r) => [r.ruleId, r.engine, r.triggers.join('+'), r.severity]);
  assert.deepEqual(rows('v1.0 Sheet3'), [
    ['PACK-SLOT-MISSING', 'metadata', 'submit+approve_attempt', 'medium'],
    ['PACK-STAGE-MISMATCH', 'metadata', 'submit', 'medium'],
    ['PACK-NA-VENDOR-DOC', 'metadata', 'submit', 'medium'],
    ['ACC-METRIC-CITED', 'content', 'approve_attempt+upload', 'medium'],
    ['ACC-EXTRACTION-NOT-HALLUCINATION', 'content', 'approve_attempt', 'high'],
    ['ACC-BAND-V1-SHEET3', 'content', 'approve_attempt', 'high'],
    ['ACC-CLASSIC-ML-METRIC', 'content', 'approve_attempt', 'medium'],
  ]);
  assert.deepEqual(
    rows('v2.0'),
    rows('v1.0 Sheet3').filter(([ruleId]) => ruleId !== 'ACC-BAND-V1-SHEET3'),
  );
  // No W4a metadata rule has the upload trigger (plan section 5).
  for (const template of Object.values(qc.templates))
    for (const rule of template.rules)
      if (rule.engine === 'metadata') assert.ok(!rule.triggers.includes('upload'), rule.ruleId);
  const stage = qc.templates['v2.0']!.rules.find((r) => r.ruleId === 'PACK-STAGE-MISMATCH');
  assert.deepEqual(stage?.params, {
    attachedForbiddenAt: { idea: [8] },
    notYetForbiddenAt: { pre_launch: [1, 2, 3, 4, 5, 6, 7, 8] },
  });
});

test('every seed body validates against its shared schema', () => {
  for (const kind of SEED_KINDS)
    assert.doesNotThrow(() => validateConfigurationBody(kind, CONFIGURATION_SEED[kind]), kind);
});

test('bodies are validated on write: a wrong shape, an unknown kind and a kind without a schema are refused', () => {
  assert.throws(
    () => validateConfigurationBody('sla', { dpo: 0, ai_coe: 5, it_security: 5 }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('operator_recipients', { addresses: [] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('operator_recipients', { addresses: ['not-an-address'] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('calendar', { timezone: 'UTC', holidays: [] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('calendar', { timezone: 'Asia/Bangkok', holidays: ['1 Jan'] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(() => validateConfigurationBody('lane_mapping', {}), /unknown kind/);
  assert.throws(() => validateConfigurationBody('risk_rubric', {}), /no body schema registered/);
});
