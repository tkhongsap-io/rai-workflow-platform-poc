// W2-02 / W2-03: lane decision store helpers — insert and read decisions, write lane projection, create or reuse
// successor draft on send-back (D05 / W0-06 4.5: concurrent send-backs share one N+1 under the case lock).
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from '@rai/shared/ids';
import type { Lane } from '@rai/shared/constants';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { LaneDecision, LaneDecisionKind, SendBackFeedback } from '@rai/shared/schemas/review';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { deskStatusFor } from '../cases/status.js';
import type { Executor, Tx } from '../db/client.js';
import { artifactSlot } from '../db/schema/artifact-slot.js';
import { cases } from '../db/schema/case.js';
import { laneDecision } from '../db/schema/lane-decision.js';
import { packVersion } from '../db/schema/pack-version.js';
import { CaseRowChanged } from '../versions/repository.js';

export type LaneProjectionValue = 'pending' | 'approved' | 'sent_back';

/** W0-04 / W0-06 4.10: which case projection column a lane writes. */
export function projectionColumnForLane(lane: Lane): 'privacyStatus' | 'securityStatus' | 'raiStatus' {
  switch (lane) {
    case 'dpo':
      return 'privacyStatus';
    case 'it_security':
      return 'securityStatus';
    case 'ai_coe':
      return 'raiStatus';
  }
}

export interface InsertDecisionInput {
  id: string;
  versionId: string;
  lane: Lane;
  decision: 'approve' | 'send_back';
  actorSubjectId: string;
  actorRole: string;
  actorScopes: RoleScope[];
  feedback: SendBackFeedback | null;
  observedQcRunId: string | null;
  decidedAt: Date;
  correlationId: string;
}

export async function insertLaneDecision(tx: Tx, input: InsertDecisionInput): Promise<void> {
  await tx.insert(laneDecision).values({
    id: input.id,
    versionId: input.versionId,
    lane: input.lane,
    decision: input.decision,
    actorSubjectId: input.actorSubjectId,
    actorRole: input.actorRole,
    actorScopes: input.actorScopes,
    feedback: input.feedback,
    observedQcRunId: input.observedQcRunId,
    decidedAt: input.decidedAt,
    correlationId: input.correlationId,
    idempotencyKeyId: null,
  });
}

export async function findLaneDecision(
  exec: Executor,
  versionId: string,
  lane: Lane,
): Promise<{ id: string; decision: string } | undefined> {
  const [row] = await exec
    .select({ id: laneDecision.id, decision: laneDecision.decision })
    .from(laneDecision)
    .where(and(eq(laneDecision.versionId, versionId), eq(laneDecision.lane, lane)))
    .limit(1);
  return row;
}

/** The version's decisions in the W0-02 7.6 read shape, ascending by `decided_at` then lane. */
export async function listLaneDecisions(exec: Executor, versionId: string): Promise<LaneDecision[]> {
  const rows = await exec
    .select({
      lane: laneDecision.lane,
      decision: laneDecision.decision,
      decidedBy: laneDecision.actorSubjectId,
      decidedAt: laneDecision.decidedAt,
      feedback: laneDecision.feedback,
    })
    .from(laneDecision)
    .where(eq(laneDecision.versionId, versionId))
    .orderBy(asc(laneDecision.decidedAt), asc(laneDecision.lane));
  return rows.map((row) => ({
    lane: row.lane as Lane,
    decision: row.decision as LaneDecisionKind,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
    feedback: row.feedback as SendBackFeedback | null, // validated against SendBackFeedbackSchema on insert
  }));
}

/**
 * Writes the lane's projection under the case lock. Does **not** increment `case.row_version`
 * (W0-06 5.1: a submitted version's revision is frozen; sibling lane decisions must not 409 each other).
 * A successor draft just created is linked in the same UPDATE, and the case then reads as sent_back.
 */
export async function writeLaneProjection(
  tx: Tx,
  before: CaseRow,
  lane: Lane,
  value: LaneProjectionValue,
  now: Date,
  successorDraftId?: string,
): Promise<CaseRow> {
  const patch: Partial<CaseRow> = { [projectionColumnForLane(lane)]: value, updatedAt: now };
  if (successorDraftId !== undefined) {
    patch.draftVersionId = successorDraftId;
    patch.deskStatus = deskStatusFor('sent_back');
  }
  const [row] = await tx.update(cases).set(patch).where(eq(cases.id, before.id)).returning();
  if (row === undefined) throw new CaseRowChanged(before.id);
  return row;
}

export interface SuccessorDraftResult {
  draft: PackVersionRow;
  created: boolean;
}

/**
 * D05 / W0-06 4.5: if no open draft exists, create N+1 with parent = N, copy stage_context,
 * checklist_template_version, risk_answers (W5-04, attribution included) and all nine slots (caller sets case.draft_version_id). If
 * case.draft_version_id is already set, reuse that draft. Concurrent send-backs share one draft
 * because withWorkflowTransaction locks the case row before this runs.
 */
export async function ensureSuccessorDraft(
  tx: Tx,
  before: CaseRow,
  parent: PackVersionRow,
  createdBy: string,
  now: Date,
): Promise<SuccessorDraftResult> {
  if (before.draftVersionId !== null) {
    const [existing] = await tx
      .select()
      .from(packVersion)
      .where(eq(packVersion.id, before.draftVersionId))
      .limit(1);
    if (existing === undefined) throw new CaseRowChanged(before.id);
    return { draft: existing, created: false };
  }

  const draftId = uuidv7(now.getTime());
  const nextNumber = parent.versionNumber + 1;
  const [draft] = await tx
    .insert(packVersion)
    .values({
      id: draftId,
      caseId: before.id,
      versionNumber: nextNumber,
      parentVersionId: parent.id,
      createdBy,
      createdAt: now,
      stageContext: parent.stageContext,
      checklistTemplateVersion: parent.checklistTemplateVersion,
      riskAnswers: parent.riskAnswers, // W5-04: the answers and their original attribution, as the slots are copied
    })
    .returning();
  if (draft === undefined) throw new CaseRowChanged(before.id);

  const parentSlots = await tx.select().from(artifactSlot).where(eq(artifactSlot.versionId, parent.id));
  if (parentSlots.length > 0) {
    await tx.insert(artifactSlot).values(
      parentSlots.map((s) => ({
        id: uuidv7(now.getTime()),
        versionId: draftId,
        slot: s.slot,
        state: s.state,
        reason: s.reason,
        artifactId: s.artifactId,
        updatedBy: createdBy,
        updatedAt: now,
      })),
    );
  }

  return { draft, created: true };
}
