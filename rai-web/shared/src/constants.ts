// W0-02 section 1: APP_TIMEZONE (D06), the lane-mapping constant (D02, W0-06 section 3) and the slot list.
// The lane mapping is a versioned constant in code, recorded on every submitted version; it is never Admin
// configuration and the configuration-revision store never holds it. Changing it needs a new register row (D02).

export const APP_TIMEZONE = 'Asia/Bangkok' as const; // D06; a constant, not configuration

export type Lane = 'ai_coe' | 'dpo' | 'it_security';
export type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const LANES: readonly Lane[] = Object.freeze(['ai_coe', 'dpo', 'it_security']);
export const SLOTS: readonly Slot[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

export interface LaneMapping {
  readonly version: string; // recorded on every submitted version (pack_version.lane_mapping_version)
  readonly decision: 'D02'; // register row that fixes it
  readonly slotsByLane: Readonly<Record<Lane, readonly Slot[]>>;
  readonly noLaneGate: readonly Slot[];
}

export const LANE_MAPPING_V1: LaneMapping = Object.freeze({
  version: 'lane-mapping/v1',
  decision: 'D02',
  slotsByLane: Object.freeze({
    ai_coe: Object.freeze([1, 5] as const),
    dpo: Object.freeze([2, 3, 4, 5] as const),
    it_security: Object.freeze([5, 6, 7, 8] as const),
  }),
  noLaneGate: Object.freeze([9] as const),
});

export const CURRENT_LANE_MAPPING: LaneMapping = LANE_MAPPING_V1;

/** Every frozen mapping by its version string, so a stored version resolves its own mapping, never CURRENT. */
export const LANE_MAPPINGS_BY_VERSION: Readonly<Record<string, LaneMapping>> = Object.freeze({
  [LANE_MAPPING_V1.version]: LANE_MAPPING_V1,
});

/** Pure functions of the mapping argument (W0-06 section 3): lanesForSlot(5) = all three; lanesForSlot(9) = []. */
export function lanesForSlot(slot: Slot, mapping: LaneMapping = CURRENT_LANE_MAPPING): Lane[] {
  return LANES.filter((lane) => mapping.slotsByLane[lane].includes(slot));
}

export function slotsForLane(lane: Lane, mapping: LaneMapping = CURRENT_LANE_MAPPING): Slot[] {
  return [...mapping.slotsByLane[lane]];
}

/** W0-06 7.3 part 3, recorded 2026-09-25: pack-level findings are AI/COE's. */
export const PACK_OWNING_LANE: Lane = 'ai_coe';

/** W0-06 section 7: who owns a `defect` finding of the given scope under the mapping recorded on its version. */
export type OwningLaneRule =
  | { kind: 'lane'; lane: Lane } // a single-lane slot (7.1), or the pack (7.3 part 3)
  | { kind: 'raising_lane'; lanes: readonly Lane[] } // slot 5: the lane whose rule raised it (7.3 part 1)
  | { kind: 'no_defects' }; // slot 9: informational only, QC raises no defect (7.3 part 2)

export function owningLaneRule(
  scope: { kind: 'pack' } | { kind: 'slot' | 'artifact'; slot: Slot },
  mapping: LaneMapping,
): OwningLaneRule {
  if (scope.kind === 'pack') return { kind: 'lane', lane: PACK_OWNING_LANE };
  const lanes = lanesForSlot(scope.slot, mapping);
  if (lanes.length === 1) return { kind: 'lane', lane: lanes[0]! };
  if (lanes.length === 0) return { kind: 'no_defects' };
  return { kind: 'raising_lane', lanes };
}

/**
 * Register row "D05 refinement (upload slot 5 and 9)" (Ta, 2026-09-26): an upload QC outage on slot 5, which three
 * lanes review, is owned by AI/COE, as on submit and for the pack.
 */
export const UPLOAD_SLOT5_OUTAGE_LANE: Lane = 'ai_coe';

/** A run for which {@link unavailableOwningLane} always names a lane. */
export type LaneRun = { trigger: 'approve_attempt'; lane: Lane } | { trigger: 'submit'; lane: null };
/** An upload-trigger run on one slot (W0-07 3.2); `lane` is never set on it. */
export type UploadRun = { trigger: 'upload'; slot: Slot };

/**
 * W0-06 7.3 part 4: a QC-unavailable finding follows the run that saw the outage. Only an upload run needs the
 * mapping (the slot's lane), so an unknown mapping never turns a submit or approve-attempt outage into an error.
 * Upload (W4-04, register row "D05 refinement (upload slot 5 and 9)"): slots 1-4 and 6-8 → the slot's single lane;
 * slot 5 → AI/COE; slot 9 → `null`: no upload rules run there, so the trigger fires no run and no finding exists.
 */
export function unavailableOwningLane(run: LaneRun, mapping?: LaneMapping): Lane;
export function unavailableOwningLane(run: UploadRun, mapping?: LaneMapping): Lane | null;
export function unavailableOwningLane(run: LaneRun | UploadRun, mapping?: LaneMapping): Lane | null {
  if (run.trigger === 'approve_attempt') return run.lane;
  if (run.trigger === 'submit') return PACK_OWNING_LANE;
  if (mapping === undefined) throw new Error("an unavailable upload run needs the version's lane mapping");
  const rule = owningLaneRule({ kind: 'slot', slot: run.slot }, mapping);
  if (rule.kind === 'lane') return rule.lane;
  if (rule.kind === 'raising_lane') return UPLOAD_SLOT5_OUTAGE_LANE;
  return null; // no_defects: slot 9
}
