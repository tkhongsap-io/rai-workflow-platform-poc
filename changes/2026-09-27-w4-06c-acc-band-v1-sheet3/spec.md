# Specification

Source: W4b plan section 15 row W4-06c and sections 3.1-3.3 (decisions 10, 11, 26, 28 and 30). The plan wins over issue #236.

Done when:

1. **`ACC-BAND-V1-SHEET3`** (`server/src/qc/content/rules/acc-band-v1-sheet3.ts`), trigger `approve_attempt` only. A claim of the grammar whose item (`params.items`) is `hallucination`, whose `metric` field, as a metric ID, is in `params.bandMetrics` (seed `['hallucination_rate']`) and whose `value` parses as a `percent` or a `ratio` (plan 3.2; a stated `unit` word wins) is judged:
   - its rate in percent is the value itself (`percent`) or the value × 100, computed exactly on the decimal string (`ratio`; `decimal.ts` `ratioToPercent`);
   - its tier is the `tier` field matched (NFC, case fold) against `params.tiers` (`high`, `medium`, `low`, English and Thai words);
   - with a tier: a finding when the rate is **≥** `params.bands[tier]` (`compareDecimal`, strict less-than passes, so equal fails);
   - with no tier or an unrecognised one: a finding with message `qc.finding.acc_band_v1_sheet3_tier_missing`, whatever the rate.

   A claim with no value, a value that does not parse, or a `count` value is not a rate and is left to `ACC-METRIC-CITED`. The answer does not matter (a stated rate is judged as stated).
2. **Finding shape.** One finding per judged claim (decision 30): artifact scope, `claimKey` = the first 16 hex characters of the claim's `excerptHash`, evidence = the claim's locator plus `excerptHash` (identical claim text merged, one evidence entry per occurrence), severity from the catalogue (`high` in the seed), owned by the run's lane. `measure` = `{ metric: <the cited metric ID>, value: <rate in percent>, denominator: <stated number or null>, threshold: <band, or null when the tier is missing>, unit: 'percent', thresholdSource: 'v1.0 Sheet3' }`. Message `qc.finding.acc_band_v1_sheet3` with params `{ slot, tier, value, threshold, threshold_source, item? }` (`value` and `threshold` exact decimal strings in percent, `threshold_source` the version's template, `item` only as an item reference); the tier-missing message carries `{ slot, value, threshold_source, item? }`. Both pass `validateQcFinding` (`message_param_text`).
3. **Template isolation (L12).** The rule raises nothing when the request's `checklistTemplateVersion` is not `v1.0 Sheet3`; the seed's `v2.0` template still omits it, `selectRules` never selects it there, and publishing it under `v2.0` stays refused (`rule_template_isolated`).
4. **Lane scope.** Seeded `params.slots` is `[1]`: a DPO or IT/Security approve attempt reads no bytes for it and emits nothing (decision 28); every finding on an AI/COE attempt is owned by `ai_coe` and passes `checkOwningLane`. `model_type` routing is unchanged (`classic_ml` never selects it).
5. **Catalogue.** `QC_RULE_PARAMS_SCHEMAS` gains `AccBandV1Sheet3ParamsSchema` (`slots`, `labels`, `items: { hallucination }`, `bandMetrics`, `tiers: { high, medium, low }`, `bands: { high, medium, low }` as non-negative decimal strings, `claimSource`), additional properties refused. The seed's `v1.0 Sheet3` entry carries `ACC_BAND_V1_SHEET3_PARAMS` (`bands { high: '1', medium: '2', low: '3' }`, `claimSource 'grammar'`); label stays `w4a.1`; "every seed body validates" stays green. Tests that build a catalogue with a params-less band entry get the seeded params.
6. **Runner.** `CONTENT_RULES` lists the rule. The seeded `llm` approve-attempt selection now completes (the W4-06a/b assertion that it is refused is replaced; the `unknown_content_rule` refusal stays tested with an unknown rule ID).
7. **Locales.** `qc.finding.acc_band_v1_sheet3_tier_missing` in th and en (sorted).
8. **Cross-check.** On the W4-09a dev split, the content runner reproduces exactly the labelled findings of every implemented content rule (now four, including `ev-dev-04` to `ev-dev-06` band cases and `ev-dev-07` v2.0).
9. **Documents.** A dated W4-06c note on W0-07 3.5 (the rule row).
10. The plan's full gate (section 16) is green.
