# Review: ACC-BAND-V1-SHEET3 (W4-06c, #236)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-06c and sections 3.1-3.3. Decisions implemented: register row "W4b delegated rulings (provisional)" decisions 10 (WA-D09), 11, 26, 28 and 30, under "Ta's delegation (2026-09-27)". D07-D10 stay open. No migration, no route, no UI, no model, no network call; synthetic data only. The runner stays unbound in every `QC_MODE` (W4-13b).

## Change

- **`ACC-BAND-V1-SHEET3`** (`server/src/qc/content/rules/acc-band-v1-sheet3.ts`): approve attempts only, template `v1.0 Sheet3` only (the rule returns nothing on any other template). A claim on the hallucination item citing a metric in `params.bandMetrics` with a `percent` or `ratio` value is judged: its rate in percent (a ratio × 100 exactly) against `params.bands[tier]`, strict less-than passes, so equal fails; a missing or unrecognised tier is a finding with `qc.finding.acc_band_v1_sheet3_tier_missing`. One finding per claim (`claimKey`, identical text merged), `measure` in percent with `threshold` the band (null without a tier) and `thresholdSource: 'v1.0 Sheet3'`, params `{ slot, tier, value, threshold, threshold_source, item? }` as exact decimal strings.
- **`decimal.ts` `ratioToPercent`**: moves the decimal point two places on the string; null past 18 integer digits (it would no longer be a decimal-string message param).
- **Registry**: `CONTENT_RULES` lists the rule (`rules/index.ts`).
- **Catalogue**: `AccBandV1Sheet3ParamsSchema` (`slots`, `labels`, `items { hallucination }`, `bandMetrics`, `tiers { high, medium, low }` bilingual word lists, `bands { high, medium, low }` non-negative decimal strings, `claimSource`) registered in `QC_RULE_PARAMS_SCHEMAS`; seed `ACC_BAND_V1_SHEET3_PARAMS` on the `v1.0 Sheet3` entry (`bands { high: '1', medium: '2', low: '3' }`, tiers `high/สูง`, `medium/ปานกลาง`, `low/ต่ำ`, `bandMetrics ['hallucination_rate']`, `slots [1]`, `claimSource 'grammar'`). `v2.0` still omits the rule; label stays `w4a.1`.
- **Locales**: new `qc.finding.acc_band_v1_sheet3_tier_missing` (th, en); the existing `qc.finding.acc_band_v1_sheet3` text reworded from "exceeds" to "is not below" (th "ไม่ต่ำกว่า"), because a rate equal to its band fails and "exceeds" would misstate it. Same key and params; no test asserted the old text.
- **Documents**: W0-07 3.5 dated W4-06c note (the rule row) in `qc-boundary-and-mail-sink.md`.
- **Tests**: new `rules/acc-band-v1-sheet3.test.ts` (12); `decimal.test.ts` (`ratioToPercent`); `configuration/{seed,qc-rules}.test.ts` (seeded params, schema refusals); dev-split cross-check extended to four rules (7 labelled band findings reproduced, `ev-dev-04` to `ev-dev-06`; `ev-dev-07` and `ev-dev-26` on v2.0 raise none).

## Changed expectations (justified)

- `server/src/qc/content/runner.test.ts`: W4-06a/b asserted that the seeded `llm` approve-attempt selection is refused (`unknown_content_rule`) "until W4-06c". The plan makes it complete now that every selected content rule exists, so the assertion now expects `completed` with `rulesEvaluated` `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3`. The `unknown_content_rule` refusal stays tested (`ACC-NOT-BUILT`, same test).
- `server/src/configuration/validate.test.ts` (two tests) and `tests/integration/w6-03-publish-validation.test.ts` (one test) built a catalogue with a params-less `ACC-BAND-V1-SHEET3` entry to exercise `rule_template_isolated` and the problem codes. With the params schema registered (plan 3.3), the schema now refuses that entry first and the cross-kind checks never run. The entries now carry `ACC_BAND_V1_SHEET3_PARAMS`, so each test still asserts exactly what it asserted (same problem counts and codes). This is the same consequence the plan names for W4-06a's `qc-rules.test.ts`.

## Deviations

- **Tier words and band metric are params.** The plan names `params.bands` only; the tier words (English and Thai) and the banded metric (`hallucination_rate`) are also catalogue params (`tiers`, `bandMetrics`), as every other content rule's words and metric lists are (decision 10: the lists are configuration, not code). Seed values are the W4-09a dev vocabulary plus Thai equivalents (WA-D09, provisional).
- **Unrecognised tier = missing tier.** A `tier` field whose word is in no tier list (for example `critical`) cannot be banded, so it raises the tier-missing finding, like an absent or empty field. The message says "no recognised risk tier".
- **Which claims are judged.** Plan: "a `hallucination_rate` value". Chosen: a claim on the hallucination item (as the other hallucination rules), citing a band metric, with a value that parses as percent or ratio; the answer is ignored (a stated rate is judged as stated, as W4-06b's extraction rule). A bare integer is a `count` under the plan 3.2 grammar, not a rate, and is not judged (ambiguous: 2 could mean 2% or 200%); a claim with no or an unparseable value is left to `ACC-METRIC-CITED`. A ratio whose percent would exceed 18 integer digits is not judged either (no exact param can carry it); no realistic rate is affected.
- **Template guard in the rule.** Besides selection and publish isolation, the rule itself returns nothing when the request's template is not `v1.0 Sheet3`, so a request that carries it anyway can never apply v1.0 bands to another template (L12). It still counts in `rulesEvaluated`.
- **`thresholdSource` and `threshold_source`.** The measure's `thresholdSource` is the constant `'v1.0 Sheet3'` (plan 3.3); the message param is the request's template, which is the same string whenever the rule fires, and passes `message_param_text` by the template allowance.
- **Message wording** changed for the equal case (above).
- **Paths outside the row's list** (test-only): `configuration/validate.test.ts`, `tests/integration/w6-03-publish-validation.test.ts` (params added to their band entries, above), `server/src/qc/content/runner.test.ts` (seeded selection now completes) and `fixtures/src/evaluation/content-rules.test.ts` (implemented set, band count; labels unchanged).
- **Lane environment**: `RAI_PG_TOOLS=docker-compose:rai-qc-content` in the uncommitted `.env` (the backup/restore tests need this lane's container).

## Checks

Logs under `/tmp/rai-w4-06c-acc-band-v1-sheet3-logs/`. Database `rai-qc-content` on port 55382; ports 8811/8812/8813/5192. Base `origin/main` `5f353ae`.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `decimal.test.ts` with `ratioToPercent` | fail (not exported) |
| RED: `seed.test.ts`, `qc-rules.test.ts` | fail (`ACC_BAND_V1_SHEET3_PARAMS` not exported) |
| RED: `rules/acc-band-v1-sheet3.test.ts`, `runner.test.ts`, `content-rules.test.ts` | fail (`unknown_content_rule`; implemented set) |
| GREEN: the six files above | 48/48 |
| Mutation: equal passes (`<= 0`) | 3 of 12 band tests fail |
| Mutation: template guard removed | the v2.0 test fails |
| Mutation: ratio not scaled by 100 | 3 of 12 band tests fail |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | first run 1160/1162 (the two `validate.test.ts` tests with a params-less band entry, fixed as above); then 1162/1162 |
| `npm run test:integration` | 478/478, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 1027 files scanned, 0 with the marker |
| `npm run test:browser:server` | 232 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 500 Markdown files, 1371 links, 0 broken |
| `git diff --cached --check` (root) | clean |

## Verdicts

Pending: two independent reviewer verdicts on the exact head (D03 ticket flow).
