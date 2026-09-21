// W0-06 section 2.4 "Derived case status": stored nowhere, computed from the rows, first match wins. Slice 1 has
// draft (v1 never submitted) and, once W1-05 lands, in_review; sent_back needs a successor draft (W2-03),
// ready_for_launch the Ready transition (W2-06), and awaiting_disposition the lane and finding rows W2 adds, which
// is why that input is optional here and defaults to "not all approved / no findings known" (in_review).

import type { CaseStatus } from '@rai/shared/schemas/cases';

export interface StatusInputs {
  /** The open draft, or null when the current version is under review (W0-04 case.draft_version_id). */
  draft: { parentVersionId: string | null } | null;
  /** The latest submitted version, or null while never submitted (W0-04 case.current_version_id). */
  current: { readyAt: Date | null } | null;
  /** W2: all three lanes approved and at least one undispositioned finding; absent in slice 1. */
  review?: { allLanesApproved: boolean; undispositionedFindings: number };
}

export function deriveCaseStatus(inputs: StatusInputs): CaseStatus {
  if (inputs.current?.readyAt != null) return 'ready_for_launch';
  if (inputs.draft !== null) return inputs.draft.parentVersionId === null ? 'draft' : 'sent_back';
  if (inputs.review?.allLanesApproved === true && inputs.review.undispositionedFindings > 0)
    return 'awaiting_disposition';
  return 'in_review';
}

/** W0-04 `case.desk_status`, the coarse stored mirror of the derived status (never returned as the status value). */
export function deskStatusFor(status: CaseStatus): 'draft' | 'in_review' | 'ready' {
  switch (status) {
    case 'draft':
    case 'sent_back':
      return 'draft';
    case 'in_review':
    case 'awaiting_disposition':
      return 'in_review';
    case 'ready_for_launch':
      return 'ready';
  }
}
