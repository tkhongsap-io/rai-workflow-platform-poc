// W4-06c (W4b plan section 3.3, provisional until D09): ACC-BAND-V1-SHEET3 applies the v1.0 Sheet-3 SL#2.1
// hallucination bands (high < 1%, medium < 2%, low < 3%) to a stated hallucination rate, exactly and strictly, so a
// rate equal to its band fails. Percent and ratio inputs; a missing tier is its own finding; v2.0 never evaluates it
// (L12); read on the AI/COE approve attempt only (decision 28). One finding per claim (decision 30). Synthetic claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_MAPPINGS_BY_VERSION, type Lane } from '@rai/shared/constants';
import type { QcFinding, QcRunRequest, QcRunResult } from '@rai/shared/qc/types';
import {
  checkOwningLane,
  duplicateFindingKey,
  findingKeyOf,
  validateQcFinding,
} from '@rai/shared/qc/validate';
import type { Segment } from '../../extraction/port.js';
import { claimKeyOf, excerptHashOf } from '../excerpt.js';
import {
  COMPLETE_ACCURACY,
  COMPLETE_HALLUCINATION,
  TEMPLATE,
  artifactIdOf,
  claimParagraph,
  onlyRules,
  recordingExtractor,
  requestOf,
  seededRules,
  type ClaimFields,
  type RequestShape,
} from '../request.test-helper.js';
import { createContentQcRunner } from '../runner.js';

const RULE = 'ACC-BAND-V1-SHEET3';
const signal = () => new AbortController().signal;

async function runOf(request: QcRunRequest) {
  const extractor = recordingExtractor();
  const runner = createContentQcRunner({
    extractor,
    now: () => new Date('2026-09-28T05:00:00Z'),
    runnerVersion: '0.0.0',
  });
  const result: QcRunResult = await runner.run(request, signal());
  assert.equal(result.status, 'completed', JSON.stringify(result));
  if (result.status !== 'completed') return { findings: [] as QcFinding[], calls: extractor.calls };
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!;
  for (const finding of result.findings) {
    assert.equal(validateQcFinding(finding, request), null, finding.findingKey);
    assert.equal(checkOwningLane(finding, mapping, request.lane), null, finding.findingKey);
  }
  assert.equal(duplicateFindingKey(result.findings), null);
  assert.deepEqual(result.rulesEvaluated, [RULE]);
  return { findings: result.findings, calls: extractor.calls };
}

const findingsOf = async (request: QcRunRequest) => (await runOf(request)).findings;

/** An AI/COE approve attempt whose slot 1 holds these segments. */
const attemptOfSegments = (segments: Segment[], shape: RequestShape = {}) =>
  requestOf({ rules: onlyRules('approve_attempt', RULE), documents: { 1: segments }, ...shape });

/** An AI/COE approve attempt whose slot 1 holds these claims, one DOCX paragraph each. */
const attemptOf = (claims: ClaimFields[], shape: RequestShape = {}) =>
  attemptOfSegments(
    claims.map((fields, i) => claimParagraph(i + 1, fields)),
    shape,
  );

const rate = (value: string, tier: string | undefined, over: ClaimFields = {}): ClaimFields => ({
  ...COMPLETE_HALLUCINATION,
  value,
  threshold: undefined,
  tier,
  ...over,
});

test('below, equal and above each tier, in percent and in ratio: equal fails (strict less-than)', async () => {
  const cases: Array<[tier: string, value: string, fires: boolean]> = [
    ['high', '0.99%', false],
    ['high', '1%', true],
    ['high', '1.00%', true],
    ['high', '1.01%', true],
    ['high', '0.0099', false],
    ['high', '0.01', true],
    ['high', '0.0101', true],
    ['medium', '1.99%', false],
    ['medium', '2%', true],
    ['medium', '2.5%', true],
    ['medium', '0.0199', false],
    ['medium', '0.02', true],
    ['medium', '0.025', true],
    ['low', '2.999999%', false],
    ['low', '3%', true],
    ['low', '3.1%', true],
    ['low', '0.029999', false],
    ['low', '0.03', true],
    ['low', '0.031', true],
    ['high', '0%', false],
    ['high', '-1%', false],
  ];
  for (const [tier, value, fires] of cases) {
    const findings = await findingsOf(attemptOf([rate(value, tier)]));
    assert.equal(findings.length, fires ? 1 : 0, `${tier} ${value}`);
    if (fires) assert.equal(findings[0]?.message.key, 'qc.finding.acc_band_v1_sheet3', `${tier} ${value}`);
  }
});

test('a rate at or above its band is one finding: locator, excerpt hash, measure in percent, exact params', async () => {
  const claim = rate('2.5%', 'medium');
  const request = attemptOf([COMPLETE_ACCURACY, claim]);
  const [finding, ...rest] = await findingsOf(request);
  assert.equal(rest.length, 0);
  const artifact = request.artifacts.find((a) => a.slot === 1)!;
  const excerptHash = excerptHashOf(claimParagraph(2, claim).text);
  const scope = {
    kind: 'artifact' as const,
    slot: 1 as const,
    artifactId: artifactIdOf(1),
    contentHash: artifact.contentHash,
  };
  assert.deepEqual(finding, {
    findingKey: findingKeyOf(RULE, scope, claimKeyOf(excerptHash)),
    ruleId: RULE,
    ruleRevision: request.qcRulesRevision,
    trigger: 'approve_attempt',
    scope,
    claimKey: claimKeyOf(excerptHash),
    severity: 'high',
    owningLane: 'ai_coe',
    evidence: [
      {
        artifactId: artifactIdOf(1),
        contentHash: artifact.contentHash,
        slot: 1,
        locator: { kind: 'section', index: 2 },
        excerptHash,
      },
    ],
    measure: {
      metric: 'hallucination_rate',
      value: 2.5,
      denominator: 500,
      threshold: 2,
      unit: 'percent',
      thresholdSource: 'v1.0 Sheet3',
    },
    message: {
      key: 'qc.finding.acc_band_v1_sheet3',
      params: {
        slot: 1,
        tier: 'medium',
        value: '2.5',
        threshold: '2',
        threshold_source: TEMPLATE,
        item: '2.1',
      },
    },
    provenance: { runner: 'content', runnerVersion: '0.0.0' },
  });
  assert.ok(!JSON.stringify(finding).includes('Hallucination rate'), 'no claim text in the finding');
});

test('a ratio is converted to percent exactly: the measure and the params carry the percent', async () => {
  const [ratio] = await findingsOf(attemptOf([rate('0.07', 'high', { denominator: undefined })]));
  assert.deepEqual(ratio?.measure, {
    metric: 'hallucination_rate',
    value: 7, // 0.07 * 100 is 7.000000000000001 in binary floating point; the decimal product is exactly 7
    denominator: null,
    threshold: 1,
    unit: 'percent',
    thresholdSource: 'v1.0 Sheet3',
  });
  assert.equal(ratio?.message.params['value'], '7');
  assert.equal(ratio?.message.params['threshold'], '1');
});

test('a missing or unrecognised tier is a finding with the tier-missing message, whatever the rate', async () => {
  const findings = await findingsOf(
    attemptOf([
      rate('0.1%', undefined),
      rate('0.2%', 'critical', { evidence: 'eval-round-e' }),
      rate('5%', '', { evidence: 'eval-round-f' }),
    ]),
  );
  assert.equal(findings.length, 3);
  for (const finding of findings)
    assert.equal(finding.message.key, 'qc.finding.acc_band_v1_sheet3_tier_missing');
  assert.deepEqual(findings[0]?.message.params, {
    slot: 1,
    value: '0.1',
    threshold_source: TEMPLATE,
    item: '2.1',
  });
  assert.deepEqual(findings[0]?.measure, {
    metric: 'hallucination_rate',
    value: 0.1,
    denominator: 500,
    threshold: null,
    unit: 'percent',
    thresholdSource: 'v1.0 Sheet3',
  });
  assert.equal(findings[0]?.severity, 'high');
});

test('only a stated hallucination rate is judged: no value, not a number, a count, another metric or item', async () => {
  assert.deepEqual(
    await findingsOf(
      attemptOf([
        COMPLETE_HALLUCINATION, // 0.4% at tier high: below
        rate('5%', 'high', { value: undefined }),
        rate('five percent', 'high'),
        rate('12', 'high'), // a bare integer is a count, not a rate (ACC-METRIC-CITED judges the claim)
        rate('5%', 'high', { metric: undefined }),
        rate('5%', 'high', { metric: 'extraction_accuracy' }), // ACC-EXTRACTION-NOT-HALLUCINATION's claim
        rate('5%', 'high', { metric: 'accuracy' }),
        { ...COMPLETE_ACCURACY, value: '5%', tier: 'high' },
        rate('5%', 'high', { question: 'Does the use case process personal data?', item: '1.1' }),
      ]),
    ),
    [],
  );
});

test('the answer does not excuse a stated rate; the metric is matched as an ID', async () => {
  const findings = await findingsOf(
    attemptOf([
      rate('1.5%', 'high', { answer: 'No' }),
      rate('1.5%', 'high', { metric: 'Hallucination Rate', evidence: 'eval-round-g' }),
    ]),
  );
  assert.equal(findings.length, 2);
  for (const finding of findings) assert.equal(finding.measure?.metric, 'hallucination_rate');
});

test('a stated unit word decides percent or ratio', async () => {
  const line = (index: number, value: string, unit: string, tier: string): Segment => ({
    locator: { kind: 'section', index },
    text: `item: 2.1; question: Hallucination rate measured?; answer: Yes; metric: hallucination_rate; value: ${value}; unit: ${unit}; tier: ${tier}`,
  });
  const findings = await findingsOf(
    attemptOfSegments([
      line(1, '0.5', 'percent', 'high'), // 0.5 %: below
      line(2, '1', 'percent', 'high'), // 1 %: equal
      line(3, '0.02', 'ratio', 'medium'), // 2 %: equal
      line(4, '0.5', '%', 'low'), // 0.5 %: below
    ]),
  );
  assert.deepEqual(
    findings.map((f) => [f.evidence[0]?.locator, f.measure?.value]),
    [
      [{ kind: 'section', index: 2 }, 1],
      [{ kind: 'section', index: 3 }, 2],
    ],
  );
  // Without a unit word, a bare 0.5 is a ratio (plan 3.2), so 50 %.
  const [bare] = await findingsOf(attemptOf([rate('0.5', 'low')]));
  assert.equal(bare?.measure?.value, 50);
});

test('Thai tier words, a text-layer PDF line and an XLSX row are all read', async () => {
  const thai = await findingsOf(
    attemptOfSegments([
      {
        locator: { kind: 'page', page: 3 },
        text: 'ข้อ: 2.1; คำถาม: มีการวัดอัตราการหลอนบนชุดข้อมูลประเมินหรือไม่; คำตอบ: ใช่; ตัวชี้วัด: hallucination_rate; ค่า: 2%; ตัวหาร: 500; ระดับ: ปานกลาง',
      },
      {
        locator: { kind: 'page', page: 4 },
        text: 'ข้อ: 2.1; คำถาม: มีการวัดอัตราการหลอนหรือไม่; คำตอบ: ใช่; ตัวชี้วัด: hallucination_rate; ค่า: 2%; ระดับ: ต่ำ',
      },
    ]),
  );
  assert.equal(thai.length, 1);
  assert.deepEqual(thai[0]?.evidence[0]?.locator, { kind: 'page', page: 3 });
  assert.equal(thai[0]?.message.params['tier'], 'medium');
  const cell = (ref: string, text: string): Segment => ({
    locator: { kind: 'cell', sheetIndex: 2, cell: ref },
    text,
  });
  const xlsx = await findingsOf(
    attemptOfSegments([
      cell('A1', 'question'),
      cell('B1', 'answer'),
      cell('C1', 'metric'),
      cell('D1', 'value'),
      cell('E1', 'tier'),
      cell('A2', 'Hallucination rate measured?'),
      cell('B2', 'Yes'),
      cell('C2', 'hallucination_rate'),
      cell('D2', '2.9%'),
      cell('E2', 'Low'),
      cell('A3', 'Hallucination rate measured again?'),
      cell('B3', 'Yes'),
      cell('C3', 'hallucination_rate'),
      cell('D3', '3%'),
      cell('E3', 'LOW'),
    ]),
  );
  assert.equal(xlsx.length, 1);
  assert.deepEqual(xlsx[0]?.evidence[0]?.locator, { kind: 'cell', sheetIndex: 2, cell: 'B3' });
  assert.equal(xlsx[0]?.message.params['tier'], 'low');
  // The sheet has no item column, so the finding carries no `item` param.
  assert.equal(xlsx[0]?.message.params['item'], undefined);
});

test('two rates are two findings; identical claim text is one finding with two evidence entries', async () => {
  const above = rate('1.5%', 'high');
  const two = await findingsOf(attemptOf([above, rate('1.6%', 'high')]));
  assert.equal(two.length, 2);
  assert.notEqual(two[0]?.findingKey, two[1]?.findingKey);
  const repeated = await findingsOf(attemptOf([above, COMPLETE_HALLUCINATION, above]));
  assert.equal(repeated.length, 1);
  assert.deepEqual(
    repeated[0]?.evidence.map((e) => e.locator),
    [
      { kind: 'section', index: 1 },
      { kind: 'section', index: 3 },
    ],
  );
});

test('v2.0 never evaluates it: not selected, and silent if a request carries it anyway (L12)', async () => {
  for (const trigger of ['upload', 'submit', 'approve_attempt'] as const)
    assert.ok(!seededRules(trigger, 'v2.0').some((r) => r.ruleId === RULE), trigger);
  const above = rate('9%', 'high');
  assert.deepEqual(
    await findingsOf(attemptOf([above, rate('9%', undefined)], { templateVersion: 'v2.0' })),
    [],
  );
  assert.equal((await findingsOf(attemptOf([above]))).length, 1, 'the same document under v1.0 Sheet3 fires');
});

test('DPO and IT/Security approve attempts read no slot-1 bytes and emit nothing (decision 28)', async () => {
  const above = rate('9%', 'high');
  for (const lane of ['dpo', 'it_security'] as Lane[]) {
    const { findings, calls } = await runOf(
      attemptOf([above], { lane, documents: { 1: [claimParagraph(1, above)], 5: [] } }),
    );
    assert.deepEqual(findings, [], lane);
    assert.deepEqual(calls, [], lane);
  }
  const { findings, calls } = await runOf(attemptOf([above]));
  assert.equal(findings.length, 1);
  assert.deepEqual(calls, [1], 'the AI/COE attempt reads slot 1 once, and only slot 1');
});

test('it is an approve-attempt rule: selected on upload or submit it fails closed', async () => {
  const [entry] = onlyRules('approve_attempt', RULE);
  for (const trigger of ['upload', 'submit'] as const) {
    const runner = createContentQcRunner({ extractor: recordingExtractor(), runnerVersion: '0.0.0' });
    const result = await runner.run(requestOf({ trigger, rules: [entry!] }), signal());
    assert.equal(result.status, 'unavailable', trigger);
    if (result.status === 'unavailable')
      assert.deepEqual([result.reason, result.detail], ['runner_error', 'unsupported_rule_trigger'], trigger);
  }
});
