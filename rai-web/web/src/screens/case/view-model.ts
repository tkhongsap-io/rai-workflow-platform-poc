// Pure view-model functions for the case flow (W1-06). No DOM, no fetch: unit-tested under `npm run test:unit`
// (W0-02 section 8.1: web unit tests cover view models and formatting only). Every label is a locale key
// rendered by the screen through t() (D12). Dates and sizes render through web/src/i18n/format.ts; paths come
// from web/src/routes.ts; the envelope is described by components/error-notice.ts. Nothing here decides access
// (W0-05: the SPA only shows what the API returned).

import { LANE_MAPPING_V1, lanesForSlot, type Lane, type LaneMapping } from '@rai/shared/constants';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { CaseView, LaneProjectionStatus } from '@rai/shared/schemas/cases';
import type { NotApplicableReason, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import type { StoredFindingSummary } from '@rai/shared/schemas/review';
import type { ExpectedVersion, FrozenSlot, SubmittedVersion } from '@rai/shared/schemas/versions';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';

export const SLOT_NUMBERS: readonly SlotNumber[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

export type SlotStateName = SlotState['state'];
export const SLOT_STATE_ORDER: readonly SlotStateName[] = Object.freeze([
  'attached',
  'not_yet',
  'missing',
  'not_applicable',
]);

export const REASON_MAX_LENGTH = 500;

export function slotNameKey(slot: SlotNumber): LocaleKey {
  return `slot.s${slot}.name` as LocaleKey;
}

export function slotStateKey(state: SlotStateName): LocaleKey {
  return `slot.state.${state}` as LocaleKey;
}

export function slotHelpKey(state: SlotStateName): LocaleKey {
  return `slot.help.${state}` as LocaleKey;
}

export function laneKey(lane: Lane): LocaleKey {
  return `lane.${lane}` as LocaleKey;
}

/** The lanes that gate a slot under the D02 mapping frozen on the version (or the current one for the draft). */
export function slotLanes(slot: SlotNumber, mapping: LaneMapping = LANE_MAPPING_V1): Lane[] {
  return lanesForSlot(slot, mapping);
}

export function stageKey(stage: string): LocaleKey {
  return `stage.${stage}` as LocaleKey;
}

export function modelTypeKey(modelType: string): LocaleKey {
  return `model_type.${modelType}` as LocaleKey;
}

/** The submission line of the overview: the latest submitted version, or "not yet submitted". */
export function submissionLine(view: Pick<CaseView, 'currentVersion'>): {
  key: LocaleKey;
  params?: Record<string, string | number>;
} {
  return view.currentVersion === null
    ? { key: 'case.submission.none' }
    : { key: 'case.submission.version', params: { number: view.currentVersion.versionNumber } };
}

/** The reason of a not-applicable slot as a locale key (the server default) or the user's text. */
export function reasonDisplay(
  reason: NotApplicableReason,
): { kind: 'key'; key: LocaleKey } | { kind: 'text'; text: string } {
  return reason.kind === 'default_non_vendor'
    ? { kind: 'key', key: NON_VENDOR_DEFAULT_REASON_KEY }
    : { kind: 'text', text: reason.text };
}

/** Section 7.5: a typed reason is required whenever the user chooses N/A; 1..500 characters after trimming. */
export function reasonIsValid(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 1 && trimmed.length <= REASON_MAX_LENGTH;
}

export type PendingSlots = Partial<Record<SlotNumber, SlotState>>;

/** Records a slot change; a change back to the saved state drops the pending entry. */
export function applySlotChange(
  saved: Record<SlotNumber, SlotState>,
  pending: PendingSlots,
  slot: SlotNumber,
  next: SlotState,
): PendingSlots {
  const out: PendingSlots = { ...pending };
  if (sameSlotState(saved[slot], next)) delete out[slot];
  else out[slot] = next;
  return out;
}

export function sameSlotState(a: SlotState, b: SlotState): boolean {
  if (a.state !== b.state) return false;
  if (a.state === 'attached' && b.state === 'attached') return a.artifactId === b.artifactId;
  if (a.state === 'not_applicable' && b.state === 'not_applicable') {
    if (a.reason.kind !== b.reason.kind) return false;
    return a.reason.kind === 'text' && b.reason.kind === 'text' ? a.reason.text === b.reason.text : true;
  }
  return true;
}

/** The slots as they would be after saving the pending changes. */
export function mergedSlots(
  saved: Record<SlotNumber, SlotState>,
  pending: PendingSlots,
): Record<SlotNumber, SlotState> {
  const out = { ...saved };
  for (const slot of SLOT_NUMBERS) {
    const next = pending[slot];
    if (next !== undefined) out[slot] = next;
  }
  return out;
}

export function pendingCount(pending: PendingSlots): number {
  return SLOT_NUMBERS.filter((slot) => pending[slot] !== undefined).length;
}

export interface SlotCounts {
  attached: number;
  not_yet: number;
  missing: number;
  not_applicable: number;
}

export function slotCounts(slots: Record<SlotNumber, SlotState | FrozenSlot>): SlotCounts {
  const counts: SlotCounts = { attached: 0, not_yet: 0, missing: 0, not_applicable: 0 };
  for (const slot of SLOT_NUMBERS) counts[slots[slot].state] += 1;
  return counts;
}

/** The `slots[n]` a field path of an invalid_input answer points at, so the row can show the message. */
export function slotOfFieldPath(path: string): SlotNumber | null {
  const match = /slots\[(\d)\]/.exec(path);
  if (match === null) return null;
  const n = Number(match[1]);
  return (SLOT_NUMBERS as readonly number[]).includes(n) ? (n as SlotNumber) : null;
}

/** The reviewer's own lane from the session grants, or null when the principal has no lane role. */
export function reviewerLaneOf(roles: readonly RoleScope[]): Lane | null {
  for (const grant of roles) {
    if (
      (grant.role === 'ai_coe' || grant.role === 'dpo' || grant.role === 'it_security') &&
      grant.scope.kind === 'all_cases' &&
      'lane' in grant.scope
    ) {
      return grant.scope.lane;
    }
  }
  return null;
}

/** D05: owner of the case, or BU SPOC of the case's business unit, must not decide that lane. */
export function isSelfExcludedOnCase(
  roles: readonly RoleScope[],
  subjectId: string,
  view: Pick<CaseView, 'businessOwner' | 'businessUnitId'>,
): boolean {
  if (view.businessOwner === subjectId) return true;
  return roles.some(
    (grant) =>
      grant.role === 'bu_spoc' &&
      grant.scope.kind === 'business_unit' &&
      grant.scope.businessUnit === view.businessUnitId,
  );
}

export function laneProjectionStatus(view: CaseView, lane: Lane): LaneProjectionStatus {
  switch (lane) {
    case 'ai_coe':
      return view.raiStatus;
    case 'dpo':
      return view.privacyStatus;
    case 'it_security':
      return view.securityStatus;
  }
}

/**
 * The lane the signed-in reviewer may decide on this version, or null when the UI must not draw controls
 * (wrong role, Admin, owner/SPOC self-exclusion, stale/superseded version, or lane already decided).
 * Mirrors the server deny cases so the SPA does not offer a button the API would 403 (W0-05 UI convenience).
 */
export function decidableLane(args: {
  roles: readonly RoleScope[];
  subjectId: string;
  view: CaseView;
  version: SubmittedVersion;
  hasOpenDraft: boolean;
}): Lane | null {
  const lane = reviewerLaneOf(args.roles);
  if (lane === null) return null;
  if (isSelfExcludedOnCase(args.roles, args.subjectId, args.view)) return null;
  if (!args.version.isLatest || args.hasOpenDraft) return null;
  if (laneProjectionStatus(args.view, lane) !== 'pending') return null;
  return lane;
}

/** Submitted versions carry a frozen revision of 1 for ExpectedVersion (W0-06 5.1 / 5.2). */
export function expectedVersionOf(version: Pick<SubmittedVersion, 'versionId'>): ExpectedVersion {
  return { versionId: version.versionId, revision: 1 };
}

export function severityKey(severity: StoredFindingSummary['severity']): LocaleKey {
  return `finding.severity.${severity}` as LocaleKey;
}

/** Params the SPA can fill from the finding summary (W2 shapes omit message params; slot is enough for many keys). */
export function findingMessageParams(finding: StoredFindingSummary): Record<string, string | number> {
  return finding.slot === null ? {} : { slot: finding.slot };
}

/** One draft feedback row before the API cast (SlotNumberSchema Static is `never` under the map() construction). */
export interface SendBackFeedbackDraftItem {
  slot: SlotNumber;
  deficiency: string;
  artifactId?: string;
}

/** A09 / W2-07: at least one item must name a slot; deficiency text is required per item. */
export function sendBackFeedbackIsValid(items: readonly SendBackFeedbackDraftItem[]): boolean {
  return items.some((item) => SLOT_NUMBERS.includes(item.slot) && item.deficiency.trim().length >= 1);
}

export function qcUnavailableReasonKey(
  reason: 'timeout' | 'runner_error' | 'not_configured' | 'artifact_unreadable' | undefined,
): LocaleKey {
  switch (reason) {
    case 'timeout':
      return 'review.qc.reason.timeout';
    case 'runner_error':
      return 'review.qc.reason.runner_error';
    case 'artifact_unreadable':
      return 'review.qc.reason.artifact_unreadable';
    case 'not_configured':
    case undefined:
      return 'review.qc.reason.not_configured';
  }
}
