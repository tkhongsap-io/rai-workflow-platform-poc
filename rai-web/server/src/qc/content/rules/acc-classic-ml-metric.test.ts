// W4-06b (W4b plan section 3.3, provisional until D09): ACC-CLASSIC-ML-METRIC. A classic-ML case's slot 1 must cite
// a matching metric with a value on the model-performance item, or answer N/A with a reason; otherwise one finding for
// the artifact, citing the performance claims or, when there are none, an `absent` locator. A slot 1 marked not
// applicable is metadata and raises nothing. Selected only for `classic_ml` (`qc/select.ts`), read on the AI/COE
// approve attempt only (decision 28). Synthetic claims only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_MAPPINGS_BY_VERSION, type Lane } from '@rai/shared/constants';
import type { ModelType, QcFinding, QcRunRequest, SelectedRule } from '@rai/shared/qc/types';
import {
  checkOwningLane,
  duplicateFindingKey,
  findingKeyOf,
  validateQcFinding,
} from '@rai/shared/qc/validate';
import { CONFIGURATION_SEED } from '../../../configuration/seed.js';
import { selectRules } from '../../select.js';
import { excerptHashOf } from '../excerpt.js';
import {
  COMPLETE_HALLUCINATION,
  TEMPLATE,
  artifactIdOf,
  claimParagraph,
  recordingExtractor,
  requestOf,
  type ClaimFields,
  type RequestShape,
} from '../request.test-helper.js';
import { createContentQcRunner } from '../runner.js';
import { CONTENT_RULES } from './index.js';

const RULE = 'ACC-CLASSIC-ML-METRIC';
const signal = () => new AbortController().signal;

/** The seeded approve-attempt selection for a model type (the orchestrator's `selectRules`, unchanged). */
const seeded = (modelType: ModelType, template = TEMPLATE): SelectedRule[] =>
  selectRules(CONFIGURATION_SEED.qc_rules, template, 'approve_attempt', modelType);
const classicRule = (): SelectedRule => seeded('classic_ml').find((r) => r.ruleId === RULE)!;

/** A classic-ML request (`modelType` as the orchestrator builds it). */
function classicRequest(shape: RequestShape = {}, modelType: ModelType = 'classic_ml'): QcRunRequest {
  return { ...requestOf({ rules: [classicRule()], ...shape }), modelType };
}

async function runOf(request: QcRunRequest) {
  const extractor = recordingExtractor();
  const runner = createContentQcRunner({
    extractor,
    now: () => new Date('2026-09-27T05:00:00Z'),
    runnerVersion: '0.0.0',
  });
  const result = await runner.run(request, signal());
  assert.equal(result.status, 'completed', JSON.stringify(result));
  if (result.status !== 'completed')
    return { findings: [] as QcFinding[], calls: extractor.calls, rulesEvaluated: [] as string[] };
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!;
  for (const finding of result.findings) {
    assert.equal(validateQcFinding(finding, request), null, finding.findingKey);
    assert.equal(checkOwningLane(finding, mapping, request.lane), null, finding.findingKey);
  }
  assert.equal(duplicateFindingKey(result.findings), null);
  return { findings: result.findings, calls: extractor.calls, rulesEvaluated: result.rulesEvaluated };
}

const findingsOf = async (request: QcRunRequest) => (await runOf(request)).findings;
const slotOne = (...claims: ClaimFields[]) =>
  classicRequest({ documents: { 1: claims.map((fields, i) => claimParagraph(i + 1, fields)) } });

const MATCHING: ClaimFields = {
  item: '3.1',
  question: 'Model performance measured with a matching metric?',
  answer: 'Yes',
  metric: 'f1',
  value: '0.91',
  denominator: '1200',
  threshold: '0.85',
  evidence: 'eval-report-31',
};
const REASONED_NA: ClaimFields = {
  item: '3.1',
  question: 'Model performance measured with a matching metric?',
  answer: 'N/A',
  evidence: 'Rule-based scoring; no trained model',
};

test('a matching metric with a value passes; so does a reasoned N/A (no invented deficiency)', async () => {
  assert.deepEqual(await findingsOf(slotOne(MATCHING)), []);
  assert.deepEqual(await findingsOf(slotOne({ ...MATCHING, metric: 'AUC-ROC', value: '0.88' })), []);
  assert.deepEqual(await findingsOf(slotOne({ ...REASONED_NA, evidence: 'no trained model' })), []);
  // One satisfying claim is enough, even beside a defective one.
  assert.deepEqual(await findingsOf(slotOne({ ...MATCHING, value: undefined }, MATCHING)), []);
  // Thai labels: a reasoned ไม่เกี่ยวข้อง (N/A).
  const thai = classicRequest({
    documents: {
      1: [
        {
          locator: { kind: 'section', index: 2 },
          text: 'ข้อ: 3.1; คำถาม: มีการวัดประสิทธิภาพของโมเดลด้วยตัวชี้วัดที่เหมาะสมหรือไม่; คำตอบ: ไม่เกี่ยวข้อง; หลักฐาน: ระบบใช้กฎที่กำหนดไว้ล่วงหน้า',
        },
      ],
    },
  });
  assert.deepEqual(await findingsOf(thai), []);
});

test('a performance claim without a matching metric and value fires, citing the claim', async () => {
  const request = slotOne({ ...MATCHING, metric: undefined, value: undefined });
  const [finding, ...rest] = await findingsOf(request);
  assert.equal(rest.length, 0);
  const artifact = request.artifacts.find((a) => a.slot === 1)!;
  const scope = {
    kind: 'artifact' as const,
    slot: 1 as const,
    artifactId: artifactIdOf(1),
    contentHash: artifact.contentHash,
  };
  const text =
    'item: 3.1; question: Model performance measured with a matching metric?; answer: Yes; denominator: 1200; threshold: 0.85; evidence: eval-report-31';
  assert.deepEqual(finding, {
    findingKey: findingKeyOf(RULE, scope),
    ruleId: RULE,
    ruleRevision: request.qcRulesRevision,
    trigger: 'approve_attempt',
    scope,
    severity: 'medium',
    owningLane: 'ai_coe',
    evidence: [
      {
        artifactId: artifactIdOf(1),
        contentHash: artifact.contentHash,
        slot: 1,
        locator: { kind: 'section', index: 1 },
        excerptHash: excerptHashOf(text),
      },
    ],
    measure: null,
    message: { key: 'qc.finding.acc_classic_ml_metric', params: { slot: 1, threshold_source: TEMPLATE } },
    provenance: { runner: 'content', runnerVersion: '0.0.0' },
  });
  assert.ok(!JSON.stringify(finding).includes('Model performance'), 'no claim text in the finding');
});

test('each shortfall fires: a non-matching metric, a metric without a value, an N/A without a reason', async () => {
  for (const [name, claim] of [
    ['a non-matching metric', { ...MATCHING, metric: 'hallucination_rate' }],
    ['an extraction metric', { ...MATCHING, metric: 'extraction_accuracy' }],
    ['no value', { ...MATCHING, value: undefined }],
    ['a value that is not a number', { ...MATCHING, value: 'good' }],
    ['an N/A without a reason', { ...REASONED_NA, evidence: undefined }],
    ['an N/A with a blank reason', { ...REASONED_NA, evidence: ' ' }],
    ['an unknown answer with a matching metric absent', { ...MATCHING, answer: 'maybe', metric: undefined }],
  ] as Array<[string, ClaimFields]>) {
    const findings = await findingsOf(slotOne(claim));
    assert.equal(findings.length, 1, name);
    assert.equal(findings[0]?.evidence[0]?.locator.kind, 'section', name);
  }
});

test('several performance claims, none satisfying, are one finding citing each of them', async () => {
  const [finding, ...rest] = await findingsOf(
    slotOne({ ...MATCHING, metric: undefined }, COMPLETE_HALLUCINATION, {
      ...REASONED_NA,
      evidence: undefined,
    }),
  );
  assert.equal(rest.length, 0);
  assert.equal(finding?.claimKey, undefined, 'the defect is the artifact’s, not one claim’s');
  assert.deepEqual(
    finding?.evidence.map((e) => e.locator),
    [
      { kind: 'section', index: 1 },
      { kind: 'section', index: 3 },
    ],
  );
  assert.ok(finding?.evidence.every((e) => typeof e.excerptHash === 'string'));
});

test('no performance claim at all fires with an `absent` locator on the artifact', async () => {
  const request = classicRequest({
    documents: { 1: [{ locator: { kind: 'page', page: 1 }, text: 'Evaluation evidence follows later.' }] },
  });
  const [finding, ...rest] = await findingsOf(request);
  assert.equal(rest.length, 0);
  const artifact = request.artifacts.find((a) => a.slot === 1)!;
  assert.deepEqual(finding?.evidence, [
    { artifactId: artifactIdOf(1), contentHash: artifact.contentHash, slot: 1, locator: { kind: 'absent' } },
  ]);
  // An empty document is the same omission.
  assert.equal((await findingsOf(classicRequest({ documents: { 1: [] } }))).length, 1);
});

test('slot 1 not applicable (with its reason), missing or not yet: metadata, no finding and no read', async () => {
  for (const disposition of ['not_applicable', 'missing', 'not_yet'] as const) {
    const { findings, calls, rulesEvaluated } = await runOf(classicRequest({ slots: { 1: disposition } }));
    assert.deepEqual(findings, [], disposition);
    assert.deepEqual(calls, [], disposition);
    assert.deepEqual(rulesEvaluated, [RULE], `${disposition}: the rule ran with nothing in scope`);
  }
});

test('DPO and IT/Security approve attempts read no slot-1 bytes and emit nothing (decision 28)', async () => {
  for (const lane of ['dpo', 'it_security'] as Lane[]) {
    const { findings, calls } = await runOf(classicRequest({ lane, documents: { 1: [], 5: [] } }));
    assert.deepEqual(findings, [], lane);
    assert.deepEqual(calls, [], lane);
  }
  const { findings, calls } = await runOf(classicRequest({ documents: { 1: [], 5: [] } }));
  assert.equal(findings.length, 1);
  assert.deepEqual(calls, [1], 'the AI/COE attempt reads slot 1 only');
});

test('model_type routing: classic_ml runs only this rule; llm and other never run it', async () => {
  const implemented = (rules: SelectedRule[]) =>
    rules
      .filter((r) => r.engine === 'content' && Object.hasOwn(CONTENT_RULES, r.ruleId))
      .map((r) => r.ruleId);
  assert.deepEqual(implemented(seeded('classic_ml')), [RULE]);
  assert.deepEqual(implemented(seeded('classic_ml', 'v2.0')), [RULE]);
  for (const modelType of ['llm', 'other'] as const)
    for (const template of [TEMPLATE, 'v2.0']) {
      const ids = seeded(modelType, template).map((r) => r.ruleId);
      assert.ok(!ids.includes(RULE), `${modelType} ${template}`);
      assert.ok(ids.includes('ACC-EXTRACTION-NOT-HALLUCINATION'), `${modelType} ${template}`);
    }
  // The whole seeded classic-ML selection (a metadata rule plus this rule) now completes on the content runner. A
  // classic-ML slot 1 that cites an extraction figure raises no ACC-EXTRACTION-NOT-HALLUCINATION finding: routed away.
  const request = {
    ...requestOf({
      rules: seeded('classic_ml'),
      documents: {
        1: [
          claimParagraph(1, MATCHING),
          claimParagraph(2, { ...COMPLETE_HALLUCINATION, metric: 'extraction_accuracy' }),
        ],
      },
    }),
    modelType: 'classic_ml' as const,
  };
  const { findings, rulesEvaluated } = await runOf(request);
  assert.deepEqual(findings, []);
  assert.deepEqual(rulesEvaluated, [RULE]);
});
