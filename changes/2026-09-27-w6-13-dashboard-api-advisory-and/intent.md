# Intent: desk dashboard API (W6-13, #215)

Ta's north star for the platform (2026-09-27) is a review desk that streamlines the workflow, tracks version history and **shows a dashboard**, on synthetic data. The dashboard is not a PRD requirement; the W6 plan added it under Ta's delegation of 2026-09-27 (section 0, section 8). W6-01 fixed its shape (`shared/src/schemas/dashboard.ts`) and the `dashboard.view` policy rows. This ticket serves it.

`GET /api/dashboard` answers, for the signed-in person and only over the cases they may see, one snapshot of the desk:

- how many cases are in each status (the same numbers the queue shows);
- per lane, how many current versions are pending, approved or sent back, and how many pending lanes are due soon or already past their due date;
- open QC findings on current versions by lane and severity, and open QC-unavailable findings by lane (operator pause separated from outage);
- QC run counts over the last 30 days;
- submissions, resubmissions, send-backs and Ready transitions per week over the last eight Bangkok weeks.

Recheck (advisory) counts, `findings.advisory` and `qc.rechecks30d`, are served as `0`: the recheck column does not exist yet. W6-09 adds the `recheck = false` predicate and wires both counts (W6 plan section 5). Risk tiers stay `{ available: false }` until W6-16.

It is order 13 of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (section 8.1, row W6-13), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". No UI (W6-15), no queue filter (W6-14), no migration. Synthetic data only; no network call; no deploy.
