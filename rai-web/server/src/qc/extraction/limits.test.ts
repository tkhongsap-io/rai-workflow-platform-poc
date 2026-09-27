// W4-05b (W4b plan sections 2 and 4.4): the extraction limits are local policy caps with no default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRACTION_LIMIT_BOUNDS,
  FIXED_WORKER_LIMITS,
  extractionLimitsProblems,
  workerLimitsOf,
  type ExtractionLimits,
} from './limits.js';

const VALID: ExtractionLimits = {
  timeoutMs: 4000,
  maxMemoryMb: 256,
  maxTextChars: 1_000_000,
  maxConcurrency: 2,
  maxInputBytes: 26_214_400,
};

test('the policy bounds are the plan section 2 caps', () => {
  assert.deepEqual(EXTRACTION_LIMIT_BOUNDS.timeoutMs, { min: 500, max: 9000 });
  assert.deepEqual(EXTRACTION_LIMIT_BOUNDS.maxMemoryMb, { min: 64, max: 512 });
  assert.deepEqual(EXTRACTION_LIMIT_BOUNDS.maxTextChars, { min: 1000, max: 2_000_000 });
  assert.deepEqual(EXTRACTION_LIMIT_BOUNDS.maxConcurrency, { min: 1, max: 4 });
  assert.equal(EXTRACTION_LIMIT_BOUNDS.maxInputBytes.min, 1);
});

test('the timeout cap stays below the 10 000 ms orchestrator deadline', () => {
  assert.ok(EXTRACTION_LIMIT_BOUNDS.timeoutMs.max < 10_000);
});

test('the fixed limits are the plan section 4.4 values', () => {
  assert.deepEqual(FIXED_WORKER_LIMITS, {
    maxSegments: 50_000,
    maxPartBytes: 20 * 1024 * 1024,
    maxTotalBytes: 100 * 1024 * 1024,
    maxPdfPages: 2000,
    maxPdfObjects: 100_000,
  });
});

test('valid limits have no problem, and each bound is inclusive', () => {
  assert.deepEqual(extractionLimitsProblems(VALID), []);
  for (const [key, { min, max }] of Object.entries(EXTRACTION_LIMIT_BOUNDS)) {
    assert.deepEqual(extractionLimitsProblems({ ...VALID, [key]: min }), [], `${key} at min`);
    if (Number.isSafeInteger(max))
      assert.deepEqual(extractionLimitsProblems({ ...VALID, [key]: max }), [], `${key} at max`);
  }
});

test('a value outside its bound, a fraction or a non-number is a problem named by its key', () => {
  for (const [key, { min, max }] of Object.entries(EXTRACTION_LIMIT_BOUNDS)) {
    assert.deepEqual(extractionLimitsProblems({ ...VALID, [key]: min - 1 }), [key], `${key} below min`);
    if (Number.isSafeInteger(max))
      assert.deepEqual(extractionLimitsProblems({ ...VALID, [key]: max + 1 }), [key], `${key} above max`);
    assert.deepEqual(extractionLimitsProblems({ ...VALID, [key]: min + 0.5 }), [key], `${key} fraction`);
    assert.deepEqual(extractionLimitsProblems({ ...VALID, [key]: Number.NaN }), [key], `${key} NaN`);
  }
  const missing = { ...VALID } as Partial<ExtractionLimits>;
  delete missing.maxConcurrency;
  assert.deepEqual(extractionLimitsProblems(missing as ExtractionLimits), ['maxConcurrency']);
});

test('the worker receives the text cap and the fixed limits, not the host-only limits', () => {
  assert.deepEqual(workerLimitsOf(VALID), { maxTextChars: 1_000_000, ...FIXED_WORKER_LIMITS });
});
