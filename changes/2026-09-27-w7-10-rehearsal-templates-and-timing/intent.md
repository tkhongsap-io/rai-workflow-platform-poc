# Intent: rehearsal templates and timing capture (W7-10, #210)

W7 ends with a dress rehearsal of the desk: an agent-run synthetic one now (W7-12 scripted, W7-14 by hand) and, later, operator Nakhun's real one on 3-5 permitted cases once D08 allows it. Every rehearsal needs the same kit: a plan to follow, a way to time each step, a place to log what went wrong and a report that states the result. None exists today, so each run would invent its own format and the timings of the scripted run, the manual run and the real run could not be compared.

This ticket adds that kit and nothing else:

- four Markdown templates under `docs/operations/rehearsal/`: the rehearsal plan, the deficiency log (with the W7-D16 blocking definition), the timing sheet (the same columns as the timer's CSV) and the acceptance report (the W7-D15 synthetic pass criteria, and proposed real PoC acceptance criteria marked as a proposal for Ta and Nakhun at the D08-gated rehearsal);
- `rai-web/tests/rehearsal/timing.ts`: `createStepTimer(runId)` records each step's start, end, duration and outcome and writes `timings.json` and `timings.csv` under `REHEARSAL_OUT_DIR/<runId>/`, refusing any directory outside `rai-web/.local/` (W7-D18: rehearsal outputs never enter Git).

It implements the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-10 with section 2 (`REHEARSAL_OUT_DIR`) and the provisional rulings W7-D13, W7-D15, W7-D16 and W7-D18 of the register row "W7 delegated rulings (provisional)", under "Ta's delegation (2026-09-27)". W7-D19 (the real rehearsal) stays pending on D08 and the operator; nothing here claims it.

Not here: the case set and loader (W7-11), the scripted rehearsal (W7-12), the rehearsal records (W7-13, W7-14). No product code, no migration, no configuration key the server reads. Synthetic data only; no external network call; nothing is deployed.
