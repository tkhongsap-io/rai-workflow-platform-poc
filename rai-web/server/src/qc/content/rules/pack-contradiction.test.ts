// W4-06d (W4b plan section 3.3, provisional until D09): PACK-CONTRADICTION reads the pack facts stated in slots 2 and 5
// on submit and raises one pack finding per fact two artifacts state with different yes/no answers (decision 30:
// `claimKey` = the fact ID), citing one place in each artifact. Agreeing, absent and N/A facts raise nothing. Owned by
// AI/COE as every pack finding (W0-06 7.1). Synthetic claims only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_MAPPINGS_BY_VERSION } from '@rai/shared/constants';
import type { QcFinding, QcRunRequest, QcRunResult, SelectedRule } from '@rai/shared/qc/types';
import {
  checkOwningLane,
  duplicateFindingKey,
  findingKeyOf,
  validateQcFinding,
} from '@rai/shared/qc/validate';
import { PACK_CONTRADICTION_PARAMS } from '../../../configuration/seed.js';
import type { Segment } from '../../extraction/port.js';
import { excerptHashOf } from '../excerpt.js';
import {
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

const RULE = 'PACK-CONTRADICTION';
const signal = () => new AbortController().signal;

const QUESTIONS = {
  personal_data: 'Does the use case process personal data?',
  external_vendor: 'Does an external vendor operate any part of the use case?',
} as const;
type Fact = keyof typeof QUESTIONS;

const fact = (id: Fact, answer: string): ClaimFields => ({
  item: id === 'personal_data' ? '1.1' : '1.2',
  question: QUESTIONS[id],
  answer,
});

/** A DOCX with a title paragraph, then one paragraph per fact claim (section 2, 3, ...). */
const docx = (...claims: ClaimFields[]): Segment[] => [
  { locator: { kind: 'section', index: 1 }, text: 'Pack facts.' },
  ...claims.map((fields, i) => claimParagraph(i + 2, fields)),
];

function runnerOf() {
  const extractor = recordingExtractor();
  const runner = createContentQcRunner({
    extractor,
    now: () => new Date('2026-09-28T05:00:00Z'),
    runnerVersion: '0.0.0',
  });
  return { extractor, runner };
}

async function runOf(request: QcRunRequest) {
  const { extractor, runner } = runnerOf();
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

/** A submit whose slots 2 and 5 hold these segments. */
const submitOf = (documents: NonNullable<RequestShape['documents']>, shape: RequestShape = {}) =>
  requestOf({ ...shape, trigger: 'submit', rules: onlyRules('submit', RULE), documents });

test('conflicting slot 2 and slot 5 facts raise one pack finding citing both artifacts, owned by AI/COE', async () => {
  const slot2 = docx(fact('personal_data', 'No'), fact('external_vendor', 'No'));
  const slot5 = docx(fact('personal_data', 'Yes'), fact('external_vendor', 'No'));
  const request = submitOf({ 2: slot2, 5: slot5 });
  const { findings, calls } = await runOf(request);
  assert.deepEqual([...calls].sort(), [2, 5], 'reads slots 2 and 5 only');
  const ref = (slot: 2 | 5) => {
    const artifact = request.artifacts.find((a) => a.slot === slot)!;
    return { artifactId: artifactIdOf(slot), contentHash: artifact.contentHash, slot };
  };
  assert.deepEqual(findings, [
    {
      findingKey: findingKeyOf(RULE, { kind: 'pack' }, 'personal_data'),
      ruleId: RULE,
      ruleRevision: request.qcRulesRevision,
      trigger: 'submit',
      scope: { kind: 'pack' },
      claimKey: 'personal_data',
      severity: 'medium',
      owningLane: 'ai_coe',
      evidence: [
        { ...ref(2), locator: slot2[1]!.locator, excerptHash: excerptHashOf(slot2[1]!.text) },
        { ...ref(5), locator: slot5[1]!.locator, excerptHash: excerptHashOf(slot5[1]!.text) },
      ],
      measure: null,
      message: {
        key: 'qc.finding.pack_contradiction',
        params: { fact: 'personal_data', slotA: 2, slotB: 5 },
      },
      provenance: { runner: 'content', runnerVersion: '0.0.0' },
    },
  ]);
  assert.equal(findings[0]!.findingKey, 'PACK-CONTRADICTION:pack:personal_data');
});

test('two contradicting facts give two findings, one per fact, in catalogue fact order', async () => {
  const findings = await findingsOf(
    submitOf({
      2: docx(fact('external_vendor', 'Yes'), fact('personal_data', 'Yes')),
      5: docx(fact('personal_data', 'No'), fact('external_vendor', 'No')),
    }),
  );
  assert.deepEqual(
    findings.map((f) => [f.claimKey, f.findingKey, f.evidence.map((e) => e.slot)]),
    [
      ['personal_data', 'PACK-CONTRADICTION:pack:personal_data', [2, 5]],
      ['external_vendor', 'PACK-CONTRADICTION:pack:external_vendor', [2, 5]],
    ],
  );
  // Each evidence entry points at the claim of its own fact.
  assert.deepEqual(
    findings.map((f) => f.evidence.map((e) => e.locator)),
    [
      [
        { kind: 'section', index: 3 },
        { kind: 'section', index: 2 },
      ],
      [
        { kind: 'section', index: 2 },
        { kind: 'section', index: 3 },
      ],
    ],
  );
});

test('agreeing, absent, N/A and unrecognised facts raise nothing', async () => {
  const both = (a: string, b: string) =>
    submitOf({ 2: docx(fact('personal_data', a)), 5: docx(fact('personal_data', b)) });
  assert.deepEqual(await findingsOf(both('Yes', 'yes')), [], 'agreeing (case folded)');
  assert.deepEqual(await findingsOf(both('No', 'N')), [], 'agreeing (another answer word)');
  assert.deepEqual(await findingsOf(both('Yes', 'N/A')), [], 'N/A states nothing');
  assert.deepEqual(await findingsOf(both('No', 'Perhaps')), [], 'an unknown answer states nothing');
  assert.deepEqual(
    await findingsOf(
      submitOf({ 2: docx(fact('personal_data', 'Yes')), 5: docx(fact('external_vendor', 'No')) }),
    ),
    [],
    'each fact stated by one artifact only',
  );
  assert.deepEqual(
    await findingsOf(submitOf({ 2: docx(fact('personal_data', 'Yes')) })),
    [],
    'slot 5 states no fact',
  );
  assert.deepEqual(
    await findingsOf(submitOf({ 2: docx(fact('personal_data', 'Yes')) }, { slots: { 5: 'missing' } })),
    [],
    'slot 5 missing: nothing to compare (PACK-SLOT-MISSING is metadata)',
  );
  // A claim whose question names no fact keyword is not a fact statement.
  assert.deepEqual(
    await findingsOf(
      submitOf({
        2: docx({ question: 'Is the use case in scope?', answer: 'Yes' }),
        5: docx({ question: 'Is the use case in scope?', answer: 'No' }),
      }),
    ),
    [],
  );
});

test('two answers inside one artifact are not a pack contradiction; a second artifact that differs is', async () => {
  const slot2 = docx(fact('personal_data', 'Yes'), fact('personal_data', 'No'));
  assert.deepEqual(await findingsOf(submitOf({ 2: slot2 })), []);
  const slot5 = docx(fact('personal_data', 'No'));
  const [finding, ...rest] = await findingsOf(submitOf({ 2: slot2, 5: slot5 }));
  assert.equal(rest.length, 0);
  // The first statement in request order, then the first statement of another artifact that differs from it.
  assert.deepEqual(
    finding!.evidence.map((e) => [e.slot, e.locator, e.excerptHash]),
    [
      [2, slot2[1]!.locator, excerptHashOf(slot2[1]!.text)],
      [5, slot5[1]!.locator, excerptHashOf(slot5[1]!.text)],
    ],
  );
});

test('XLSX answer cells and Thai keywords and answers are read as in the other rules', async () => {
  const header = (col: string, text: string): Segment => ({
    locator: { kind: 'cell', sheetIndex: 1, cell: `${col}1` },
    text,
  });
  const cell = (ref: string, text: string): Segment => ({
    locator: { kind: 'cell', sheetIndex: 1, cell: ref },
    text,
  });
  const xlsx: Segment[] = [
    header('A', 'item'),
    header('B', 'question'),
    header('C', 'answer'),
    cell('A2', '1.1'),
    cell('B2', QUESTIONS.personal_data),
    cell('C2', 'Yes'),
    cell('A3', '1.2'),
    cell('B3', QUESTIONS.external_vendor),
    cell('C3', 'No'),
  ];
  // Thai keys, keywords and answers (the seeded bilingual lists): no to both facts.
  const thai: Segment[] = [
    { locator: { kind: 'section', index: 1 }, text: 'ข้อเท็จจริงของชุดเอกสาร' },
    {
      locator: { kind: 'section', index: 2 },
      text: 'ข้อ: 1.1; คำถาม: ระบบมีการประมวลผลข้อมูลส่วนบุคคลหรือไม่; คำตอบ: ไม่ใช่',
    },
    {
      locator: { kind: 'section', index: 3 },
      text: 'ข้อ: 1.2; คำถาม: มีผู้ให้บริการภายนอกดำเนินการส่วนใดของระบบหรือไม่; คำตอบ: ไม่ใช่',
    },
  ];
  const findings = await findingsOf(submitOf({ 2: xlsx, 5: thai }));
  assert.deepEqual(
    findings.map((f) => [f.claimKey, f.evidence.map((e) => e.locator)]),
    [
      [
        'personal_data',
        [
          { kind: 'cell', sheetIndex: 1, cell: 'C2' },
          { kind: 'section', index: 2 },
        ],
      ],
    ],
  );
});

test('a fact is compared only across its own slots; the rule reads only the slots its params list', async () => {
  const params = structuredClone(PACK_CONTRADICTION_PARAMS);
  params.slots = [2, 3, 5];
  params.facts = [
    { id: 'personal_data', slots: [2, 5] },
    { id: 'external_vendor', slots: [3, 5] },
  ];
  const [rule] = onlyRules('submit', RULE);
  const rules: SelectedRule[] = [{ ...rule!, params }];
  const request = requestOf({
    trigger: 'submit',
    rules,
    documents: {
      2: docx(fact('personal_data', 'Yes'), fact('external_vendor', 'Yes')),
      3: docx(fact('personal_data', 'No'), fact('external_vendor', 'No')),
      5: docx(fact('personal_data', 'Yes'), fact('external_vendor', 'No')),
    },
  });
  const { findings, calls } = await runOf(request);
  assert.deepEqual([...calls].sort(), [2, 3, 5]);
  // personal_data: slots 2 and 5 agree (slot 3 is not its slot). external_vendor: slot 2 is not its slot; 3 and 5
  // agree. Nothing contradicts.
  assert.deepEqual(findings, []);
  // Slot 3 differing from slot 5 on the vendor fact does.
  const vendor = await findingsOf(
    requestOf({
      trigger: 'submit',
      rules,
      documents: {
        3: docx(fact('external_vendor', 'Yes')),
        5: docx(fact('external_vendor', 'No')),
      },
    }),
  );
  assert.deepEqual(
    vendor.map((f) => [f.claimKey, f.evidence.map((e) => e.slot), f.message.params]),
    [['external_vendor', [3, 5], { fact: 'external_vendor', slotA: 3, slotB: 5 }]],
  );
});

test('an unreadable slot 2 or 5 makes the submit content part unavailable, never clean', async () => {
  for (const slot of [2, 5] as const) {
    const { runner } = runnerOf();
    const result = await runner.run(
      submitOf({
        2: docx(fact('personal_data', 'No')),
        5: docx(fact('personal_data', 'No')),
        [slot]: { fail: 'unreadable' },
      }),
      signal(),
    );
    assert.equal(result.status, 'unavailable', `slot ${slot}`);
    if (result.status === 'unavailable')
      assert.deepEqual([result.reason, result.detail], ['artifact_unreadable', 'extract_unreadable']);
  }
});

test('the rule is a submit rule: selected on another trigger it fails the run before any read', async () => {
  const [rule] = onlyRules('submit', RULE);
  const { extractor, runner } = runnerOf();
  const result = await runner.run(
    requestOf({ trigger: 'approve_attempt', lane: 'ai_coe', rules: [rule!] }),
    signal(),
  );
  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable')
    assert.deepEqual([result.reason, result.detail], ['runner_error', 'unsupported_rule_trigger']);
  assert.deepEqual(extractor.calls, []);
});

test('params the schema accepts but that do not hold together fail the run before any read', async () => {
  const [rule] = onlyRules('submit', RULE);
  const broken: Array<[string, (p: typeof PACK_CONTRADICTION_PARAMS) => void]> = [
    ['a fact without keywords', (p) => delete (p.items as Record<string, unknown>)['external_vendor']],
    ['a fact slot the rule does not read', (p) => (p.facts[0]!.slots = [2, 6])],
    ['a fact listed twice', (p) => p.facts.push({ ...p.facts[0]! })],
  ];
  for (const [name, patch] of broken) {
    const params = structuredClone(PACK_CONTRADICTION_PARAMS);
    patch(params);
    const { extractor, runner } = runnerOf();
    const result = await runner.run(
      requestOf({
        trigger: 'submit',
        rules: [{ ...rule!, params }],
        documents: { 2: docx(fact('personal_data', 'Yes')), 5: docx(fact('personal_data', 'No')) },
      }),
      signal(),
    );
    assert.equal(result.status, 'unavailable', name);
    if (result.status === 'unavailable')
      assert.deepEqual([result.reason, result.detail], ['runner_error', 'invalid_rule_params'], name);
    assert.deepEqual(extractor.calls, [], name);
  }
});

test('the seeded submit selection has PACK-CONTRADICTION as its only content rule', () => {
  assert.deepEqual(
    seededRules('submit')
      .filter((r) => r.engine === 'content')
      .map((r) => r.ruleId),
    [RULE],
  );
});
