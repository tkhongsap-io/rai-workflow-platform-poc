# Intent: dashboard UI (W6-15, #232)

Ta's north star (2026-09-27) is a review desk that streamlines the workflow, tracks version history and **shows a dashboard**, on synthetic data. W6-13 serves the numbers (`GET /api/dashboard`, inside the actor's scope) and W6-14 lets the queue list the cases behind each number. This ticket gives every signed-in person the screen itself.

- A "Dashboard" page, first in the primary navigation, for every signed-in role (owner, BU SPOC, the three reviewers, Admin), each seeing only their own scope because the server counts only that.
- Tiles for case status, lanes and SLA (pending, approved, sent back, due soon, past due), open findings by lane and severity (and QC unavailable), QC runs in the last 30 days, risk tiers (not available until W6-16) and the last eight weeks of activity.
- A number the queue can filter is a link that opens the filtered queue; a 0 is plain text.
- An empty state when nothing is in scope; Thai and English; keyboard; accessible tables with captions, bars that are decoration only, and words, never colour alone.

Order 15 of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (sections 8 and 9, row W6-15), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". Not in this ticket: risk tiers and the `riskTier` filter (W6-16), advisory recheck counts (W6-09), the Admin configuration screens (W6-05 to W6-07). No migration, no server change. Synthetic data only; no network call; no deploy.
