// The nine-slot draft rules that need no database (W0-02 7.5, W0-04 `artifact_slot`, A02): the mapping between a
// stored slot row and the contract's `SlotState`, the create-time default (slots 3 DPA and 4 SOW are
// `not_applicable` with the `default_non_vendor` reason only when the case's `vendor_involved` is false), the 7.5
// flip rule (a later `vendorInvolved: true` reverts a slot that still carries the default to `missing`; a
// user-typed reason is kept), and the step-4 validation of the slot values a save carries: a reason is mandatory
// for N/A (`validation.reason_required`), and `default_non_vendor` is accepted only where the server would set it.

import type { FieldError } from '@rai/shared/errors';
import {
  NON_VENDOR_DEFAULT_REASON_KEY,
  type NotApplicableReason,
  type SlotNumber,
  type SlotState,
} from '@rai/shared/schemas/pack';

export const SLOT_NUMBERS: readonly SlotNumber[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
/** Slots 3 (DPA) and 4 (SOW): the two vendor documents (W0-02 7.5, W0-04 create row). */
export const VENDOR_SLOTS: readonly SlotNumber[] = Object.freeze([3, 4]);

export const REASON_REQUIRED = 'validation.reason_required' as const;

/** The three W0-04 `artifact_slot` columns a `SlotState` maps onto. */
export interface SlotColumns {
  state: SlotState['state'];
  reason: string | null;
  artifactId: string | null;
}

const STATE_NAMES: ReadonlySet<string> = new Set<SlotState['state']>([
  'attached',
  'not_yet',
  'missing',
  'not_applicable',
]);

/** A stored row (state as text) → the typed columns; throws on a value the CHECK constraint would never admit. */
export function columnsOfRow(row: {
  state: string;
  reason: string | null;
  artifactId: string | null;
}): SlotColumns {
  if (!STATE_NAMES.has(row.state)) throw new Error(`artifact_slot state ${row.state} is not a slot state`);
  return { state: row.state as SlotState['state'], reason: row.reason, artifactId: row.artifactId };
}

export function isSlotNumber(value: unknown): value is SlotNumber {
  return typeof value === 'number' && (SLOT_NUMBERS as readonly number[]).includes(value);
}

export function isVendorSlot(slot: SlotNumber): boolean {
  return VENDOR_SLOTS.includes(slot);
}

/** The state a slot row is created with (W1-02 create, W2-03 successor): `missing`, or the non-vendor default. */
export function defaultSlotState(slot: SlotNumber, vendorInvolved: boolean): SlotState {
  if (!vendorInvolved && isVendorSlot(slot))
    return { state: 'not_applicable', reason: { kind: 'default_non_vendor' } };
  return { state: 'missing' };
}

/** `reason` column → the contract reason: the reserved locale key is the server default; anything else is text. */
export function reasonFromColumn(reason: string): NotApplicableReason {
  return reason === NON_VENDOR_DEFAULT_REASON_KEY
    ? { kind: 'default_non_vendor' }
    : { kind: 'text', text: reason };
}

export function reasonToColumn(reason: NotApplicableReason): string {
  return reason.kind === 'default_non_vendor' ? NON_VENDOR_DEFAULT_REASON_KEY : reason.text;
}

/** A stored row → the 7.5 `SlotState`. Throws on a row the W0-04 CHECK constraints would never admit. */
export function slotStateFromColumns(input: {
  state: string;
  reason: string | null;
  artifactId: string | null;
}): SlotState {
  const row = columnsOfRow(input);
  switch (row.state) {
    case 'attached':
      if (row.artifactId === null) throw new Error('attached slot without artifact_id');
      return { state: 'attached', artifactId: row.artifactId };
    case 'not_yet':
      return { state: 'not_yet' };
    case 'missing':
      return { state: 'missing' };
    case 'not_applicable':
      if (row.reason === null) throw new Error('not_applicable slot without reason');
      return { state: 'not_applicable', reason: reasonFromColumn(row.reason) };
  }
}

/** The 7.5 `SlotState` → the three columns. */
export function slotStateToColumns(state: SlotState): SlotColumns {
  switch (state.state) {
    case 'attached':
      return { state: 'attached', reason: null, artifactId: state.artifactId };
    case 'not_yet':
      return { state: 'not_yet', reason: null, artifactId: null };
    case 'missing':
      return { state: 'missing', reason: null, artifactId: null };
    case 'not_applicable':
      return { state: 'not_applicable', reason: reasonToColumn(state.reason), artifactId: null };
  }
}

/** The 7.5 flip rule: a slot that still carries the server default reverts to `missing` once a vendor is involved. */
export function carriesVendorDefault(
  row: { state: string; reason: string | null },
  slot: SlotNumber,
): boolean {
  return isVendorSlot(slot) && row.state === 'not_applicable' && row.reason === NON_VENDOR_DEFAULT_REASON_KEY;
}

export function slotPath(slot: string | number, field?: string): string {
  return field === undefined ? `body.slots[${slot}]` : `body.slots[${slot}].${field}`;
}

/**
 * The pre-validation scan of the raw body (before the TypeBox shape runs): a `not_applicable` slot whose reason is
 * absent, not an object, or a `text` reason that is blank after trimming surfaces as `validation.reason_required`
 * on the slot's reason, not as the shape's generic union failure (W0-02 7.5 error row; W0-06 4.2 "rejected before
 * any write"). Everything else is left to the schema.
 */
export function reasonRequiredErrors(body: unknown): FieldError[] {
  const slots = (body as { slots?: unknown } | null)?.slots;
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) return [];
  const out: FieldError[] = [];
  for (const [slot, raw] of Object.entries(slots as Record<string, unknown>)) {
    const state = raw as { state?: unknown; reason?: unknown } | null;
    if (typeof state !== 'object' || state === null || state.state !== 'not_applicable') continue;
    const reason = state.reason as { kind?: unknown; text?: unknown } | null | undefined;
    if (typeof reason !== 'object' || reason === null) {
      out.push({ path: slotPath(slot, 'reason'), messageKey: REASON_REQUIRED });
      continue;
    }
    if (reason.kind === 'text' && (typeof reason.text !== 'string' || reason.text.trim() === ''))
      out.push({ path: slotPath(slot, 'reason'), messageKey: REASON_REQUIRED });
  }
  return out;
}

/**
 * Step-4 value rules on a shape-valid `slots` patch: a text reason must be non-blank; `default_non_vendor` may be
 * sent back only for slot 3 or 4 of a case whose `vendorInvolved` is false (exactly where the server sets it; on
 * any other slot, or once a vendor is involved, the default never applies and a typed reason is required).
 */
export function validateSlotValues(
  slots: Partial<Record<SlotNumber, SlotState>>,
  vendorInvolved: boolean,
): FieldError[] {
  const out: FieldError[] = [];
  for (const [key, state] of Object.entries(slots) as Array<[string, SlotState | undefined]>) {
    if (state === undefined || state.state !== 'not_applicable') continue;
    const slot = Number(key);
    if (state.reason.kind === 'text') {
      if (state.reason.text.trim() === '')
        out.push({ path: slotPath(key, 'reason'), messageKey: REASON_REQUIRED });
    } else if (!isSlotNumber(slot) || vendorInvolved || !isVendorSlot(slot)) {
      out.push({ path: slotPath(key, 'reason'), messageKey: REASON_REQUIRED });
    }
  }
  return out;
}
