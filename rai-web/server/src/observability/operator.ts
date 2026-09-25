import { and, desc, eq, gt, or, sql } from 'drizzle-orm';
import { LANES, type Lane, unavailableOwningLane } from '@rai/shared/constants';
import { Value } from 'typebox/value';
import {
  DeskHealthReportSchema,
  type DeskHealthReport,
  type ReadinessReport,
} from '@rai/shared/schemas/observability';
import type { Db } from '../db/client.js';
import {
  notification,
  operatorJobRun,
  operatorJobNotification,
  packVersion,
  qcRun,
  qcLateResult,
} from '../db/schema/index.js';

/** Caller must enforce operator.view. Recipient is authorized response data, never log data. */

/** The lane an unavailable run's QC-UNAVAILABLE finding belongs to; upload runs (none in slice 1) are never guessed. */
function owningLaneOfUnavailableRun(trigger: string, lane: string | null): Lane | undefined {
  if (trigger === 'approve_attempt' && lane !== null && (LANES as readonly string[]).includes(lane))
    return unavailableOwningLane({ trigger: 'approve_attempt', lane: lane as Lane });
  if (trigger === 'submit') return unavailableOwningLane({ trigger: 'submit', lane: null });
  return undefined;
}

export async function readDeskHealth(
  db: Db,
  readiness: ReadinessReport,
  errorCounters: DeskHealthReport['errorCounters'],
  now: () => Date = () => new Date(),
): Promise<DeskHealthReport> {
  return db.transaction(
    async (tx) => {
      const mail = await tx
        .select({
          id: notification.id,
          event: notification.event,
          caseId: notification.caseId,
          versionId: notification.versionId,
          lane: notification.lane,
          recipient: notification.recipient,
          status: notification.status,
          attempts: notification.attempts,
          nextAttemptAt: notification.nextAttemptAt,
          lastErrorCode: notification.lastErrorCode,
          correlationId: notification.correlationId,
        })
        .from(notification)
        .where(
          or(
            eq(notification.status, 'failed'),
            and(eq(notification.status, 'queued'), gt(notification.attempts, 0)),
          ),
        )
        .orderBy(
          sql`${notification.nextAttemptAt} DESC NULLS FIRST`,
          desc(notification.createdAt),
          desc(notification.id),
        )
        .limit(100);
      const unavailable = await tx
        .select({
          qcRunId: qcRun.id,
          caseId: packVersion.caseId,
          versionId: qcRun.versionId,
          trigger: qcRun.trigger,
          lane: qcRun.lane,
          reason: qcRun.unavailableReason,
          requestedAt: qcRun.requestedAt,
          correlationId: qcRun.correlationId,
        })
        .from(qcRun)
        .innerJoin(packVersion, eq(qcRun.versionId, packVersion.id))
        .where(eq(qcRun.status, 'unavailable'))
        .orderBy(desc(qcRun.requestedAt), desc(qcRun.id))
        .limit(100);
      const late = await tx
        .select({
          lateResultId: qcLateResult.id,
          qcRunId: qcLateResult.qcRunId,
          caseId: packVersion.caseId,
          versionId: qcLateResult.versionId,
          trigger: qcLateResult.trigger,
          lane: qcLateResult.lane,
          status: qcLateResult.status,
          refusedFindingCount: qcLateResult.refusedFindingCount,
          recordedAt: qcLateResult.recordedAt,
          correlationId: qcLateResult.correlationId,
        })
        .from(qcLateResult)
        .innerJoin(packVersion, eq(qcLateResult.versionId, packVersion.id))
        .orderBy(desc(qcLateResult.recordedAt), desc(qcLateResult.id))
        .limit(100);
      const [lastRun] = await tx
        .select()
        .from(operatorJobRun)
        .orderBy(desc(operatorJobRun.startedAt), desc(operatorJobRun.id))
        .limit(1);
      const links =
        lastRun === undefined
          ? []
          : await tx
              .select({ id: operatorJobNotification.notificationId })
              .from(operatorJobNotification)
              .where(eq(operatorJobNotification.jobRunId, lastRun.id))
              .orderBy(operatorJobNotification.notificationId);
      const failures = await tx
        .select()
        .from(operatorJobRun)
        .where(eq(operatorJobRun.status, 'failed'))
        .orderBy(desc(operatorJobRun.startedAt), desc(operatorJobRun.id))
        .limit(100);
      const report = {
        generatedAt: now().toISOString(),
        readiness,
        errorCounters,
        failedMail: mail.map((row) => ({
          notificationId: row.id,
          eventType: row.event,
          ...(row.caseId === null ? {} : { caseId: row.caseId }),
          ...(row.versionId === null ? {} : { versionId: row.versionId }),
          ...(row.lane === '-' ? {} : { lane: row.lane }),
          recipient: row.recipient,
          status: row.status,
          attempts: row.attempts,
          lastErrorCode: row.lastErrorCode,
          correlationId: row.correlationId,
          ...(row.status === 'failed'
            ? { failureCategory: 'mail_delivery_failed' }
            : row.nextAttemptAt === null
              ? {}
              : { nextAttemptAt: row.nextAttemptAt.toISOString() }),
        })),
        // W0-06 7.2 (recorded 2026-09-25): the outage finding's lane follows the run, so it is derived from the run
        // itself; that also covers a run that reused an earlier open finding and has no finding row of its own.
        unavailableQc: unavailable.map(({ lane, ...row }) => {
          const owningLane = owningLaneOfUnavailableRun(row.trigger, lane);
          return {
            ...row,
            reason: row.reason ?? 'unknown',
            ...(owningLane === undefined ? {} : { owningLane }),
            requestedAt: row.requestedAt.toISOString(),
          };
        }),
        lateQc: late.map(({ lane, ...row }) => ({
          ...row,
          ...(lane === null ? {} : { lane }),
          recordedAt: row.recordedAt.toISOString(),
        })),
        slaDigest: {
          ...(lastRun === undefined
            ? {}
            : {
                lastRun: {
                  jobRunId: lastRun.id,
                  digestDay: lastRun.digestDay,
                  startedAt: lastRun.startedAt.toISOString(),
                  ...(lastRun.finishedAt === null ? {} : { finishedAt: lastRun.finishedAt.toISOString() }),
                  status: lastRun.status,
                  ...(lastRun.breachCount === null ? {} : { breachCount: lastRun.breachCount }),
                  notificationIds: links.map((link) => link.id),
                  ...(lastRun.errorCode === null ? {} : { errorCode: lastRun.errorCode }),
                  correlationId: lastRun.correlationId,
                },
              }),
          recentFailures: failures.map((row) => ({
            jobRunId: row.id,
            digestDay: row.digestDay,
            startedAt: row.startedAt.toISOString(),
            stage: row.errorStage,
            errorCode: row.errorCode,
            correlationId: row.correlationId,
          })),
        },
      };
      if (!Value.Check(DeskHealthReportSchema, report))
        throw new Error('operator report violates shared contract');
      return report;
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
