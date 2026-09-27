// W4-03 (W4a plan section 4): the deterministic runner as a `QcRunner`. Its identity is `deterministic` at the server
// package version; a request with no rules (`rules: null`) is `unavailable:not_configured`, never a clean pass;
// only metadata rules execute and count; anything it cannot vouch for is `runner_error`. It never reads a byte of
// any artifact: the artifacts handed to it refuse `read()`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Value } from 'typebox/value';
import { QcRunResultSchema } from '@rai/shared/qc/validate';
import type { QcRunResult, SelectedRule } from '@rai/shared/qc/types';
import { qcKindOf } from '../kind.js';
import { createDeterministicQcRunner } from './runner.js';
import { onlyRule, requestOf, seededRules } from './request-builder.test-helper.js';

const AT = new Date('2026-09-27T05:00:00Z');
const runner = createDeterministicQcRunner({ now: () => AT });
const signal = () => new AbortController().signal;

const unavailable = (result: QcRunResult) =>
  result.status === 'unavailable'
    ? { reason: result.reason, detail: result.detail }
    : { status: result.status };

test('identity: runner deterministic at the @rai/server package version; readiness reports deterministic', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    name: string;
    version: string;
  };
  assert.equal(pkg.name, '@rai/server');
  assert.deepEqual(createDeterministicQcRunner().identity, {
    runner: 'deterministic',
    runnerVersion: pkg.version,
  });
  assert.equal(qcKindOf(runner.identity), 'deterministic');
  assert.equal(createDeterministicQcRunner({ runnerVersion: '9.9.9' }).identity.runnerVersion, '9.9.9');
});

test('rules: null is unavailable:not_configured, never a clean pass', async () => {
  const reads = { count: 0 };
  const result = await runner.run(requestOf({ rules: null, slots: { 7: 'missing' }, reads }), signal());
  assert.deepEqual(unavailable(result), { reason: 'not_configured', detail: 'no_qc_rules_revision' });
  assert.equal(result.startedAt, AT.toISOString());
  assert.equal(reads.count, 0);
  assert.ok(Value.Check(QcRunResultSchema, result));
});

test('rules: [] completes with zero rules evaluated and no findings', async () => {
  const result = await runner.run(requestOf({ rules: [], slots: { 7: 'missing' } }), signal());
  assert.deepEqual(result, {
    status: 'completed',
    findings: [],
    rulesEvaluated: [],
    startedAt: AT.toISOString(),
    finishedAt: AT.toISOString(),
  });
});

test('rulesEvaluated lists the executed metadata rules in request order; content rules are neither run nor counted', async () => {
  const submit = await runner.run(requestOf(), signal());
  assert.equal(submit.status, 'completed');
  assert.deepEqual(submit.status === 'completed' ? submit.rulesEvaluated : null, [
    'PACK-SLOT-MISSING',
    'PACK-STAGE-MISMATCH',
    'PACK-NA-VENDOR-DOC',
  ]);
  const approveRules = seededRules('approve_attempt');
  assert.ok(approveRules.some((r) => r.engine === 'content'));
  const approve = await runner.run(requestOf({ trigger: 'approve_attempt', lane: 'dpo' }), signal());
  assert.deepEqual(approve.status === 'completed' ? approve.rulesEvaluated : null, ['PACK-SLOT-MISSING']);
  // A content rule the runner does not know is still only catalogued, never executed.
  const future: SelectedRule = { ruleId: 'ACC-FUTURE-RULE', engine: 'content', severity: 'high' };
  const onlyContent = await runner.run(requestOf({ rules: [future] }), signal());
  assert.deepEqual(onlyContent.status === 'completed' ? onlyContent.rulesEvaluated : null, []);
});

test('anything the runner cannot vouch for is runner_error, never a partial clean pass', async () => {
  const cases: Array<[string, ReturnType<typeof requestOf>]> = [
    [
      'unknown_metadata_rule',
      requestOf({
        rules: [
          ...onlyRule('PACK-SLOT-MISSING'),
          { ruleId: 'PACK-FUTURE-RULE', engine: 'metadata', severity: 'low' },
        ],
      }),
    ],
    ['unsupported_rule_trigger', requestOf({ trigger: 'upload', rules: onlyRule('PACK-SLOT-MISSING') })],
    [
      'unsupported_rule_trigger',
      requestOf({ trigger: 'approve_attempt', rules: onlyRule('PACK-NA-VENDOR-DOC') }),
    ],
    [
      'unknown_lane_mapping',
      { ...requestOf({ slots: { 7: 'missing' } }), laneMappingVersion: 'lane-mapping/v0' },
    ],
    ['approve_attempt_without_lane', { ...requestOf({ trigger: 'approve_attempt' }), lane: null }],
  ];
  for (const [detail, request] of cases) {
    const result = await runner.run(request, signal());
    assert.deepEqual(unavailable(result), { reason: 'runner_error', detail }, detail);
    assert.ok(Value.Check(QcRunResultSchema, result));
  }
});

test('never reads document bytes: every artifact refuses read(), and a run that raises every rule never calls it', async () => {
  const reads = { count: 0 };
  const request = requestOf({
    stage: 'idea',
    vendor: true,
    slots: { 3: 'not_applicable', 4: 'not_applicable', 7: 'missing' },
    reads,
  });
  assert.ok(request.artifacts.length > 0);
  await assert.rejects(request.artifacts[0]!.read(), /never read document bytes/);
  reads.count = 0;
  const result = await runner.run(request, signal());
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.status === 'completed' ? result.findings.map((f) => f.ruleId) : [], [
    'PACK-SLOT-MISSING',
    'PACK-STAGE-MISMATCH',
    'PACK-NA-VENDOR-DOC',
    'PACK-NA-VENDOR-DOC',
  ]);
  assert.equal(reads.count, 0);
  const approve = await runner.run(
    requestOf({ trigger: 'approve_attempt', lane: 'it_security', slots: { 5: 'missing' }, reads }),
    signal(),
  );
  assert.equal(approve.status, 'completed');
  assert.equal(reads.count, 0);
});

test('findings carry the request revision, trigger and the runner identity; the output is schema-valid and repeatable', async () => {
  const request = requestOf({
    stage: 'pre_launch',
    vendor: true,
    slots: { 2: 'missing', 4: 'not_applicable', 6: 'not_yet' },
  });
  const first = await runner.run(request, signal());
  const second = await runner.run(request, signal());
  assert.ok(Value.Check(QcRunResultSchema, first));
  assert.deepEqual(first, second);
  assert.equal(first.status, 'completed');
  if (first.status !== 'completed') return;
  assert.equal(first.findings.length, 3);
  for (const finding of first.findings) {
    assert.equal(finding.ruleRevision, request.qcRulesRevision);
    assert.equal(finding.trigger, 'submit');
    assert.deepEqual(finding.provenance, runner.identity);
  }
});
