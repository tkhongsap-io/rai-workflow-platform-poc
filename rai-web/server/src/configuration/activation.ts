// The provisional activation rule (W1-00, until W6): a revision applies to submissions after its publish time.
// Pure functions so W1-05 (freeze) and W3-05 (SLA) evaluate the same rule the store uses for `currentRevision`.

import type { ActivationRule } from '@rai/shared/schemas/cases';

export interface ActivatableRevision {
  activationRule: ActivationRule;
  publishedAt: Date;
}

/** True when `revision` is in force for an event at `at` (strictly after its publish instant). */
export function appliesAt(revision: ActivatableRevision, at: Date): boolean {
  switch (revision.activationRule) {
    case 'after_publish':
      return revision.publishedAt.getTime() < at.getTime();
  }
}

/** The revision in force at `at` among the candidates of one kind: the latest published one that applies. */
export function revisionInForce<T extends ActivatableRevision>(
  candidates: readonly T[],
  at: Date,
): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (!appliesAt(candidate, at)) continue;
    if (best === undefined || candidate.publishedAt.getTime() > best.publishedAt.getTime()) best = candidate;
  }
  return best;
}
