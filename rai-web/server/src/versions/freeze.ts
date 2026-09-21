// The pure rules of the submit freeze (W0-06 4.3, W0-04 `pack_version` frozen columns): the slot precondition
// (nine slots each carrying a disposition and every `not_applicable` carrying a reason; missing or not-yet
// documents never block, L7), the configuration revisions frozen with the version (`{kind: revision_id}` for every
// kind in force at the submit instant, W0-04 `frozen_configuration`; the one FK column, W0-04 `configuration_
// revision_id`), and the W0-02 7.6 `SubmittedVersion` view assembled from stored rows. No database here.

import { CURRENT_LANE_MAPPING, type LaneMapping } from '@rai/shared/constants';
import type { FieldError } from '@rai/shared/errors';
import type { ConfigurationRevisionId } from '@rai/shared/ids';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import { CONFIGURATION_KINDS, type ConfigurationKind } from '@rai/shared/schemas/cases';
import type { SlotNumber, StageContext } from '@rai/shared/schemas/pack';
import type { FrozenSlot, SubmittedVersion, VersionSummary } from '@rai/shared/schemas/versions';
import { SLOT_NUMBERS, reasonFromColumn } from '../pack/slots.js';

export const REASON_REQUIRED = 'validation.reason_required' as const;

/** The three columns of a slot row the precondition and the view read. */
export interface SlotColumnsIn {
  slot: number;
  state: string;
  reason: string | null;
  artifactId: string | null;
}

/** W0-06 8.3: field paths use the request's JSON path; the submit body carries no slots, so the path is `slots[n]`. */
export function submitSlotPath(slot: number, field: string): string {
  return `slots[${slot}].${field}`;
}

/**
 * W0-06 4.3 precondition over the stored draft rows: every slot present (the create transaction guarantees nine),
 * every `not_applicable` with a non-blank reason (the W0-04 CHECK admits no NULL reason; a blank string is the
 * application's rule, as W1-04 applies on save). Everything else is a fact, not an error (A02, L7).
 */
export function submitSlotErrors(rows: readonly SlotColumnsIn[]): FieldError[] {
  const out: FieldError[] = [];
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  for (const slot of SLOT_NUMBERS) {
    const row = bySlot.get(slot);
    if (row === undefined) {
      out.push({ path: submitSlotPath(slot, 'state'), messageKey: 'validation.required' });
      continue;
    }
    if (row.state === 'not_applicable' && (row.reason === null || row.reason.trim() === ''))
      out.push({ path: submitSlotPath(slot, 'reason'), messageKey: REASON_REQUIRED });
  }
  return out;
}

/** A configuration revision as the freeze needs it: its kind, id and publish instant (already filtered to "in force"). */
export interface RevisionInForce {
  kind: ConfigurationKind;
  id: string;
  publishedAt: Date;
}

export interface FrozenConfiguration {
  /** W0-04 `frozen_configuration`: `{kind: revision_id}` for every kind that has a revision in force. */
  byKind: Partial<Record<ConfigurationKind, string>>;
  /**
   * W0-04 `configuration_revision_id`: the `qc_rules` revision when one is in force (W0-04: "the one most often
   * queried"); until W1-10 publishes one, the W0-02 7.3 `ConfigurationView.revisionId` rule (the latest published
   * among the kinds the view exposes: use_case_groups, checklist_templates, sla), so the frozen id equals what
   * `GET /api/configuration/current` showed the submitter. Recorded in changes/2026-09-22-w1-05/review.md.
   */
  configurationRevisionId: ConfigurationRevisionId;
}

export class NoConfigurationInForce extends Error {
  constructor() {
    super('no published configuration revision applies at the submit instant');
    this.name = 'NoConfigurationInForce';
  }
}

const VIEW_KINDS: readonly ConfigurationKind[] = ['use_case_groups', 'checklist_templates', 'sla'];

export function resolveFrozenConfiguration(revisions: readonly RevisionInForce[]): FrozenConfiguration {
  const byKind: Partial<Record<ConfigurationKind, string>> = {};
  for (const kind of CONFIGURATION_KINDS) {
    const row = revisions.find((r) => r.kind === kind);
    if (row !== undefined) byKind[kind] = row.id;
  }
  const qc = byKind.qc_rules;
  if (qc !== undefined) return { byKind, configurationRevisionId: qc };
  // The same rows in the same order and with the same tie-break as `effectiveConfiguration` (configuration/store.ts).
  const viewRows = VIEW_KINDS.map((kind) => revisions.find((r) => r.kind === kind)).filter(
    (r): r is RevisionInForce => r !== undefined,
  );
  if (viewRows.length === 0) throw new NoConfigurationInForce();
  const latest = viewRows.reduce((a, b) => (a.publishedAt.getTime() >= b.publishedAt.getTime() ? a : b));
  return { byKind, configurationRevisionId: latest.id };
}

/** W0-04 `lane_mapping`: the constant's content, so a restored backup is self-describing. */
export function laneMappingContent(mapping: LaneMapping = CURRENT_LANE_MAPPING): Record<string, unknown> {
  return {
    version: mapping.version,
    decision: mapping.decision,
    slotsByLane: {
      ai_coe: [...mapping.slotsByLane.ai_coe],
      dpo: [...mapping.slotsByLane.dpo],
      it_security: [...mapping.slotsByLane.it_security],
    },
    noLaneGate: [...mapping.noLaneGate],
  };
}

/** The frozen-slot map of the 7.6 body from slot rows and the artifact references they point at. */
export function frozenSlotsOf(
  rows: readonly SlotColumnsIn[],
  artifacts: ReadonlyMap<string, ArtifactRef>,
): Record<SlotNumber, FrozenSlot> {
  const out: Partial<Record<SlotNumber, FrozenSlot>> = {};
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  for (const slot of SLOT_NUMBERS) {
    const row = bySlot.get(slot);
    if (row === undefined) throw new Error(`no slot ${slot} row`);
    switch (row.state) {
      case 'attached': {
        const ref = row.artifactId === null ? undefined : artifacts.get(row.artifactId);
        if (ref === undefined) throw new Error(`slot ${slot} is attached without an artifact reference`);
        out[slot] = { state: 'attached', artifact: { ...ref } }; // embedded, immutable copy of the reference
        break;
      }
      case 'not_yet':
        out[slot] = { state: 'not_yet' };
        break;
      case 'missing':
        out[slot] = { state: 'missing' };
        break;
      case 'not_applicable':
        if (row.reason === null) throw new Error(`slot ${slot} is not_applicable without a reason`);
        out[slot] = { state: 'not_applicable', reason: reasonFromColumn(row.reason) };
        break;
      default:
        throw new Error(`artifact_slot state ${row.state} is not a slot state`);
    }
  }
  return out as Record<SlotNumber, FrozenSlot>;
}

/** The columns of a submitted `pack_version` row the view reads. */
export interface SubmittedVersionColumns {
  id: string;
  caseId: string;
  versionNumber: number;
  parentVersionId: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  checklistTemplateVersion: string;
  stageContext: string;
  configurationRevisionId: string | null;
  laneMappingVersion: string | null;
}

export class VersionNotSubmitted extends Error {
  constructor(readonly versionId: string) {
    super(`pack_version ${versionId} is not submitted`);
    this.name = 'VersionNotSubmitted';
  }
}

/** The W0-02 7.6 `SubmittedVersion` from a submitted row, its frozen slots and whether it is the case's latest. */
export function submittedVersionView(
  row: SubmittedVersionColumns,
  slots: Record<SlotNumber, FrozenSlot>,
  isLatest: boolean,
): SubmittedVersion {
  if (
    row.submittedAt === null ||
    row.submittedBy === null ||
    row.configurationRevisionId === null ||
    row.laneMappingVersion === null
  )
    throw new VersionNotSubmitted(row.id);
  return {
    versionId: row.id,
    caseId: row.caseId,
    versionNumber: row.versionNumber,
    parentVersionId: row.parentVersionId,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(),
    checklistTemplateVersion: row.checklistTemplateVersion,
    stageContext: row.stageContext as StageContext,
    configurationRevisionId: row.configurationRevisionId,
    laneMappingVersion: row.laneMappingVersion,
    slots,
    isLatest,
  };
}

/** The 7.6 `VersionSummary` (list row and `CaseView.currentVersion`). */
export function versionSummaryOf(row: SubmittedVersionColumns, isLatest: boolean): VersionSummary {
  if (row.submittedAt === null || row.submittedBy === null) throw new VersionNotSubmitted(row.id);
  return {
    versionId: row.id,
    versionNumber: row.versionNumber,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt.toISOString(),
    isLatest,
  };
}
