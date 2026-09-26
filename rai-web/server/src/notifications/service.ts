// Reads committed outbox rows on its own connection, never inside a workflow transaction, so an
// uncommitted or rolled-back event cannot reach the sink.
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Value } from 'typebox/value';
import { LANES, type Lane } from '@rai/shared/constants';
import type {
  CommittedEvent,
  DeliveryErrorCode,
  DeliveryReceipt,
  DeliveryRequest,
  MailSink,
} from '@rai/shared/mail/types';
import { SendBackFeedbackSchema } from '@rai/shared/schemas/review';
import type { Db, Tx } from '../db/client.js';
import {
  auditEvent,
  cases,
  laneDecision,
  notification,
  packVersion,
  qcFinding,
  session,
} from '../db/schema/index.js';
import { runWithContext } from '../observability/context.js';
import type { ErrorCapture } from '../observability/errors.js';
import type { Emitter } from '../observability/log.js';
import { loadCommittedDigestRequest, DigestCompositionError } from './digest.js';
import { deliveryUpdate, nextAttempt, RETRY_BACKOFF_MS } from './retry.js';
import { laneDueDates } from '../sla/due-dates.js';
import {
  composeCaseMail,
  CompositionError,
  resolveRecipient,
  type CaseMailContent,
  type CaseMailKind,
  type MailIdentity,
} from './compose.js';

const KINDS: Record<string, CaseMailKind> = {
  lane_open: 'lane_opened',
  send_back: 'sent_back',
  ready: 'ready_for_launch',
};
const DELIVERABLE_EVENTS = [...Object.keys(KINDS), 'sla_breach_digest'];
const ACTIONS = {
  lane_opened: 'lane.opened',
  sent_back: 'lane.sent_back',
  ready_for_launch: 'case.ready_for_launch',
} as const;
export interface NotificationDeps {
  errors?: ErrorCapture;
  db: Db;
  sink: MailSink;
  identities: readonly MailIdentity[];
  publicBaseUrl: URL;
  emitter: Emitter;
  now?: () => Date;
}
export type NotificationRow = typeof notification.$inferSelect;

/** Call only from the dispatcher's own transaction after reading a committed outbox row.
 * Composition has no delivery/status/log side effects; the dispatcher sets the attempt on the returned request.
 */
export async function loadCommittedCaseRequest(
  tx: Tx,
  row: NotificationRow,
  deps: Pick<NotificationDeps, 'identities' | 'publicBaseUrl'>,
) {
  const kind = KINDS[row.event];
  if (!kind || !row.caseId || !row.versionId) throw new CompositionError('malformed_request');
  const lane = row.lane === '-' ? null : (row.lane as Lane);
  if (kind === 'ready_for_launch' ? lane !== null : !LANES.includes(lane as Lane))
    throw new CompositionError('malformed_request');
  const [caseRow] = await tx.select().from(cases).where(eq(cases.id, row.caseId));
  const [version] = await tx
    .select()
    .from(packVersion)
    .where(and(eq(packVersion.id, row.versionId), eq(packVersion.caseId, row.caseId)));
  if (!caseRow || !version?.submittedAt) throw new CompositionError('malformed_request');
  const audits = await tx
    .select()
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.targetCaseId, row.caseId),
        eq(auditEvent.targetVersionId, row.versionId),
        eq(auditEvent.correlationId, row.correlationId),
        eq(auditEvent.action, ACTIONS[kind]),
        lane === null ? undefined : sql`${auditEvent.targetRef}->>'lane' = ${lane}`,
      ),
    )
    .limit(2);
  if (audits.length !== 1) throw new CompositionError('malformed_request');
  const audit = audits[0]!;
  const event: CommittedEvent = {
    kind,
    caseId: row.caseId,
    versionId: row.versionId,
    versionNumber: version.versionNumber,
    digestDay: null,
    lane,
    auditEventId: audit.id,
    committedAt: audit.occurredAt.toISOString(),
    correlationId: row.correlationId,
  };
  const recipient = resolveRecipient(deps.identities, row.recipient, event, {
    caseId: caseRow.id,
    ownerSubjectId: caseRow.ownerSubjectId,
    businessUnitId: caseRow.businessUnitId,
  });
  const [preference] = await tx
    .select({ locale: session.locale })
    .from(session)
    .where(eq(session.subjectId, recipient.recipientId))
    .orderBy(desc(session.createdAt), desc(session.id))
    .limit(1);
  if (preference?.locale === 'en' || preference?.locale === 'th') recipient.locale = preference.locale;
  const content: CaseMailContent = { caseName: caseRow.useCaseName };
  if (kind === 'lane_opened') {
    const [total] = await tx
      .select({ value: count() })
      .from(qcFinding)
      // W3-F3 (ruling item 11): that lane's findings recorded when this attempt is composed, both kinds (a QC
      // outage is a finding, so it never reads as 0: W0-07 3.6) and dispositioned ones (recorded, not open).
      .where(and(eq(qcFinding.versionId, row.versionId), eq(qcFinding.owningLane, lane as Lane)));
    content.findingCount = total?.value ?? 0;
    content.dueOn = (await laneDueDates(tx, row.versionId)).find((d) => d.lane === lane)!.dueOn;
  }
  if (kind === 'sent_back') {
    const params = row.templateParams as { decision_id?: unknown };
    if (typeof params.decision_id !== 'string') throw new CompositionError('malformed_request');
    const [decision] = await tx
      .select()
      .from(laneDecision)
      .where(
        and(
          eq(laneDecision.versionId, row.versionId),
          eq(laneDecision.lane, row.lane),
          eq(laneDecision.decision, 'send_back'),
          eq(laneDecision.correlationId, row.correlationId),
        ),
      );
    if (
      !decision ||
      decision.id !== params.decision_id ||
      (audit.targetRef as { decision_id?: unknown } | null)?.decision_id !== decision.id ||
      !Value.Check(SendBackFeedbackSchema, decision.feedback)
    )
      throw new CompositionError('malformed_request');
    content.feedback = decision.feedback;
  }
  if (kind === 'ready_for_launch' && version.readyAt === null)
    throw new CompositionError('malformed_request');
  const request = composeCaseMail(event, recipient, content, deps.publicBaseUrl);
  if (
    row.templateKey !== request.mail.templateKey ||
    row.deepLinkPath !== new URL(request.deepLinks[0]!.url).pathname
  )
    throw new CompositionError('unsafe_link');
  return request;
}

export function createNotifications(deps: NotificationDeps) {
  const now = deps.now ?? (() => new Date());
  async function send(
    tx: Tx,
    row: NotificationRow,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<DeliveryReceipt> {
    const failed = (code: DeliveryErrorCode): DeliveryReceipt => ({
      dedupKey: '',
      status: 'failed',
      attempt,
      at: now().toISOString(),
      sinkMessageId: null,
      error: { code, message: 'composition or delivery failed' },
    });
    let request: DeliveryRequest;
    try {
      request =
        row.event === 'sla_breach_digest'
          ? await loadCommittedDigestRequest(tx, row, deps)
          : await loadCommittedCaseRequest(tx, row, deps);
    } catch (err) {
      const code =
        err instanceof CompositionError || err instanceof DigestCompositionError ? err.code : 'sink_failure';
      return failed(code);
    }
    // Shutdown may stop an attempt only before the sink sees it; a settled result is always committed.
    signal?.throwIfAborted();
    try {
      return await deps.sink.deliver({ ...request, attempt });
    } catch {
      return failed('sink_failure');
    }
  }
  /** Dispatches at most one eligible attempt for this row; a crash before commit can replay it. */
  async function deliverInitial(id: string, signal?: AbortSignal): Promise<DeliveryReceipt | undefined> {
    signal?.throwIfAborted();
    const outcome = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(notification)
        .where(
          and(
            eq(notification.id, id),
            eq(notification.status, 'queued'),
            inArray(notification.event, DELIVERABLE_EVENTS),
          ),
        )
        .for('update', { skipLocked: true });
      signal?.throwIfAborted();
      if (!row) return undefined;
      // A failed first attempt recorded without a deadline: schedule from now, never infer from createdAt.
      if (row.attempts === 1 && row.nextAttemptAt === null) {
        await tx
          .update(notification)
          .set({ nextAttemptAt: new Date(now().getTime() + RETRY_BACKOFF_MS[0]) })
          .where(eq(notification.id, id));
        signal?.throwIfAborted();
        return undefined;
      }
      const attempt = nextAttempt({ ...row, status: 'queued' }, now());
      if (attempt === undefined) return undefined;
      const receipt = await send(tx, row, attempt, signal);
      const update = deliveryUpdate(attempt, receipt, now());
      await tx.update(notification).set(update).where(eq(notification.id, id));
      return { row, receipt, update, attempt };
    });
    if (outcome === undefined) return undefined;
    const { row, receipt, update, attempt } = outcome;
    // No outcome log until COMMIT succeeds. Logs themselves are not crash-atomic with the DB.
    await runWithContext({ correlationId: row.correlationId, startedAt: performance.now() }, () => {
      if (attempt === 1)
        deps.emitter.log('mail.enqueued', {
          notificationId: row.id,
          eventType: row.event,
          caseId: row.caseId,
          versionId: row.versionId,
          lane: row.lane,
          recipientCount: 1,
        });
      if (receipt.status === 'duplicate')
        deps.emitter.log('mail.deduplicated', {
          eventType: row.event,
          caseId: row.caseId,
          versionId: row.versionId,
          lane: row.lane,
          existingNotificationId: row.id,
        });
      if (update.status === 'sent')
        deps.emitter.log('mail.sent', {
          notificationId: row.id,
          attempt,
          sinkKind: deps.sink.identity.sink,
        });
      else if (update.status === 'failed') {
        deps.emitter.log('mail.failed', {
          notificationId: row.id,
          attempts: attempt,
          errorCode: update.lastErrorCode,
        });
        deps.errors?.job({
          category: 'mail_delivery_failed',
          notificationId: row.id,
          attempts: 4,
          errorCode: receipt.error?.code ?? 'sink_failure',
        });
      } else
        deps.emitter.log('mail.attempt_failed', {
          notificationId: row.id,
          attempt,
          nextAttemptAt: update.nextAttemptAt!.toISOString(),
          errorCode: receipt.error?.code ?? 'sink_failure',
        });
      return Promise.resolve();
    });
    return receipt;
  }
  /** One bounded batch for case and digest mail; polling revisits backlog. */
  async function deliverPending(correlationId?: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const rows = await deps.db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.status, 'queued'),
          sql`${notification.attempts} >= 0 AND ${notification.attempts} < 4`,
          sql`(${notification.nextAttemptAt} <= ${now()} OR (${notification.nextAttemptAt} IS NULL AND ${notification.attempts} <= 1))`,
          inArray(notification.event, DELIVERABLE_EVENTS),
          correlationId === undefined ? undefined : eq(notification.correlationId, correlationId),
        ),
      )
      .orderBy(asc(notification.createdAt), asc(notification.id))
      .limit(25);
    for (const row of rows) await deliverInitial(row.id, signal);
  }
  return { deliverInitial, deliverPending };
}
export type Notifications = ReturnType<typeof createNotifications>;
