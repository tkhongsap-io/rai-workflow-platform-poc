# Intent: record the #35 owning-lane rule and finish W2-05

Ta's instruction on 2026-09-25, in the session that closed the W3 hardening: accept all five recommendations of the [#35 decision brief](../2026-09-23-w3-hardening/issue-35-decision-brief.md), record the rule, and implement the W2-05 cases that were blocked on it.

Why: W0-06 section 7.3 left four finding categories with no owning lane (slot 5, slot 9, pack-level, QC-unavailable) and one open question (carry-over to N+1). Until the rule exists the workflow fails closed: such a run is recorded `unavailable` and no finding is stored (H7), so a QC outage leaves no finding behind and a case can still reach Ready after it. The hardening walkthrough re-check showed exactly that. Issue #35 and epic #53 stay open because of it.

Scope: the W2-05 ticket (already authorized under D03, `status:ready`), synthetic data only. One register row recorded by Ta, the W0-06 and W0-07 text that the row resolves, the shared rule function, the orchestrator's QC-unavailable finding, the reserved W1-10 fixtures, and the tests W2-05's done-when still owes. No new product scope, no W4 work, no change to any other recorded decision. Upload-triggered QC does not exist in slice 1; its slot-5 and slot-9 sub-case is recorded as defined with upload QC in W4.
