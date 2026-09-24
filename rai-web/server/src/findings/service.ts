// W2-05 disposition: append-only event on a finding (W0-06 4.7 / 4.8). Ready (W2-06) is evaluated in the same
// transaction after the disposition write. Authorization maps body.kind → finding.* action; the route calls
// authorize before this service.

import { InvalidInputError, NotFoundError } from '@rai/shared/errors';
import { uuidv7 } from '@rai/shared/ids';
import type { DispositionKind, DispositionRequest, DispositionResponse } from '@rai/shared/schemas/review';
import type { AuditAction } from '../audit/store.js';
import { requestDigest } from '../cases/idempotency.js';
import { readVersionRow } from '../cases/repository.js';
import type { Db } from '../db/client.js';
import { REASON_REQUIRED } from '../pack/slots.js';
import { withWorkflowTransaction, type ActionContext, type WorkflowResult } from '../versions/transaction.js';
import { applyReadyIfHeld, type ReadyTrigger } from '../workflow/ready.js';
import { caseRef, isUuid, keyRef, staleAt } from '../workflow/refs.js';
import {
  findLatestSubmittedVersionId,
  insertDisposition,
  readFindingForCase,
  readLatestDisposition,
} from './repository.js';

export interface DispositionServiceDeps {
  db: Db;
  now?: () => Date;
  /** Owner email(s) for ready notices; resolved from identity data in start.ts / tests. */
  readyRecipientsForOwner?: (ownerSubjectId: string) => readonly string[];
}

export const DISPOSITION_ACTION = 'finding.disposition' as const;

const KIND_TO_AUDIT: Record<DispositionKind, AuditAction> = {
  fixed_proposed: 'disposition.proposed',
  fixed_confirmed: 'disposition.confirmed',
  fixed: 'disposition.recorded',
  waived: 'disposition.recorded',
  not_applicable: 'disposition.recorded',
};

function requireReason(kind: DispositionKind, reason: string | undefined): string | null {
  if (kind === 'waived' || kind === 'not_applicable') {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new InvalidInputError([{ path: 'body.reason', messageKey: REASON_REQUIRED }]);
    }
    return reason.trim();
  }
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;
}

export async function recordDisposition(
  deps: DispositionServiceDeps,
  ctx: ActionContext,
  caseId: string,
  findingId: string,
  request: DispositionRequest,
  idempotencyKey: string,
): Promise<WorkflowResult<DispositionResponse>> {
  const clock = deps.now ?? (() => new Date());
  if (request.expectedVersion.versionId !== undefined && !isUuid(request.expectedVersion.versionId)) {
    throw new NotFoundError('version');
  }

  const reason = requireReason(request.kind, request.reason);

  return withWorkflowTransaction<DispositionResponse>(
    deps.db,
    caseId,
    {
      ...ctx,
      action: DISPOSITION_ACTION,
      idempotencyKey,
      requestDigest: requestDigest(DISPOSITION_ACTION, { ...request, findingId }),
      now: clock(),
    },
    {
      async apply({ tx, caseRow: before, audit }) {
        const finding = await readFindingForCase(tx, caseId, findingId);
        if (finding === undefined) throw new NotFoundError('finding');

        const findingVersion = await readVersionRow(tx, finding.versionId);
        if (findingVersion === undefined) throw new NotFoundError('version');

        // Ready closes mutating dispositions (W0-06 4.7 / 5.2 version_closed).
        const current =
          before.currentVersionId === null ? undefined : await readVersionRow(tx, before.currentVersionId);
        if (current?.readyAt != null) {
          throw staleAt('version_closed', 'error.stale_version.guidance.ready', current, before);
        }

        const latestSubmittedId = await findLatestSubmittedVersionId(tx, caseId);
        if (latestSubmittedId === undefined || finding.versionId !== latestSubmittedId) {
          const shown = current ?? findingVersion;
          throw staleAt(
            'version_superseded',
            'error.stale_version.guidance.version_superseded',
            shown,
            before,
          );
        }

        // expectedVersion must name the finding's version (the latest submitted).
        if (request.expectedVersion.versionId !== finding.versionId) {
          throw staleAt(
            'version_superseded',
            'error.stale_version.guidance.version_superseded',
            findingVersion,
            before,
          );
        }

        const latest = await readLatestDisposition(tx, finding.id);
        if (request.kind === 'fixed_confirmed' && latest?.kind !== 'fixed_proposed') {
          throw new InvalidInputError([
            { path: 'body.kind', messageKey: 'error.invalid_input.fixed_confirmed_without_proposal' },
          ]);
        }

        // Minted under the case lock and after the finding's latest event, so "latest" follows commit order
        // even with a frozen clock or a second instance whose clock lags.
        const stamp = new Date(Math.max(clock().getTime(), (latest?.createdAt.getTime() ?? -Infinity) + 1));
        const dispositionId = uuidv7(stamp.getTime());
        const evidenceRef =
          request.evidence === undefined
            ? null
            : {
                ...(request.evidence.slot === undefined ? {} : { slot: request.evidence.slot }),
                ...(request.evidence.artifactId === undefined
                  ? {}
                  : { artifact_id: request.evidence.artifactId }),
              };

        await insertDisposition(tx, {
          id: dispositionId,
          findingId: finding.id,
          kind: request.kind,
          reason,
          evidenceRef,
          actorSubjectId: ctx.actor.subjectId,
          actorRole: ctx.role,
          createdAt: stamp,
          correlationId: ctx.correlationId,
        });

        const auditAction = KIND_TO_AUDIT[request.kind];
        await audit({
          action: auditAction,
          targetCaseId: caseId,
          targetVersionId: finding.versionId,
          targetRef: {
            finding_id: finding.id,
            disposition_id: dispositionId,
            kind: request.kind,
            owning_lane: finding.owningLane,
            idempotency_key: keyRef(idempotencyKey),
            ...(reason === null ? {} : { reason_present: true }),
          },
          beforeRef: caseRef(before),
          afterRef: caseRef(before),
          occurredAt: stamp,
        });

        const recipients = (deps.readyRecipientsForOwner ?? (() => []))(before.ownerSubjectId);
        const readyResult = await applyReadyIfHeld(tx, before, finding.versionId, {
          trigger: { id: dispositionId, event: auditAction as ReadyTrigger['event'] },
          correlationId: ctx.correlationId,
          occurredAt: stamp,
          recipients,
        });

        const body: DispositionResponse = {
          dispositionId,
          findingId: finding.id,
          kind: request.kind,
          recordedAt: stamp.toISOString(),
          caseRevision: before.rowVersion,
          ready: readyResult.applied,
        };

        return { status: 201, body };
      },
    },
  );
}
