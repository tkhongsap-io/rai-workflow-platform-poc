// W3-F1 (#163): display names placed next to the subject IDs they describe. Display only: the IDs stay the identity
// of record, a missing name leaves the body as it was, and nothing here decides access or reaches a log.

import type { LaneDecision } from '@rai/shared/schemas/review';

/** Puts `submittedByDisplayName` right after `submittedBy`, or returns the body unchanged when the name is unknown. */
export function withSubmitterName<T extends { submittedBy: string }>(body: T, name: string | undefined): T {
  if (name === undefined) return body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = value;
    if (key === 'submittedBy') out.submittedByDisplayName = name;
  }
  return out as T;
}

/** Puts `decidedByDisplayName` right after `decidedBy` (the `LaneDecisionSchema` order), or returns it unchanged. */
export function withDeciderName(decision: LaneDecision, name: string | undefined): LaneDecision {
  if (name === undefined) return decision;
  const { lane, decision: kind, decidedBy, ...rest } = decision;
  return { lane, decision: kind, decidedBy, decidedByDisplayName: name, ...rest };
}
