# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - new integration `tests/integration/w5-06-risk-proposal-read.test.ts`;
   - new unit `server/src/risk/view.test.ts` (pure `riskProposalView` builder: Council rule, bounds, frozen rubric, attribution merge, unavailable).
3. GREEN:
   - `shared/src/schemas/risk.ts` (new): `RiskProposalViewSchema`, `RiskProposalResponseSchema`;
   - `server/src/risk/view.ts` (new, pure) and `server/src/risk/repository.ts` (`readSubmitProposal`);
   - `server/src/risk/routes.ts` (new): `registerRiskRoutes`;
   - `server/src/app.ts`: register with the version routes' database, clock and subject directory.
4. Docs: W0-02 section 7.7 amendment.
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-06-risk-proposal-read-endpoint-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #238").
