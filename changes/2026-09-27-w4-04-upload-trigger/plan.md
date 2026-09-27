# Plan

1. Board CLAIM (lane A). Change frame (this folder).
2. RED:
   - `shared/src/constants.test.ts`: upload slot 5 → `ai_coe`, slot 9 → `null` (replaces the "throws for slot 5 and 9" expectations, which the register row changes).
   - `fixtures/src/substitutes/qc/scripted-runner.test.ts`, `scripts.test.ts`: no bundled script has an `upload` entry; an upload request on a scripted fixture case completes with zero findings; slot scoping stays tested with an inline script.
   - `tests/integration/w4-04-upload-trigger.test.ts` (new, fixture app with a gated test runner and the deterministic runner): the cases of spec item 10.
   - `tests/integration/w4a-int-deterministic-server.test.ts`: an attach over HTTP yields one upload run, `lane` null, `slot` set, `rules_evaluated = 0`.
3. GREEN:
   - `shared/src/constants.ts`: `unavailableOwningLane` overloads.
   - `server/src/qc/orchestrator.ts`: `loadUploadTarget`, upload-scoped `buildRequest`, `runAndPersistUploadQc` (runKey in-flight key, no replay, slot on the run row, per-lane outage reuse, late / closed handling).
   - `server/src/findings/repository.ts`: `findLatestUnavailableFinding` optional owning-lane filter.
   - `server/src/pack/qc-trigger.ts`: `createUploadTrigger` (slot-9 check, stale refusals not reported as internal errors).
   - `server/src/pack/service.ts`: `fireUploadTriggers` tracked on an optional drain.
   - `server/src/app.ts`: `pack.qc` binds the upload trigger with the drain; `compose-app-deps.ts` fills `pack.qc` when a runner is bound.
   - `server/src/observability/operator.ts`: owning lane of an unavailable upload run.
   - `tests/support/fixture-app.ts`: expose the drain; close apps through the drain so background upload runs finish before the next reset.
   - Substitute scripts: remove `upload` entries.
4. Docs: W0-07 3.2, 3.6, 3.9 dated amendments.
5. Full plan section 8 gate, one suite at a time, logs under `/tmp/rai-w4-04-upload-trigger-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #188").
