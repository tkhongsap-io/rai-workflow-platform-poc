# Review: PACK-CONTRADICTION (W4-06d, #244)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-06d and sections 3.1-3.3. Decisions implemented: register row "W4b delegated rulings (provisional)" decisions 10 (WA-D09), 22, 28 and 30, under "Ta's delegation (2026-09-27)". D07-D10 stay open. No migration, no route, no UI, no model, no network call; synthetic data only. The runner stays unbound in every `QC_MODE` (W4-13b).

## Change

- **`PACK-CONTRADICTION`** (`server/src/qc/content/rules/pack-contradiction.ts`): submit only. For each `params.facts` entry, the grammar claims of the artifacts in that fact's `slots` whose item (`params.items` keywords, keyed by fact ID) is the fact and whose answer is `yes` or `no`. When two different artifacts state the fact with different answers: one finding, pack scope, `claimKey` = the fact ID (`findingKey` `PACK-CONTRADICTION:pack:<fact>`), owned by the pack lane of the request's mapping (`ai_coe`), severity from the catalogue, `measure` null, evidence = two entries in request (slot) order (the first statement, then the first statement of another artifact with the other answer), each with locator and `excerptHash`; message `qc.finding.pack_contradiction` `{ fact, slotA, slotB }`.
- **Cross-field params check**: `ContentRule.paramsProblems` (optional); the runner refuses params with a problem as `runner_error` / `invalid_rule_params` before any read. `packContradictionParamsProblems` (shared) refuses a fact listed twice, a fact without keywords, keywords for no fact, and a fact slot outside `params.slots`; `qcRulesBodyProblems` reports the same problems on publish.
- **Catalogue**: `PackContradictionParamsSchema` (`slots`, `labels`, `items` record keyed by fact ID `^[a-z][a-z0-9_]{0,63}$`, `facts` 1-16 of `{ id, slots }` with at least two slots 1-8, `claimSource`) in `QC_RULE_PARAMS_SCHEMAS`; seed `PACK_CONTRADICTION_PARAMS` (`slots [2, 5]`, facts `personal_data` and `external_vendor` on `[2, 5]`, keywords en `personal data` / `external vendor`, th `ข้อมูลส่วนบุคคล` / `ผู้ให้บริการภายนอก`, `claimSource 'grammar'`) as the last entry of both templates (content, submit, medium). Label stays `w4a.1`. Not routed by `model_type`.
- **Registries**: `CONTENT_RULES` and `IMPLEMENTED_RULES` (`content`, `['submit']`; W6-03 merged first) list the rule; `server/src/qc/rule-registry.test.ts` now asserts the registry's `content` entries equal `Object.keys(CONTENT_RULES)`, trigger for trigger (replacing the W6-03 test that only checked the four `ACC-*` IDs were present, which the new test subsumes).
- **Locales**: `qc.finding.pack_contradiction`, `qc.rule.pack_contradiction` (th, en), inserted in place.
- **Documents**: W0-07 3.5 dated W4-06d note (`qc-boundary-and-mail-sink.md`).
- **Tests**: new `rules/pack-contradiction.test.ts` (10: one finding per contradicting fact with the exact shape; two facts → two findings; agreeing, absent, N/A, unknown, missing slot → none; within-artifact answers; XLSX answer cell and Thai; per-fact slots; unreadable slot 2 or 5 → unavailable; trigger refusal; cross-field params refused before any read); `configuration/{seed,qc-rules}.test.ts`; `qc/select.test.ts`; `qc/rule-registry.test.ts`; dev-split cross-check now compares every submit run (3 labelled contradictions reproduced: `ev-dev-14` one, `ev-dev-15` two); `tests/evaluation/harness.test.ts` now requires the rule in the catalogue and no part mismatch.

## Changed expectations (justified)

The plan adds `PACK-CONTRADICTION` to the seeded submit selection, so tests that asserted the seeded submit selection change:

- `server/src/qc/select.test.ts`: the seeded submit selection gains `PACK-CONTRADICTION` (last, catalogue order), for every template and model type.
- `tests/integration/w4-02-rule-catalogue.test.ts`: the submit QC request of the frozen seeded revision carries `PACK-CONTRADICTION` (the deterministic runner skips it).
- `server/src/qc/content/runner.test.ts` ("only content rules run"): it used the seeded submit selection as a metadata-only list; it now filters that selection to its metadata rules and asserts they are the three W4a submit rules, so it still proves metadata rules are skipped and read no bytes.
- `tests/evaluation/harness.test.ts`: W4-08a allowed the submit content part to disagree with its labels until `PACK-CONTRADICTION` was seeded (a conditional). It is seeded now, so the test asserts the rule is in the catalogue, all 3 labelled findings are true positives and there is no part mismatch (tightened, not weakened).
- `server/src/qc/rule-registry.test.ts`: the "four ACC-* rules listed until W4b implements them" test is replaced by the plan's content-registry equality test, which covers those four IDs and more.

## Deviations

- **Params shape.** The plan names `params.facts` and `params.facts[].slots` and says every content rule lists `slots`, `labels`, `items`, `claimSource`. Chosen: `items` keyed by fact ID (the keywords, as the other rules' `items`) and `facts` as `{ id, slots }`; `params.slots` stays the runner's read set and each fact is compared only across its own slots. The consistency the schema cannot express is a cross-field check run on publish and by the runner (fail closed), through a new optional `ContentRule.paramsProblems` hook.
- **What counts as a contradiction.** Only `yes`/`no` answers state a fact; two answers inside one artifact are not a pack contradiction (plan: "two attached artifacts"). When one artifact states both answers and another states one, the finding cites the first statement in request order and the first differing statement of another artifact.
- **Evidence order and message params.** Two entries in slot order; params `slotA`/`slotB` are the two cited slots (numbers).
- **Registry test.** W6-03's test named the four `ACC-*` rules "until W4b implements them"; replaced by the equality test the plan asks for (above).
- **Paths outside the row's list** (tests and comments only): `server/src/qc/{select,rule-registry}.test.ts`, `server/src/qc/content/{runner.ts,runner.test.ts,rules/rule.ts,rules/index.ts}`, `tests/integration/w4-02-rule-catalogue.test.ts`, `tests/evaluation/harness.test.ts`, `fixtures/src/evaluation/content-rules.test.ts`, `docs/engineering/qc-boundary-and-mail-sink.md`.
- **Lane environment**: `RAI_PG_TOOLS=docker-compose:rai-qc-content` in the uncommitted `.env` (the W7-01/W7-02 backup tests need this lane's container; the first integration run failed those 6 tests with `pg_tools_container_not_found` before this was set).

## Checks

Logs under `/tmp/rai-w4-06d-pack-contradiction-seed-entry-logs/`. Database `rai-qc-content` on port 55382; ports 8811/8812/8813/5192. Branched from `origin/main` `e4c6cbe`, rebased onto `7d81ab8` (W7-16, unrelated) before push.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `pack-contradiction.test.ts`, `seed.test.ts`, `qc-rules.test.ts` | fail (`PACK_CONTRADICTION_PARAMS` not exported) |
| RED: `select.test.ts`, `rule-registry.test.ts`, `content-rules.test.ts` | fail (assertions: selection, registry, no submit runs compared) |
| GREEN: the six files above | 40/40 |
| Mutation: same-artifact pairs allowed | 1 test fails |
| Mutation: per-fact slots ignored | 1 test fails |
| Mutation: `na` counted as a statement | 1 test fails |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | first run 1258/1259 (`runner.test.ts` seeded submit selection, fixed as above); then 1259/1259 |
| `npm run test:integration` | first run 488/495 (`w4-02` submit selection, fixed as above; 6 W7-01/W7-02 backup tests: lane `.env` `RAI_PG_TOOLS`); then 495/495 |
| `npm run build && npm run check:substitute-absent` | exit 0; 1067 files scanned, 0 with the marker |
| `npm run test:browser:server` | 244 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 530 Markdown files, 1454 links, 0 broken (on the rebased head) |
| `git diff --check` (root) | clean |
| After the rebase onto `7d81ab8` (W7-16 adds docs and one unit test; DEVLOG/CHANGELOG conflicts resolved by keeping both entries): `npm run lint`, `npm run typecheck` | exit 0, exit 0 |
| After the rebase: `npm run test:unit` | 1266/1266 (W7-16's new tests included); integration and browser results above are from the pre-rebase head, which differs only by W7-16's docs and unit test |

## Verdicts

Pending: two independent reviewer verdicts on the exact head (D03 ticket flow).
