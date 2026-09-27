# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED:
   - `tests/integration/w4-11a-run-identity.test.ts` (new): completed, unavailable, unbound and `deterministic` runs record identity and `rules_evaluated`; their log lines carry the new fields and `qcKind`; two submit runs on one version with different frozen revisions are distinguishable; desk-health `unavailableQc` rows carry the runner label.
   - `tests/integration/w3-07a-migration-contract.test.ts`: historical row reads `unrecorded` / NULL; NOT NULL without default; CHECK >= 0; the second raw insert supplies `runner_version`.
   - `shared/src/schemas/observability.test.ts`: the report requires `runner` and `runnerVersion` and rejects unsafe values.
3. GREEN:
   - `server/drizzle/0009_w4_11a_run_identity.sql`, journal entry and snapshot (`drizzle-kit generate`, then the reviewed default-drop and CHECK statements).
   - `db/schema/qc-run.ts` (columns, CHECK), `qc/repository.ts` (`InsertRunInput`), `qc/orchestrator.ts` (identity on the run record, `rules_evaluated`, log fields, `qcKind` from the runner), `observability/log.ts` (catalogue), `observability/operator.ts` and `shared/src/schemas/observability.ts` (runner label), `tests/browser/support/operator-rehearsal.ts` (typed synthetic report).
   - W0-10 `observability-contract.md`: dated amendment of 3.3 and 7.2.
4. Full plan section 8 gate, one suite at a time, logs under `/tmp/rai-w4-11a-run-identity-logs/`.
5. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #184").
