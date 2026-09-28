import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk } from '@rai/shared/risk/score';
import {
  ACC_BAND_V1_SHEET3_PARAMS,
  ACC_CLASSIC_ML_METRIC_PARAMS,
  ACC_EXTRACTION_NOT_HALLUCINATION_PARAMS,
  ACC_METRIC_CITED_PARAMS,
  CONFIGURATION_SEED,
  PACK_CONTRADICTION_PARAMS,
  SEED_KINDS,
  UNSEEDED_KINDS,
} from './seed.js';
import { ConfigurationBodyInvalid, validateConfigurationBody } from './store.js';

// W6-02 (W6 plan section 3, 11.2): assert by kind, never by count or order, so each package's seeded kind (W5
// `risk_rubric`) is one more membership line here.
const SEEDED = new Set<string>(SEED_KINDS);

test('the seed holds the ticket-named kinds with the recorded values (D01, D06, D11, W0-08)', () => {
  for (const kind of [
    'calendar',
    'checklist_templates',
    'operator_recipients',
    'qc_rules',
    'risk_rubric',
    'sla',
    'use_case_groups',
    'desk_controls', // W6-02
  ])
    assert.ok(SEEDED.has(kind), `${kind} is seeded`);
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

test('qc_rules revision 1 (w5.1) catalogues both template versions; v2.0 has no v1.0 Sheet-3 bands (W4-02)', () => {
  const qc = CONFIGURATION_SEED.qc_rules;
  // W5-10 (W5 plan section 9, label rule): the label names the last ticket that changed the seeded body.
  assert.equal(qc.label, 'w5.1');
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
    ['RISK-TIER-UNKNOWN', 'metadata', 'submit', 'medium'], // W5-10 (R-11)
    ['ACC-METRIC-CITED', 'content', 'approve_attempt+upload', 'medium'],
    ['ACC-EXTRACTION-NOT-HALLUCINATION', 'content', 'approve_attempt', 'high'],
    ['ACC-BAND-V1-SHEET3', 'content', 'approve_attempt', 'high'],
    ['ACC-CLASSIC-ML-METRIC', 'content', 'approve_attempt', 'medium'],
    ['PACK-CONTRADICTION', 'content', 'submit', 'medium'], // W4-06d
  ]);
  assert.deepEqual(
    rows('v2.0'),
    rows('v1.0 Sheet3').filter(([ruleId]) => ruleId !== 'ACC-BAND-V1-SHEET3'),
  );
  // No W4a metadata rule has the upload trigger (plan section 5).
  for (const template of Object.values(qc.templates))
    for (const rule of template.rules)
      if (rule.engine === 'metadata') assert.ok(!rule.triggers.includes('upload'), rule.ruleId);
  // W4-06a (plan section 3.3): ACC-METRIC-CITED carries its params in both templates; W4-06b adds the params of
  // ACC-EXTRACTION-NOT-HALLUCINATION and ACC-CLASSIC-ML-METRIC; W4-06c those of ACC-BAND-V1-SHEET3 (below).
  for (const template of Object.values(qc.templates))
    for (const [ruleId, params] of [
      ['ACC-METRIC-CITED', ACC_METRIC_CITED_PARAMS],
      ['ACC-EXTRACTION-NOT-HALLUCINATION', ACC_EXTRACTION_NOT_HALLUCINATION_PARAMS],
      ['ACC-CLASSIC-ML-METRIC', ACC_CLASSIC_ML_METRIC_PARAMS],
    ] as const) {
      const entry = template.rules.find((r) => r.ruleId === ruleId);
      assert.deepEqual(entry?.params, params, ruleId);
      assert.equal((entry?.params as { claimSource?: string }).claimSource, 'grammar', ruleId);
      // Content rules on slot 1 only read it on the AI/COE approve attempt (decision 28).
      if (ruleId !== 'ACC-METRIC-CITED') assert.deepEqual(entry?.params?.['slots'], [1], ruleId);
    }
  // W4-06b (WA-D09, provisional): the extraction metric is not an accepted metric, and the classic-ML matching
  // metrics are the dev vocabulary's `f1` plus the usual classification metrics.
  assert.deepEqual(ACC_EXTRACTION_NOT_HALLUCINATION_PARAMS.extractionMetrics, ['extraction_accuracy']);
  for (const metric of ACC_EXTRACTION_NOT_HALLUCINATION_PARAMS.extractionMetrics)
    assert.ok(!ACC_METRIC_CITED_PARAMS.acceptedMetrics.includes(metric), metric);
  assert.ok(ACC_CLASSIC_ML_METRIC_PARAMS.matchingMetrics.includes('f1'));
  // W4-06c (plan section 3.3; WA-D09, provisional): ACC-BAND-V1-SHEET3 carries its params on the v1.0 Sheet3
  // template only (v2.0 never lists it, L12): slot 1, the v1.0 Sheet-3 SL#2.1 bands in percent, strict less-than.
  const band = qc.templates['v1.0 Sheet3']!.rules.find((r) => r.ruleId === 'ACC-BAND-V1-SHEET3');
  assert.deepEqual(band?.params, ACC_BAND_V1_SHEET3_PARAMS);
  assert.equal(ACC_BAND_V1_SHEET3_PARAMS.claimSource, 'grammar');
  assert.deepEqual(ACC_BAND_V1_SHEET3_PARAMS.slots, [1]);
  assert.deepEqual(ACC_BAND_V1_SHEET3_PARAMS.bands, { high: '1', medium: '2', low: '3' });
  assert.deepEqual(ACC_BAND_V1_SHEET3_PARAMS.bandMetrics, ['hallucination_rate']);
  assert.deepEqual(
    ACC_BAND_V1_SHEET3_PARAMS.tiers.high.en.concat(
      ACC_BAND_V1_SHEET3_PARAMS.tiers.medium.en,
      ACC_BAND_V1_SHEET3_PARAMS.tiers.low.en,
    ),
    ['high', 'medium', 'low'],
  );
  assert.ok(!qc.templates['v2.0']!.rules.some((r) => r.ruleId === 'ACC-BAND-V1-SHEET3'));
  // W4-06d (plan section 3.3; WA-D09, provisional): PACK-CONTRADICTION carries its params in both templates: slots 2
  // and 5, the two seeded facts, each read from both slots, English and Thai keywords, grammar only.
  for (const template of Object.values(qc.templates)) {
    const entry = template.rules.find((r) => r.ruleId === 'PACK-CONTRADICTION');
    assert.deepEqual(entry?.params, PACK_CONTRADICTION_PARAMS);
  }
  assert.deepEqual(PACK_CONTRADICTION_PARAMS.slots, [2, 5]);
  assert.equal(PACK_CONTRADICTION_PARAMS.claimSource, 'grammar');
  assert.deepEqual(PACK_CONTRADICTION_PARAMS.facts, [
    { id: 'personal_data', slots: [2, 5] },
    { id: 'external_vendor', slots: [2, 5] },
  ]);
  assert.deepEqual(Object.keys(PACK_CONTRADICTION_PARAMS.items), ['personal_data', 'external_vendor']);
  const stage = qc.templates['v2.0']!.rules.find((r) => r.ruleId === 'PACK-STAGE-MISMATCH');
  assert.deepEqual(stage?.params, {
    attachedForbiddenAt: { idea: [8] },
    notYetForbiddenAt: { pre_launch: [1, 2, 3, 4, 5, 6, 7, 8] },
  });
});

test('desk_controls is seeded with every switch off (W6 plan section 7, Q12)', () => {
  assert.deepEqual(CONFIGURATION_SEED.desk_controls, {
    writesFrozen: false,
    mailPaused: false,
    qcPaused: false,
  });
});

test('registered and seeded kinds are separate: no UNSEEDED_KINDS member is seeded (W6 plan section 3)', () => {
  assert.deepEqual([...UNSEEDED_KINDS], ['group_role_mapping']);
  for (const kind of UNSEEDED_KINDS) {
    assert.ok(
      !SEEDED.has(kind),
      `${kind} is never seeded (W6 plan section 6: no identity mapping in the seed)`,
    );
    assert.ok(!(kind in CONFIGURATION_SEED), kind);
  }
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
