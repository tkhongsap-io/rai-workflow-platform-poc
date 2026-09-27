# Specification

Source: W4a plan section 6 (the plan wins over issue #184).

Done when:

1. **Migration `0009_w4_11a_run_identity`** (forward-only) on `qc_run`:
   - `runner_version text NOT NULL`, added with `DEFAULT 'unrecorded'` and the default then dropped: rows written before it read `unrecorded`, and an insert that omits the value fails.
   - `rules_evaluated integer NULL` with `CHECK (rules_evaluated IS NULL OR rules_evaluated >= 0)` (`qc_run_rules_evaluated_check`): NULL on earlier rows.
   - No trigger or grant change (adding columns fires no UPDATE trigger; the existing `rai_app` grants cover them, as in `0007`). `engine_id` keeps the runner name.
2. **Every new run row** records `engine_id` = the bound runner's `identity.runner` and `runner_version` = its `identity.runnerVersion`:
   - completed: `rules_evaluated` = the length of the result's `rulesEvaluated`;
   - unavailable with a bound runner (timeout, runner error, a result refused by validation): the bound runner's identity (not the orchestrator's `QC-UNAVAILABLE` provenance), `rules_evaluated` = 0;
   - no runner bound: `engine_id` and `runner_version` both `unbound`, `rules_evaluated` = 0.
3. **Log lines** (W0-10 catalogue amended with a dated note):
   - `qc.run.started` gains `runner`, `runnerVersion`, `ruleRevision`; `qcKind` comes from the bound runner (`deterministic` for runner `deterministic`, `substitute` for every other runner, which in W0-W4a is synthetic).
   - `qc.run.completed` gains `runner`, `runnerVersion`, `ruleRevision`, `rulesEvaluated`.
   - `qc.run.unavailable` gains `runner`, `runnerVersion`, `ruleRevision` (the run row's values, `unbound` when no runner is bound).
   - No document text, filename or message parameter is added. A replay emits nothing, as before.
4. **Operator report:** each `DeskHealthReport.unavailableQc` row gains `runner` (`engine_id`) and `runnerVersion` (`runner_version`, `unrecorded` on older rows); the shared schema requires both as bounded identifier strings. `lateQc` is unchanged.
5. **Distinguishable:** two runs on one version whose rule revisions differ are told apart from their rows (`rule_revision`) and their log lines (`ruleRevision`), and runs by different runner versions by `runner_version` / `runnerVersion`.
6. `tests/integration/w3-07a-migration-contract.test.ts` raw `qc_run` inserts updated: the pre-0007 row reads `unrecorded` / NULL after migration; the post-migration insert supplies `runner_version`; an insert without it and a negative `rules_evaluated` are refused.
7. Full plan section 8 gate green.
