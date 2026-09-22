import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import {
  DeskHealthReportSchema,
  FailureReportSchema,
  DigestJobProvenanceSchema,
  ReadinessReportSchema,
  SafeErrorFieldsSchema,
  type ReadinessReport,
} from './observability.js';

const id = '11111111-1111-4111-8111-111111111111';
const at = '2026-09-22T00:00:00.000Z';
const readiness: ReadinessReport = {
  status: 'ready',
  checkedAt: at,
  identity: { mode: 'fixture', loopbackBind: true, status: 'ok' },
  store: { db: 'ok', migrations: 'current', blob: 'ok' },
  mailSink: { kind: 'memory', status: 'ok' },
  qc: { kind: 'substitute', status: 'unavailable' },
  build: { commit: 'dev', schemaVersion: '7' },
};
test('readiness permits QC outage and rejects paths, credentials and arbitrary startup reasons', () => {
  assert.equal(Value.Check(ReadinessReportSchema, readiness), true);
  for (const payload of [
    { ...readiness, databaseUrl: 'postgres://private' },
    { ...readiness, store: { ...readiness.store, db: '/private/database' } },
    { ...readiness, identity: { ...readiness.identity, reason: 'secret_missing:someone@example.test' } },
  ])
    assert.equal(Value.Check(ReadinessReportSchema, payload), false);
  assert.equal(
    Value.Check(ReadinessReportSchema, {
      ...readiness,
      identity: { ...readiness.identity, reason: 'secret_missing:RAI_SESSION_ABSOLUTE_HOURS' },
    }),
    true,
  );
});
test('operator report represents historical unknown reasons and durable late results', () => {
  const report = {
    generatedAt: at,
    readiness,
    failedMail: [],
    unavailableQc: [
      {
        qcRunId: id,
        caseId: id,
        versionId: id,
        trigger: 'submit',
        reason: 'unknown',
        requestedAt: at,
        correlationId: id,
      },
    ],
    lateQc: [
      {
        lateResultId: id,
        qcRunId: id,
        caseId: id,
        versionId: id,
        trigger: 'submit',
        status: 'completed',
        refusedFindingCount: 2,
        recordedAt: at,
        correlationId: id,
      },
    ],
    slaDigest: { recentFailures: [] },
    errorCounters: [],
  };
  assert.equal(Value.Check(DeskHealthReportSchema, report), true);
  assert.equal(
    Value.Check(DeskHealthReportSchema, {
      ...report,
      unavailableQc: [{ ...report.unavailableQc[0], reason: 'raw runner exception' }],
    }),
    false,
  );
});
test('safe errors reject values hidden in unknown paths, filenames, messages and stacks', () => {
  for (const payload of [
    { category: 'invalid_input', fieldPaths: ['body'] },
    { category: 'mail_delivery_failed', notificationId: id, attempts: 4, errorCode: 'sink_failure' },
    {
      category: 'internal_error',
      stackHash: 'a'.repeat(64),
      stack: [{ module: 'server/src/app.ts', line: 1, column: 2 }],
    },
  ])
    assert.equal(Value.Check(SafeErrorFieldsSchema, payload), true);
  for (const payload of [
    { category: 'invalid_input', fieldPaths: ['body.person@example.test'] },
    { category: 'unsafe_upload', reason: 'filename_invalid', filename: 'private.pdf' },
    {
      category: 'mail_delivery_failed',
      notificationId: id,
      attempts: 4,
      errorCode: 'recipient@example.test',
    },
    { category: 'internal_error', stackHash: 'a'.repeat(64), stack: 'Error: RAI-DESK-SYNTHETIC-FIXTURE' },
    {
      category: 'internal_error',
      stackHash: 'a'.repeat(64),
      stack: [{ module: '/Users/private/app.ts', line: 1, column: 2 }],
    },
  ])
    assert.equal(Value.Check(SafeErrorFieldsSchema, payload), false);
});
test('digest provenance is typed, bounded and does not replace ordinary audit provenance', () => {
  assert.equal(
    Value.Check(DigestJobProvenanceSchema, {
      kind: 'sla_digest_job',
      digestDay: '2026-09-22',
      jobRunId: id,
      correlationId: id,
    }),
    true,
  );
  assert.equal(
    Value.Check(DigestJobProvenanceSchema, {
      kind: 'sla_digest_job',
      digestDay: '2026-09-22',
      jobRunId: 'bogus',
      correlationId: id,
    }),
    false,
  );
  assert.equal(
    Value.Check(DigestJobProvenanceSchema, { kind: 'lane_open', jobRunId: id, correlationId: id }),
    false,
  );
  assert.equal(
    Value.Check(DigestJobProvenanceSchema, {
      kind: 'sla_digest_job',
      digestDay: '2026-09-22',
      jobRunId: id,
      correlationId: id,
      auditEventId: id,
    }),
    false,
  );
});

test('terminal delivery category is derived without losing the bounded cause', () => {
  const terminal = {
    notificationId: id,
    eventType: 'send_back',
    recipient: 'operator@rai-desk.example',
    correlationId: id,
    status: 'failed',
    attempts: 4,
    lastErrorCode: 'sink_failure',
    failureCategory: 'mail_delivery_failed',
  };
  assert.equal(Value.Check(FailureReportSchema, terminal), true);
  assert.equal(Value.Check(FailureReportSchema, { ...terminal, failureCategory: undefined }), false);
  assert.equal(
    Value.Check(FailureReportSchema, { ...terminal, status: 'queued', attempts: 3, nextAttemptAt: at }),
    false,
  );
  assert.equal(
    Value.Check(FailureReportSchema, {
      notificationId: id,
      eventType: 'send_back',
      recipient: 'operator@rai-desk.example',
      correlationId: id,
      status: 'queued',
      attempts: 3,
      nextAttemptAt: at,
      lastErrorCode: 'sink_failure',
    }),
    true,
  );
});
