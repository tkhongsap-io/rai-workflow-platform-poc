// W4-06a (W4b plan section 3.3, provisional until D09): ACC-METRIC-CITED fires on a "Yes" hallucination or accuracy
// claim that lacks an accepted metric, a value, a denominator, a threshold or evidence; one finding per defective claim
// (decision 30), `measure` only when the metric and the value are stated. Synthetic claims only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_MAPPINGS_BY_VERSION } from '@rai/shared/constants';
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
  recordingExtractor,
  requestOf,
  type ClaimFields,
} from '../request.test-helper.js';
import { createContentQcRunner } from '../runner.js';

const signal = () => new AbortController().signal;
const runner = createContentQcRunner({
  extractor: recordingExtractor(),
  now: () => new Date('2026-09-27T05:00:00Z'),
  runnerVersion: '0.0.0',
});

async function findingsOf(request: QcRunRequest): Promise<QcFinding[]> {
  const result: QcRunResult = await runner.run(request, signal());
  assert.equal(result.status, 'completed', JSON.stringify(result));
  if (result.status !== 'completed') return [];
  // Every finding passes the orchestrator's checks (W0-07 3.4 steps 4-5 and the run-level check).
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!;
  for (const finding of result.findings) {
    assert.equal(validateQcFinding(finding, request), null, finding.findingKey);
    assert.equal(checkOwningLane(finding, mapping, request.lane), null, finding.findingKey);
  }
  assert.equal(duplicateFindingKey(result.findings), null);
  return result.findings;
}

/** An upload of slot 1 holding these claims, one paragraph each. */
const uploadOf = (...claims: ClaimFields[]) =>
  requestOf({
    trigger: 'upload',
    documents: { 1: claims.map((fields, i) => claimParagraph(i + 1, fields)) },
  });

test('complete hallucination and accuracy evidence raises nothing (no invented deficiency)', async () => {
  assert.deepEqual(await findingsOf(uploadOf(COMPLETE_HALLUCINATION, COMPLETE_ACCURACY)), []);
});

test('it fires on each missing field alone, naming it in `missing`', async () => {
  for (const field of ['metric', 'value', 'denominator', 'threshold', 'evidence'] as const) {
    const [finding, ...rest] = await findingsOf(uploadOf({ ...COMPLETE_ACCURACY, [field]: undefined }));
    assert.equal(rest.length, 0, field);
    assert.ok(finding, field);
    assert.equal(finding.ruleId, 'ACC-METRIC-CITED');
    assert.equal(finding.severity, 'medium');
    assert.equal(finding.owningLane, 'ai_coe');
    assert.equal(finding.message.key, 'qc.finding.acc_metric_cited');
    assert.deepEqual(finding.message.params, { slot: 1, missing: field, item: '2.2' }, field);
  }
});

test('the finding cites the claim by locator and excerpt hash, keyed by the claim (decision 30)', async () => {
  const request = uploadOf(COMPLETE_ACCURACY, {
    ...COMPLETE_ACCURACY,
    threshold: undefined,
    denominator: undefined,
  });
  const [finding] = await findingsOf(request);
  const artifact = request.artifacts[0]!;
  const text =
    'item: 2.2; question: Answer accuracy measured on the evaluation set?; answer: Yes; metric: accuracy; value: 96%; evidence: eval-report-22';
  const excerptHash = excerptHashOf(text);
  const scope = {
    kind: 'artifact' as const,
    slot: 1 as const,
    artifactId: artifactIdOf(1),
    contentHash: artifact.contentHash,
  };
  assert.deepEqual(finding?.scope, scope);
  assert.equal(finding?.claimKey, claimKeyOf(excerptHash));
  assert.equal(finding?.findingKey, findingKeyOf('ACC-METRIC-CITED', scope, claimKeyOf(excerptHash)));
  assert.deepEqual(finding?.evidence, [
    {
      artifactId: artifactIdOf(1),
      contentHash: artifact.contentHash,
      slot: 1,
      locator: { kind: 'section', index: 2 },
      excerptHash,
    },
  ]);
  assert.deepEqual(finding?.message.params, { slot: 1, missing: 'denominator,threshold', item: '2.2' });
  // The stated metric and value are the measure; the missing denominator and threshold are null.
  assert.deepEqual(finding?.measure, {
    metric: 'accuracy',
    value: 96,
    denominator: null,
    threshold: null,
    unit: 'percent',
    thresholdSource: TEMPLATE,
  });
  // No field of the finding carries the claim's text.
  assert.ok(!JSON.stringify(finding).includes('Answer accuracy'));
});

test('measure is null when the metric or the value is missing; the gaps are still named', async () => {
  const [noMetric] = await findingsOf(uploadOf({ ...COMPLETE_HALLUCINATION, metric: undefined }));
  assert.equal(noMetric?.measure, null);
  assert.equal(noMetric?.message.params['missing'], 'metric');
  const [noValue] = await findingsOf(
    uploadOf({ ...COMPLETE_HALLUCINATION, value: undefined, threshold: undefined }),
  );
  assert.equal(noValue?.measure, null);
  assert.equal(noValue?.message.params['missing'], 'value,threshold');
  const [unparseable] = await findingsOf(uploadOf({ ...COMPLETE_HALLUCINATION, value: 'low' }));
  assert.equal(unparseable?.measure, null);
  assert.equal(unparseable?.message.params['missing'], 'value');
});

test('an extraction metric counts as absent; a ratio value is a ratio', async () => {
  const [extraction] = await findingsOf(
    uploadOf({ ...COMPLETE_HALLUCINATION, metric: 'extraction_accuracy', value: '97%' }),
  );
  assert.equal(extraction?.message.params['missing'], 'metric');
  assert.equal(extraction?.measure, null);
  const [ratio] = await findingsOf(uploadOf({ ...COMPLETE_ACCURACY, value: '0.91', evidence: undefined }));
  assert.deepEqual(ratio?.measure, {
    metric: 'accuracy',
    value: 0.91,
    denominator: 500,
    threshold: 90,
    unit: 'ratio',
    thresholdSource: TEMPLATE,
  });
});

test('only a Yes on the hallucination or accuracy item is judged', async () => {
  const gaps = {
    metric: undefined,
    value: undefined,
    denominator: undefined,
    threshold: undefined,
    evidence: undefined,
  };
  assert.deepEqual(
    await findingsOf(
      uploadOf(
        { ...COMPLETE_ACCURACY, ...gaps, answer: 'No' },
        { ...COMPLETE_ACCURACY, ...gaps, answer: 'N/A' },
        { ...COMPLETE_ACCURACY, ...gaps, answer: 'perhaps' },
        { ...COMPLETE_ACCURACY, ...gaps, item: '1.1', question: 'Does the use case process personal data?' },
        { item: '9.9', question: 'Model performance measured with a matching metric?', answer: 'Yes' },
      ),
    ),
    [],
  );
});

test('Thai claims are judged from the Thai labels', async () => {
  const request = requestOf({
    trigger: 'upload',
    documents: {
      1: [
        {
          locator: { kind: 'section', index: 1 },
          text: 'ข้อ: 2.1; คำถาม: มีการวัดอัตราการหลอนบนชุดข้อมูลประเมินหรือไม่; คำตอบ: ใช่; ตัวชี้วัด: hallucination_rate; ค่า: 0.5%; ตัวหาร: 500; หลักฐาน: eval-report-21',
        },
      ],
    },
  });
  const [finding, ...rest] = await findingsOf(request);
  assert.equal(rest.length, 0);
  assert.equal(finding?.message.params['missing'], 'threshold');
  assert.equal(finding?.measure?.metric, 'hallucination_rate');
});

test('two defective claims in one artifact are two findings with two keys; identical claim text is one finding', async () => {
  const two = await findingsOf(
    uploadOf(
      { ...COMPLETE_HALLUCINATION, threshold: undefined },
      { ...COMPLETE_ACCURACY, denominator: undefined },
    ),
  );
  assert.equal(two.length, 2);
  assert.notEqual(two[0]?.findingKey, two[1]?.findingKey);
  assert.deepEqual(
    two.map((f) => f.message.params['missing']),
    ['threshold', 'denominator'],
  );
  const same = { ...COMPLETE_ACCURACY, evidence: undefined };
  const repeated = await findingsOf(uploadOf(same, COMPLETE_HALLUCINATION, same));
  assert.equal(repeated.length, 1, 'one claim written twice is one claim');
  assert.deepEqual(
    repeated[0]?.evidence.map((e) => e.locator),
    [
      { kind: 'section', index: 1 },
      { kind: 'section', index: 3 },
    ],
  );
});

test('an item reference that is not a pattern-checked number is left out of the params (decision 26)', async () => {
  const [finding] = await findingsOf(
    uploadOf({ ...COMPLETE_ACCURACY, item: 'Section four', question: undefined, threshold: undefined }),
  );
  // "Section four" names no item keyword and the question is gone, so the claim has no item: nothing fires.
  assert.equal(finding, undefined);
  const [withKeyword] = await findingsOf(
    uploadOf({ ...COMPLETE_ACCURACY, item: 'accuracy check', threshold: undefined }),
  );
  assert.deepEqual(withKeyword?.message.params, { slot: 1, missing: 'threshold' });
});

test('XLSX claims are located at the answer cell', async () => {
  const cell = (ref: string, text: string) => ({
    locator: { kind: 'cell' as const, sheetIndex: 2, cell: ref },
    text,
  });
  const request = requestOf({
    trigger: 'upload',
    documents: {
      1: [
        cell('A1', 'item'),
        cell('B1', 'question'),
        cell('C1', 'answer'),
        cell('D1', 'metric'),
        cell('E1', 'value'),
        cell('A2', '2.1'),
        cell('B2', 'Hallucination rate measured?'),
        cell('C2', 'Yes'),
        cell('D2', 'hallucination_rate'),
        cell('E2', '0.8%'),
      ],
    },
  });
  const [finding] = await findingsOf(request);
  assert.deepEqual(finding?.evidence[0]?.locator, { kind: 'cell', sheetIndex: 2, cell: 'C2' });
  assert.equal(finding?.message.params['missing'], 'denominator,threshold,evidence');
  assert.equal(finding?.measure?.value, 0.8);
});
