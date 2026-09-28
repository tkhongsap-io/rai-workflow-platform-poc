// W4-06a (W4b plan section 3.1; decisions 22, 27 and 28): the content runner as a `QcRunner`. It executes only
// `content` rules, decides everything it can before reading a byte, reads only the slots each rule may read for this
// trigger and lane, checks every artifact's bytes against its hash, extracts each artifact once, and maps every
// extraction outcome to an unavailable result, never to a shorter clean one. A recording fake `Extractor` shows which
// slots were read. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { LANES, LANE_MAPPINGS_BY_VERSION, type Lane } from '@rai/shared/constants';
import type { QcRunResult, SelectedRule } from '@rai/shared/qc/types';
import { QcRunResultSchema, checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import type { ExtractFailureReason } from '../extraction/port.js';
import {
  COMPLETE_ACCURACY,
  claimParagraph,
  onlyRules,
  recordingExtractor,
  requestOf,
  seededRules,
  type RequestShape,
} from './request.test-helper.js';
import { createContentQcRunner, type ExtractFailedEvent } from './runner.js';

const AT = new Date('2026-09-27T05:00:00Z');
const signal = () => new AbortController().signal;
const outcome = (result: QcRunResult) =>
  result.status === 'unavailable'
    ? { reason: result.reason, detail: result.detail }
    : { status: result.status, findings: result.findings.length };

/** A slot-1 or slot-5 document with one defective accuracy claim (no threshold). */
const defective = (index = 1) => [claimParagraph(index, { ...COMPLETE_ACCURACY, threshold: undefined })];

async function run(shape: RequestShape) {
  const extractor = recordingExtractor();
  const failures: ExtractFailedEvent[] = [];
  const reads = shape.reads ?? new Map<number, number>();
  const runner = createContentQcRunner({
    extractor,
    now: () => AT,
    runnerVersion: '0.0.0',
    onExtractFailed: (event) => failures.push(event),
  });
  const request = requestOf({ ...shape, reads });
  const result = await runner.run(request, signal());
  assert.ok(Value.Check(QcRunResultSchema, result), JSON.stringify(result));
  return { result, request, extracted: extractor.calls, reads, failures };
}

test('identity: runner `content` at the server package version', () => {
  const runner = createContentQcRunner({ extractor: recordingExtractor() });
  assert.equal(runner.identity.runner, 'content');
  assert.match(runner.identity.runnerVersion, /^\d+\.\d+\.\d+/);
  assert.equal(
    createContentQcRunner({ extractor: recordingExtractor(), runnerVersion: '9.9.9' }).identity.runnerVersion,
    '9.9.9',
  );
});

test('rules: null is unavailable:not_configured and reads nothing', async () => {
  const { result, extracted, reads } = await run({ rules: null, documents: { 1: defective() } });
  assert.deepEqual(outcome(result), { reason: 'not_configured', detail: 'no_qc_rules_revision' });
  assert.deepEqual(extracted, []);
  assert.equal(reads.size, 0);
});

test('only content rules run: metadata rules are skipped and not counted; no content rule reads no bytes', async () => {
  // W4-06d seeds PACK-CONTRADICTION on submit, so the seeded submit selection is no longer metadata-only: take its
  // metadata rules (the three W4a submit rules and W5-10's RISK-TIER-UNKNOWN).
  const metadataOnly = seededRules('submit').filter((r) => r.engine === 'metadata');
  assert.deepEqual(
    metadataOnly.map((r) => r.ruleId),
    ['PACK-SLOT-MISSING', 'PACK-STAGE-MISMATCH', 'PACK-NA-VENDOR-DOC', 'RISK-TIER-UNKNOWN'],
  );
  const submit = await run({ trigger: 'submit', rules: metadataOnly, documents: { 1: defective() } });
  assert.deepEqual(submit.result.status === 'completed' && submit.result.rulesEvaluated, []);
  assert.deepEqual(outcome(submit.result), { status: 'completed', findings: 0 });
  assert.deepEqual(submit.extracted, []);
  assert.equal(submit.reads.size, 0);

  const empty = await run({ rules: [], documents: { 1: defective() } });
  assert.deepEqual(outcome(empty.result), { status: 'completed', findings: 0 });
  assert.equal(
    empty.result.status === 'completed' && empty.result.engine,
    undefined,
    'no extraction, no identity',
  );
  assert.equal(empty.reads.size, 0);

  const mixed = await run({
    rules: onlyRules('approve_attempt', 'PACK-SLOT-MISSING', 'ACC-METRIC-CITED'),
    documents: { 1: defective() },
  });
  assert.deepEqual(mixed.result.status === 'completed' && mixed.result.rulesEvaluated, ['ACC-METRIC-CITED']);
  assert.deepEqual(outcome(mixed.result), { status: 'completed', findings: 1 });
  assert.deepEqual(mixed.result.status === 'completed' && mixed.result.engine, {
    extractorVersion: 'rai-extract/1+test',
  });
});

test('fail closed before reading: unknown rule, wrong trigger, bad params, model source, unknown mapping, no lane', async () => {
  const cited = onlyRules('approve_attempt', 'ACC-METRIC-CITED')[0]!;
  const cases: Array<[string, RequestShape, { reason: string; detail: string }]> = [
    [
      'a content rule this runner does not implement',
      { rules: [{ ruleId: 'ACC-NOT-BUILT', engine: 'content', severity: 'low' }] },
      { reason: 'runner_error', detail: 'unknown_content_rule' },
    ],
    [
      'a trigger the rule is not defined for',
      { trigger: 'submit', rules: [cited] },
      { reason: 'runner_error', detail: 'unsupported_rule_trigger' },
    ],
    [
      'params that fail the schema',
      { rules: [{ ...cited, params: { ...cited.params, slots: [9] } }] },
      { reason: 'runner_error', detail: 'invalid_rule_params' },
    ],
    [
      'no params',
      { rules: [{ ruleId: cited.ruleId, engine: 'content', severity: cited.severity }] },
      { reason: 'runner_error', detail: 'invalid_rule_params' },
    ],
    [
      'a grammar+model rule while no model port exists',
      { rules: [{ ...cited, params: { ...cited.params, claimSource: 'grammar+model' } }] },
      { reason: 'not_configured', detail: 'model_disabled' },
    ],
    [
      'an approve attempt without a lane',
      { lane: null },
      { reason: 'runner_error', detail: 'approve_attempt_without_lane' },
    ],
  ];
  for (const [name, shape, expected] of cases) {
    const { result, extracted, reads } = await run({
      ...shape,
      documents: { 1: defective(), 5: defective() },
    });
    assert.deepEqual(outcome(result), expected, name);
    assert.deepEqual(extracted, [], name);
    assert.equal(reads.size, 0, name);
  }
  // W4-06c: every content rule of the seeded llm approve-attempt selection is implemented (ACC-BAND-V1-SHEET3 was the
  // last), so the seeded selection now runs to completion; an unknown rule ID is still refused (above).
  const seeded = await run({ rules: seededRules('approve_attempt') });
  assert.equal(seeded.result.status, 'completed', JSON.stringify(seeded.result));
  if (seeded.result.status === 'completed')
    assert.deepEqual(seeded.result.rulesEvaluated, [
      'ACC-METRIC-CITED',
      'ACC-EXTRACTION-NOT-HALLUCINATION',
      'ACC-BAND-V1-SHEET3',
    ]);

  const runner = createContentQcRunner({ extractor: recordingExtractor(), now: () => AT });
  const unknownMapping = await runner.run(
    { ...requestOf(), laneMappingVersion: 'lane-mapping/v0' },
    signal(),
  );
  assert.deepEqual(outcome(unknownMapping), { reason: 'runner_error', detail: 'unknown_lane_mapping' });
});

test('upload lane scope (decision 22): slot 1 is read and judged for AI/COE; slot 5 reads nothing and raises nothing', async () => {
  const slot1 = await run({ trigger: 'upload', uploadSlot: 1, documents: { 1: defective() } });
  assert.deepEqual(slot1.extracted, [1]);
  assert.equal(slot1.reads.get(1), 1);
  assert.equal(slot1.result.status, 'completed');
  if (slot1.result.status !== 'completed') return;
  assert.equal(slot1.result.findings.length, 1);
  assert.equal(slot1.result.findings[0]?.owningLane, 'ai_coe');
  assert.deepEqual(slot1.result.rulesEvaluated, ['ACC-METRIC-CITED']);

  const slot5 = await run({ trigger: 'upload', uploadSlot: 5, documents: { 5: defective() } });
  assert.deepEqual(outcome(slot5.result), { status: 'completed', findings: 0 });
  assert.deepEqual(slot5.extracted, []);
  assert.equal(slot5.reads.size, 0);
  assert.deepEqual(slot5.result.status === 'completed' && slot5.result.rulesEvaluated, ['ACC-METRIC-CITED']);
  // A scanned slot-5 upload is never a content outage.
  const scanned5 = await run({ trigger: 'upload', uploadSlot: 5, documents: { 5: { fail: 'unreadable' } } });
  assert.deepEqual(outcome(scanned5.result), { status: 'completed', findings: 0 });
});

test('approve-attempt lane scope (decision 28): DPO and IT/Security never read slot 1; AI/COE reads 1 and 5', async () => {
  const documents = { 1: defective(), 5: defective() };
  const readsByLane: Record<string, number[]> = {};
  for (const lane of LANES) {
    const { result, extracted, request } = await run({ lane, documents });
    readsByLane[lane] = [...extracted].sort();
    assert.equal(result.status, 'completed', lane);
    if (result.status !== 'completed') continue;
    const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!;
    for (const finding of result.findings) {
      assert.equal(finding.owningLane, lane, `${lane}: ${finding.findingKey}`);
      assert.equal(validateQcFinding(finding, request), null);
      assert.equal(checkOwningLane(finding, mapping, request.lane), null, 'never finding_outside_lane');
    }
    const slots = result.findings.map((f) => (f.scope.kind === 'artifact' ? f.scope.slot : null)).sort();
    assert.deepEqual(slots, lane === 'ai_coe' ? [1, 5] : [5], lane);
  }
  assert.deepEqual(readsByLane, { dpo: [5], ai_coe: [1, 5], it_security: [5] });
});

test('a scanned slot 1 makes only the AI/COE content part unavailable; DPO and IT/Security complete', async () => {
  const documents = { 1: { fail: 'unreadable' as const }, 5: defective() };
  const byLane = new Map<Lane, ReturnType<typeof outcome>>();
  for (const lane of LANES) byLane.set(lane, outcome((await run({ lane, documents })).result));
  assert.deepEqual(byLane.get('ai_coe'), { reason: 'artifact_unreadable', detail: 'extract_unreadable' });
  assert.deepEqual(byLane.get('dpo'), { status: 'completed', findings: 1 });
  assert.deepEqual(byLane.get('it_security'), { status: 'completed', findings: 1 });
});

test('slots that are not attached are skipped; slot 9 is never read', async () => {
  const cited = onlyRules('approve_attempt', 'ACC-METRIC-CITED')[0]!;
  const { result, extracted } = await run({
    slots: { 1: 'missing', 5: 'not_applicable' },
    rules: [{ ...cited, params: { ...cited.params, slots: [1, 5, 8] } }],
    lane: 'ai_coe',
  });
  assert.deepEqual(outcome(result), { status: 'completed', findings: 0 });
  assert.deepEqual(extracted, []);
});

test('each artifact is read and extracted once per run, however many rules read it', async () => {
  const cited = onlyRules('approve_attempt', 'ACC-METRIC-CITED')[0]!;
  // The same rule selected twice is a malformed catalogue in practice; here it stands for two rules on one slot.
  const { extracted, reads } = await run({
    lane: 'dpo',
    rules: [cited, cited],
    documents: { 5: defective() },
  });
  assert.deepEqual(extracted, [5]);
  assert.equal(reads.get(5), 1);
});

test('bytes are checked: a read that rejects is blob_missing; a wrong hash or extra bytes is hash_mismatch', async () => {
  const blob = await run({ trigger: 'upload', documents: { 1: { readRejects: true } } });
  assert.deepEqual(outcome(blob.result), { reason: 'artifact_unreadable', detail: 'blob_missing' });
  assert.deepEqual(blob.extracted, []);

  const bytes = new TextEncoder().encode(JSON.stringify({ slot: 1, segments: [] }));
  const wrongHash = await run({
    trigger: 'upload',
    documents: { 1: { bytes, declaredHash: 'e'.repeat(64) } },
  });
  assert.deepEqual(outcome(wrongHash.result), { reason: 'artifact_unreadable', detail: 'hash_mismatch' });
  assert.deepEqual(wrongHash.extracted, [], 'bytes that fail the hash never reach the extractor');

  const longer = await run({
    trigger: 'upload',
    documents: { 1: { bytes, declaredLength: bytes.length - 1 } },
  });
  assert.deepEqual(outcome(longer.result), { reason: 'artifact_unreadable', detail: 'hash_mismatch' });

  const media = await run({
    trigger: 'upload',
    documents: { 1: { mediaType: 'text/plain', segments: defective() } },
  });
  assert.deepEqual(outcome(media.result), { reason: 'artifact_unreadable', detail: 'extract_unreadable' });
  assert.deepEqual(media.extracted, []);
});

test('every extraction outcome maps to an unavailable result, never a shorter clean one', async () => {
  const expected: Record<ExtractFailureReason, { reason: string; detail: string }> = {
    unreadable: { reason: 'artifact_unreadable', detail: 'extract_unreadable' },
    limit_bytes: { reason: 'artifact_unreadable', detail: 'extract_limit_bytes' },
    limit_time: { reason: 'artifact_unreadable', detail: 'extract_limit_time' },
    limit_memory: { reason: 'artifact_unreadable', detail: 'extract_limit_memory' },
    limit_output: { reason: 'artifact_unreadable', detail: 'extract_limit_output' },
    crash: { reason: 'runner_error', detail: 'extract_crash' },
  };
  for (const [reason, want] of Object.entries(expected) as Array<
    [ExtractFailureReason, (typeof expected)['crash']]
  >) {
    const { result, failures } = await run({ lane: 'dpo', documents: { 5: { fail: reason } } });
    assert.deepEqual(outcome(result), want, reason);
    assert.deepEqual(result.engine, { extractorVersion: 'rai-extract/1+test' }, reason);
    assert.equal(failures.length, 1, reason);
    assert.deepEqual(
      { ...failures[0], durationMs: 0 },
      { slot: 5, reason, durationMs: 0, extractorVersion: 'rai-extract/1+test' },
    );
  }
  const thrown = await run({ lane: 'dpo', documents: { 5: { throws: true } } });
  assert.deepEqual(outcome(thrown.result), { reason: 'runner_error', detail: 'extract_crash' });
  assert.equal(thrown.failures[0]?.reason, 'crash');
});

test('one unreadable artifact makes the content part unavailable although another artifact holds a finding', async () => {
  const { result, extracted } = await run({
    lane: 'ai_coe',
    documents: { 1: defective(), 5: { fail: 'limit_output' } },
  });
  assert.deepEqual(outcome(result), { reason: 'artifact_unreadable', detail: 'extract_limit_output' });
  assert.deepEqual([...extracted].sort(), [1, 5]);
});

test('an aborted signal is a timeout', async () => {
  const runner = createContentQcRunner({ extractor: recordingExtractor(), now: () => AT });
  const controller = new AbortController();
  controller.abort();
  const result = await runner.run(requestOf({ documents: { 1: defective() } }), controller.signal);
  assert.deepEqual(outcome(result), { reason: 'timeout', detail: null });
});

test('a rule whose readable slots hold nothing is still counted as evaluated', async () => {
  const rules: SelectedRule[] = onlyRules('approve_attempt', 'ACC-METRIC-CITED');
  const { result } = await run({ lane: 'it_security', rules, slots: { 5: 'missing' } });
  assert.deepEqual(result.status === 'completed' && result.rulesEvaluated, ['ACC-METRIC-CITED']);
});
