// Controlled browser reports only. These do not prove OBS17 or the real operator API.
import { Value } from 'typebox/value';
import { DeskHealthReportSchema, type DeskHealthReport } from '@rai/shared/schemas/observability';
export const operatorPath = '/api/operator/desk-health';
export const recordId = '11111111-1111-4111-8111-111111111111';
export const secondId = '22222222-2222-4222-8222-222222222222';
export const at = '2026-09-22T00:00:00.000Z';
export const recipient = 'synthetic-operator-rehearsal@rai-desk.example';
export function report(populated = true): DeskHealthReport {
  const value: DeskHealthReport = {
    generatedAt: at,
    readiness: {
      status: 'ready',
      checkedAt: at,
      identity: { mode: 'fixture', loopbackBind: true, status: 'ok' },
      store: { db: 'ok', migrations: 'current', blob: 'ok' },
      mailSink: { kind: 'memory', status: 'ok' },
      qc: { kind: 'substitute', status: 'unavailable' },
      build: { commit: 'dev', schemaVersion: '7' },
    },
    failedMail: [],
    unavailableQc: [],
    lateQc: [],
    slaDigest: { recentFailures: [] },
    errorCounters: [],
  };
  if (populated) {
    value.failedMail = [
      {
        notificationId: recordId,
        eventType: 'ready',
        recipient,
        correlationId: recordId,
        status: 'queued',
        attempts: 1,
        lastErrorCode: 'sink_failure',
        caseId: recordId,
        versionId: secondId,
      },
      {
        notificationId: secondId,
        eventType: 'sla_breach_digest',
        recipient,
        correlationId: secondId,
        status: 'failed',
        attempts: 4,
        lastErrorCode: 'sink_failure',
        failureCategory: 'mail_delivery_failed',
      },
    ];
    value.unavailableQc = [
      {
        qcRunId: recordId,
        caseId: recordId,
        versionId: secondId,
        trigger: 'submit',
        reason: 'unknown',
        runner: 'substitute-scripted',
        runnerVersion: 'unrecorded',
        requestedAt: at,
        correlationId: recordId,
      },
    ];
    value.lateQc = [
      {
        lateResultId: recordId,
        qcRunId: recordId,
        caseId: recordId,
        versionId: secondId,
        trigger: 'submit',
        status: 'completed',
        refusedFindingCount: 2,
        recordedAt: at,
        correlationId: recordId,
      },
    ];
    value.slaDigest.lastRun = {
      jobRunId: recordId,
      digestDay: '2026-09-22',
      startedAt: at,
      status: 'running',
      notificationIds: [],
      correlationId: recordId,
    };
    value.slaDigest.recentFailures = [
      {
        jobRunId: secondId,
        digestDay: '2026-09-21',
        startedAt: at,
        stage: 'query',
        errorCode: 'query_failed',
        correlationId: secondId,
      },
    ];
    value.errorCounters = [{ code: 'mail_delivery_failed', count: 0, lastAt: at }];
  }
  if (!Value.Check(DeskHealthReportSchema, value)) throw new Error('invalid rehearsal report');
  return value;
}
