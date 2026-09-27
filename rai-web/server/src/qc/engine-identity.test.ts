// W4-11b (W4b plan sections 7 and 8): how a result's engine identity and detail become qc_run columns and log fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QC_UNAVAILABLE_DETAIL_PATTERN, type QcRunResult } from '@rai/shared/qc/types';
import { MIGRATIONS_FOLDER } from '../db/migrate.js';
import {
  ENGINE_IDENTITY_INVALID,
  UNAVAILABLE_DETAIL_PATTERN,
  UNSPECIFIED_DETAIL,
  engineColumnsOf,
  engineLogFields,
  storedUnavailableDetail,
} from './engine-identity.js';

const model = {
  provider: 'local-fake' as const,
  modelId: 'fake-claims-1',
  promptRevision: 'claims/v1@0123456789ab',
  inputTokens: 7,
  outputTokens: 3,
  latencyMs: 11,
  costUsdMicros: 0,
};

const unavailable = (detail: string | null): QcRunResult => ({
  status: 'unavailable',
  reason: 'runner_error',
  detail,
  startedAt: 't0',
  finishedAt: 't1',
});

test('W4-11b: no engine gives all-NULL columns and no log fields', () => {
  const columns = engineColumnsOf(undefined);
  assert.deepEqual(columns, {
    extractorVersion: null,
    modelProvider: null,
    modelId: null,
    promptRevision: null,
    modelInputTokens: null,
    modelOutputTokens: null,
    modelLatencyMs: null,
    modelCostUsdMicros: null,
  });
  assert.deepEqual(engineLogFields(columns), {});
});

test('W4-11b: an engine maps onto the columns; the log carries identities and numbers but not the cost', () => {
  const columns = engineColumnsOf({ extractorVersion: 'rai-extract/1', model });
  assert.deepEqual(columns, {
    extractorVersion: 'rai-extract/1',
    modelProvider: 'local-fake',
    modelId: 'fake-claims-1',
    promptRevision: 'claims/v1@0123456789ab',
    modelInputTokens: 7,
    modelOutputTokens: 3,
    modelLatencyMs: 11,
    modelCostUsdMicros: 0,
  });
  assert.deepEqual(engineLogFields(columns), {
    extractorVersion: 'rai-extract/1',
    modelProvider: 'local-fake',
    modelId: 'fake-claims-1',
    promptRevision: 'claims/v1@0123456789ab',
    modelInputTokens: 7,
    modelOutputTokens: 3,
    modelLatencyMs: 11,
  });
  assert.deepEqual(engineLogFields(engineColumnsOf({ extractorVersion: 'rai-extract/1' })), {
    extractorVersion: 'rai-extract/1',
  });
});

test('W4-11b: the stored detail is the code when bounded, unspecified otherwise, NULL when absent or completed', () => {
  for (const code of ['extract_limit_time', 'unknown_template_version', 'blob_missing', 'a', 'x'.repeat(64)])
    assert.equal(storedUnavailableDetail(unavailable(code)), code);
  for (const text of ['', 'simulated:timeout', 'Error: boom', 'x'.repeat(65), 'has space', 'UPPER'])
    assert.equal(storedUnavailableDetail(unavailable(text)), UNSPECIFIED_DETAIL);
  assert.equal(storedUnavailableDetail(unavailable(null)), null);
  assert.equal(
    storedUnavailableDetail({
      status: 'completed',
      findings: [],
      rulesEvaluated: [],
      startedAt: 't0',
      finishedAt: 't1',
    }),
    null,
  );
  // A detail that is not a string (a runner outside the schema) is never coerced into a code (review round 1).
  for (const odd of [42, true, { code: 'x' }, ['a']])
    assert.equal(storedUnavailableDetail(unavailable(odd as unknown as string)), UNSPECIFIED_DETAIL);
  assert.match(UNSPECIFIED_DETAIL, /^[a-z0-9_]{1,64}$/);
  assert.match(ENGINE_IDENTITY_INVALID, /^[a-z0-9_]{1,64}$/);
});

test('one detail pattern: the server check, the shared read schemas and the migration CHECK agree', () => {
  assert.equal(QC_UNAVAILABLE_DETAIL_PATTERN, '^[a-z0-9_]{1,64}$');
  assert.equal(UNAVAILABLE_DETAIL_PATTERN.source, QC_UNAVAILABLE_DETAIL_PATTERN);
  const sql = readFileSync(path.join(MIGRATIONS_FOLDER, '0012_w4_11b_run_extraction_identity.sql'), 'utf8');
  assert.ok(sql.includes(`"unavailable_detail" ~ '${QC_UNAVAILABLE_DETAIL_PATTERN}'`));
});
