import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk } from '@rai/shared/risk/score';
import { CONFIGURATION_SEED, SEED_KINDS } from './seed.js';
import { ConfigurationBodyInvalid, validateConfigurationBody } from './store.js';

test('the seed holds the ticket-named kinds with the recorded values (D01, D06, D11, W0-08)', () => {
  assert.deepEqual([...SEED_KINDS].sort(), [
    'calendar',
    'checklist_templates',
    'operator_recipients',
    'qc_rules',
    'risk_rubric',
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
  // W5-02 registered risk_rubric; group_role_mapping (W6/W8) is still a kind without a schema.
  assert.throws(() => validateConfigurationBody('group_role_mapping', {}), /no body schema registered/);
  assert.throws(() => validateConfigurationBody('risk_rubric', {}), ConfigurationBodyInvalid);
});

// W5-02 (W5 plan section 3 "Placeholder seed"): every value below is a SYNTHETIC PLACEHOLDER for D07 (AI/COE).
const RUBRIC = CONFIGURATION_SEED.risk_rubric;
const ATTACHED = { 1: 'attached' } as const;
const answers = (values: string[]) =>
  Object.fromEntries(RUBRIC.questions.map((q, i) => [q.questionId, values[i] ?? 'unknown']));

test('risk_rubric revision 1 is the labelled synthetic placeholder (R-1, R-2)', () => {
  assert.equal(RUBRIC.label, 'synthetic-placeholder.1');
  assert.equal(RUBRIC.provenance, 'synthetic_placeholder');
  assert.deepEqual(
    RUBRIC.questions.map((q) => q.questionId),
    ['RQ1', 'RQ2', 'RQ3', 'RQ4', 'RQ5', 'RQ6', 'RQ7'],
  );
  for (const q of RUBRIC.questions) {
    assert.ok(q.text.en.startsWith('[SYNTHETIC PLACEHOLDER]'), q.questionId);
    assert.ok(q.text.th.startsWith('[SYNTHETIC PLACEHOLDER]'), q.questionId);
    assert.equal(q.evidenceSlot, 1, q.questionId);
    assert.equal(q.options.length, 3, q.questionId);
    assert.deepEqual(q.options.map((o) => o.level).sort(), ['high', 'low', 'medium'], q.questionId);
  }
  const escalations = RUBRIC.questions.flatMap((q) =>
    q.options.filter((o) => o.escalatesTo !== undefined).map((o) => [q.questionId, o.value, o.escalatesTo]),
  );
  assert.deepEqual(escalations, [['RQ3', 'yes', 'medium']], 'personal data escalates only to Medium');
  assert.equal(RUBRIC.defaultTier, 'low');
  assert.deepEqual(RUBRIC.tierRules, [
    { tier: 'high', anyOf: [{ allOf: [{ level: 'high', atLeast: 3 }] }] },
    {
      tier: 'medium',
      anyOf: [{ allOf: [{ level: 'high', atLeast: 1 }] }, { allOf: [{ level: 'medium', atLeast: 2 }] }],
    },
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(RUBRIC.tierLabels).map(([k, v]) => [k, v.en])), {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    unknown: 'Unknown',
  });
  for (const label of Object.values(RUBRIC.tierLabels)) assert.ok(label.th.length > 0);
});

test('the placeholder thresholds are visibly not the operating-model section 7 summary (D07 stays open)', () => {
  const levelValue = (level: string) => (qId: string) =>
    RUBRIC.questions.find((q) => q.questionId === qId)!.options.find((o) => o.level === level)!.value;
  const low = RUBRIC.questions.map((q) => levelValue('low')(q.questionId));
  const high = RUBRIC.questions.map((q) => levelValue('high')(q.questionId));
  // Two high answers: High under the section 7 summary, Medium here.
  assert.equal(scoreRisk(RUBRIC, answers([high[0]!, high[1]!, ...low.slice(2)]), ATTACHED).tier, 'medium');
  // Three high answers: High.
  assert.equal(
    scoreRisk(RUBRIC, answers([high[0]!, high[1]!, high[2]!, ...low.slice(3)]), ATTACHED).tier,
    'high',
  );
  // Personal data (RQ3 'yes', one medium answer, otherwise Low) alone: High under the summary, Medium here, by
  // escalation.
  const pii = [...low];
  pii[2] = 'yes';
  const piiScore = scoreRisk(RUBRIC, answers(pii), ATTACHED);
  assert.equal(piiScore.tier, 'medium');
  assert.deepEqual(piiScore.escalation, { questionId: 'RQ3', to: 'medium' });
  // Every answer low: Low. Nothing answered: Unknown, never Low.
  assert.equal(scoreRisk(RUBRIC, answers(low), ATTACHED).tier, 'low');
  assert.equal(scoreRisk(RUBRIC, {}, ATTACHED).tier, 'unknown');
  // Slot 1 not attached: every answer is Unknown (R-5).
  assert.equal(scoreRisk(RUBRIC, answers(low), {}).tier, 'unknown');
});

test('a risk_rubric body with a problem the schema cannot express is refused on publish (W5 plan section 2)', () => {
  const duplicate = structuredClone(RUBRIC);
  duplicate.questions[1] = { ...duplicate.questions[1]!, questionId: 'RQ1' };
  assert.throws(() => validateConfigurationBody('risk_rubric', duplicate), /RQ1 is listed twice/);
  const approved = { ...structuredClone(RUBRIC), provenance: 'd07_recorded' };
  assert.throws(() => validateConfigurationBody('risk_rubric', approved), ConfigurationBodyInvalid);
});
