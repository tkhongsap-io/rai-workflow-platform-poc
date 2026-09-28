# Specification

Source: W5 plan section 9 (the W5-10 row and "W5-10 merge order"), section 8 ("QC input (W5-10)"), section 7 (locale keys and "Every W5 edit to the in-memory API substitute"), section 9's shared-file table (`qc_rules` label rule, `rule-registry.ts`, `qc/orchestrator.ts`), decisions R-11 and R-17. The plan wins over issue #240.

Done when:

1. **Request field (R-17).** `QcRunRequest` (`shared/src/qc/types.ts`) gains the required field `riskProposal: { status: 'proposed' | 'unavailable'; tier: RiskTier | null } | null`. `runKey` is unchanged.
2. **Orchestrator.** `qc/orchestrator.ts` loads the version's `submit` proposal (`risk/repository.ts` `readSubmitProposal`) for submit runs and passes `{ status, tier }`; `null` when the version has none (submitted before W5), and always `null` on upload and approve-attempt runs.
3. **Rule.** `qc/deterministic/rules/risk-tier-unknown.ts`, registered in `METADATA_RULES` for the `submit` trigger: pack scope, owning lane AI/COE (W0-06 7.3 part 3), the catalogue severity; fires when `riskProposal` is `unavailable` or its tier is `unknown`; never on `null` or on `high`, `medium`, `low`. One finding, evidence a pack-level `absent` locator (the rule reads a recorded proposal, not a document), message `qc.finding.risk_tier_unknown` with `{ status }` (`unknown` or `unavailable`).
4. **Catalogue.** The seeded `qc_rules` body lists `RISK-TIER-UNKNOWN` (`engine: 'metadata'`, `triggers: ['submit']`, `severity: 'medium'`) in both templates; label `w4a.1` → `w5.1`. `IMPLEMENTED_RULES` (`shared/src/qc/rule-registry.ts`, W6-03 merged) lists it as `metadata`, `['submit']`.
5. **Builders.** Every `QcRunRequest` literal builder the typecheck names sets `riskProposal` (one line each), including `fixtures/src/substitutes/api/routes-review.ts` `buildLaneQcRequest` (`riskProposal: null`). Files that only import the type are untouched.
6. **Locales.** `qc.finding.risk_tier_unknown` and `qc.rule.risk_tier_unknown` in th and en.
7. **Tests.**
   - Rule fixtures through the runner: proposed `high`/`medium`/`low` → nothing; proposed `unknown` → one finding; `unavailable` → one finding; `null` → nothing; each finding passes the W0-07 3.4 validator and owning-lane check.
   - Orchestrator (real Postgres): a submit run's request carries the recorded proposal; approve-attempt and upload requests carry `null`; a version without a proposal carries `null`; under `deterministic` an answerless submit records the finding and a fully answered High submit does not.
   - The existing tests the W5-10 row names, and only those: the label `w4a.1` → `w5.1` in five files; `w4-02` submit selection gains the rule; `w4-03` and `w4a-int-deterministic-server` submit `rules_evaluated` 3 → 4 and one extra finding per fixture submit. Upload, approve-attempt and substitute journeys unchanged.
8. **Docs.** W0-07 3.3 (the field) and 3.5 (the rule row) dated W5-10 amendments.
