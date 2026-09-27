# Review: rubric schema and pure scoring engine (W5-01, #204)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 3, the section 2 publish refusals, the section 11 unit layer and the W5-01 row of section 9 (the plan wins over issue #204). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)" (R-2, R-5, R-6, R-7, R-9, R-13). D07 stays open for AI/COE: no rubric content here is the approved instrument. Synthetic data only; no network call, no model, no deploy.

## Change

- **Body schema** (`shared/src/schemas/cases.ts`): `RiskRubricBodySchema` and `type RiskRubricBody`, exactly the plan's section 3 shape. `provenance` accepts only `'synthetic_placeholder'` (R-2); exactly 7 questions (`^RQ[1-9]$`); 2..5 options (`^[a-z][a-z0-9_]{0,39}$`, level `low|medium|high`, optional `escalatesTo: medium|high`); optional `evidenceSlot` 1..9; `tierRules` of `{ tier: high|medium, anyOf: [{ allOf: [{ level: high|medium, atLeast: 1..7 }] }] }`; `defaultTier: 'low'`; `tierLabels` for the four codes; every text Bilingual (th and en). Every object refuses unknown keys. Not registered in `CONFIGURATION_BODY_SCHEMAS` or `ConfigurationBodies` (W5-02; a test pins that).
- **Body problems** (`riskRubricBodyProblems`, the `qcRulesBodyProblems` pattern): duplicate question ID, duplicate option value within a question, the reserved option value `unknown`, a `high` rule after a `medium` rule. All problems are reported, not only the first.
- **Engine** (`shared/src/risk/`):
  - `types.ts`: `ENGINE_VERSION = 'risk-engine/1'`, `RiskLevel`, `ScoredTier` (`high|medium|low|unknown`, R-9), `UnknownReason`, `RiskAnswerValues` (values only, R-13), `EvidenceSlotStates`, `RiskQuestionScore`, `RiskScore`.
  - `score.ts`: `tierOf(rubric, levels)` counts each level exactly and returns the first matching rule (or `default`) with the counts. `scoreRisk(rubric, answers, slotStates)` resolves each question in rubric order (answered, or Unknown as `unanswered`, `explicit_unknown`, `not_in_rubric` or `evidence_not_attached`), applies the maximum `escalatesTo` (never lowering), and computes the exact bounds over every combination of the Unknown questions' options (R-6). It enumerates the reachable (high count, medium count, escalation) states rather than the raw product, which is exact because the rules read only those three values; a test cross-checks it against brute force on 300 generated synthetic rubrics.
  - `inputs.ts`: `canonicalInputs` (rubric question IDs ascending, each with its answer value, evidence slot and slot state) and `inputsHash`, a lowercase hex SHA-256 computed by a pure-TypeScript FIPS 180-4 implementation (`sha256Hex`).
- **Tests** (39 new unit tests, `shared/src/risk/`): `rubric-schema.test.ts` (10), `score.test.ts` (20), `inputs.test.ts` (6), `module-graph.test.ts` (3). Test rubric: `test-rubric.test-helper.ts`, agent-team synthetic, labelled not the seed and not D07.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **`RiskTier` in `schemas/cases.ts` is not widened here.** The W5-05 row owns "`RiskTier` widened with `unknown`" (it changes `CaseView`). The engine's tier type is `ScoredTier` in `risk/types.ts`; W5-05 can alias `RiskTier` to it.
- **The engine takes answer values only** (`RiskAnswerValues`, question ID to value). The plan's stored answer carries attribution (`answeredBy`, `answeredRole`, `answeredAt`); the engine never needs it, so attribution cannot reach a score or the hash (R-13). W5-05 joins attribution onto the explanation from the stored answers when it writes the proposal.
- **`matchedRule` and `escalation` with Unknown questions** (the plan names the fields only). `matchedRule` is the rule every combination matches, or `null` when combinations match different rules (so it is never a guess). `escalation` is the highest `escalatesTo` among answered questions only, first in rubric order on a tie; an Unknown question's possible escalation shows in `bounds.highest`, not in `escalation`. `counts` cover answered questions only.
- **An answer to a question the rubric does not have is ignored**; `not_in_rubric` applies to a rubric question whose stored value is not one of its options (section 2's "that question is Unknown"). The inputs hash also ignores it.
- **`evidence_not_attached` includes an absent slot state**, and the question still reports its option's level (so the display can say what the answer would have been). The evidence check is applied only to a value that is one of the question's options.
- **`tierOf` does not apply escalation**: section 3 defines it on the levels of one answer set; `scoreRisk` combines it with `escalatesTo`. `tierOf` also returns the counts and the matched rule.
- **SHA-256 in plain TypeScript** rather than `node:crypto` or Web Crypto: `shared/src/risk` must hold no Node or DOM import, and the submit transaction (W5-05) needs a synchronous digest. Checked against the FIPS 180-4 vectors and against `node:crypto` (in the test only) across block boundaries and non-ASCII text.
- **Schema limits the plan leaves open**: Bilingual strings 1..500 characters; `atLeast` 1..7; `anyOf` and `allOf` non-empty; `tierRules` may be empty (everything is `defaultTier` Low unless escalated). Structural limits (count, option bounds, provenance) are in the schema; the checks a schema cannot express are in `riskRubricBodyProblems`.
- **`evidenceSlot` uses a literal tuple union** (`EvidenceSlotSchema`) rather than `SlotNumberSchema`, whose mapped array makes TypeBox infer `never` (the same fix as `StageContextSchema`).
- No existing test changed; no spec amendment is assigned to W5-01 (plan section 12).

## Commands and results

Worktree `/tmp/rai-w5-01-rubric-schema-and-pure`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-01-rubric-schema-and-pure-logs/`. Hard-coded ports seen in tests (`tests/support/fixture-app.ts` 8787, `tests/browser/w1-int-evidence-config.spec.ts` 8789/5175) did not collide in this run; no retry was needed.

| Command (from `rai-web/` unless noted)                                                              | Result                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| RED: `node --import tsx --conditions=rai-source --test 'shared/src/risk/*.test.ts'` before the code | failed for the right reason: `risk/inputs.js` and `risk/types.js` not found; `schemas/cases.js` has no export `RiskRubricBodySchema` |
| same, after the code                                                                                | 39/39                                                                                                                                |
| `npm ci`                                                                                            | exit 0                                                                                                                               |
| `npm run lint`                                                                                      | exit 0 (eslint, prettier check, check-css)                                                                                           |
| `npm run typecheck`                                                                                 | exit 0                                                                                                                               |
| `npm run test:unit`                                                                                 | 687/687 (648 before + 39)                                                                                                            |
| `npm run test:integration`                                                                          | 374/374, 0 skipped                                                                                                                   |
| `npm run build && npm run check:substitute-absent`                                                  | exit 0; 675 files scanned, 0 with the marker                                                                                         |
| `npm run test:browser:server`                                                                       | 202 passed                                                                                                                           |
| `npm run test:browser:substitute`                                                                   | 48 passed                                                                                                                            |
| `node scripts/check-links.mjs` (root)                                                               | 373 Markdown files, 1064 relative links, 0 broken                                                                                    |
| `git diff --check` (root)                                                                           | clean                                                                                                                                |

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes                                                                                                                          |
| ----- | ---- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| -     | -    | -        | pending | Two independent reviewer verdicts on the PR head, and green CI on that head, are recorded here before merge (D03 ticket flow). |
