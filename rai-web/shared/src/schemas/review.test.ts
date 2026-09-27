// W4-11b round 1 (review polish): the qc-runs read bounds the identity and detail fields it serves the same way the
// qc_run CHECK, QcEngineIdentitySchema and DeskHealthReportSchema bound them (W4b plan sections 7 and 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { QcRunSummarySchema } from './review.js';

const run = {
  runId: '11111111-2222-4333-8444-555555555555',
  trigger: 'submit',
  lane: null,
  slot: null,
  status: 'unavailable',
  unavailableReason: 'runner_error',
  runner: 'deterministic',
  runnerVersion: '0.0.0',
  ruleRevision: 'w4a.1',
  rulesLabel: null,
  rulesEvaluated: 0,
  findingCount: 1,
  requestedAt: '2026-09-27T00:00:00.000Z',
  completedAt: '2026-09-27T00:00:01.000Z',
  extractorVersion: 'extract/1.0.0',
  model: { provider: 'local-fake', modelId: 'fake-claims-1', promptRevision: 'claims/v1@0123456789ab' },
  modelUsage: { inputTokens: 7, outputTokens: 3, latencyMs: 11 },
  unavailableDetail: 'extract_limit_time',
};

test('W4-11b: a qc-runs summary with bounded identity and detail passes', () => {
  assert.equal(Value.Check(QcRunSummarySchema, run), true);
  const none = { ...run, extractorVersion: null, model: null, modelUsage: null, unavailableDetail: null };
  assert.equal(Value.Check(QcRunSummarySchema, none), true);
  assert.equal(Value.Check(QcRunSummarySchema, { ...run, unavailableDetail: 'unspecified' }), true);
});

test('W4-11b: free text in the detail or the identity fields is refused', () => {
  for (const bad of [
    { ...run, unavailableDetail: 'Error: boom' },
    { ...run, unavailableDetail: 'x'.repeat(65) },
    { ...run, unavailableDetail: '' },
    { ...run, extractorVersion: 'has space' },
    { ...run, extractorVersion: 'x'.repeat(129) },
    { ...run, model: { ...run.model, provider: 'Some provider text' } },
    { ...run, model: { ...run.model, modelId: '' } },
    { ...run, model: { ...run.model, promptRevision: 'line\nbreak' } },
  ])
    assert.equal(Value.Check(QcRunSummarySchema, bad), false, JSON.stringify(bad).slice(0, 120));
});
