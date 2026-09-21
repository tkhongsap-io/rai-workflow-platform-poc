// Slot vocabulary shared by the pack draft (7.5) and the frozen version (7.6). Lives in its own module only so that
// pack.ts (which imports ExpectedVersion from versions.ts) and versions.ts (which embeds slot reasons) do not form
// an ESM import cycle; pack.ts re-exports everything here, so consumers keep importing from '@rai/shared/schemas/pack'.

import { Type, type Static, type TSchema } from 'typebox';

export const SlotNumberSchema = Type.Union([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => Type.Literal(n)));
export type SlotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const STAGE_CONTEXTS = ['idea', 'pre_build', 'pre_launch'] as const; // D11; stored, never a lifecycle state
export type StageContext = (typeof STAGE_CONTEXTS)[number];
export const StageContextSchema = Type.Union(STAGE_CONTEXTS.map((v) => Type.Literal(v)));

export const NotApplicableReasonSchema = Type.Union([
  Type.Object({ kind: Type.Literal('default_non_vendor') }), // server-set for slots 3 and 4 when vendorInvolved is false
  Type.Object({ kind: Type.Literal('text'), text: Type.String({ minLength: 1, maxLength: 500 }) }), // required whenever the user chooses N/A
]);
export type NotApplicableReason = Static<typeof NotApplicableReasonSchema>;

/** The W0-04 artifact_slot.reason value for the non-vendor default: a locale key, so it stays visible and translatable. */
export const NON_VENDOR_DEFAULT_REASON_KEY = 'slot.na.reason.non_vendor_default' as const;

export const SlotStateSchema = Type.Union([
  Type.Object({ state: Type.Literal('attached'), artifactId: Type.String({ minLength: 1 }) }),
  Type.Object({ state: Type.Literal('not_yet') }),
  Type.Object({ state: Type.Literal('missing') }),
  Type.Object({ state: Type.Literal('not_applicable'), reason: NotApplicableReasonSchema }),
]);
export type SlotState = Static<typeof SlotStateSchema>;
export const SLOT_STATE_NAMES = ['attached', 'not_yet', 'not_applicable', 'missing'] as const; // W0-04 artifact_slot.state
export type SlotStateName = (typeof SLOT_STATE_NAMES)[number];

/** Builds the `Record<SlotNumber, T>` object schema used by the draft and the frozen version. */
export function slotRecord<T extends TSchema>(schema: T) {
  return Type.Object({
    1: schema,
    2: schema,
    3: schema,
    4: schema,
    5: schema,
    6: schema,
    7: schema,
    8: schema,
    9: schema,
  });
}
