# Intent: queue drill-down filters (W6-14, #224)

Ta's north star (2026-09-27) is a review desk that streamlines the workflow, tracks version history and **shows a dashboard**, on synthetic data. W6-13 serves the dashboard's numbers (`GET /api/dashboard`). A number is only useful if the reviewer can click through to the cases behind it: "DPO, 3 breached" must open the list of those three cases, and nothing else.

This ticket lets the review queue filter by what the dashboard counts:

- a lane and its state on the current submitted version (pending, approved, sent back);
- SLA: pending lanes due soon or already breached (one lane, or any lane);
- open QC findings on the current version, by owning lane, severity and kind (defect or QC unavailable).

Each filter narrows the actor's own scope before anything is counted or paged (A06), so an out-of-scope case can never appear or be counted. The queue screen reads the filters from the URL and keeps them there, so a dashboard link such as `/queue?lane=dpo&sla=breached` opens the filtered list, and applying a search keeps the drill-down.

Order 14 of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (section 8.2, row W6-14), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". Not in this ticket: the dashboard screen and its links (W6-15), the `riskTier` filter (W6-16), excluding recheck findings from the finding filters (W6-09, once the column exists). No migration. Synthetic data only; no network call; no deploy.
