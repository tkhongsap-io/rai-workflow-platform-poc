// W3-03b producer/loader only. The W3-04 dispatcher owns all sink calls and retry state.
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { t } from '@rai/shared/locales/keys';
import { buildDedupKey } from '@rai/shared/mail/dedup';
import { isDigestJobProvenance } from '@rai/shared/mail/provenance';
import type { CommittedDigestEvent, DeliveryRequest, Locale } from '@rai/shared/mail/types';
import { OperatorRecipientsBodySchema } from '@rai/shared/schemas/cases';
import { SlaBreachSchema } from '@rai/shared/schemas/sla';
import { bangkokDate } from '@rai/shared/sla/working-days';
import type { Db, Tx } from '../db/client.js';
import { notification } from '../db/schema/notification.js';
import { operatorJobRun, operatorJobNotification } from '../db/schema/operator-job-run.js';
import { currentRevision } from '../configuration/store.js';
import { listSlaBreaches } from '../sla/breach.js';
import { laneDueDates } from '../sla/due-dates.js';
import { packVersion } from '../db/schema/pack-version.js';
import { runWithContext } from '../observability/context.js';
import type { Emitter } from '../observability/log.js';

const SnapshotSchema = Type.Object(
  {
    configurationRevisionId: Type.String({ minLength: 1 }),
    locale: Type.Union([Type.Literal('th'), Type.Literal('en')]),
    breaches: Type.Array(SlaBreachSchema, { minItems: 1, maxItems: 500 }),
  },
  { additionalProperties: false },
);
type Snapshot = Static<typeof SnapshotSchema>;
type Row = typeof notification.$inferSelect;
type Stage = 'query' | 'render' | 'enqueue';
export class DigestCompositionError extends Error {
  readonly code = 'malformed_request';
  constructor() {
    super('invalid persisted digest');
  }
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new DigestCompositionError();
}
function synthetic(address: string): boolean {
  return (
    /^[^\s@<>,;:"()[\]\\/]+@(?:[a-z0-9-]+\.)+(?:test|example|invalid)$/i.test(address) ||
    /^[^\s@<>,;:"()[\]\\/]+@(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$/i.test(address)
  );
}
function render(
  event: CommittedDigestEvent,
  address: string,
  snapshot: Snapshot,
  base: URL,
): DeliveryRequest {
  requireValid(isDigestJobProvenance(event.provenance) && synthetic(address));
  requireValid(
    ['http:', 'https:'].includes(base.protocol) &&
      base.pathname === '/' &&
      !base.search &&
      !base.hash &&
      !base.username &&
      !base.password,
  );
  const caseIds = [...new Set(snapshot.breaches.map((b) => b.caseId))];
  requireValid(caseIds.every((id) => /^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,127}$/.test(id)));
  const deepLinks = snapshot.breaches.map(({ caseId }) => ({
    url: `${base.origin}/cases/${caseId}`,
    route: 'case' as const,
    caseId,
    requiresSignIn: true as const,
  }));
  const recipient = {
    recipientId: `operator_recipients:${snapshot.configurationRevisionId}`,
    address,
    displayName: null,
    locale: snapshot.locale,
    basis: 'operator_recipients' as const,
  };
  const entries = snapshot.breaches
    .map(
      (b, index) =>
        `${b.caseId} — ${t(snapshot.locale, `lane.${b.lane}`)} — ${b.dueOn}\n${deepLinks[index]!.url}`,
    )
    .join('\n');
  const params = { day: event.digestDay, count: caseIds.length, entries };
  const subject = t(snapshot.locale, 'mail.sla_breach_digest');
  const textBody = t(snapshot.locale, 'mail.sla_breach_digest.body', params);
  requireValid(Buffer.byteLength(textBody, 'utf8') <= 65_536 && Buffer.byteLength(subject, 'utf8') <= 998);
  return {
    event,
    recipient,
    deepLinks,
    digestCases: snapshot.breaches.map((b, index) => ({
      caseId: b.caseId,
      lane: b.lane,
      deepLinkIndex: index,
    })),
    mail: { subject, textBody, templateKey: 'mail.sla_breach_digest', templateParams: params },
    dedupKey: buildDedupKey(event, recipient),
    attempt: 1,
  };
}
function eventFor(run: typeof operatorJobRun.$inferSelect, createdAt: Date): CommittedDigestEvent {
  return {
    kind: 'sla_breach_digest',
    caseId: null,
    versionId: null,
    versionNumber: null,
    lane: null,
    digestDay: run.digestDay,
    committedAt: createdAt.toISOString(),
    correlationId: run.correlationId,
    provenance: {
      kind: 'sla_digest_job',
      jobRunId: run.id,
      digestDay: run.digestDay,
      correlationId: run.correlationId,
    },
  };
}

/** Dispatcher-owned transaction only; reads the real committed row, not caller-supplied proof. */
export async function loadCommittedDigestRequest(
  tx: Tx,
  candidate: Row,
  deps: { publicBaseUrl: URL },
): Promise<DeliveryRequest> {
  const [stored] = await tx.select().from(notification).where(eq(notification.id, candidate.id));
  requireValid(
    stored &&
      stored.event === 'sla_breach_digest' &&
      stored.caseId === null &&
      stored.versionId === null &&
      stored.lane === '-',
  );
  const [joined] = await tx
    .select({ link: operatorJobNotification, run: operatorJobRun })
    .from(operatorJobNotification)
    .innerJoin(operatorJobRun, eq(operatorJobRun.id, operatorJobNotification.jobRunId))
    .where(eq(operatorJobNotification.notificationId, stored.id));
  requireValid(
    joined &&
      joined.run.job === 'sla_digest' &&
      stored.createdAt >= joined.run.startedAt &&
      joined.link.digestDay === joined.run.digestDay &&
      joined.link.recipient === stored.recipient &&
      joined.run.correlationId === stored.correlationId &&
      bangkokDate(joined.run.startedAt) === joined.run.digestDay,
  );
  const snapshot = stored.templateParams;
  requireValid(Value.Check(SnapshotSchema, snapshot));
  const configuration = await currentRevision(tx, 'operator_recipients', joined.run.startedAt);
  requireValid(
    configuration &&
      configuration.id === snapshot.configurationRevisionId &&
      Value.Check(OperatorRecipientsBodySchema, configuration.body) &&
      configuration.body.addresses.includes(stored.recipient),
  );
  for (const breach of snapshot.breaches) {
    const [version] = await tx
      .select()
      .from(packVersion)
      .where(and(eq(packVersion.id, breach.versionId), eq(packVersion.caseId, breach.caseId)));
    requireValid(
      version?.submittedAt &&
        version.submittedAt <= joined.run.startedAt &&
        breach.dueOn < joined.run.digestDay,
    );
    const due = (await laneDueDates(tx, breach.versionId)).find((d) => d.lane === breach.lane);
    requireValid(due?.dueOn === breach.dueOn);
  }
  const request = render(
    eventFor(joined.run, stored.createdAt),
    stored.recipient,
    snapshot,
    deps.publicBaseUrl,
  );
  requireValid(
    stored.templateKey === request.mail.templateKey &&
      stored.deepLinkPath === new URL(request.deepLinks[0]!.url).pathname,
  );
  return request;
}

export interface DigestDeps {
  db: Db;
  publicBaseUrl: URL;
  emitter: Emitter;
  now?: () => Date;
  locale?: Locale;
  /** Failure-injection seam; never receives case data or recipients. */
  beforeStage?: (stage: Stage) => void;
}
function duplicateRecipient(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; cause?: unknown } | null;
  return (
    !!e &&
    ((e.code === '23505' && e.constraint === 'operator_digest_day_recipient_key') ||
      (e.cause !== undefined && duplicateRecipient(e.cause)))
  );
}
export function createDigestProducer(deps: DigestDeps) {
  const now = deps.now ?? (() => new Date());
  return async function run(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const startedAt = now();
    const [job] = await deps.db
      .insert(operatorJobRun)
      .values({
        id: randomUUID(),
        job: 'sla_digest',
        digestDay: bangkokDate(startedAt),
        correlationId: randomUUID(),
        startedAt,
        status: 'running',
      })
      .returning();
    const run = job!;
    return runWithContext({ correlationId: run.correlationId, startedAt: performance.now() }, async () => {
      let stage: Stage = 'query';
      let breachCount: number | null = null;
      const notificationIds: string[] = [];
      try {
        deps.beforeStage?.(stage);
        const breaches = await listSlaBreaches(deps.db, startedAt);
        breachCount = breaches.length;
        const configuration = await currentRevision(deps.db, 'operator_recipients', startedAt);
        requireValid(configuration && Value.Check(OperatorRecipientsBodySchema, configuration.body));
        stage = 'render';
        deps.beforeStage?.(stage);
        signal?.throwIfAborted();
        if (breaches.length !== 0) {
          const snapshot: Snapshot = {
            configurationRevisionId: configuration.id,
            locale: deps.locale ?? 'th',
            breaches,
          };
          requireValid(Value.Check(SnapshotSchema, snapshot));
          const addresses = [...new Set(configuration.body.addresses)];
          // Validate every recipient/render before any enqueue transaction.
          const messages = addresses.map((address) =>
            render(eventFor(run, startedAt), address, snapshot, deps.publicBaseUrl),
          );
          stage = 'enqueue';
          for (const message of messages) {
            signal?.throwIfAborted();
            const id = randomUUID();
            try {
              await deps.db.transaction(async (tx) => {
                await tx.insert(notification).values({
                  id,
                  event: 'sla_breach_digest',
                  lane: '-',
                  recipient: message.recipient.address,
                  templateKey: message.mail.templateKey,
                  templateParams: snapshot,
                  deepLinkPath: new URL(message.deepLinks[0]!.url).pathname,
                  correlationId: run.correlationId,
                  createdAt: now(),
                });
                deps.beforeStage?.(stage);
                await tx.insert(operatorJobNotification).values({
                  jobRunId: run.id,
                  notificationId: id,
                  digestDay: run.digestDay,
                  recipient: message.recipient.address,
                });
                signal?.throwIfAborted();
              });
              notificationIds.push(id);
            } catch (err) {
              if (!duplicateRecipient(err)) throw err;
            }
          }
        }
        signal?.throwIfAborted();
        await deps.db
          .update(operatorJobRun)
          .set({ status: 'completed', breachCount, finishedAt: now() })
          .where(eq(operatorJobRun.id, run.id));
        deps.emitter.log('sla.digest.completed', { jobRunId: run.id, breachCount, notificationIds });
        return { jobRunId: run.id, notificationIds, status: 'completed' as const };
      } catch {
        const errorCode = `${stage}_failed`;
        await deps.db
          .update(operatorJobRun)
          .set({ status: 'failed', breachCount, finishedAt: now(), errorStage: stage, errorCode })
          .where(eq(operatorJobRun.id, run.id));
        deps.emitter.log('sla.digest.failed', { jobRunId: run.id, stage, errorCode });
        return { jobRunId: run.id, notificationIds, status: 'failed' as const };
      }
    });
  };
}
