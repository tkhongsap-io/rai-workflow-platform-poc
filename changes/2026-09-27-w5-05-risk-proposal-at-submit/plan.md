# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - new `tests/integration/w5-05-risk-submit.test.ts`;
   - new unit `server/src/risk/module-graph.test.ts` (ready/policy reach no risk module; no risk policy action) and `server/src/risk/propose.test.ts` (pure outcome builder);
   - intended edits to `w1-05-submit.test.ts`, `w2-01-lanes.test.ts`, `audit/store.test.ts`.
3. GREEN:
   - `server/src/risk/propose.ts` (pure `proposalOutcome` + transactional `proposeAtSubmit`), `server/src/risk/repository.ts` (`insertRiskProposal`);
   - `server/src/versions/service.ts` (call, audit, post-commit logs, `emitter`/`errors`/`riskEngine` deps), `versions/repository.ts` (`closeDraftOnCase` `riskTier`, header comment), `cases/repository.ts` (comment, cast);
   - `server/src/app.ts` passes `emitter` and `errors` to the version routes;
   - `server/src/audit/store.ts` (`risk.proposed`), `observability/log.ts` (two events);
   - `shared/src/schemas/cases.ts` (`RiskTier` union).
4. Docs: W0-06 4.3, 9.2, 9.4; W0-04 `risk_tier` row; W0-10 catalogue.
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-05-risk-proposal-at-submit-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #229").
