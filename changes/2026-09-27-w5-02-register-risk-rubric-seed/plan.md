# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - `server/src/configuration/seed.test.ts`, `shared/src/risk/rubric-schema.test.ts` (unit).
   - `tests/integration/w1-00-configuration.test.ts`, `tests/integration/w1-05-submit.test.ts` (frozen `risk_rubric` assertion), new `tests/integration/w5-02-risk-rubric.test.ts`.
3. GREEN:
   - `shared/src/schemas/cases.ts`: register the kind; `RiskRubricView`.
   - `shared/src/errors.ts`: `NotFoundResource` gains `risk_rubric`.
   - `server/src/configuration/store.ts`: the `risk_rubric` problems branch; `currentRiskRubric(exec, at)`.
   - `server/src/configuration/seed.ts`: the placeholder body.
   - `server/src/cases/routes.ts`: the read route.
4. W0-02 section 7.3 amendment (dated note, endpoint row).
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-02-register-risk-rubric-seed-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #213").
