# Plan

1. Board CLAIM on `lane-a-workflow-server.md`. Change frame (this folder).
2. RED:
   - `shared/src/qc/validate.test.ts`: `claimKey` and `findingKeyOf` with the claim part; `message_param_text` patterns and the template-version allowance; `evidence_outside_request` only when `artifacts` is given; `duplicateFindingKey`.
   - `server/src/qc/content/{decimal,excerpt,claims}.test.ts`: exact comparison; hash and claim key; XLSX header/rows, DOCX/PDF pairs, Thai and English labels, answers, units.
   - `server/src/qc/content/rules/acc-metric-cited.test.ts`: fires on each missing field, never on complete evidence, `measure` null when metric or value missing, extraction metric absent, two defective claims two findings, identical claims one.
   - `server/src/qc/content/runner.test.ts` with a recording fake `Extractor`: content rules only; no bytes when nothing selected; fail-closed paths; hash mismatch, blob missing, every extraction outcome; upload slot 1 vs slot 5; approve attempts per lane (no slot-1 read for DPO and IT/Security, scanned slot 1 unavailable only for AI/COE, every finding owned by the run's lane and passing `checkOwningLane`).
   - `server/src/qc/content/module-graph.test.ts`.
   - `server/src/configuration/{seed,qc-rules}.test.ts`: `ACC-METRIC-CITED` params required and seeded.
   - `fixtures/src/substitutes/qc/scripts.test.ts`: the `storeableFindings` context drops no script finding.
   - Orchestrator: an integration case where a stub runner returns two findings with one key → `runner_error` / `duplicate_finding_key`.
   - Cross-check (`fixtures/src/evaluation/content-rules.test.ts`): on the W4-09a dev split, the runner over the in-process worker gives exactly the labelled `ACC-METRIC-CITED` findings.
3. GREEN: `shared/src/qc/{types,validate}.ts`, `shared/src/schemas/cases.ts`, `server/src/qc/content/**`, `server/src/qc/orchestrator.ts` (`checkedResult`), `server/src/configuration/seed.ts`.
4. Documents: W0-07 3.4 step 5 and 3.5 dated notes.
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-06a-content-runner-claim-grammar-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #221").
