// W2-06: Ready predicate and system transition (W0-06 §4.9 / §6; W0-04 Ready row). Evaluated only inside
// lane.approved and disposition transactions under the case row lock — never a user route. Desk completion
// only; not Council or ITSM approval.
import { and, eq, sql } from 'drizzle-orm';
import { LANE_MAPPINGS_BY_VERSION, type Lane } from '@rai/shared/constants';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { AuditRefValue } from '../audit/store.js';
import { auditStore } from '../audit/store.js';
import { isOwnerOrSpocOnCase, type CaseScopeFacts } from '../authz/policy.js';
import { readVersionRow, type CaseRow } from '../cases/repository.js';
import { deskStatusFor } from '../cases/status.js';
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
      /** Lanes whose approver was owner or BU SPOC on the case (§6 condition 4); never counted. */
      selfApprovedLanes: Lane[];
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
 * Lanes required by the mapping frozen on the version (same resolution as open-lanes). Unknown or
 * missing `lane_mapping_version` fails closed.
 */
export function requiredLanesForMapping(laneMappingVersion: string | null): readonly Lane[] | null {
  if (laneMappingVersion === null || laneMappingVersion === '') return null;
  const mapping = LANE_MAPPINGS_BY_VERSION[laneMappingVersion];
  if (mapping === undefined) return null;
  return Object.keys(mapping.slotsByLane) as Lane[];
}

/**
 * §6 condition 4 on the grants the approver held when deciding. A row without that snapshot (not written by
 * approveLane) is a leak when it names the case owner or records an owner / BU SPOC role.
 */
function approverIsOwnerOrSpoc(
  approval: { actorSubjectId: string; actorRole: string; actorScopes: RoleScope[] | null },
  facts: CaseScopeFacts,
): boolean {
  if (approval.actorScopes === null) {
    return (
      approval.actorSubjectId === facts.ownerSubjectId ||
      approval.actorRole === 'owner' ||
      approval.actorRole === 'bu_spoc'
    );
  }
  return isOwnerOrSpocOnCase({ subjectId: approval.actorSubjectId, roles: approval.actorScopes }, facts);
}

/**
 * W0-06 §6 + persistence Ready SQL sketches. Runs under the case lock. Approvals on any earlier version
 * do not count; fixed_proposed alone leaves a finding undispositioned; owner/BU-SPOC as approver fails closed.
 */
export async function evaluateReadyPredicate(
  tx: Tx,
  caseRow: CaseRow,
  versionId: string,
): Promise<ReadyEval> {
  const notReady = (missing: readonly Lane[] = []): ReadyEval => ({
    ready: false,
    missingApprovals: [...missing],
    undispositionedFindingIds: [],
    selfApprovedLanes: [],
  });

  if (caseRow.currentVersionId !== versionId) {
    return notReady();
  }

  const version = await readVersionRow(tx, versionId);
  if (version === undefined || version.submittedAt === null || version.readyAt != null) {
    return notReady();
  }

  const requiredLanes = requiredLanesForMapping(version.laneMappingVersion);
  if (requiredLanes === null || requiredLanes.length === 0) {
    return notReady();
  }

  const approvals = await tx
    .select({
      id: laneDecision.id,
      lane: laneDecision.lane,
      actorSubjectId: laneDecision.actorSubjectId,
      actorRole: laneDecision.actorRole,
      actorScopes: laneDecision.actorScopes,
    })
    .from(laneDecision)
    .where(and(eq(laneDecision.versionId, versionId), eq(laneDecision.decision, 'approve')));

  const byLane = new Map(approvals.map((row) => [row.lane as Lane, row]));
  const missingApprovals = requiredLanes.filter((lane) => !byLane.has(lane));

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

  // §6 condition 4: each approving actor must be neither owner nor BU SPOC of the case.
  const facts: CaseScopeFacts = {
    ownerSubjectId: caseRow.ownerSubjectId,
    businessUnitId: caseRow.businessUnitId,
  };
  const selfApprovedLanes = requiredLanes.filter((lane) => {
    const row = byLane.get(lane);
    return row !== undefined && approverIsOwnerOrSpoc(row, facts);
  });

  if (missingApprovals.length > 0 || undispositionedFindingIds.length > 0 || selfApprovedLanes.length > 0) {
    return { ready: false, missingApprovals, undispositionedFindingIds, selfApprovedLanes };
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
    approvalDecisionIds: requiredLanes.map((lane) => byLane.get(lane)!.id),
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
      deskStatus: deskStatusFor('ready_for_launch'),
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
