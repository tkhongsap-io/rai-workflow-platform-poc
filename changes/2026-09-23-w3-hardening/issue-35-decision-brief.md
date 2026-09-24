# Decision brief: who owns a finding that no single lane owns (issue #35)

For Ta and the review leads (AI/COE, DPO, IT/Security). One decision, five parts. It is a refinement inside D05, so it needs a register row with approver and date; agents do not decide it.

## Why it matters now

D05 says a finding is waived or marked N/A by "the finding's owning lane". For most findings that is obvious: a finding on slot 1 belongs to AI/COE, slots 2-4 to DPO, slots 6-8 to IT/Security. For five kinds of finding there is no single owner yet, and the code refuses to guess:

- after hardening batch H7, a QC run that produces one of these findings is recorded as **unavailable** (fail closed) with no findings stored, and the reviewer sees "QC unavailable" before deciding;
- the actual finding is therefore never stored, so nobody can disposition it, and the reviewer has to decide without it.

That is safe, because nothing is silently treated as clean, but it throws away real information. It also does not block Ready. An unavailable run stores no finding, so the reviewer can approve after seeing "QC unavailable", and the case can reach Ready for launch without anyone dispositioning what QC would have raised.

Nakhun can see this in the walkthrough: changing the risk-screening slot on some synthetic cases produces an unavailable run with "Review lane: Not recorded". Real QC (W4) would hit it on every BRD and pack-level check. Part 4 of the decision covers exactly this case.

## The five parts, with a recommendation for each

The full option table is in [docs/engineering/workflow-transition-and-error-contract.md section 7.3](../../docs/engineering/workflow-transition-and-error-contract.md#73-open-d05-refinement-the-review-leads-record-before-w2-05).

| # | Finding on… | Recommended | Why | Alternatives |
|---|---|---|---|---|
| 1 | **Slot 5, the BRD** (all three lanes review it) | **The lane whose QC rule raised it** | QC rules are already lane-scoped; the lane that asked the question owns the answer. Keeps one owner per finding. | AI/COE always; any lane, first to record wins |
| 2 | **Slot 9, other supporting documents** (no lane reviews it) | **Informational only: QC raises no defects on slot 9** | Nobody reviews slot 9, so a defect there has no one to act on it. Unsafe files are already rejected at upload. | AI/COE; the rule's declared lane |
| 3 | **The whole pack** (completeness, contradictions between documents, stage mismatch) | **AI/COE** | AI/COE owns risk screening, the document that frames the whole pack. One named owner is simplest to operate. | The rule's declared lane; all three |
| 4 | **QC unavailable** (QC could not run or timed out) | **Follow the run:** on an approve attempt, the lane that was approving; on upload, the slot's owner (per 1-3); on submit, the pack owner (AI/COE) | The person who saw "QC unavailable" before deciding is the right person to accept or chase it. | Always one named lane; follow the slot only |
| 5 | **The same finding again on version N+1** | **Never carry over; re-disposition on each version** | Matches today's behaviour and the immutability rule. Revisit in W4 when real QC exists. | Carry over when rule, revision, slot and file hash are identical |

## What happens after you decide

1. Ta records one row in `docs/product/decisions.md` (approver = review leads within D05, date, channel).
2. One ticket updates `owningLaneForSlot` and the QC recording path, adds the slot-5, slot-9 and pack-level test cases W2-05 still owes, and closes #35 and epic #53.
3. Nothing else changes: Ready, the audit trail and the other D05 rules stay as they are.

If you accept all five recommendations, the change is small (one function, one recording rule, the tests). If you pick "all three lanes" or "carry over", it is larger, because `owning_lane` becomes a set or a new event type is needed.
