// PACK-NA-VENDOR-DOC (W4a plan section 4, new in W4a; provisional until D09). On a vendor case a vendor document
// (slot 3 DPA, slot 4 SOW; `pack/slots.ts` VENDOR_SLOTS) is `not_applicable`, with any reason. The non-vendor
// default cannot survive the vendor flip (W0-02 7.5), so a typed reason is what remains to confirm. A soft finding
// owned by the slot's lane (DPO): the DPO confirms the reason by waiving it, or the owner fixes the slot.
import { owningLaneRule } from '@rai/shared/constants';
import type { QcFinding } from '@rai/shared/qc/types';
import { VENDOR_SLOTS } from '../../../pack/slots.js';
import { finding, slotEvidence, type MetadataRule, type RuleInput } from './rule.js';

function evaluate(input: RuleInput): QcFinding[] {
  const { request, mapping } = input;
  if (!request.vendorInvolved) return [];
  const findings: QcFinding[] = [];
  for (const state of request.slots) {
    if (!VENDOR_SLOTS.includes(state.slot) || state.disposition !== 'not_applicable') continue;
    const owner = owningLaneRule({ kind: 'slot', slot: state.slot }, mapping);
    if (owner.kind !== 'lane') throw new Error(`vendor slot ${state.slot} has one owning lane (W0-06 7.1)`);
    findings.push(
      finding(input, {
        scope: { kind: 'slot', slot: state.slot },
        owningLane: owner.lane,
        evidence: [slotEvidence(request, state.slot)],
        message: { key: 'qc.finding.pack_na_vendor_doc', params: { slot: state.slot } },
      }),
    );
  }
  return findings;
}

export const PACK_NA_VENDOR_DOC: MetadataRule = Object.freeze({
  triggers: Object.freeze(['submit'] as const),
  evaluate,
});
