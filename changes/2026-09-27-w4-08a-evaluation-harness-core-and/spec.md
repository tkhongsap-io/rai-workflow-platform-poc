# Specification

Source: W4b plan section 15 row W4-08a ("`eval:qc --split dev` runs both parts per trigger and prints per-rule and per-segment metrics, grounding and identities; no text in the report; check-result and request extraction are pure moves with tests unchanged") and sections 11.2, 11.3 and 16. The plan wins over issue #237.

Done when:

1. **Pure moves.**
   - `server/src/qc/request.ts` exports `runKeyOf` and `requestOf(read, caseRow, version, trigger, lane, correlationId, deadlineMs, ruleRevision, rules, uploadSlot?)`: the body of `buildRequest` after `readSlotsWithArtifacts`, unchanged (upload carries its one slot; a draft uses the current lane mapping; a submitted version without one throws; artifacts carry the empty read handle W4-05a replaces). `buildRequest` in `qc/orchestrator.ts` becomes the read plus this call.
   - `server/src/qc/check-result.ts` exports `unavailableResult`, `checkedResult` and `callRunner`, unchanged; the orchestrator imports them.
   - No existing test changes; new unit tests pin both modules.
2. **Load** (`tests/evaluation/load-set.ts`). `loadEvalSet('dev')` renders every document of the split in memory, checks the renders against `fixtures/src/evaluation/manifest.json` (a mismatch refuses), and returns each case with its labels and its documents by slot. A split the set does not hold (today `heldout`) is refused.
3. **Run** (`tests/evaluation/harness.ts`). For every labelled run of every case:
   - the request is built with `requestOf` from synthetic case, version and slot rows (all nine slots; upload keeps its slot), with the seeded `qc_rules` catalogue selected by `requestRules`, and each artifact's read handle bound to its rendered bytes;
   - both parts run on that request: the deterministic runner and `createContentQcRunner` with the extractor passed in (the CLI passes the real forking worker extractor with the `.env.example` limits);
   - each result goes through `callRunner` (so `checkedResult` and the 10 000 ms deadline apply) and its latency is measured;
   - an unknown template (rule selection error) records both parts `runner_error` without calling a runner, as the orchestrator does.
4. **Grade** (`tests/evaluation/grade.ts`, pure). A finding matches a label on `ruleId`, owning lane, scope (kind and slot) and evidence (slot and locator position); multiset matching. Reported:
   - per rule (every catalogue rule and every labelled rule, with its engine and whether the catalogue has it): TP, FP, FN, precision, recall (null when undefined);
   - per segment (template, model type, language, format of the cited document): the same counts;
   - unavailable handling: every part's status and reason against its label; accuracy overall and on labelled-unavailable parts; mismatches by identity;
   - lane scope (decision 28) and metadata kept beside an unavailable content part (decision 27), as counts;
   - grounded citations: every evidence entry with an artifact must name an artifact of the same request (slot and content hash), and when it has a locator its `excerptHash` must equal the hash of the text re-extraction yields at that locator (the segment, or the claim the grammar reads there); rate overall and per rule;
   - latency p50, p95 and max per part and overall; failure count (`runner_error`, `timeout`); cost (0, no provider; model token counts if any).
5. **Identity** (`tests/evaluation/identity.ts`). Code commit (and whether the tree is dirty), runner names and versions, extractor version, rules label, body sha256 and the derived revision ID, template versions, model (`disabled`, prompt revision null), dataset (`qc-eval-synthetic@1 <sha256[0:12]>`, full sha256, split), grader version, thresholds sha256; `identityDigest` = sha256 of the canonical JSON of the rest. Any change of any part changes the digest.
6. **Report** (`tests/evaluation/report.ts`). `report.json` and `report.md` in the output directory hold identities, hashes, locators and counts only: no document text, filename, finding message or param. A unit test runs the full dev split and asserts that no text line, claim line or filename of any document appears in either file.
7. **CLI** (`tests/evaluation/run.ts`, `npm run eval:qc`). `--split dev` (default `dev`), `--out <dir>` (default `rai-web/.local/eval/<split>/`). Prints the dataset label, identity digest, per-rule and per-segment tables, grounding, unavailable handling, latency, failures, cost and the paths written. `--gate` and `--verify` are refused with a pointer to W4-08b; unknown arguments exit 2.
8. **Thresholds** (`tests/evaluation/thresholds.json`). The provisional thresholds of section 11.3, recorded before the first run and hashed into the identity; evaluated by W4-08b.
9. **Wiring.** `package.json` `eval:qc` = `NODE_ENV=test node --import tsx --conditions=rai-source tests/evaluation/run.ts`; `test:unit` adds `'tests/evaluation/*.test.ts'`; `tests/tsconfig.json` includes `evaluation/**/*.ts`. TESTING.md gains the eval commands.
10. The plan's full gate (section 16) is green; `npm run eval:qc -- --split dev` exits 0 and its summary is recorded in review.md.
