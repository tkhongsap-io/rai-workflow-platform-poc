// PACK-SLOT-MISSING (W4a plan section 4; provisional until D09). A lane-gated slot is `missing`.
//   - submit: every `missing` slot with exactly one lane under the version's mapping (1-4, 6-8 under
//     lane-mapping/v1), owned by that lane (W0-06 7.1). Slot 5 is not raised on submit, so no lane is invented;
//     slot 9 has no lane and carries no defect (7.3 part 2).
//   - approve_attempt: every `missing` slot reviewed by several lanes that include the run's lane (slot 5), owned
//     by the run's lane (D05 refinement (#35), 7.3 part 1). Each lane's attempt raises its own finding.
import { owningLaneRule } from '@rai/shared/constants';
import type { QcFinding } from '@rai/shared/qc/types';
import { finding, slotEvidence, type MetadataRule, type RuleInput } from './rule.js';

function evaluate(input: RuleInput): QcFinding[] {
  const { request, mapping } = input;
  const findings: QcFinding[] = [];
  for (const state of request.slots) {
    if (state.disposition !== 'missing') continue;
    const owner = owningLaneRule({ kind: 'slot', slot: state.slot }, mapping);
    let lane;
    if (request.trigger === 'submit' && owner.kind === 'lane') lane = owner.lane;
    else if (
      request.trigger === 'approve_attempt' &&
      owner.kind === 'raising_lane' &&
      request.lane !== null &&
      owner.lanes.includes(request.lane)
    )
      lane = request.lane;
    if (lane === undefined) continue;
    findings.push(
      finding(input, {
        scope: { kind: 'slot', slot: state.slot },
        owningLane: lane,
        evidence: [slotEvidence(request, state.slot)],
        message: { key: 'qc.finding.pack_slot_missing', params: { slot: state.slot } },
      }),
    );
  }
  return findings;
}

export const PACK_SLOT_MISSING: MetadataRule = Object.freeze({
  triggers: Object.freeze(['submit', 'approve_attempt'] as const),
  evaluate,
});
