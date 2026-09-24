// W0-04 store access for submitted versions. Writes: `freezeDraft` is the last UPDATE a `pack_version` row ever
// receives (it sets `submitted_at`, after which the W1-00 `pack_version_frozen` trigger raises on any change but
// `ready_at`) and `closeDraftOnCase` moves the case pointers. No function here updates a submitted version or its
// slot rows; none exists in the data-access layer (W0-02 7.6 "no UPDATE path"), and the triggers stand below.
// Reads: the submitted versions of a case (ascending by number), one version scoped to its case, and the frozen
// slot rows joined with the artifact rows they reference (the embedded, immutable `ArtifactRef` copies).

import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import { toArtifactRef } from '../artifacts/pipeline.js';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { deskStatusFor } from '../cases/status.js';
import type { Executor, Tx } from '../db/client.js';
import { artifact } from '../db/schema/artifact.js';
import { artifactSlot } from '../db/schema/artifact-slot.js';
import { cases } from '../db/schema/case.js';
import { packVersion } from '../db/schema/pack-version.js';
import { isUuid } from '../workflow/refs.js';
import type { ManifestSlot } from './manifest.js';
import type { SlotColumnsIn } from './freeze.js';

/** The frozen columns the submit transaction writes once (W0-04 `pack_version`, "Frozen at submit"). */
export interface FreezeInput {
  submittedBy: string;
  submittedRole: string;
  submittedAt: Date;
  configurationRevisionId: string;
  frozenConfiguration: Record<string, string>;
  laneMappingVersion: string;
  laneMapping: Record<string, unknown>;
  manifestHash: string;
  submitCorrelationId: string;
}

export class DraftNotOpen extends Error {
  constructor(readonly versionId: string) {
    super(`pack_version ${versionId} is not an open draft`);
    this.name = 'DraftNotOpen';
  }
}

/** The freeze: one UPDATE on the draft row, guarded by `submitted_at IS NULL`; the row is immutable afterwards. */
export async function freezeDraft(tx: Tx, draftId: string, input: FreezeInput): Promise<PackVersionRow> {
  const [row] = await tx
    .update(packVersion)
    .set({
      submittedBy: input.submittedBy,
      submittedRole: input.submittedRole,
      submittedAt: input.submittedAt,
      configurationRevisionId: input.configurationRevisionId,
      frozenConfiguration: input.frozenConfiguration,
      laneMappingVersion: input.laneMappingVersion,
      laneMapping: input.laneMapping,
      manifestHash: input.manifestHash,
      submitCorrelationId: input.submitCorrelationId,
    })
    .where(and(eq(packVersion.id, draftId), sql`${packVersion.submittedAt} IS NULL`))
    .returning();
  if (row === undefined) throw new DraftNotOpen(draftId);
  return row;
}

export class CaseRowChanged extends Error {
  constructor(readonly caseId: string) {
    super(`case ${caseId} changed under the lock`);
    this.name = 'CaseRowChanged';
  }
}

/**
 * W0-04 "Submit" / "Resubmit" row on the case: `current_version_id = the version`, `draft_version_id = NULL`
 * (no open draft after submit; W2-03 creates N+1 later), `desk_status = 'in_review'`, the three lane
 * projections `pending` (W0-06 4.10: every submission reopens all lanes; a no-op for v1), `row_version + 1`.
 * Runs under `rai.workflow_write`, which `withWorkflowTransaction` set. `risk_tier` is untouched.
 * First submit leaves `ai_readiness_status` untouched; resubmit (W2-04) also sets it to `not_ready`.
 */
export async function closeDraftOnCase(
  tx: Tx,
  before: CaseRow,
  versionId: string,
  now: Date,
  opts?: { resetAiReadiness?: boolean },
): Promise<CaseRow> {
  const [row] = await tx
    .update(cases)
    .set({
      currentVersionId: versionId,
      draftVersionId: null,
      deskStatus: deskStatusFor('in_review'),
      privacyStatus: 'pending',
      securityStatus: 'pending',
      raiStatus: 'pending',
      ...(opts?.resetAiReadiness === true ? { aiReadinessStatus: 'not_ready' as const } : {}),
      rowVersion: sql`${cases.rowVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(cases.id, before.id),
        eq(cases.rowVersion, before.rowVersion),
        eq(cases.draftVersionId, versionId),
      ),
    )
    .returning();
  if (row === undefined) throw new CaseRowChanged(before.id);
  return row;
}

/** The submitted versions of a case, ascending by `version_number` (W0-02 7.6 `VersionListResponse`). */
export async function listSubmittedVersions(exec: Executor, caseId: string): Promise<PackVersionRow[]> {
  return exec
    .select()
    .from(packVersion)
    .where(and(eq(packVersion.caseId, caseId), isNotNull(packVersion.submittedAt)))
    .orderBy(asc(packVersion.versionNumber));
}

/** One submitted version, only when it belongs to `caseId` (7.6: 404 also when it belongs to another case). */
export async function readSubmittedVersion(
  exec: Executor,
  caseId: string,
  versionId: string,
): Promise<PackVersionRow | undefined> {
  if (!isUuid(versionId)) return undefined; // never a uuid cast error
  const [row] = await exec
    .select()
    .from(packVersion)
    .where(
      and(eq(packVersion.id, versionId), eq(packVersion.caseId, caseId), isNotNull(packVersion.submittedAt)),
    )
    .limit(1);
  return row;
}

export interface FrozenSlotRows {
  rows: SlotColumnsIn[];
  artifacts: Map<string, ArtifactRef>;
  manifest: ManifestSlot[];
}

/** The nine slot rows of a version with the artifact rows they reference, for the view and the manifest. */
export async function readSlotsWithArtifacts(exec: Executor, versionId: string): Promise<FrozenSlotRows> {
  const joined = await exec
    .select({ slot: artifactSlot, artifact })
    .from(artifactSlot)
    .leftJoin(artifact, eq(artifactSlot.artifactId, artifact.id))
    .where(eq(artifactSlot.versionId, versionId))
    .orderBy(asc(artifactSlot.slot));
  const rows: SlotColumnsIn[] = [];
  const artifacts = new Map<string, ArtifactRef>();
  const manifest: ManifestSlot[] = [];
  for (const { slot, artifact: art } of joined) {
    rows.push({ slot: slot.slot, state: slot.state, reason: slot.reason, artifactId: slot.artifactId });
    if (art !== null) artifacts.set(art.id, toArtifactRef(art));
    manifest.push({
      slot: slot.slot,
      state: slot.state,
      reason: slot.reason,
      artifact:
        art === null
          ? null
          : {
              sha256: art.contentHash,
              filename: art.filename,
              mediaType: art.mediaType,
              sizeBytes: art.sizeBytes,
            },
    });
  }
  return { rows, artifacts, manifest };
}
