// W4-08a (W4b plan section 11.2): the orchestrator's result checks (W0-07 3.4 steps 4-5), moved out of
// `orchestrator.ts` so the evaluation harness passes every result through the same boundary. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QcFinding, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import { ENGINE_IDENTITY_INVALID } from './engine-identity.js';
import { createDeterministicQcRunner } from './deterministic/runner.js';
import { requestOf } from './deterministic/request-builder.test-helper.js';
import { callRunner, checkedResult, unavailableResult } from './check-result.js';

const STAMP = new Date('2026-09-27T05:00:00Z');
const AT = STAMP.toISOString();
// An approve attempt with slot 5 missing: the deterministic runner raises PACK-SLOT-MISSING owned by the DPO.
const request = requestOf({ trigger: 'approve_attempt', lane: 'dpo', slots: { 5: 'missing' } });

async function validFindings(): Promise<QcFinding[]> {
  const result = await createDeterministicQcRunner({ now: () => STAMP }).run(
    request,
    new AbortController().signal,
  );
  assert.equal(result.status, 'completed');
  assert.ok(result.status === 'completed' && result.findings.length > 0);
  return result.status === 'completed' ? result.findings : [];
}

const completed = (findings: QcFinding[], engine?: QcRunResult['engine']): QcRunResult => ({
  status: 'completed',
  findings,
  rulesEvaluated: ['PACK-SLOT-MISSING'],
  startedAt: AT,
  finishedAt: AT,
  ...(engine === undefined ? {} : { engine }),
});

test('unavailableResult stamps both instants and keeps the detail', () => {
  assert.deepEqual(unavailableResult('timeout', null, STAMP), {
    status: 'unavailable',
    reason: 'timeout',
    detail: null,
    startedAt: AT,
    finishedAt: AT,
  });
  assert.equal(unavailableResult('runner_error', 'x_y', STAMP).status, 'unavailable');
});

test('checkedResult passes a valid completed result and an unavailable one unchanged', async () => {
  const ok = completed(await validFindings(), { extractorVersion: 'rai-extract/1+test' });
  assert.equal(checkedResult(ok, request, STAMP), ok);
  const down = unavailableResult('artifact_unreadable', 'extract_unreadable', STAMP);
  assert.equal(checkedResult(down, request, STAMP), down);
});

test('checkedResult refuses an engine identity that is not identifiers and numbers, without keeping it', async () => {
  const bad = completed(await validFindings(), { extractorVersion: 'has spaces and text' });
  assert.deepEqual(
    checkedResult(bad, request, STAMP),
    unavailableResult('runner_error', ENGINE_IDENTITY_INVALID, STAMP),
  );
});

test('checkedResult fails the whole run on one invalid finding and keeps a valid engine identity', async () => {
  const [finding] = await validFindings();
  const engine = { extractorVersion: 'rai-extract/1+test' };
  const wrongLane = completed([{ ...finding!, owningLane: 'ai_coe' }], engine);
  const refused = checkedResult(wrongLane, request, STAMP);
  assert.equal(refused.status, 'unavailable');
  assert.ok(refused.status === 'unavailable');
  assert.equal(refused.reason, 'runner_error');
  assert.equal(refused.detail, 'finding_outside_lane');
  assert.deepEqual(refused.engine, engine);
  const otherRevision = checkedResult(completed([{ ...finding!, ruleRevision: 'other' }]), request, STAMP);
  assert.ok(otherRevision.status === 'unavailable' && otherRevision.reason === 'runner_error');
  assert.equal(otherRevision.engine, undefined);
});

test('checkedResult fails a run whose findings share a finding key', async () => {
  const [finding] = await validFindings();
  const result = checkedResult(completed([finding!, finding!], { extractorVersion: 'e1' }), request, STAMP);
  assert.deepEqual(result, {
    ...unavailableResult('runner_error', 'duplicate_finding_key', STAMP),
    engine: { extractorVersion: 'e1' },
  });
});

test('checkedResult: an unknown lane mapping vouches for no lane', async () => {
  const findings = await validFindings();
  const result = checkedResult(
    completed(findings),
    { ...request, laneMappingVersion: 'lane-mapping/v0' },
    STAMP,
  );
  assert.ok(result.status === 'unavailable');
  assert.equal(result.detail, 'owning_lane_mismatch');
});

const runnerOf = (run: QcRunner['run']): QcRunner => ({
  identity: { runner: 'test', runnerVersion: '0' },
  run,
});

test('callRunner checks the result, and maps a throw to runner_error and the deadline to timeout', async () => {
  const findings = await validFindings();
  const ok = await callRunner(
    runnerOf(() => Promise.resolve(completed(findings))),
    request,
    STAMP,
    1000,
  );
  assert.equal(ok.status, 'completed');
  const refused = await callRunner(
    runnerOf(() => Promise.resolve(completed([findings[0]!, findings[0]!]))),
    request,
    STAMP,
    1000,
  );
  assert.ok(refused.status === 'unavailable' && refused.detail === 'duplicate_finding_key');
  const thrown = await callRunner(
    runnerOf(() => Promise.reject(new Error('boom'))),
    request,
    STAMP,
    1000,
  );
  assert.deepEqual(thrown, unavailableResult('runner_error', null, STAMP));
  let aborted = false;
  const slow = await callRunner(
    runnerOf(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    ),
    request,
    STAMP,
    20,
  );
  assert.equal(aborted, true);
  assert.deepEqual(slow, unavailableResult('timeout', null, STAMP));
});

test('callRunner revokes when the deadline fires, before a runner that ignores the abort settles, and once it settles (W4-05a)', async () => {
  const findings = await validFindings();
  const settled: string[] = [];
  let revokes = 0;
  const onRevoke = (): void => {
    revokes += 1;
    settled.push(`revoke:${revokes}`);
  };
  const ok = await callRunner(
    runnerOf(() => Promise.resolve(completed(findings))),
    request,
    STAMP,
    1000,
    onRevoke,
  );
  assert.equal(ok.status, 'completed');
  assert.equal(revokes, 1, 'revoked once the runner settled');

  revokes = 0;
  settled.length = 0;
  let release: () => void = () => undefined;
  const late = await callRunner(
    runnerOf(
      () =>
        new Promise<QcRunResult>((resolve) => {
          // Ignores the abort; settles only after the test has seen the deadline revoke.
          release = () => resolve(completed(findings));
          setTimeout(() => {
            settled.push('runner');
            release();
          }, 60);
        }),
    ),
    request,
    STAMP,
    20,
    onRevoke,
  );
  void late; // what a late result becomes is out of scope here (see review.md, deferred)
  assert.deepEqual(
    settled.slice(0, 2),
    ['revoke:1', 'runner'],
    'the deadline revoked before the runner settled',
  );

  revokes = 0;
  await callRunner(
    runnerOf(() => Promise.reject(new Error('boom'))),
    request,
    STAMP,
    1000,
    onRevoke,
  );
  assert.equal(revokes, 1, 'revoked after a throw');
});
