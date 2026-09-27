# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - `shared/src/risk/rubric-schema.test.ts`: the schema accepts the synthetic test rubric and refuses each structural and semantic problem in spec items 1-2.
   - `shared/src/risk/score.test.ts`: `tierOf` boundaries, escalation, every unknown reason, bounds, determinate despite Unknown, all Unknown, the labelled section 7 expressiveness case, a brute-force cross-check, purity and timing.
   - `shared/src/risk/inputs.test.ts`: SHA-256 known vectors (and agreement with `node:crypto` in the test only), canonical form, stability and sensitivity.
   - `shared/src/risk/module-graph.test.ts`: the non-test modules of `shared/src/risk` reach only `typebox` and workspace modules, no Node built-in or DOM global.
   - Shared synthetic rubric for these tests: `shared/src/risk/test-rubric.test-helper.ts` (agent-team synthetic, labelled; not the W5-02 seed and not D07).
3. GREEN:
   - `shared/src/schemas/cases.ts`: `RiskRubricBodySchema`, `RiskRubricBody`, `riskRubricBodyProblems` (not registered).
   - `shared/src/risk/types.ts`, `score.ts`, `inputs.ts`.
4. Full gate, one suite at a time, logs under `/tmp/rai-w5-01-rubric-schema-and-pure-logs/`.
5. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #204").
