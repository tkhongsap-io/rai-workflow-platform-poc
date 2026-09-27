# Rehearsal kit templates

Templates for every W7 dress rehearsal of the review desk: the agent-run synthetic rehearsals (scripted, W7-12; by hand, W7-14) and, once D08 permits it, operator Nakhun's real rehearsal on 3-5 permitted cases (W7-D19, **pending D08 and the operator**). Source: the [W7 plan](../../engineering/implementation-plan-w7.md) section 9 row W7-10, the register row "W7 delegated rulings (provisional)" in [decisions](../../product/decisions.md) and the [BUILD_PLAN](../../../BUILD_PLAN.md) W7 entry. Added by W7-10 (2026-09-28).

| Template | Filled in | Purpose |
|---|---|---|
| [Rehearsal plan](rehearsal-plan-template.md) | before the run | Run identity, scope, roles, steps with the step IDs the timer uses, stop rules |
| [Timing sheet](timing-sheet-template.md) | during the run | One row per step; the same columns as `timings.csv` |
| [Deficiency log](deficiency-log-template.md) | during and after the run | Every deficiency, disagreed finding and manual workaround, with the W7-D16 blocking rule |
| [Acceptance report](acceptance-report-template.md) | after the run | Result against the pass criteria, pending items and remaining limits |

How to use them:

- Copy a template into the run's record folder (`changes/<date>-<slug>/` for a synthetic run) and fill it there. Never edit the templates in place for a run.
- Timings come from `createStepTimer(runId)` in `rai-web/tests/rehearsal/timing.ts`, which writes `timings.json` and `timings.csv` under `REHEARSAL_OUT_DIR/<runId>/` (default `rai-web/.local/rehearsal/`, gitignored; any directory outside `rai-web/.local/` is refused). A synthetic record summarises them; raw outputs stay local (W7-D18).
- **Synthetic runs:** synthetic data only (`@rai-desk.example` principals, the `REH-` case set of the plan's section 11).
- **Real runs:** a real rehearsal's contents (case names, documents, reviewer comments, timings tied to real cases) never enter Git (BUILD_PLAN W7). Only a redacted summary the DPO allows may be recorded.
