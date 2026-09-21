// Pure view-model functions for the case flow (W1-06). No DOM, no fetch: unit-tested under `npm run test:unit`
// (W0-02 section 8.1: web unit tests cover view models and formatting only). Every label is a locale key
// rendered by the screen through t() (D12); dates render in Asia/Bangkok with the Gregorian calendar (D06,
// section 10.5). Nothing here decides access (W0-05: the SPA only shows what the API returned).

import { APP_TIMEZONE, LANE_MAPPING_V1, lanesForSlot, type Lane } from '@rai/shared/constants';
import type { Locale, LocaleKey } from '@rai/shared/locales/keys';
import type { CaseStatus, CaseView } from '@rai/shared/schemas/cases';
import type { NotApplicableReason, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import type { FrozenSlot } from '@rai/shared/schemas/versions';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';
import type { ApiError } from '../../api/client.js';

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
export function slotLanes(slot: SlotNumber, mapping = LANE_MAPPING_V1): Lane[] {
  return lanesForSlot(slot, mapping);
}

export function statusKey(status: CaseStatus): LocaleKey {
  return `status.${status}` as LocaleKey;
}

export function nextActionKey(status: CaseStatus): LocaleKey {
  return `case.next_action.${status}` as LocaleKey;
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

/** Section 10.5: Asia/Bangkok, Gregorian calendar even in Thai (`th-TH-u-ca-gregory`); never Buddhist era by accident. */
export function formatDateTime(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** File sizes through Intl unit formatting so the unit is localised, never a hard-coded string. */
export function formatBytes(locale: Locale, bytes: number): string {
  const tag = locale === 'th' ? 'th-TH' : 'en-GB';
  if (bytes < 1024) return new Intl.NumberFormat(tag, { style: 'unit', unit: 'byte' }).format(bytes);
  if (bytes < 1024 * 1024)
    return new Intl.NumberFormat(tag, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(
      bytes / 1024,
    );
  return new Intl.NumberFormat(tag, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(
    bytes / (1024 * 1024),
  );
}

export function casePath(caseId: string): string {
  return `/cases/${encodeURIComponent(caseId)}`;
}

export function versionPath(caseId: string, versionId: string): string {
  return `${casePath(caseId)}/versions/${encodeURIComponent(versionId)}`;
}

export function signInPath(returnTo: string): string {
  return `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Keys as the API sent them (strings): rendered through the catalogue when known, shown verbatim otherwise. */
export interface ErrorPresentation {
  messageKey: string;
  guidanceKey: string | null;
  correlationId: string | null;
  refreshPath: string | null;
  fields: { path: string; messageKey: string; params?: Record<string, string | number> }[];
}

/** Turns the W0-06 8.2 envelope into what the screen renders: keys only, never text (section 10.3). */
export function presentError(
  error: Pick<ApiError, 'messageKey' | 'correlationId' | 'fields' | 'stale'>,
): ErrorPresentation {
  const stale = error.stale;
  return {
    messageKey: error.messageKey,
    guidanceKey: stale === undefined ? null : stale.guidanceKey,
    correlationId: error.correlationId,
    refreshPath: stale === undefined ? null : stale.refreshPath,
    fields: error.fields.map((f) =>
      f.params === undefined ? { path: f.path, messageKey: f.messageKey } : f,
    ),
  };
}

/** The `slots[n]` a field path of an invalid_input answer points at, so the row can show the message. */
export function slotOfFieldPath(path: string): SlotNumber | null {
  const match = /slots\[(\d)\]/.exec(path);
  if (match === null) return null;
  const n = Number(match[1]);
  return (SLOT_NUMBERS as readonly number[]).includes(n) ? (n as SlotNumber) : null;
}
