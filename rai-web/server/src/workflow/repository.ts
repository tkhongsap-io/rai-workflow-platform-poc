// W2-02 / W2-03: lane decision store helpers — insert decision, write lane projection, create or reuse
// successor draft on send-back (D05 / W0-06 4.5: concurrent send-backs share one N+1).
import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '@rai/shared/ids';
import type { Lane } from '@rai/shared/constants';
import type { SendBackFeedback } from '@rai/shared/schemas/review';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import type { Executor, Tx } from '../db/client.js';
import { artifactSlot } from '../db/schema/artifact-slot.js';
import { cases } from '../db/schema/case.js';
import { laneDecision } from '../db/schema/lane-decision.js';
import { packVersion } from '../db/schema/pack-version.js';
import { CaseRowChanged } from '../versions/repository.js';

/** Postgres unique_violation (W0-06 4.5 / 9.3 backstop when two successor inserts race). */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur != null; i += 1) {
    if (typeof cur !== 'object') return false;
    const record = cur as { code?: unknown; cause?: unknown };
    if (record.code === '23505') return true;
    cur = record.cause;
  }
  return false;
}

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

/**
 * Writes the lane's projection under the case lock. Does **not** increment `case.row_version`
 * (W0-06 5.1: a submitted version's revision is frozen; sibling lane decisions must not 409 each other).
 * Optionally sets `draft_version_id` when a successor draft was just created (same UPDATE).
 */
export async function writeLaneProjection(
  tx: Tx,
  before: CaseRow,
  lane: Lane,
  value: LaneProjectionValue,
  now: Date,
  draftVersionId?: string | null,
): Promise<CaseRow> {
  const column = projectionColumnForLane(lane);
  const patch: Record<string, unknown> = {
    [column]: value,
    updatedAt: now,
  };
  if (draftVersionId !== undefined) patch.draftVersionId = draftVersionId;
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
 * checklist_template_version and all nine slots; set case.draft_version_id. If a draft already exists, reuse it.
 * Unique-violation on the one-draft-per-case index is recovered via SAVEPOINT (never surfaced as a duplicate).
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
  await tx.execute(sql.raw(`SAVEPOINT successor_draft`));
  try {
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

    await tx.execute(sql.raw(`RELEASE SAVEPOINT successor_draft`));
    return { draft, created: true };
  } catch (err) {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT successor_draft`));
    if (!isUniqueViolation(err)) throw err;
    // W0-06 4.5: lock bypass backstop — reclaim the one open draft rather than failing the second send-back.
    const [existing] = await tx
      .select()
      .from(packVersion)
      .where(and(eq(packVersion.caseId, before.id), isNull(packVersion.submittedAt)))
      .limit(1);
    if (existing === undefined) throw err;
    return { draft: existing, created: false };
  }
}
