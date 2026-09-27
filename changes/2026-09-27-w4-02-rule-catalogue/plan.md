# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED:
   - `shared/src/schemas/qc-rules.test.ts` (new): body schema accepts the seed shape, refuses unknown keys, bad rule IDs, empty or repeated triggers, unknown severities, duplicate rule IDs, bad `PACK-STAGE-MISMATCH` params, params on a rule without a schema.
   - `server/src/qc/select.test.ts` (new): trigger filtering and order, template isolation, `model_type` routing, unknown template, no mutation of the body.
   - `server/src/configuration/seed.test.ts`: `qc_rules` is seeded with label `w4a.1` and the two templates as specified.
   - `tests/integration/w4-02-rule-catalogue.test.ts` (new): the orchestrator passes the selected rules for each fixture template; the submitted version reads its frozen revision after a newer one is published; a draft reads the revision in force strictly before the instant; a version frozen with another kind gets `rules: null`, and approve attempts answering `not_configured` are retried; an unknown template records `runner_error` without calling the runner.
   - `tests/integration/w1-05-submit.test.ts`: `configurationRevisionId` is the `qc_rules` revision in force.
3. GREEN:
   - `shared/src/schemas/cases.ts` (body schema, params schemas, `qcRulesBodyProblems`), `shared/src/qc/types.ts` (`SelectedRule`, `rules`).
   - `server/src/configuration/store.ts` (the per-rule checks on write), `configuration/seed.ts` (revision 1).
   - `server/src/qc/select.ts`, `server/src/qc/rules-revision.ts`, `server/src/qc/orchestrator.ts` (rule context, `request.rules`, pre-run `runner_error`).
   - `versions/freeze.ts` comment. Docs: W0-02 7.3/7.6 and W0-07 3.3 dated amendments.
4. Full plan section 8 gate, one suite at a time, logs under `/tmp/rai-w4-02-rule-catalogue-logs/`.
5. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #185").
