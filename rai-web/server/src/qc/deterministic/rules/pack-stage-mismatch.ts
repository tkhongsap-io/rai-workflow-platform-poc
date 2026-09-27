// PACK-STAGE-MISMATCH (W4a plan section 4; provisional until D09). The pack does not fit its `stage_context` (D11:
// a QC input only, never a lifecycle state). The catalogue params say, per stage, which slots may not be `attached`
// and which may not be `not_yet`; the seed carries the source spec's two examples (a deployment checklist, slot 8,
// filed at idea; any lane-gated slot not yet at pre_launch). One pack finding, owned by AI/COE (W0-06 7.3 part 3),
// with one evidence entry per offending slot. Slot 9 is never evidence of a defect (7.3 part 2).
import { Value } from 'typebox/value';
import { owningLaneRule } from '@rai/shared/constants';
import type { QcFinding, SlotNumber } from '@rai/shared/qc/types';
import { StageMismatchParamsSchema } from '@rai/shared/schemas/cases';
import { RuleParamsError, finding, slotEvidence, type MetadataRule, type RuleInput } from './rule.js';

function evaluate(input: RuleInput): QcFinding[] {
  const { request, rule, mapping } = input;
  if (!Value.Check(StageMismatchParamsSchema, rule.params)) throw new RuleParamsError(rule.ruleId);
  const attachedForbidden: readonly number[] = rule.params.attachedForbiddenAt[request.stageContext] ?? [];
  const notYetForbidden: readonly number[] = rule.params.notYetForbiddenAt[request.stageContext] ?? [];
  const offending: SlotNumber[] = request.slots
    .filter(
      (s) =>
        owningLaneRule({ kind: 'slot', slot: s.slot }, mapping).kind !== 'no_defects' &&
        ((s.disposition === 'attached' && attachedForbidden.includes(s.slot)) ||
          (s.disposition === 'not_yet' && notYetForbidden.includes(s.slot))),
    )
    .map((s) => s.slot)
    .sort((a, b) => a - b);
  if (offending.length === 0) return [];
  const pack = owningLaneRule({ kind: 'pack' }, mapping);
  if (pack.kind !== 'lane') throw new Error('the pack has one owning lane (W0-06 7.3 part 3)');
  return [
    finding(input, {
      scope: { kind: 'pack' },
      owningLane: pack.lane,
      evidence: offending.map((slot) => slotEvidence(request, slot)),
      message: { key: 'qc.finding.pack_stage_mismatch', params: {} },
    }),
  ];
}

export const PACK_STAGE_MISMATCH: MetadataRule = Object.freeze({
  triggers: Object.freeze(['submit'] as const),
  evaluate,
});
