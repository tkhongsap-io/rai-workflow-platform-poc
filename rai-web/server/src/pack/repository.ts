// W0-04 `VersionWriteRepository` for the draft (`updateDraftSlot`, `updateDraftContext`) plus the reads behind the
// 7.5 `PackDraft`. Writes touch draft rows only: the caller holds the case row lock (service.ts) and has checked
// that the version is the open draft, and the W1-00 `artifact_slot_frozen` / `pack_version_frozen` triggers raise
// on any write to a submitted version below this layer. The case binding lives here as W0-04 requires: an
// `artifact_id` is loaded inside the transaction and refused when its `case_id` is not the version's case.

import { and, eq, sql } from 'drizzle-orm';
import type { PackDraft, SlotNumber, SlotState, StageContext } from '@rai/shared/schemas/pack';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import type { Executor, Tx } from '../db/client.js';
import { artifact } from '../db/schema/artifact.js';
import { artifactSlot } from '../db/schema/artifact-slot.js';
import { packVersion } from '../db/schema/pack-version.js';
import { isUuid } from '../workflow/refs.js';
import { storedRiskAnswers, type StoredRiskAnswers } from './risk-answers.js';
import {
  SLOT_NUMBERS,
  carriesVendorDefault,
  isSlotNumber,
  slotStateFromColumns,
  slotStateToColumns,
} from './slots.js';

export type ArtifactSlotRow = typeof artifactSlot.$inferSelect;
export type ArtifactRow = typeof artifact.$inferSelect;

/** W0-04 `ArtifactCaseMismatch`: the artifact is unknown or was uploaded under another case. */
export class ArtifactCaseMismatch extends Error {
  constructor(
    readonly slot: SlotNumber,
    readonly artifactId: string,
  ) {
    super(`artifact ${artifactId} does not belong to the version's case (slot ${slot})`);
    this.name = 'ArtifactCaseMismatch';
  }
}

/** The nine rows of one version, keyed by slot number. Throws when a version has other than nine rows. */
export async function readDraftSlots(
  exec: Executor,
  versionId: string,
): Promise<Record<SlotNumber, ArtifactSlotRow>> {
  const rows = await exec.select().from(artifactSlot).where(eq(artifactSlot.versionId, versionId));
  const out: Partial<Record<SlotNumber, ArtifactSlotRow>> = {};
  for (const row of rows) {
    if (!isSlotNumber(row.slot)) throw new Error(`artifact_slot ${row.id} has slot ${row.slot}`);
    out[row.slot] = row;
  }
  for (const slot of SLOT_NUMBERS) {
    if (out[slot] === undefined) throw new Error(`version ${versionId} has no slot ${slot} row`);
  }
  return out as Record<SlotNumber, ArtifactSlotRow>;
}

export function slotStatesOf(rows: Record<SlotNumber, ArtifactSlotRow>): Record<SlotNumber, SlotState> {
  const out: Partial<Record<SlotNumber, SlotState>> = {};
  for (const slot of SLOT_NUMBERS) out[slot] = slotStateFromColumns(rows[slot]);
  return out as Record<SlotNumber, SlotState>;
}

/** Resolves a subject's display name for a read (W3-F1); undefined omits `answeredByName`. */
export type NameOf = (subjectId: string) => Promise<string | undefined>;

/** The 7.5 `PackDraft` for the case's open draft; `nameOf` adds `answeredByName` to the risk answers (W5-04). */
export async function packDraftView(
  exec: Executor,
  caseRow: CaseRow,
  draft: PackVersionRow,
  nameOf: NameOf = () => Promise.resolve(undefined),
): Promise<PackDraft> {
  const rows = await readDraftSlots(exec, draft.id);
  const riskAnswers: PackDraft['riskAnswers'] = {};
  for (const [questionId, answer] of Object.entries(storedRiskAnswers(draft.riskAnswers))) {
    const name = await nameOf(answer.answeredBy);
    riskAnswers[questionId] = name === undefined ? answer : { ...answer, answeredByName: name };
  }
  return {
    draftId: draft.id,
    caseId: caseRow.id,
    versionNumber: draft.versionNumber,
    parentVersionId: draft.parentVersionId,
    checklistTemplateVersion: draft.checklistTemplateVersion,
    stageContext: draft.stageContext as StageContext,
    slots: slotStatesOf(rows),
    draftRevision: caseRow.rowVersion, // one counter per case (W0-04 case.row_version)
    updatedAt: caseRow.updatedAt.toISOString(),
    riskAnswers,
  };
}

/** Loads the artifact an attach names, inside the transaction, and applies the W0-04 case binding. */
export async function loadArtifactForSlot(
  exec: Executor,
  caseId: string,
  slot: SlotNumber,
  artifactId: string,
): Promise<ArtifactRow> {
  if (!isUuid(artifactId)) throw new ArtifactCaseMismatch(slot, artifactId); // unknown: never a uuid cast error
  const [row] = await exec.select().from(artifact).where(eq(artifact.id, artifactId)).limit(1);
  if (row === undefined || row.caseId !== caseId) throw new ArtifactCaseMismatch(slot, artifactId);
  return row;
}

/**
 * W0-04 `updateDraftSlot`: writes one slot row of the draft. An `attached` patch must name an artifact of the
 * version's case (`loadArtifactForSlot` ran, or runs here). Returns the written row.
 */
export async function updateDraftSlot(
  tx: Tx,
  version: { id: string; caseId: string },
  slot: SlotNumber,
  state: SlotState,
  updatedBy: string,
  now: Date,
): Promise<ArtifactSlotRow> {
  if (state.state === 'attached') await loadArtifactForSlot(tx, version.caseId, slot, state.artifactId);
  const columns = slotStateToColumns(state);
  const [row] = await tx
    .update(artifactSlot)
    .set({ ...columns, updatedBy, updatedAt: now })
    .where(and(eq(artifactSlot.versionId, version.id), eq(artifactSlot.slot, slot)))
    .returning();
  if (row === undefined) throw new Error(`version ${version.id} has no slot ${slot} row`);
  return row;
}

/** W0-04 `updateDraftContext`: the two draft-time columns the owner may set (D11 stage context; L12 template). */
export async function updateDraftContext(
  tx: Tx,
  versionId: string,
  patch: { stageContext?: StageContext; checklistTemplateVersion?: string },
): Promise<PackVersionRow> {
  const set: Partial<{ stageContext: string; checklistTemplateVersion: string }> = {};
  if (patch.stageContext !== undefined) set.stageContext = patch.stageContext;
  if (patch.checklistTemplateVersion !== undefined)
    set.checklistTemplateVersion = patch.checklistTemplateVersion;
  if (Object.keys(set).length === 0) {
    const [row] = await tx.select().from(packVersion).where(eq(packVersion.id, versionId)).limit(1);
    if (row === undefined) throw new Error(`no pack_version ${versionId}`);
    return row;
  }
  const [row] = await tx.update(packVersion).set(set).where(eq(packVersion.id, versionId)).returning();
  if (row === undefined) throw new Error(`no pack_version ${versionId}`);
  return row;
}

/**
 * W5-04 `updateDraftRiskAnswers`: replaces the draft's `risk_answers` with the merged answers (service.ts merges and
 * validates). The caller holds the case lock and has checked the version is the open draft; `pack_version_frozen`
 * raises below this layer on a submitted version. Returns the written row.
 */
export async function updateDraftRiskAnswers(
  tx: Tx,
  versionId: string,
  merged: StoredRiskAnswers,
): Promise<PackVersionRow> {
  const [row] = await tx
    .update(packVersion)
    .set({ riskAnswers: merged })
    .where(eq(packVersion.id, versionId))
    .returning();
  if (row === undefined) throw new Error(`no pack_version ${versionId}`);
  return row;
}

/**
 * The 7.5 flip rule, run by the case edit when `vendorInvolved` goes false → true: slots 3 and 4 that still carry
 * `default_non_vendor` revert to `missing`; a user-typed reason is kept. Returns the slots it changed.
 */
export async function revertVendorDefaults(
  tx: Tx,
  draftId: string,
  updatedBy: string,
  now: Date,
): Promise<SlotNumber[]> {
  const rows = await readDraftSlots(tx, draftId);
  const reverted: SlotNumber[] = [];
  for (const slot of SLOT_NUMBERS) {
    if (!carriesVendorDefault(rows[slot], slot)) continue;
    await tx
      .update(artifactSlot)
      .set({ state: 'missing', reason: null, artifactId: null, updatedBy, updatedAt: now })
      .where(and(eq(artifactSlot.versionId, draftId), eq(artifactSlot.slot, slot)));
    reverted.push(slot);
  }
  return reverted;
}

/** W0-08 check 10: bytes the draft's attached artifacts reference, by slot, so an attach can net out a replacement. */
export async function attachedBytesBySlot(
  exec: Executor,
  versionId: string,
): Promise<Partial<Record<SlotNumber, number>>> {
  const rows = await exec
    .select({ slot: artifactSlot.slot, sizeBytes: sql<string>`${artifact.sizeBytes}` })
    .from(artifactSlot)
    .innerJoin(artifact, eq(artifactSlot.artifactId, artifact.id))
    .where(and(eq(artifactSlot.versionId, versionId), eq(artifactSlot.state, 'attached')));
  const out: Partial<Record<SlotNumber, number>> = {};
  for (const row of rows) if (isSlotNumber(row.slot)) out[row.slot] = Number(row.sizeBytes);
  return out;
}
