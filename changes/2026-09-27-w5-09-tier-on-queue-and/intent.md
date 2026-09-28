# Intent: tier on queue and case list (W5-09, #239)

W5-05 writes the proposed risk tier of the latest submitted version to `case.risk_tier`, and the case read serves it, but the two lists people work from (the review queue and the case list) do not show it. Reviewers triaging the queue and owners scanning their cases should see, on each card, the tier the desk proposed, with Unknown shown as its own state and never read as Low.

This ticket serves `riskTier` on `CaseSummary` (and so on `QueueItem`) from the real server and renders a tier chip on each queue and case-list card. It adds one column to reads that are already scoped; it changes no scope, no filter, no count and no permission. The tier stays a desk proposal, not a governance decision, and the rubric behind it is the SYNTHETIC PLACEHOLDER (D07 open), so a list that shows a tier also shows the placeholder banner.

It is order 6 in section 9 of the [W5 plan](../../docs/engineering/implementation-plan-w5.md) (the W5-09 row) and implements section 6 (the `QueueItem`/`CaseSummary` row) and section 7 ("Queue and case list"), under the register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)". The tier filter and dashboard tier counts are W6's (W6-14, W6-16). No migration, no substitute edit. Synthetic data only; no network call; no deploy.
