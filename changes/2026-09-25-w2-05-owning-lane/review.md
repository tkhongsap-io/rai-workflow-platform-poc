# Review: W2-05 owning-lane rule (#35)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md), written before any change. Decision: Ta accepted the five recommendations of the [#35 brief](../2026-09-23-w3-hardening/issue-35-decision-brief.md) on 2026-09-25 and approved the register row's wording in the same session; the row "D05 refinement (#35)" in [decisions.md](../../docs/product/decisions.md) is the record. Synthetic data only; no other decision touched.

## 1. What changed

- `@rai/shared/constants`: `owningLaneRule(scope, mapping)` and `unavailableOwningLane(run, mapping)` replace `owningLaneForSlot`; `PACK_OWNING_LANE = 'ai_coe'`.
- `@rai/shared/qc/validate`: `checkOwningLane(finding, mapping, runLane)`; violations `owning_lane_slot_informational` and `finding_outside_lane`; `owning_lane_rule_pending` is gone.
- Orchestrator: an `unavailable` run stores the W0-07 3.6 `QC-UNAVAILABLE` finding (`kind = unavailable`, `slot = null`, severity `high`) owned per W0-06 7.2, once per open scope (`findLatestUnavailableFinding`); the lane-QC route and the replay carry it in the run body.
- W1-10 substitute: accepts slot-5 and pack-level `defect` findings with the recorded lane; refuses slot 9; scripts one of each on `fx-case-missing-slot`; locale key `qc.finding.pack_stage_mismatch`.
- No migration: `qc_finding` already allowed `kind = 'unavailable'` and `slot IS NULL`.
- No UI change: the reviewer workspace already lists every stored finding owned by the viewing lane under the outage notice; a browser test now proves it.
- Documents: W0-06 7.1-7.4 and its summary rows; W0-07 line 14, 3.4 steps 5-6, 3.5, 3.6, 3.9; BUILD_PLAN and README status lines; the brief and the walkthrough script note the outcome.

## 2. Commands and results

Worktree `/tmp/rai-w2-05` from `origin/main` `2d6cf13`, Postgres compose project `rai-w2-05` on 55370, `.env` from `.env.example` with the ports rewritten, `DATABASE_OPERATOR_URL` and `OBS_MIGRATION_ADMIN_URL` set as CI sets them. Suites run in full on head `5c738ea` (PR #159) and again in full on the round-2 head after the review fixes; the counts below are the round-2 run (the round-1 run differed only by the two integration tests added since: 327 then). Run serially, one suite at a time on the database (an earlier overlap of two suites on one database produced spurious failures; see section 4).

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm run migrate` | applied 9 migration(s), 0 already applied |
| `npm run lint` | exit 0 (eslint, prettier, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 582 tests, 582 pass, 0 fail, 0 skipped |
| `npm run test:integration` | 329 tests, 329 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | build exit 0; scanned 595 files, 0 with the marker |
| `npm run test:browser:server` | 193 passed (7.6m), 0 failed, at 1440, 834 and 390 px |
| `npm run test:browser:substitute` | 48 passed (30.3s) |
| `node --test tests/*.test.mjs` (root) | 22 tests, 22 pass |
| `node --test scripts/*.test.mjs` (root) | 18 tests, 18 pass |
| `node scripts/check-links.mjs` (root) | 293 Markdown files, 804 relative links, 0 broken (at the PR head; 801 before this review record's own links were added) |
| `node scripts/check-frozen-source.mjs` (root) | source-spec sha256 `92c4f712…` matches |
| `git diff --check` (root) | clean |

## 3. Reviewer verdicts

Two independent reviewer agents (Claude Opus, fresh context each) posted on PR #159.

| Round | Head | Correctness and tests (whole branch) | Contract, security, simplicity |
|---|---|---|---|
| 1 | `5c738ea` | PASS; minors: an unknown mapping version threw while storing the outage finding (less fail-closed than main), an extra lookup on the replay path, three test gaps (audit `finding_count` on reuse; a later completed run leaves the finding open; the late path writes no finding), stale W0-07 lines | BLOCKING on records: stale W0-07 text (46, 192, 221, 239, 261, 556), two ledger rulings missing here, link count 801 vs 804, walkthrough step 2 and bullet wording; non-blocking: silent AI/COE fallback for an approve attempt with no lane, W0-06 7.3 stating `finding_outside_lane` for slot 5 only, no 403 test for a non-owning lane or Admin on the outage finding, two type imports from one module |
| 2 | (round-2 head) | pending | pending |

Round-1 fixes: `unavailableOwningLane` needs the mapping only for an upload run and the orchestrator no longer throws on an unknown mapping; an approve attempt with no lane throws instead of falling back to AI/COE (unreachable by type); the `qc.run.unavailable` log line carries the finding's `owningLane` (W0-10 3.3); three regression pins and the 403 test were added; the stale W0-07 and W0-06 text, the walkthrough wording and this record were corrected. Deferred as minors: the replay path's extra lookup; `scripts.ts` repeating the lane branching rather than calling `checkOwningLane` (a `ScriptedFinding` is not a `QcFinding`).

## 4. Rulings and exceptions

Decisions taken during execution, each with its cost if wrong. None changes the recorded rule.

- **Worktree by `git worktree add` at `/tmp/rai-w2-05`** rather than the app's managed worktree: the approved plan names the path and a per-change Postgres, the hardening convention. Cost: cleanup is manual.
- **No true integration baseline.** The baseline run started after Task 1 had removed `owningLaneForSlot`, so it measured the edit, not `main`; the reference is main's CI run 36041409928 and the hardening's clean-checkout 316/316. Cost: an environment failure could have been misread; the serial Task 9 run (327/327) is the record.
- **The validator unit test's base fixture is slot 7 / IT-Security**, not slot 1 / AI-COE as the plan assumed; the test values were adapted, the cases are the same. Cost: none.
- **After Task 2 the typecheck also failed in `orchestrator.ts` and `scripted-runner.ts`** (the `checkOwningLane` arity), not only in `scripts.ts` as the plan said; both were Task 3/4 files and were fixed there. Cost: none.
- **`findLatestUnavailableFinding` lives in `findings/repository.ts`** beside `latestDisposition`, not in `qc/repository.ts` as the plan said: `findings/repository.ts` already imports `qc/repository.ts`, and the plan's placement would have made an ESM cycle. Cost: one import path.
- **The lane-QC route built its unavailable body with `findings: []`**; it now passes the outcome's findings through. Cost: none; the response schema already typed the array.
- **Three scripted-runner unit tests and one W2-05 integration test encoded the old posture** (one finding on that submit; a pack finding throws; a slot-5 finding is invalid; the late-finding test used a slot-5 finding). Each was updated with the spec citation; the construction guard is now proven with slot 9 and the late test with a lane mismatch, so no test lost its intent.
- **The W2-05 invalid-finding loop was reordered** so the refused case runs before the slot-5 case on the same lane: a completed approve-attempt run replays for the next case (W0-07 3.7), which would have masked the mismatch.
- **Two suites on one database.** The first run of the new integration file overlapped with the background full run on Postgres 55370; both truncate the same tables. The three failures (an owner submit 403, two fixture-reset duplicate keys) vanished on a serial rerun (9/9; the slot-9 case 1/1 alone), and the one failure in that background run (`w3-int-browser-lifecycle`, 500 on a built child) passed 10/10 alone on a settled build. Rule: one suite at a time per database; Task 9 ran serially.
- **No UI code change.** The reviewer workspace already lists every stored finding owned by the viewing lane under the outage notice (`laneFindings` over GET …/findings, loaded after the run). The view-model unit test the plan named was dropped for a browser test that proves it end to end at three widths.
- **`w2-int-09-disposition.spec.ts` changed expectation** (Done-when 7): `fx-case-missing-slot` now raises the AI/COE pack-level finding on submit and the DPO's slot-5 finding on its approve attempt, so the journey lists both, has each owning lane waive its finding by API, and sorts the list before comparing because the two submit findings share a timestamp. The reason is in the test's comments.

## 5. Remaining boundaries

- Upload-triggered QC does not exist in slice 1, so the slot-5 and slot-9 upload sub-case of part 4 is defined with upload QC (W4). `unavailableOwningLane` throws rather than guesses for it.
- With no runner bound (`QC_MODE=none`), every submit and every approve attempt now stores a `QC-UNAVAILABLE` finding its lane must disposition before Ready. That is W0-07 3.6 as written, not a new choice; in fixture mode with the substitute bound it happens only on a simulated outage.
- `PACK-CONTRADICTION` has the rule but no fixture; nothing in slice 1 needs one.
- W2-05 closes #35 and epic #53 on merge. W4-W8 remain unauthorized.
