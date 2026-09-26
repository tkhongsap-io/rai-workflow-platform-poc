# Specification

Done when:

1. Each `unavailableQc` entry of `GET /api/operator/desk-health` carries `owningLane`, derived from the run with the recorded rule (W0-06 7.2, `unavailableOwningLane`): an approve-attempt run → its lane; a submit run → AI/COE. An upload run gets none (slice 1 has no upload-triggered QC, and the rule for slots 5 and 9 is W4's), so nothing is guessed.
2. Deriving from the run, not joining the finding row, is deliberate: a run that reused an earlier open outage finding (W0-07 3.4 step 6) has no finding row of its own but the same owner.
3. Tests: the operator-probe integration test expects `dpo` on DPO approve-attempt outages; the real-server desk-health browser test expects `ai_coe` on its submit timeout. The Admin page renders the lane already (`desk-health-sections.tsx`).
4. The observability contract's field comment says how the value is derived. Full suite green; two independent reviewer verdicts; CI green on the reviewed head.
