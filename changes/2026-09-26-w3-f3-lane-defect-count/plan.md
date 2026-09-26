# Plan

1. Board claim (Lane B).
2. RED: a w3-03a test inserts two DPO defects, one IT/Security defect and one AI/COE unavailable finding before a manual delivery (no automatic worker, no submit QC), expecting 2, 1, 0; it failed with 3.
3. GREEN: the lane filter in `loadCommittedCaseRequest`; both locale labels.
4. Spec text; records; full suite serially on Postgres 55373; PR; two reviewers; CI; merge.
