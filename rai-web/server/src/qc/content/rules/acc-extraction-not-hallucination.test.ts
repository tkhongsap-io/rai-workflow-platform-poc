// W4-06b (W4b plan section 3.3, provisional until D09): ACC-EXTRACTION-NOT-HALLUCINATION flags a claim on the
// hallucination item that cites an extraction metric (extraction accuracy is not a hallucination rate). One finding
// per claim (decision 30), read on the AI/COE approve attempt only (decision 28). Synthetic claims only.
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
  type ClaimFields,
  type RequestShape,
} from '../request.test-helper.js';
import { createContentQcRunner } from '../runner.js';

const RULE = 'ACC-EXTRACTION-NOT-HALLUCINATION';
const signal = () => new AbortController().signal;

async function runOf(request: QcRunRequest) {
  const extractor = recordingExtractor();
  const runner = createContentQcRunner({
    extractor,
    now: () => new Date('2026-09-27T05:00:00Z'),
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

/** An AI/COE approve attempt whose slot 1 holds these claims, one DOCX paragraph each. */
const attemptOf = (claims: ClaimFields[], shape: RequestShape = {}) =>
  requestOf({
    rules: onlyRules('approve_attempt', RULE),
    documents: { 1: claims.map((fields, i) => claimParagraph(i + 1, fields)) },
    ...shape,
  });

const EXTRACTION_ONLY: ClaimFields = {
  ...COMPLETE_HALLUCINATION,
  metric: 'extraction_accuracy',
  value: '97%',
  denominator: '200',
  threshold: '95%',
  evidence: 'extract-run-c',
};

test('an extraction-only "Yes" on the hallucination item is flagged, by locator and excerpt hash', async () => {
  const request = attemptOf([COMPLETE_ACCURACY, EXTRACTION_ONLY]);
  const [finding, ...rest] = await findingsOf(request);
  assert.equal(rest.length, 0);
  const artifact = request.artifacts.find((a) => a.slot === 1)!;
  const text =
    'item: 2.1; question: Hallucination rate measured on the evaluation set?; answer: Yes; metric: extraction_accuracy; value: 97%; denominator: 200; threshold: 95%; evidence: extract-run-c; tier: high';
  const excerptHash = excerptHashOf(text);
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
      metric: 'extraction_accuracy',
      value: 97,
      denominator: 200,
      threshold: 95,
      unit: 'percent',
      thresholdSource: TEMPLATE,
    },
    message: {
      key: 'qc.finding.acc_extraction_not_hallucination',
      params: { slot: 1, metric: 'extraction_accuracy', item: '2.1' },
    },
    provenance: { runner: 'content', runnerVersion: '0.0.0' },
  });
  assert.ok(!JSON.stringify(finding).includes('Hallucination rate'), 'no claim text in the finding');
});

test('a hallucination claim that cites an accepted metric, and non-hallucination items, raise nothing', async () => {
  assert.deepEqual(
    await findingsOf(
      attemptOf([
        COMPLETE_HALLUCINATION,
        { ...COMPLETE_HALLUCINATION, metric: undefined },
        { ...COMPLETE_HALLUCINATION, metric: 'Hallucination Rate' },
        { ...COMPLETE_ACCURACY, metric: 'extraction_accuracy' },
        { ...EXTRACTION_ONLY, item: '1.1', question: 'Does the use case process personal data?' },
        { ...EXTRACTION_ONLY, question: undefined, item: '2.1' },
      ]),
    ),
    [],
  );
});

test('the metric is matched as an ID; the answer does not excuse an extraction figure', async () => {
  const findings = await findingsOf(
    attemptOf([
      { ...EXTRACTION_ONLY, metric: 'Extraction Accuracy' },
      { ...EXTRACTION_ONLY, metric: 'extraction-accuracy', answer: 'No', evidence: 'extract-run-d' },
    ]),
  );
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.message.params['metric']),
    ['extraction_accuracy', 'extraction_accuracy'],
  );
});

test('measure: stated numbers only; value null keeps the stated or default unit', async () => {
  const [bare] = await findingsOf(
    attemptOf([
      {
        ...EXTRACTION_ONLY,
        value: undefined,
        denominator: 'many',
        threshold: undefined,
        item: 'extraction check',
      },
    ]),
  );
  assert.deepEqual(bare?.measure, {
    metric: 'extraction_accuracy',
    value: null,
    denominator: null,
    threshold: null,
    unit: 'percent',
    thresholdSource: TEMPLATE,
  });
  // `item` is not an item reference, so it is left out of the params (decision 26).
  assert.deepEqual(bare?.message.params, { slot: 1, metric: 'extraction_accuracy' });
  const [ratio] = await findingsOf(attemptOf([{ ...EXTRACTION_ONLY, value: '0.97', threshold: '0.95' }]));
  assert.equal(ratio?.measure?.unit, 'ratio');
  assert.equal(ratio?.measure?.value, 0.97);
  assert.equal(ratio?.measure?.threshold, 0.95);
});

test('two extraction claims are two findings; identical claim text is one finding with two evidence entries', async () => {
  const two = await findingsOf(attemptOf([EXTRACTION_ONLY, { ...EXTRACTION_ONLY, value: '98%' }]));
  assert.equal(two.length, 2);
  assert.notEqual(two[0]?.findingKey, two[1]?.findingKey);
  const repeated = await findingsOf(attemptOf([EXTRACTION_ONLY, COMPLETE_HALLUCINATION, EXTRACTION_ONLY]));
  assert.equal(repeated.length, 1);
  assert.deepEqual(
    repeated[0]?.evidence.map((e) => e.locator),
    [
      { kind: 'section', index: 1 },
      { kind: 'section', index: 3 },
    ],
  );
});

test('Thai labels, a text-layer PDF line and an XLSX row are all read', async () => {
  const thai = await findingsOf(
    requestOf({
      rules: onlyRules('approve_attempt', RULE),
      documents: {
        1: [
          {
            locator: { kind: 'page', page: 2 },
            text: 'ข้อ: 2.1; คำถาม: มีการวัดอัตราการหลอนบนชุดข้อมูลประเมินหรือไม่; คำตอบ: ใช่; ตัวชี้วัด: extraction_accuracy; ค่า: 97%; ตัวหาร: 200',
          },
        ],
      },
    }),
  );
  assert.equal(thai.length, 1);
  assert.deepEqual(thai[0]?.evidence[0]?.locator, { kind: 'page', page: 2 });
  const cell = (ref: string, text: string) => ({
    locator: { kind: 'cell' as const, sheetIndex: 1, cell: ref },
    text,
  });
  const xlsx = await findingsOf(
    requestOf({
      rules: onlyRules('approve_attempt', RULE),
      documents: {
        1: [
          cell('A1', 'question'),
          cell('B1', 'answer'),
          cell('C1', 'metric'),
          cell('D1', 'value'),
          cell('A2', 'Hallucination rate measured?'),
          cell('B2', 'Yes'),
          cell('C2', 'extraction_accuracy'),
          cell('D2', '96.5%'),
        ],
      },
    }),
  );
  assert.deepEqual(xlsx[0]?.evidence[0]?.locator, { kind: 'cell', sheetIndex: 1, cell: 'B2' });
  assert.equal(xlsx[0]?.measure?.value, 96.5);
});

test('DPO and IT/Security approve attempts read no slot-1 bytes and emit nothing (decision 28)', async () => {
  for (const lane of ['dpo', 'it_security'] as Lane[]) {
    const { findings, calls } = await runOf(
      attemptOf([EXTRACTION_ONLY], { lane, documents: { 1: [claimParagraph(1, EXTRACTION_ONLY)], 5: [] } }),
    );
    assert.deepEqual(findings, [], lane);
    assert.deepEqual(calls, [], lane);
  }
  const { findings, calls } = await runOf(attemptOf([EXTRACTION_ONLY]));
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
