// W4-03 (W4a plan section 4): what a deterministic metadata rule is. A rule is a pure function of the request (slot
// states, stage, model type, vendor flag) and its catalogue entry (severity, params); it has no store, no clock and
// no access to document bytes. It returns W0-07 3.3 findings, which the orchestrator validates unchanged (3.4).
import type { LaneMapping, Lane } from '@rai/shared/constants';
import type {
  EvidenceLocation,
  FindingScope,
  QcFinding,
  QcRunRequest,
  QcRunner,
  QcTrigger,
  SelectedRule,
} from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';

export interface RuleInput {
  request: QcRunRequest;
  rule: SelectedRule;
  /** The lane mapping recorded on the version (`request.laneMappingVersion`), never the current one. */
  mapping: LaneMapping;
  provenance: QcRunner['identity'];
}

export interface MetadataRule {
  /** The triggers the rule is defined for; a catalogue that selects it on another trigger fails the run. */
  readonly triggers: readonly QcTrigger[];
  evaluate(input: RuleInput): QcFinding[];
}

/** `params` that do not match the rule's schema: the run cannot vouch for its result (`runner_error`). */
export class RuleParamsError extends Error {
  constructor(readonly ruleId: string) {
    super(`${ruleId}: params do not match the rule's schema`);
    this.name = 'RuleParamsError';
  }
}

/** Evidence for a slot-level fact (a state, not a location in a document): the slot, and the artifact if attached. */
export function slotEvidence(request: QcRunRequest, slot: EvidenceLocation['slot']): EvidenceLocation {
  const state = request.slots.find((s) => s.slot === slot);
  const artifact =
    state?.artifactId == null ? undefined : request.artifacts.find((a) => a.artifactId === state.artifactId);
  return {
    artifactId: artifact?.artifactId ?? null,
    contentHash: artifact?.contentHash ?? null,
    slot,
    locator: { kind: 'absent' },
  };
}

export function finding(
  input: RuleInput,
  fields: {
    scope: Exclude<FindingScope, { kind: 'run' }>;
    owningLane: Lane;
    evidence: EvidenceLocation[];
    message: QcFinding['message'];
  },
): QcFinding {
  const { request, rule, provenance } = input;
  return {
    findingKey: findingKeyOf(rule.ruleId, fields.scope),
    ruleId: rule.ruleId,
    ruleRevision: request.qcRulesRevision,
    trigger: request.trigger,
    scope: fields.scope,
    severity: rule.severity,
    owningLane: fields.owningLane,
    evidence: fields.evidence,
    measure: null,
    message: fields.message,
    provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
  };
}
