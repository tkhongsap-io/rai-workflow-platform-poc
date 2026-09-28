# Review: evaluation harness core and report (W4-08a, #237)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-08a and sections 11.2, 11.3 and 16. Decisions implemented under the register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)" (decisions 12-16, 27, 28, WA-D09). D07-D10 stay open. No migration, no route, no UI, no model, no network call; synthetic data only.

## Change

- **Pure moves out of `server/src/qc/orchestrator.ts`** (bodies unchanged; the orchestrator imports them; no existing test changed):
  - `server/src/qc/request.ts`: `runKeyOf` and `requestOf(read, caseRow, version, trigger, lane, correlationId, deadlineMs, ruleRevision, rules, uploadSlot?)`, the body of `buildRequest` after `readSlotsWithArtifacts`. `buildRequest` is now that read plus `requestOf`. Structural row types (`RequestSlotRead`, `RequestArtifactRow`, `RequestCaseRow`, `RequestVersionRow`) so no database row is needed.
  - `server/src/qc/check-result.ts`: `unavailableResult`, `checkedResult` and `callRunner`.
  - New unit tests `request.test.ts` (5) and `check-result.test.ts` (7) pin both.
- **Harness `rai-web/tests/evaluation/`**:
  - `load-set.ts`: renders the split in memory and checks it against `fixtures/src/evaluation/manifest.json`; refuses a split the set does not hold (`heldout` until W4-09b).
  - `harness.ts`: per labelled run, `requestOf` over synthetic case/version/slot rows with the seeded `qc_rules` selected by `requestRules` (a selection error records both parts `runner_error` without a call, as the orchestrator does); read handles bound to the rendered bytes; both parts (`createDeterministicQcRunner`, `createContentQcRunner` over the extractor passed in) through `callRunner` (10 000 ms, `checkedResult`); latency per part; `checkCitations` re-extracts each cited artifact (cached per content hash) and requires the request's artifact, slot and content hash and, for a locator, the excerpt hash of the segment or of the grammar claim at that locator.
  - `grade.ts` (pure): multiset match on rule, owning lane, scope (kind, slot) and evidence (slot, locator); per rule (catalogue and labelled rules, engine, in-catalogue flag) and per segment (template, model type, language, cited format or `none`) TP/FP/FN/precision/recall; unavailable handling; lane scope (decision 28); metadata kept on cases with an unreadable slot 1, 2 or 5 (decision 27); grounding; nearest-rank p50/p95/max; failures (`runner_error`, `timeout`); cost (USD micros and tokens from `engine.model`, 0 today).
  - `identity.ts`: code commit and dirty flag, runners, extractor, rules label/body sha256/derived revision, templates, model (`disabled`), dataset, grader version, thresholds sha256; `identityDigest` = sha256 of canonical JSON.
  - `report.ts`: `report.json`, `report.md`, console summary. Identities, hashes, locators and counts only.
  - `run.ts`: `npm run eval:qc -- --split dev [--out <dir>]` (default `rai-web/.local/eval/<split>/`, gitignored), real `createWorkerExtractor`; `--gate`/`--verify` refused (exit 2) until W4-08b.
  - `thresholds.json`: the section 11.3 provisional thresholds, recorded before the first run.
- **Wiring**: `package.json` `eval:qc`, `test:unit` glob `tests/evaluation/*.test.ts`; `tests/tsconfig.json` includes `evaluation/**/*.ts`. TESTING.md: eval commands and a W4b evaluation paragraph.

## First dev-split run (`npm run eval:qc -- --split dev`, real forking worker)

Dataset `qc-eval-synthetic@1 76e295b4a33d`; rules `w4a.1` body `46e82b776666…`; extractor `rai-extract/1+0.0.0`; model disabled; grader `rai-qc-eval-grader/1`; thresholds `49f09f6f02a8…`; code `f64900a` plus this branch's uncommitted change (dirty), so the digest printed (`fc2d80f6d028…`) is not an evidence identity; W4-08b/W4-14 record committed runs.

| Rule                                          | TP  | FP  | FN  | Precision | Recall |
| --------------------------------------------- | --- | --- | --- | --------- | ------ |
| ACC-BAND-V1-SHEET3                            | 7   | 0   | 0   | 1         | 1      |
| ACC-CLASSIC-ML-METRIC                         | 2   | 0   | 0   | 1         | 1      |
| ACC-EXTRACTION-NOT-HALLUCINATION              | 1   | 0   | 0   | 1         | 1      |
| ACC-METRIC-CITED                              | 12  | 0   | 0   | 1         | 1      |
| PACK-CONTRADICTION (not in catalogue, W4-06d) | 0   | 0   | 3   | n/a       | 0      |
| PACK-NA-VENDOR-DOC                            | 1   | 0   | 0   | 1         | 1      |
| PACK-SLOT-MISSING                             | 8   | 0   | 0   | 1         | 1      |
| PACK-STAGE-MISMATCH                           | 3   | 0   | 0   | 1         | 1      |

Grounded citations 23/23. Unavailable handling 357/360 parts (the three misses are the submit content parts of `ev-dev-11`, `ev-dev-22`, `ev-dev-23`, labelled `artifact_unreadable` for PACK-CONTRADICTION's reads, which complete with no rule selected until W4-06d). Foreign-lane content findings 0; metadata kept 6/6. Latency p50 0 ms, p95 47.4 ms, max 88.7 ms over 360 parts. Failures 0; cost 0. Wall clock about 5 s. Log: `/tmp/rai-w4-08a-evaluation-harness-core-and-logs/eval-qc-dev.log`.

## Deviations

- **`thresholds.json` is created here.** Section 11.2 lists it among the harness files and section 11.3 says the thresholds are recorded "before any run"; W4-08a makes the first run and hashes the file into every identity. It is data only; W4-08b evaluates it (`--gate`) and may extend it.
- **`callRunner` and `unavailableResult` moved with `checkedResult`**, so the harness applies the same deadline and throw/abort mapping as the product instead of a copy.
- **`requestOf` takes the slot read as its first argument** (instead of `tx`), so the move is the function body unchanged; the harness binds the artifacts' read handles to the rendered bytes after building (the product's empty handle stays until W4-05a).
- **Documents rendered in memory**, not read from `.local/eval-fixtures/`: the renders are checked against the committed manifest first, so the graded bytes are exactly the set identity's; no `fixtures:eval:generate` step is needed before a run.
- **Extraction limits pinned** to the `.env.example` values the plan gives W4-13b (4000 ms, 256 MB, 1 000 000 chars, concurrency 2, 25 MiB), so a report does not depend on a local `.env`.
- **Rules revision ID** is derived from the catalogue body sha256 (UUID shape), since no database revision exists in process; the report records label, body digest and this ID.
- **PACK-CONTRADICTION gap.** The labels (W4-09a) carry it; the seeded catalogue does not until W4-06d. The harness reports 3 FN and 3 part mismatches; labels are unchanged (decision 14). `harness.test.ts` asserts perfect part agreement once the rule is seeded and, until then, that every mismatch is exactly that gap. A labelled rule outside the catalogue takes the engine of the part its labels sit in.
- **Grounding definition.** A locator is grounded when the re-extracted segment at that locator, or the claim the rule's grammar reads there (an XLSX claim's excerpt is its row), hashes to the finding's `excerptHash`; an `absent` locator on a request artifact is grounded on the artifact alone; an entry with no artifact is not a citation.
- **Test seam** `HarnessOptions.runners` replaces a product runner in tests only (the boundary test uses it); the CLI never passes it.
- **Cost** is recorded in USD micros from `engine.model.costUsdMicros` (the W4-11b field), not a bare amount.
- **Code identity** `dirty` ignores untracked files (`git status --porcelain --untracked-files=no`), so a local `.env` or `.local/` does not mark a run dirty.

## Checks

Logs under `/tmp/rai-w4-08a-evaluation-harness-core-and-logs/`. Database `rai-qc-content` on port 55382; ports 8811/8812/8813/5192. Base `origin/main` `f64900a`.

| Command (from `rai-web/` unless noted)                    | Result                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| RED: `server/src/qc/{request,check-result}.test.ts`       | fail (modules missing)                                                                             |
| RED: `tests/evaluation/*.test.ts`                         | 6 files fail (modules missing)                                                                     |
| GREEN: both server files                                  | 12/12 (one expectation of mine corrected to the moved code's actual detail `finding_outside_lane`) |
| GREEN: `tests/evaluation/*.test.ts`                       | 24/24                                                                                              |
| Mutation: grounding compares `!==`                        | 2 tests fail                                                                                       |
| Mutation: grading ignores evidence                        | 1 test fails                                                                                       |
| Mutation: harness calls `runner.run` without `callRunner` | boundary test fails (hangs to the 15 s test timeout)                                               |
| `npm ci`                                                  | exit 0                                                                                             |
| `npm run lint`                                            | exit 0 (after `prettier --write tests/tsconfig.json`)                                              |
| `npm run typecheck`                                       | exit 0                                                                                             |
| `npm run test:unit`                                       | 1230/1230                                                                                          |
| `npm run test:integration`                                | 479/479, 0 skipped                                                                                 |
| `npm run build && npm run check:substitute-absent`        | exit 0; 1059 files scanned, 0 with the marker                                                      |
| `npm run test:browser:server`                             | 232 passed (10.4m)                                                                                 |
| `npm run test:browser:substitute`                         | 48 passed                                                                                          |
| `npm run eval:qc -- --split dev`                          | exit 0 (above)                                                                                     |
| `node scripts/check-links.mjs` (root)                     | 509 Markdown files, 1393 relative links checked, 0 broken                                          |
| `git diff --check` (root)                                 | clean                                                                                              |

## Verdicts

Pending: two independent reviewer verdicts on the exact head (D03 ticket flow).
