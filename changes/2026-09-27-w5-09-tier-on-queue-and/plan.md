# Plan

1. Board CLAIM (Lane B). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - new integration `tests/integration/w5-09-risk-tier-lists.test.ts` (both lists serve `riskTier`; null before submit; scope unchanged);
   - unit tests in `web/src/screens/cases/case-list.view-model.test.ts` (chip model per tier, none for absent/null, banner rule) and `web/src/screens/queue/view-model.test.ts` (queue item chip);
   - browser `tests/browser/w5-09-risk-tier-lists.spec.ts` (server build: submitted case shows the chip and the banner on the queue and case list).
3. GREEN:
   - `shared/src/schemas/cases.ts`: `CaseSummary.riskTier?`;
   - `server/src/cases/repository.ts`, `server/src/queue/repository.ts`: serve the column;
   - `web/src/screens/cases/case-list.view-model.ts`: `riskTierChipOf`, `RISK_TIER_TONE`, `showsPlaceholderBanner`; `CaseRowModel.riskTier`;
   - `web/src/screens/cases/risk-tier-chip.tsx` (new): the chip fact; used by both screens;
   - `web/src/screens/queue/queue-screen.tsx`, `web/src/screens/cases/case-list-screen.tsx`: chip and banner;
   - `shared/src/locales/{th,en}.json`: `risk.list.tier`.
4. Docs: W0-02 7.3 amendment.
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-09-tier-on-queue-and-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #239").
