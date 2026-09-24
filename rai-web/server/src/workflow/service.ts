// W2-02: approve / send-back a lane (W0-06 4.4 / 4.5; W0-04 Decide row). Authorization ran in the middleware
// (lane.approve / lane.send_back with D05 self-exclusion). This module runs under withWorkflowTransaction:
// expected-version checks, lane_decision insert, projection write, successor draft on first send-back,
// send_back notification, and the decision audit event. Ready (W2-06) is evaluated inside approve after the
// decision write, under the same case lock.

import { createHash } from 'node:crypto';
import { InvalidInputError, NotFoundError, StaleVersionError } from '@rai/shared/errors';
import { uuidv7 } from '@rai/shared/ids';
import type { Lane } from '@rai/shared/constants';
import type { Principal, Role } from '@rai/shared/schemas/auth';
import type {
  ApproveLaneRequest,
  LaneDecisionResponse,
  SendBackFeedback,
  SendBackLaneRequest,
} from '@rai/shared/schemas/review';
import type { ExpectedVersion } from '@rai/shared/schemas/versions';
import type { AuditRefValue } from '../audit/store.js';
import { requestDigest } from '../cases/idempotency.js';
import { readVersionRow, type CaseRow, type PackVersionRow } from '../cases/repository.js';
import { staleDetails } from '../cases/service.js';
import type { Db, Tx } from '../db/client.js';
import { findLatestApproveAttemptRun, ruleRevisionOf } from '../qc/repository.js';
import {
  ensureSuccessorDraft,
  findLaneDecision,
  insertLaneDecision,
  writeLaneProjection,
} from './repository.js';
import { insertSendBackNotifications } from './send-back-notice.js';
import { applyReadyIfHeld } from './ready.js';
import { withWorkflowTransaction, type WorkflowResult } from '../versions/transaction.js';
import { isUuid } from '../versions/repository.js';

export interface DecideServiceDeps {
  db: Db;
  now?: () => Date;
  /** Owner email(s) for send_back and ready notices; resolved from identity data in start.ts / tests. */
  sendBackRecipientsForOwner?: (ownerSubjectId: string) => readonly string[];
}

export interface ActionContext {
  actor: Principal;
  role: Role;
  correlationId: string;
}

export const APPROVE_ACTION = 'lane.approve' as const;
export const SEND_BACK_ACTION = 'lane.send_back' as const;

const AUDIT_REF = /^[A-Za-z0-9_.:/@-]{1,64}$/;

function keyRef(key: string): string {
  return AUDIT_REF.test(key) ? key : createHash('sha256').update(key).digest('hex');
}

function refreshPathFor(caseId: string, version: PackVersionRow): string {
  return `/cases/${caseId}/versions/${version.id}`;
}

function caseRef(row: CaseRow): Record<string, AuditRefValue> {
  return {
    draft_version_id: row.draftVersionId,
    current_version_id: row.currentVersionId,
    desk_status: row.deskStatus,
    row_version: row.rowVersion,
    privacy_status: row.privacyStatus,
    security_status: row.securityStatus,
    rai_status: row.raiStatus,
    ai_readiness_status: row.aiReadinessStatus,
  };
}

/**
 * Shared expected-version / precondition checks for decide (W0-06 4.4 / 4.5 / 5.2).
 * Does **not** compare `expected.revision` to `case.row_version`: §5.1 freezes revision for submitted
 * versions, and §5.2 names version_superseded / version_closed / lane_already_decided for these actions.
 * Order matches W0-06 §4 / §5.2: existence (check 3), then Ready → version_closed for any mutating
 * action, then named-vs-current / submitted / successor checks. An unknown UUID stays not_found even
 * when Ready; a real non-current version of a Ready case is version_closed, not version_superseded.
 * `requireNoSuccessor`: approve only — a successor draft closes the version for further approvals.
 */
async function assertDecideTarget(
  tx: Tx,
  row: CaseRow,
  expected: ExpectedVersion,
  opts: { requireNoSuccessor: boolean },
): Promise<PackVersionRow> {
  if (!isUuid(expected.versionId)) throw new NotFoundError('version');

  // Check 3 — existence: the referenced version exists and belongs to this case.
  const named = await readVersionRow(tx, expected.versionId);
  if (named === undefined || named.caseId !== row.id) throw new NotFoundError('version');

  const current = row.currentVersionId === null ? undefined : await readVersionRow(tx, row.currentVersionId);
  if (current === undefined) throw new NotFoundError('version');

  // Check 6 — Ready closes every mutating action (§5.2), before named-vs-current.
  if (current.readyAt != null) {
    throw new StaleVersionError(
      staleDetails(
        'version_closed',
        'error.stale_version.guidance.ready',
        current,
        row.rowVersion,
        refreshPathFor(row.id, current),
      ),
    );
  }

  if (current.id !== named.id) {
    throw new StaleVersionError(
      staleDetails(
        'version_superseded',
        'error.stale_version.guidance.version_superseded',
        current,
        row.rowVersion,
        refreshPathFor(row.id, current),
      ),
    );
  }

  if (named.submittedAt === null) {
    throw new StaleVersionError(
      staleDetails(
        'version_superseded',
        'error.stale_version.guidance.version_superseded',
        named,
        row.rowVersion,
        refreshPathFor(row.id, named),
      ),
    );
  }

  if (opts.requireNoSuccessor && row.draftVersionId !== null) {
    throw new StaleVersionError(
      staleDetails(
        'version_closed',
        'error.stale_version.guidance.version_closed',
        named,
        row.rowVersion,
        refreshPathFor(row.id, named),
      ),
    );
  }

  return named;
}

async function assertLanePending(
  tx: Tx,
  version: PackVersionRow,
  lane: Lane,
  caseRow: CaseRow,
): Promise<void> {
  const existing = await findLaneDecision(tx, version.id, lane);
  if (existing !== undefined) {
    throw new StaleVersionError(
      staleDetails(
        'lane_already_decided',
        'error.stale_version.guidance.lane_already_decided',
        version,
        caseRow.rowVersion,
        refreshPathFor(caseRow.id, version),
      ),
    );
  }
}

/** Format check before the transaction (W0-06 4.4 `lane_qc_not_run`); approveLane checks the run itself. */
export function requireQcRunId(qcRunId: string | undefined): string {
  if (typeof qcRunId !== 'string' || !isUuid(qcRunId.trim())) {
    throw new InvalidInputError([
      { path: 'body.qcRunId', messageKey: 'error.invalid_input.lane_qc_not_run' },
    ]);
  }
  return qcRunId.trim();
}

/** A09: send-back feedback must name at least one artifact (slot). Schema enforces minItems; belt-and-braces. */
export function requireNamedArtifactFeedback(feedback: SendBackFeedback | undefined): SendBackFeedback {
  if (feedback === undefined || !Array.isArray(feedback.items) || feedback.items.length === 0) {
    throw new InvalidInputError([
      { path: 'body.feedback.items', messageKey: 'error.invalid_input.send_back_artifact_required' },
    ]);
  }
  for (let i = 0; i < feedback.items.length; i += 1) {
    const item = feedback.items[i]!;
    if (item.slot === undefined || item.deficiency === undefined || item.deficiency.trim() === '') {
      throw new InvalidInputError([
        { path: `body.feedback.items[${i}]`, messageKey: 'error.invalid_input.send_back_artifact_required' },
      ]);
    }
  }
  return feedback;
}

function responseOf(
  decisionId: string,
  versionId: string,
  lane: Lane,
  decision: 'approve' | 'send_back',
  decidedAt: Date,
  successorDraftVersionId: string | null,
  caseRevision: number,
  ready: boolean,
): LaneDecisionResponse {
  return {
    decisionId,
    versionId,
    lane,
    decision,
    decidedAt: decidedAt.toISOString(),
    successorDraftVersionId,
    caseRevision,
    ready,
  };
}

export async function approveLane(
  deps: DecideServiceDeps,
  ctx: ActionContext,
  caseId: string,
  versionId: string,
  lane: Lane,
  request: ApproveLaneRequest,
  idempotencyKey: string,
): Promise<WorkflowResult<LaneDecisionResponse>> {
  const now = (deps.now ?? (() => new Date()))();
  const qcRunId = requireQcRunId(request.qcRunId);
  // Path versionId must match the body's expectedVersion.versionId (route param is the target).
  if (request.expectedVersion.versionId !== versionId) {
    throw new InvalidInputError([
      { path: 'body.expectedVersion.versionId', messageKey: 'validation.required' },
    ]);
  }

  return withWorkflowTransaction<LaneDecisionResponse>(
    deps.db,
    caseId,
    {
      actor: ctx.actor,
      role: ctx.role,
      correlationId: ctx.correlationId,
      action: APPROVE_ACTION,
      idempotencyKey,
      requestDigest: requestDigest(APPROVE_ACTION, { ...request, lane, versionId }),
      now,
    },
    {
      async apply({ tx, caseRow: before, audit }) {
        const version = await assertDecideTarget(tx, before, request.expectedVersion, {
          requireNoSuccessor: true,
        });
        await assertLanePending(tx, version, lane, before);

        // W0-06 4.4 / 5.2: name the latest lane-QC run, so no one approves past a defect they never saw.
        // An `unavailable` run is a valid run to have seen.
        const latest = await findLatestApproveAttemptRun(tx, version.id, lane, ruleRevisionOf(version));
        if (latest === undefined) {
          throw new InvalidInputError([
            { path: 'body.qcRunId', messageKey: 'error.invalid_input.lane_qc_not_run' },
          ]);
        }
        if (latest.id !== qcRunId) {
          throw new StaleVersionError(
            staleDetails(
              'qc_run_superseded',
              'error.stale_version.guidance.qc_run_superseded',
              version,
              before.rowVersion,
              refreshPathFor(before.id, version),
            ),
          );
        }

        const decisionId = uuidv7(now.getTime());
        await insertLaneDecision(tx, {
          id: decisionId,
          versionId: version.id,
          lane,
          decision: 'approve',
          actorSubjectId: ctx.actor.subjectId,
          actorRole: ctx.role,
          actorScopes: ctx.actor.roles,
          feedback: null,
          observedQcRunId: qcRunId,
          decidedAt: now,
          correlationId: ctx.correlationId,
        });

        const after = await writeLaneProjection(tx, before, lane, 'approved', now);
        await audit({
          action: 'lane.approved',
          targetCaseId: before.id,
          targetVersionId: version.id,
          targetRef: {
            decision_id: decisionId,
            lane,
            idempotency_key: keyRef(idempotencyKey),
            qc_run_id: qcRunId,
          },
          beforeRef: caseRef(before),
          afterRef: caseRef(after),
          occurredAt: now,
        });

        const recipients = (deps.sendBackRecipientsForOwner ?? (() => []))(before.ownerSubjectId);
        const readyResult = await applyReadyIfHeld(tx, after, version.id, {
          trigger: { id: decisionId, event: 'lane.approved' },
          correlationId: ctx.correlationId,
          occurredAt: now,
          recipients,
        });
        const body = responseOf(
          decisionId,
          version.id,
          lane,
          'approve',
          now,
          null,
          before.rowVersion,
          readyResult.applied,
        );
        return { status: 201, body };
      },
    },
  );
}

export async function sendBackLane(
  deps: DecideServiceDeps,
  ctx: ActionContext,
  caseId: string,
  versionId: string,
  lane: Lane,
  request: SendBackLaneRequest,
  idempotencyKey: string,
): Promise<WorkflowResult<LaneDecisionResponse>> {
  const now = (deps.now ?? (() => new Date()))();
  const feedback = requireNamedArtifactFeedback(request.feedback);
  if (request.expectedVersion.versionId !== versionId) {
    throw new InvalidInputError([
      { path: 'body.expectedVersion.versionId', messageKey: 'validation.required' },
    ]);
  }

  return withWorkflowTransaction<LaneDecisionResponse>(
    deps.db,
    caseId,
    {
      actor: ctx.actor,
      role: ctx.role,
      correlationId: ctx.correlationId,
      action: SEND_BACK_ACTION,
      idempotencyKey,
      requestDigest: requestDigest(SEND_BACK_ACTION, { ...request, lane, versionId }),
      now,
    },
    {
      async apply({ tx, caseRow: before, audit }) {
        const version = await assertDecideTarget(tx, before, request.expectedVersion, {
          requireNoSuccessor: false,
        });
        await assertLanePending(tx, version, lane, before);

        const decisionId = uuidv7(now.getTime());
        await insertLaneDecision(tx, {
          id: decisionId,
          versionId: version.id,
          lane,
          decision: 'send_back',
          actorSubjectId: ctx.actor.subjectId,
          actorRole: ctx.role,
          actorScopes: ctx.actor.roles,
          feedback,
          observedQcRunId: null,
          decidedAt: now,
          correlationId: ctx.correlationId,
        });

        const successor = await ensureSuccessorDraft(tx, before, version, ctx.actor.subjectId, now);
        const after = await writeLaneProjection(
          tx,
          before,
          lane,
          'sent_back',
          now,
          successor.created ? successor.draft.id : undefined,
        );

        const recipients = (deps.sendBackRecipientsForOwner ?? (() => []))(before.ownerSubjectId);
        await insertSendBackNotifications({
          tx,
          caseId: before.id,
          versionId: version.id,
          lane,
          recipients,
          correlationId: ctx.correlationId,
          occurredAt: now,
          decisionId,
        });

        if (successor.created) {
          await audit({
            action: 'draft.successor_created',
            targetCaseId: before.id,
            targetVersionId: successor.draft.id,
            targetRef: {
              parent_version_id: version.id,
              version_number: successor.draft.versionNumber,
              triggered_by_decision_id: decisionId,
              lane,
            },
            beforeRef: caseRef(before),
            afterRef: caseRef(after),
            occurredAt: now,
          });
        }

        await audit({
          action: 'lane.sent_back',
          targetCaseId: before.id,
          targetVersionId: version.id,
          targetRef: {
            decision_id: decisionId,
            lane,
            idempotency_key: keyRef(idempotencyKey),
            feedback_item_count: feedback.items.length,
            successor_draft_version_id: successor.draft.id,
            successor_created: successor.created,
          },
          beforeRef: caseRef(before),
          afterRef: caseRef(after),
          occurredAt: now,
        });

        const body = responseOf(
          decisionId,
          version.id,
          lane,
          'send_back',
          now,
          successor.draft.id,
          before.rowVersion,
          false,
        );
        return { status: 201, body };
      },
    },
  );
}
