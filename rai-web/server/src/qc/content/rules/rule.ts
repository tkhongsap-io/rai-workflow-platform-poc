// W4-06a (W4b plan section 3.1): what a content rule is. The runner decides everything it can before a byte is read
// (the rule is implemented, defined for the trigger, its params pass their schema), works out which slots the rule may
// read for this trigger and lane (decisions 22 and 28), reads and extracts those artifacts, and hands the rule their
// segments. A rule is then a pure function of the request, its checked params and those segments: no store, no clock,
// no bytes. It returns W0-07 3.3 findings that cite claims by locator and `excerptHash`, never by text.
import type { Lane } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcFinding,
  QcRunRequest,
  QcRunner,
  QcTrigger,
  SelectedRule,
} from '@rai/shared/qc/types';
import type { TSchema } from 'typebox';
import type { Segment } from '../../extraction/port.js';

/** One artifact the rule may read on this request, with its extracted segments and the lane that owns its findings. */
export interface ContentDocument {
  artifact: AuthorizedArtifactRef;
  segments: readonly Segment[];
  /**
   * Upload: the slot's single lane. Approve attempt: the run's lane (every finding of the run belongs to it, W0-07 3.4
   * step 5). Submit: null; a pack-level rule owns its findings by the W0-06 pack rule (AI/COE).
   */
  owningLane: Lane | null;
}

export interface ContentRuleInput {
  request: QcRunRequest;
  rule: SelectedRule;
  /** `rule.params`, already checked against `paramsSchema`. */
  params: unknown;
  /** The readable artifacts, in request order; empty when the rule has nothing in scope on this request. */
  documents: readonly ContentDocument[];
  provenance: QcRunner['identity'];
}

export interface ContentRule {
  /** The triggers the rule is defined for; a catalogue that selects it on another trigger fails the run. */
  readonly triggers: readonly QcTrigger[];
  /** The rule's registered params schema (`QC_RULE_PARAMS_SCHEMAS`); its params list `slots` and `claimSource`. */
  readonly paramsSchema: TSchema;
  evaluate(input: ContentRuleInput): QcFinding[];
}
