// RISK-TIER-UNKNOWN (W5 plan R-11 and section 8, W5-10; provisional until D09). The version's submit risk proposal
// (`request.riskProposal`, loaded by the orchestrator) is `unknown` (answers or evidence missing, so more than one tier
// is possible) or `unavailable` (no rubric, an invalid rubric or an engine error). One soft pack finding owned by
// AI/COE (W0-06 7.3 part 3), which AI/COE confirms or waives before Ready like any other soft finding (L7). A
// `high`, `medium` or `low` proposal raises nothing, and so does `null` (a version submitted before W5). The rule
// reads a recorded proposal, never a document or an answer: its evidence is a pack-level `absent` locator, and its
// message names only the proposal status. No tier routes, skips or grants anything.
import { owningLaneRule } from '@rai/shared/constants';
import type { QcFinding } from '@rai/shared/qc/types';
import { finding, type MetadataRule, type RuleInput } from './rule.js';

function evaluate(input: RuleInput): QcFinding[] {
  const { request, mapping } = input;
  const proposal = request.riskProposal;
  if (proposal === null) return [];
  const status =
    proposal.status === 'unavailable' ? 'unavailable' : proposal.tier === 'unknown' ? 'unknown' : null;
  if (status === null) return [];
  const pack = owningLaneRule({ kind: 'pack' }, mapping);
  if (pack.kind !== 'lane') throw new Error('the pack has one owning lane (W0-06 7.3 part 3)');
  return [
    finding(input, {
      scope: { kind: 'pack' },
      owningLane: pack.lane,
      evidence: [{ artifactId: null, contentHash: null, slot: null, locator: { kind: 'absent' } }],
      message: { key: 'qc.finding.risk_tier_unknown', params: { status } },
    }),
  ];
}

export const RISK_TIER_UNKNOWN: MetadataRule = Object.freeze({
  triggers: Object.freeze(['submit'] as const),
  evaluate,
});
