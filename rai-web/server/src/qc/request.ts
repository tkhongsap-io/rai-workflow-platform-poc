// W4-08a (W4b plan section 11.2): the pure part of the QC orchestrator's request builder, moved unchanged out of
// `orchestrator.ts` so the evaluation harness (`tests/evaluation/`) builds each `QcRunRequest` exactly as the product
// does. The orchestrator reads the slot rows (`readSlotsWithArtifacts`) and calls {@link requestOf}; nothing here
// touches the database. W0-07 3.3 (request) and 3.7 (runKey).
import { createHash } from 'node:crypto';
import { CURRENT_LANE_MAPPING, type Lane, type Slot } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcRunRequest,
  QcTrigger,
  SelectedRule,
  SlotState,
} from '@rai/shared/qc/types';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import type { SlotColumnsIn } from '../versions/freeze.js';

/** The slot rows of a version and the artifact rows they reference (what `readSlotsWithArtifacts` returns). */
export interface RequestSlotRead {
  rows: readonly SlotColumnsIn[];
  artifacts: ReadonlyMap<string, RequestArtifactRow>;
}
export type RequestArtifactRow = Pick<ArtifactRef, 'sha256' | 'mediaType' | 'filename' | 'sizeBytes'> & {
  artifactId: string;
};
export type RequestCaseRow = Pick<CaseRow, 'modelType' | 'vendorInvolved'>;
export type RequestVersionRow = Pick<
  PackVersionRow,
  | 'id'
  | 'caseId'
  | 'versionNumber'
  | 'submittedAt'
  | 'laneMappingVersion'
  | 'checklistTemplateVersion'
  | 'stageContext'
>;

export function runKeyOf(
  versionId: string,
  trigger: QcTrigger,
  lane: Lane | null,
  qcRulesRevision: string,
  artifacts: ReadonlyArray<{ slot: number; contentHash: string }>,
): string {
  const parts = artifacts
    .map((a) => `${a.slot}:${a.contentHash}`)
    .sort()
    .join('|');
  return createHash('sha256')
    .update(`${versionId}|${trigger}|${lane ?? '-'}|${qcRulesRevision}|${parts}`)
    .digest('hex');
}

export function requestOf(
  read: RequestSlotRead,
  caseRow: RequestCaseRow,
  version: RequestVersionRow,
  trigger: QcTrigger,
  lane: Lane | null,
  correlationId: string,
  deadlineMs: number,
  ruleRevision: string,
  rules: SelectedRule[] | null,
  uploadSlot: Slot | null = null,
): QcRunRequest {
  const artifactMap = read.artifacts;
  // W0-07 3.3: an upload request carries the one uploaded slot and its artifact; runKey follows (3.7).
  const rows = uploadSlot === null ? read.rows : read.rows.filter((s) => s.slot === uploadSlot);
  const slots: SlotState[] = rows.map((s) => ({
    slot: s.slot as SlotState['slot'],
    disposition: s.state as SlotState['disposition'],
    reason: s.reason,
    artifactId: s.artifactId,
  }));
  const artifacts: AuthorizedArtifactRef[] = [];
  for (const s of rows) {
    if (s.state !== 'attached' || s.artifactId === null) continue;
    const art = artifactMap.get(s.artifactId);
    if (art === undefined) continue;
    artifacts.push({
      artifactId: art.artifactId,
      slot: s.slot as AuthorizedArtifactRef['slot'],
      contentHash: art.sha256,
      mediaType: art.mediaType,
      filename: art.filename,
      byteLength: art.sizeBytes,
      read: () => Promise.resolve(new ReadableStream()),
    });
  }
  // A draft has no mapping frozen yet; its upload run uses the current constant (W4a plan section 5).
  const laneMappingVersion =
    version.laneMappingVersion ?? (version.submittedAt === null ? CURRENT_LANE_MAPPING.version : null);
  if (laneMappingVersion === null) throw new Error('submitted version has no lane_mapping_version');
  return {
    correlationId,
    runKey: runKeyOf(
      version.id,
      trigger,
      lane,
      ruleRevision,
      artifacts.map((a) => ({ slot: a.slot, contentHash: a.contentHash })),
    ),
    trigger,
    lane,
    version: {
      caseId: version.caseId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      isDraft: version.submittedAt === null,
    },
    checklistTemplateVersion: version.checklistTemplateVersion,
    qcRulesRevision: ruleRevision,
    laneMappingVersion,
    stageContext: version.stageContext as QcRunRequest['stageContext'],
    modelType: caseRow.modelType as QcRunRequest['modelType'],
    vendorInvolved: caseRow.vendorInvolved,
    slots,
    artifacts,
    deadlineMs,
    rules,
  };
}
