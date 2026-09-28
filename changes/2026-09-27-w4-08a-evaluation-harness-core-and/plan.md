# Plan

1. Board CLAIM on `docs/board/lane-c-platform-substitutes.md`. Change frame (this folder).
2. RED:
   - `server/src/qc/request.test.ts`: `requestOf` shape for submit, approve attempt and upload (one slot), draft lane-mapping fallback, missing mapping throws, `runKeyOf` order-independent and input-sensitive.
   - `server/src/qc/check-result.test.ts`: passthrough; invalid engine identity; a finding violation and a duplicate key keep the engine; an unavailable result passes; `callRunner` maps a throw to `runner_error` and an abort to `timeout`.
   - `tests/evaluation/{load-set,grade,identity,report,harness,run}.test.ts`: loading and split refusal; grading counts, precision/recall, segments, unavailable handling, lane scope, latency percentiles; identity digest sensitivity; report carries no text; full dev run with an in-process extractor (both parts per labelled trigger, grounding 1.0 on the implemented rules); CLI argument handling.
3. GREEN: move `runKeyOf`/`buildRequest` body to `server/src/qc/request.ts` and `unavailableResult`/`checkedResult`/`callRunner` to `server/src/qc/check-result.ts`; orchestrator imports. Write `tests/evaluation/{load-set,harness,grade,identity,report,run}.ts` and `thresholds.json`; `package.json` scripts; `tests/tsconfig.json`.
4. Run `npm run eval:qc -- --split dev` (real worker extractor) and record the summary.
5. TESTING.md eval commands.
6. Full gate, one suite at a time, logs under `/tmp/rai-w4-08a-evaluation-harness-core-and-logs/`.
7. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #237").
