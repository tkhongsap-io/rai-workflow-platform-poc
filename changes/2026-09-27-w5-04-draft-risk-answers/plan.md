# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - unit `server/src/pack/risk-answers.test.ts` (pure validation and merge);
   - new `tests/integration/w5-04-risk-answers.test.ts`;
   - `tests/integration/w2-03-successor-draft.test.ts` extended (successor copy).
3. GREEN:
   - `shared/src/schemas/pack.ts`: `RiskAnswerSchema`, `PackDraft.riskAnswers`, `PackDraftUpdateRequest.riskAnswers`.
   - `server/src/pack/risk-answers.ts` (new, pure): `riskAnswerProblems(request, rubric)` and `mergeRiskAnswers(stored, request, attribution)`.
   - `server/src/pack/service.ts`: validation in `validateValues`, merge and write in `saveDraft`, audit refs; names on the read.
   - `server/src/pack/repository.ts`: `updateDraftRiskAnswers`; `packDraftView` reads `riskAnswers`.
   - `server/src/workflow/repository.ts`: `ensureSuccessorDraft` copies `risk_answers`.
   - `server/src/compose-app-deps.ts`: the pack routes get the same subject directory (names on the read).
   - `fixtures/src/substitutes/api/{store,workflow}.ts`: `riskAnswers: {}` in the `PackDraft` literals.
   - `shared/src/locales/{th,en}.json`: `error.risk.not_configured`.
4. W0-02 section 7.5 amendment (dated note).
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-04-draft-risk-answers-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #222").
