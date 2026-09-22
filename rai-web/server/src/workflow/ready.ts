// W2-06: Ready predicate and system transition (W0-06 §4.9 / §6; W0-04 Ready row). Evaluated only inside
// lane.approved and disposition transactions under the case row lock — never a user route. Desk completion
// only; not Council or ITSM approval.
import { and, eq, sql } from 'drizzle-orm';
import { LANES, type Lane } from '@rai/shared/constants';
import type { AuditRefValue } from '../audit/store.js';
import { auditStore } from '../audit/store.js';
import { readVersionRow, type CaseRow } from '../cases/repository.js';
import type { Tx } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { laneDecision } from '../db/schema/lane-decision.js';
import { packVersion } from '../db/schema/pack-version.js';
import { CaseRowChanged } from '../versions/repository.js';
import { insertReadyNotifications } from './ready-notice.js';

export type ReadyTrigger = {
  /** Audit / decision / disposition id that caused the recheck. */
  id: string;
  /** Event name stored on case.ready_for_launch.target_ref.triggered_by_event. */
  event: 'lane.approved' | 'disposition.recorded' | 'disposition.proposed' | 'disposition.confirmed';
};

export type ReadyEval =
  | {
      ready: true;
      approvalDecisionIds: string[];
      dispositionedFindingCount: number;
    }
  | {
      ready: false;
      missingApprovals: Lane[];
      undispositionedFindingIds: string[];
    };

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
 * W0-06 §6 + persistence Ready SQL sketches. Runs under the case lock. Approvals on any earlier version
 * do not count; fixed_proposed alone leaves a finding undispositioned; owner-as-approver fails closed.
 */
export async function evaluateReadyPredicate(
  tx: Tx,
  caseRow: CaseRow,
  versionId: string,
): Promise<ReadyEval> {
  if (caseRow.currentVersionId !== versionId) {
    return { ready: false, missingApprovals: [...LANES], undispositionedFindingIds: [] };
  }

  const version = await readVersionRow(tx, versionId);
  if (version === undefined || version.submittedAt === null || version.readyAt != null) {
    return { ready: false, missingApprovals: [...LANES], undispositionedFindingIds: [] };
  }

  const approvals = await tx
    .select({
      id: laneDecision.id,
      lane: laneDecision.lane,
      actorSubjectId: laneDecision.actorSubjectId,
    })
    .from(laneDecision)
    .where(and(eq(laneDecision.versionId, versionId), eq(laneDecision.decision, 'approve')));

  const byLane = new Map(approvals.map((row) => [row.lane as Lane, row]));
  const missingApprovals = LANES.filter((lane) => !byLane.has(lane));

  const undispositioned = await tx.execute(sql`
    SELECT f.id::text AS id
    FROM qc_finding f
    LEFT JOIN LATERAL (
      SELECT kind
      FROM disposition_event d
      WHERE d.finding_id = f.id
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 1
    ) latest ON true
    WHERE f.version_id = ${versionId}::uuid
      AND (latest.kind IS NULL OR latest.kind = 'fixed_proposed')
  `);
  const undispositionedFindingIds = (undispositioned.rows as Array<{ id: string }>).map((r) => r.id);

  // §6 condition 4: approving actors must not be the case owner (SPOC/self-approval already enforced at 4.4).
  const ownerAsApprover = approvals.some((row) => row.actorSubjectId === caseRow.ownerSubjectId);

  if (missingApprovals.length > 0 || undispositionedFindingIds.length > 0 || ownerAsApprover) {
    return { ready: false, missingApprovals, undispositionedFindingIds };
  }

  const dispositioned = await tx.execute(sql`
    SELECT count(*)::int AS n
    FROM qc_finding f
    INNER JOIN LATERAL (
      SELECT kind
      FROM disposition_event d
      WHERE d.finding_id = f.id
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 1
    ) latest ON true
    WHERE f.version_id = ${versionId}::uuid
      AND latest.kind IN ('fixed', 'fixed_confirmed', 'waived', 'not_applicable')
  `);
  const dispositionedFindingCount = Number((dispositioned.rows[0] as { n: number } | undefined)?.n ?? 0);

  return {
    ready: true,
    approvalDecisionIds: LANES.map((lane) => byLane.get(lane)!.id),
    dispositionedFindingCount,
  };
}

/**
 * Recheck under the lock immediately before writing. If the predicate fails, writes nothing beyond the
 * triggering event (caller already committed that write in this transaction).
 */
export async function applyReadyIfHeld(
  tx: Tx,
  caseRow: CaseRow,
  versionId: string,
  input: {
    trigger: ReadyTrigger;
    correlationId: string;
    occurredAt: Date;
    recipients: readonly string[];
  },
): Promise<{ applied: true; caseRow: CaseRow } | { applied: false }> {
  const evaluation = await evaluateReadyPredicate(tx, caseRow, versionId);
  if (!evaluation.ready) return { applied: false };

  const [versionAfter] = await tx
    .update(packVersion)
    .set({ readyAt: input.occurredAt })
    .where(and(eq(packVersion.id, versionId), sql`${packVersion.readyAt} IS NULL`))
    .returning({ id: packVersion.id });
  if (versionAfter === undefined) return { applied: false };

  const [after] = await tx
    .update(cases)
    .set({
      deskStatus: 'ready',
      aiReadinessStatus: 'ready',
      updatedAt: input.occurredAt,
    })
    .where(eq(cases.id, caseRow.id))
    .returning();
  if (after === undefined) throw new CaseRowChanged(caseRow.id);

  await insertReadyNotifications({
    tx,
    caseId: caseRow.id,
    versionId,
    recipients: input.recipients,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });

  await auditStore.append(tx, {
    actorSubjectId: 'system',
    actorRole: 'system',
    action: 'case.ready_for_launch',
    targetCaseId: caseRow.id,
    targetVersionId: versionId,
    targetRef: {
      triggered_by: input.trigger.id,
      triggered_by_event: input.trigger.event,
      approval_decision_ids: evaluation.approvalDecisionIds,
      dispositioned_finding_count: evaluation.dispositionedFindingCount,
    },
    beforeRef: caseRef(caseRow),
    afterRef: caseRef(after),
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });

  return { applied: true, caseRow: after };
}
