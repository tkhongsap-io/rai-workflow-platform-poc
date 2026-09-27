# Review: upload-trigger QC on the save-draft attach (W4-04, #188)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4a plan](../../docs/engineering/implementation-plan-w4a.md) section 5 (commands: section 8; amendments: section 12), with the plan-review notes on the ticket. Decisions implemented: register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings" (Ta, 2026-09-26). Human-review-required: it touches immutability (where a late run may land), the Ready gate (a carried outage) and shutdown (the drain). Synthetic data only; no document parsing, model, provider or network call. Rule outcomes are provisional until D09.

## Change

- **`shared/src/constants.ts`**: `unavailableOwningLane` is overloaded. `LaneRun` (submit, approve attempt) returns `Lane`, so existing callers keep a non-null type. `UploadRun` (`{ trigger: 'upload', slot }`) returns `Lane | null`. Slots 1-4 and 6-8 give the slot's single lane. Slot 5 gives `UPLOAD_SLOT5_OUTAGE_LANE = 'ai_coe'` (register row "D05 refinement (upload slot 5 and 9)"). Slot 9 gives `null`, meaning no run. The function no longer throws for slots 5 and 9. It still needs a mapping for upload.
- **`server/src/qc/orchestrator.ts`**:
  - New `runAndPersistUploadQc(deps, { caseId, versionId, slot, correlationId })`. Slot 9 returns `undefined` and writes nothing.
  - New `loadUploadTarget` accepts two targets under the case lock: the case's open draft, or a submitted row, which it hands to `loadOpenSubmittedTarget` unchanged (Ready → `version_closed`; send-back → `version_closed`; later version → `version_superseded`). A draft row that is no longer the open draft is `version_superseded`.
  - The first transaction only reads. It builds the request: the one uploaded slot and its artifact; the `qc_rules` revision from `ruleContextOf` (in force at the upload instant for a draft); rules selected for `upload`; the current lane mapping when the row has none frozen.
  - The in-flight table (`uploadFlights`) is keyed by `request.runKey` (W0-07 3.7). Upload never calls `replayPrior`.
  - The persist transaction re-checks the target under the lock. On a `StaleVersionError` it calls `recordLate`: a Ready version gets a `qc_late_result` row and `qc.run.late`. A send-back-closed version is refused and nothing is written.
  - `recordRun` writes `slot` for upload runs (`lane` stays `NULL`). The `qc.run_recorded` audit `target_ref` carries `slot` for upload.
  - `outageOwningLane(request)` replaces the inline lane choice for the QC-UNAVAILABLE finding. For upload it calls `unavailableOwningLane` with the request's mapping.
  - An upload outage reuses the open finding per version and owning lane. `buildRequest` gains an `uploadSlot` parameter.
  - `shareFlight` is split into `contextOf` and `inFlight`. Submit and approve-attempt keys are unchanged.
- **`server/src/findings/repository.ts`**: `findLatestUnavailableFinding` takes an optional `owningLane` filter. The reuse key is `QC-UNAVAILABLE:run:upload:<owningLane>`.
- **`server/src/pack/qc-trigger.ts`**:
  - `createUploadTrigger(deps)` checks slot 9 before calling the orchestrator.
  - It swallows `StaleVersionError`: a late or closed result is an expected race that the orchestrator records itself. Any other error goes to the service's `error.captured`.
  - `noopUploadTrigger` stays (used by `w1-04-pack-draft.test.ts`'s injected hook and as the default).
- **`server/src/pack/service.ts`**: `PackServiceDeps.drain` (optional). `fireUploadTriggers` tracks each fired promise on it. The response still returns before the trigger runs.
- **`server/src/app.ts`**:
  - `AppDeps.pack` gains `qc?: QcBinding`. When it is set, `createUploadTrigger` is bound here, next to the submit trigger.
  - The drain is injected into the pack routes.
  - Without `qc`, `uploadTrigger` (default no-op) is the hook.
- **`server/src/compose-app-deps.ts`**: `pack.qc = { runner }` when a runner is bound (see Deviations).
- **`server/src/observability/operator.ts`**: `unavailableQc` derives `owningLane` for an upload run from `qc_run.slot` and the version's `lane_mapping_version`. A draft has none frozen, so it uses the current constant. Slot 5 gives AI/COE; an unknown mapping or slot gives no lane.
- **Substitute**:
  - The `upload` entries leave `fixtures/src/substitutes/qc/scripts/fx-case-nonvendor.json` and `fx-case-vendor.json`.
  - `scripted-runner.test.ts`: the test "upload trigger returns only the findings on the uploaded slot" is replaced by two tests:
    - no bundled script has an `upload` entry, and an upload request on each scripted fixture case (slots 1, 5 and 6) completes with zero findings and `rulesEvaluated: []`;
    - the slot scoping, tested with an inline script that re-adds the old entry.
  - `scripts.test.ts`: schema conformance asserts no bundled entry is `upload` and drops `uploadSlot`. The owning-lane test's floor goes from `count >= 8` to `count >= 7` (9 scripted findings before, 7 after).
  - `scripted-runner.ts` is unchanged: an unscripted trigger still answers zero findings.
- **`tests/support/fixture-app.ts`**: `diagnostics` also exposes `drain`, and the harness closes each app through its drain (once per app) instead of `fastify.close()`. Background upload runs therefore settle before the next reset.
- **Docs**: dated W4-04 amendments in W0-07 (`qc-boundary-and-mail-sink.md`):
  - end of 3.2: run fields, target, where the result lands;
  - end of 3.6: the owner of an upload outage, the slot-5 and slot-9 rule, the reuse key, the Ready gate, the operator view;
  - end of 3.9: the bundled scripts carry no `upload` entry.
- **Tests**:
  - `shared/src/constants.test.ts`: the upload assertions for slots 5 and 9 changed from "throws" to `ai_coe` and `null`, per the register row (see Deviations). A new test covers all nine slots and the non-null overload.
  - `tests/integration/w4-04-upload-trigger.test.ts` (new, 10 tests, fixture app with a synthetic `upload-probe` runner held by a gate where timing matters):
    - one run per changed attach (`lane` NULL, `slot` 1, the save's correlation id; the request carries one slot, `isDraft`, `lane-mapping/v1`), and none on an unchanged save;
    - two attaches in one save run separately (different `runKey`);
    - slot 9 writes no `qc_run` row;
    - the save response returns while the run is held, and `drain.close()` waits for it;
    - outages on slots 2, 2, 5 and 7 give four runs and three findings (dpo reused, ai_coe for slot 5, it_security), and desk health names the same lanes;
    - a run released after submit appends to the submitted version (same row id);
    - an upload outage carried into the version keeps Ready unset after three approvals, and the DPO's waiver releases it;
    - Ready then release: no run, no finding, `ready_at` unchanged, one `qc_late_result` row (`upload`, lane null) and one `qc.run.late` line, no `error.captured`;
    - send-back then release: no run, no late row, no `error.captured`;
    - with the deterministic runner, an upload run records `rules_evaluated = 0` and no finding.
  - `tests/integration/w4a-int-deterministic-server.test.ts` (+1, real server, `QC_MODE=deterministic`): a save-draft attach over HTTP on `fx-case-vendor` yields exactly one `qc_run` on the draft: `upload`, slot 1, lane null, `deterministic`, the server version, `completed`, `rules_evaluated = 0`, the save's correlation id. There is no finding, and `qc.run.started` has `trigger: 'upload'`.

## Deviations

- **No upload run when no runner is bound.** `compose-app-deps.ts` binds the upload trigger only when a runner is bound. The plan is silent on this case.
  - When is no runner bound? Since W4-13 `start.ts` always binds one, except under `QC_MODE=substitute` without the fixtures package (readiness `disabled`); the integration harness also runs without one when a suite binds none.
  - Why skip the run? In that case the submit run already records `not_configured` with an AI/COE outage finding that gates Ready (A08). Unbound upload runs would only stack identical `not_configured` rows on every attach. The approve-attempt path already avoids that for an unbound runner (`replayPrior`).
  - The orchestrator itself still records `unbound` / `not_configured` if called without a runner. This is the smallest option consistent with A08. Reviewers may prefer the other one.
- **Existing test expectations changed by the plan or register.**
  - `shared/src/constants.test.ts` expected `unavailableOwningLane` to throw for upload on slots 5 and 9. The register row now fixes AI/COE and "no run".
  - `fixtures/src/substitutes/qc/scripted-runner.test.ts` and `scripts.test.ts` asserted the bundled upload entries that plan section 5 removes. The slot-scoping behaviour they covered is still tested with an inline script.
  - No integration or browser test changed its expectation: `npm run test:integration` (all 357 earlier tests) and both browser suites pass unchanged. No suite asserted an upload finding. CI binds the substitute, whose upload answer is now a clean zero-finding run. That run adds a `qc_run` row with `trigger = 'upload'` on any re-attach, and no existing assertion counts those.
- **Integration harness.** `tests/support/fixture-app.ts` now closes apps through the drain, so a test's background upload run cannot race the next test's reset. `diagnostics` exposes the drain for the drain test. Every suite passes unchanged.
- **The artifact a run evaluates.** The request is built from the slot as it is when the run starts, under the case lock, not from the event's `artifactId`. If a later save changes the slot again before the run starts, that save fires its own run. The row that will be frozen is what QC reads.
- **Audit.** The `qc.run_recorded` audit `target_ref` of an upload run carries `slot`, beside `run_id`, `trigger` and `finding_count`. W0-06 9.4 lists the action without fixed fields. No log line gains a field: W0-10 is unchanged, because `qc.run.*` has no `slot` field and this ticket is not assigned a catalogue change.

## Commands and results

Worktree `/tmp/rai-w4-04-upload-trigger`, Postgres project `rai-w4a` on 55380, `rai-web/.env` from `.env.example` with the ports rewritten (8797/8798/8799/5185) and `QC_MODE=deterministic` (the default). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w4-04-upload-trigger-logs/`.

| Command (from `rai-web/` unless noted)                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test shared/src/constants.test.ts fixtures/src/substitutes/qc/*.test.ts` | 34/38. The upload slot-5 test fails with the old "defined with upload QC (W4)" throw. The two substitute tests and schema conformance fail on the bundled `upload` entries (`duplicate_entry` for the inline script, `actual: 'upload'`).                                                                                                                |
| RED: same runner with `--test-concurrency=1`, `tests/integration/w4-04-upload-trigger.test.ts`                                                                     | First run: the module had no `runAndPersistUploadQc` export. With the orchestrator function but the trigger unbound: "expected 1 upload runs, saw 0", and the gated test waited on a run that never came (the helper then got a 5 s limit). With the trigger bound: 9/10, and the desk-health lanes were `undefined` until `operator.ts` handled upload. |
| RED: same runner, `tests/integration/w4a-int-deterministic-server.test.ts`, with the `compose-app-deps.ts` binding reverted                                        | 4/5; "the upload run did not complete within 10 s"                                                                                                                                                                                                                                                                                                       |
| `npm ci`                                                                                                                                                           | exit 0                                                                                                                                                                                                                                                                                                                                                   |
| `npm run lint`                                                                                                                                                     | exit 0 (eslint, prettier check, check-css). The first run flagged one unnecessary non-null assertion in the new test; fixed.                                                                                                                                                                                                                             |
| `npm run typecheck`                                                                                                                                                | exit 0. The first run flagged an untyped `fields` index in the real-server test; fixed.                                                                                                                                                                                                                                                                  |
| `npm run test:unit`                                                                                                                                                | exit 0, 642/642                                                                                                                                                                                                                                                                                                                                          |
| `npm run test:integration`                                                                                                                                         | exit 0, 368/368 (357 before + 10 in `w4-04-upload-trigger.test.ts` + 1 real-server upload test)                                                                                                                                                                                                                                                          |
| `npm run build && npm run check:substitute-absent`                                                                                                                 | exit 0; `scanned 675 files, 0 with the marker`                                                                                                                                                                                                                                                                                                           |
| `npm run test:browser:server`                                                                                                                                      | exit 0, 196 passed (7.6 min)                                                                                                                                                                                                                                                                                                                             |
| `npm run test:browser:substitute`                                                                                                                                  | exit 0, 48 passed (30.5 s)                                                                                                                                                                                                                                                                                                                               |
| `node scripts/check-links.mjs` (repo root)                                                                                                                         | exit 0; 353 Markdown files, 955 relative links, 0 broken                                                                                                                                                                                                                                                                                                 |
| `git diff --check` (repo root, staged)                                                                                                                             | exit 0                                                                                                                                                                                                                                                                                                                                                   |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow). Ta reviews the W4a exit record.
