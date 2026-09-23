// W2-06: Ready predicate and system transition (W0-06 §4.9 / §6; W0-04 Ready row). Evaluated only inside
// lane.approved and disposition transactions under the case row lock — never a user route. Desk completion
// only; not Council or ITSM approval.
import { and, desc, eq, sql } from 'drizzle-orm';
import { LANE_MAPPINGS_BY_VERSION, type Lane } from '@rai/shared/constants';
import type { Principal, RoleScope } from '@rai/shared/schemas/auth';
import type { AuditRefValue } from '../audit/store.js';
import { auditStore } from '../audit/store.js';
import { isOwnerOrSpocOnCase, type Actor, type CaseScopeFacts } from '../authz/policy.js';
import { readVersionRow, type CaseRow } from '../cases/repository.js';
import { deskStatusFor } from '../cases/status.js';
import type { Tx } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { laneDecision } from '../db/schema/lane-decision.js';
import { packVersion } from '../db/schema/pack-version.js';
import { session } from '../db/schema/session.js';
import { CaseRowChanged } from '../versions/repository.js';
import { insertReadyNotifications } from './ready-notice.js';

export type ReadyTrigger = {
  /** Audit / decision / disposition id that caused the recheck. */
  id: string;
  /** Event name stored on case.ready_for_launch.target_ref.triggered_by_event. */
  event: 'lane.approved' | 'disposition.recorded' | 'disposition.proposed' | 'disposition.confirmed';
};

/** Known identities (fixture list in slice 1) used to resolve approver grants for §6 condition 4. */
export type ReadyKnownIdentity = {
  subjectId: string;
  roles: readonly RoleScope[];
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
 * Lanes required by the mapping frozen on the version (same resolution as open-lanes). Unknown or
 * missing `lane_mapping_version` fails closed.
 */
export function requiredLanesForMapping(laneMappingVersion: string | null): readonly Lane[] | null {
  if (laneMappingVersion === null || laneMappingVersion === '') return null;
  const mapping = LANE_MAPPINGS_BY_VERSION[laneMappingVersion];
  if (mapping === undefined) return null;
  return Object.keys(mapping.slotsByLane) as Lane[];
}

function actorFromKnown(subjectId: string, known: readonly ReadyKnownIdentity[]): Actor | undefined {
  const match = known.find((u) => u.subjectId === subjectId);
  if (match === undefined) return undefined;
  return { subjectId: match.subjectId, roles: [...match.roles] };
}

/** Same store as cases/subject-directory: newest session.principal for the subject. */
async function actorFromLatestSession(tx: Tx, subjectId: string): Promise<Actor | undefined> {
  const [row] = await tx
    .select({ principal: session.principal })
    .from(session)
    .where(eq(session.subjectId, subjectId))
    .orderBy(desc(session.createdAt))
    .limit(1);
  const principal = row?.principal as Partial<Principal> | undefined;
  if (principal === undefined || !Array.isArray(principal.roles) || principal.roles.length === 0) {
    return undefined;
  }
  return { subjectId, roles: [...principal.roles] };
}

/**
 * When neither known list nor session can resolve the approver: leak only if the decision names the
 * case owner as actor, or the stored actor_role is owner / bu_spoc. A plain reviewer we cannot look
 * up is not a leak (empty known list in local-google / network / production must still allow Ready).
 */
function leakFromDecisionFallback(actorSubjectId: string, actorRole: string, caseRow: CaseRow): boolean {
  if (actorSubjectId === caseRow.ownerSubjectId) return true;
  return actorRole === 'owner' || actorRole === 'bu_spoc';
}

async function approverIsOwnerOrSpocLeak(
  tx: Tx,
  approval: { actorSubjectId: string; actorRole: string },
  caseRow: CaseRow,
  knownIdentities: readonly ReadyKnownIdentity[],
  facts: CaseScopeFacts,
): Promise<boolean> {
  const fromKnown = actorFromKnown(approval.actorSubjectId, knownIdentities);
  if (fromKnown !== undefined) return isOwnerOrSpocOnCase(fromKnown, facts);
  const fromSession = await actorFromLatestSession(tx, approval.actorSubjectId);
  if (fromSession !== undefined) return isOwnerOrSpocOnCase(fromSession, facts);
  return leakFromDecisionFallback(approval.actorSubjectId, approval.actorRole, caseRow);
}

/**
 * W0-06 §6 + persistence Ready SQL sketches. Runs under the case lock. Approvals on any earlier version
 * do not count; fixed_proposed alone leaves a finding undispositioned; owner/BU-SPOC as approver fails closed.
 */
export async function evaluateReadyPredicate(
  tx: Tx,
  caseRow: CaseRow,
  versionId: string,
  knownIdentities: readonly ReadyKnownIdentity[],
): Promise<ReadyEval> {
  const notReady = (missing: readonly Lane[] = []): ReadyEval => ({
    ready: false,
    missingApprovals: [...missing],
    undispositionedFindingIds: [],
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
  // Resolve grants: known-identity list → latest session.principal → decision/case fallback.
  const facts: CaseScopeFacts = {
    ownerSubjectId: caseRow.ownerSubjectId,
    businessUnitId: caseRow.businessUnitId,
  };
  let selfApprovalLeak = false;
  for (const lane of requiredLanes) {
    const row = byLane.get(lane);
    if (row === undefined) continue;
    if (await approverIsOwnerOrSpocLeak(tx, row, caseRow, knownIdentities, facts)) {
      selfApprovalLeak = true;
      break;
    }
  }

  if (missingApprovals.length > 0 || undispositionedFindingIds.length > 0 || selfApprovalLeak) {
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
    knownIdentities: readonly ReadyKnownIdentity[];
  },
): Promise<{ applied: true; caseRow: CaseRow } | { applied: false }> {
  const evaluation = await evaluateReadyPredicate(tx, caseRow, versionId, input.knownIdentities);
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
