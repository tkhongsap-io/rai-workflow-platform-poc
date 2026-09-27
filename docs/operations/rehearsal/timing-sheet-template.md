# Timing sheet: <run ID>

Template (W7-10). One row per timed step; see the [kit README](README.md) and the [rehearsal plan](rehearsal-plan-template.md) for the step IDs. Source: [W7 plan](../../engineering/implementation-plan-w7.md) section 9 rows W7-10, W7-12 and W7-14.

- The columns are exactly those of `timings.csv` written by `createStepTimer(runId)` (`rai-web/tests/rehearsal/timing.ts`); a unit test keeps them equal. A scripted run's CSV can be pasted as rows; a run by hand fills the same columns with a stopwatch or the timer.
- Times are ISO-8601 UTC; `duration_ms` is whole milliseconds; `outcome` is `completed`, `failed` or `skipped`.
- Timings are recorded **without a target** (W7-D15): no baseline exists. Proposed targets, if any, belong in the [acceptance report](acceptance-report-template.md) as a proposal.
- A failed or skipped step cites its deficiency ID from the [deficiency log](deficiency-log-template.md) in `note`.
- Synthetic data only for agent runs. A real run's rows stay outside Git (W7-D18).

| run_id | step_id | section | started_at | ended_at | duration_ms | outcome | note |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Summary

| Measure | Value |
|---|---|
| Steps timed | |
| Completed / failed / skipped | |
| Total elapsed (first start to last end) | |
| Longest step (step ID, ms) | |
| Raw files | `REHEARSAL_OUT_DIR/<run ID>/timings.json`, `timings.csv` (local, not committed) |
