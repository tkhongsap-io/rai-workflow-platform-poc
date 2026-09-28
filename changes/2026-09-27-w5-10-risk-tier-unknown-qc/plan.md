# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing):
   - `server/src/qc/deterministic/rules.test.ts`: `RISK-TIER-UNKNOWN` fixtures (proposed high/medium/low, unknown, unavailable, null) and the label keys;
   - `server/src/configuration/seed.test.ts` and `server/src/qc/rule-registry.test.ts` expectations (label `w5.1`, the rule in both templates and in `IMPLEMENTED_RULES`);
   - new integration `tests/integration/w5-10-risk-tier-unknown-qc.test.ts` (orchestrator request field per trigger; the finding recorded under the deterministic runner);
   - the existing expectations the W5-10 row names (label, rule list, counts, extra finding).
3. GREEN:
   - `shared/src/qc/types.ts`: `QcRiskProposal`, required `riskProposal`;
   - `server/src/qc/orchestrator.ts`: load the submit proposal for submit runs;
   - `server/src/qc/deterministic/rules/risk-tier-unknown.ts` + `rules/index.ts`;
   - `server/src/configuration/seed.ts`: the rule and label `w5.1`;
   - `shared/src/qc/rule-registry.ts`: the entry;
   - every builder `npm run typecheck` names (one line each);
   - locales th/en.
4. Docs: W0-07 3.3 and 3.5 dated amendments.
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-10-risk-tier-unknown-qc-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #240").
