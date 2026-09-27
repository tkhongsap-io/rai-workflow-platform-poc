# Build board — Lane C: platform and substitutes

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W1-10 merged
- What: QC substitute: scripted findings by version ref, unavailable, timeout, QC_RUNNER=none, provable no write path. PR #69.
- Why: Ticket W1-10 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/69

## 2026-09-21 (time not recorded) — W1-11 merged
- What: Mail-sink substitute: four inputs, delivery status, forced failure, dedup key, provable no external mail path. PR #68.
- Why: Ticket W1-11 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/68

## 2026-09-21 (time not recorded) — W1-12 merged
- What: CI workflow (11 jobs: unit, integration on Postgres, lint, typecheck, build, link check, frozen-source hash, demo suite, browser/Playwright) and local harness scripts; altered-snapshot hash test. PR #70.
- Why: Ticket W1-12 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/70

## 2026-09-21 (time not recorded) — W1-09 merged
- What: Synthetic fixture set slice1-synthetic@1 (5 cases, 33 generated documents incl. Thai-named file, dual-role SPOC case), fixtures:generate/load, denylist test; migration renumbered to 0002 after the W1-01 collision. PR #72.
- Why: Ticket W1-09 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/72

## 2026-09-21 (time not recorded) — W1-12 merged
- What: Browser job green on main: Playwright web server now builds the fixtures workspace (server refused with fixture_outside_test on clean checkouts), and the harness spec asserts the fixture sign-in route W1-01 added. Found by independent review. PR #75.
- Why: Ticket W1-12 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/75

## 2026-09-21 (time not recorded) — W1-13 merged
- What: Dev/test-only in-memory API substitute serving every 7.2-7.6 shape from the fixture set with the W0-06 error envelope; absent from the production build; 61 new tests. PR #77.
- Why: Ticket W1-13 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/77

## 2026-09-21 (time not recorded) — W1-13 merged
- What: Lint green on main: StageContextSchema spelled out as a literal tuple (byte-identical JSON schema); the substitute contract-cast helpers are identity functions. PR #79.
- Why: Ticket W1-13 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/79

## 2026-09-22 13:40 — W1-10 substitute onto main
- What: Copy the already-reviewed QC substitute from `codex/w1-00-qc-shared-contract` onto main. The fixture index keeps its current exports and adds `qcSubstitute`. Contract files from PR #74 were already on main and were not recopied.
- Why: W2-05 depends on W1-10. PR #69 merged into the side branch only, so `main` had no runner to feed.
- Next: W2-05 disposition contract for single-lane findings. §7.3 categories stay blocked.
- Author: operator=ta session=w2 model=grok-4.7
- Evidence: branch codex/w1-10-qc-substitute-on-main

## 2026-09-22 14:20 — CLAIM W2-10
- What: Claim W2-10 (issue #37): extend the W1-13 API substitute with W2 shapes (approve, send-back, qc-run, disposition) on branch `codex/w2-10-w2-shapes`.
- Why: Lane C contract PR so Lane B never edits the substitute inside a UI ticket.
- Next: Implement routes + unit tests; local commit only.
- Author: operator=agent session=w2-10-w2-shapes model=composer
- Evidence: branch codex/w2-10-w2-shapes

## 2026-09-22 14:45 — W2-10 done (local)
- What: W2-10 substitute extension complete on `codex/w2-10-w2-shapes`: approve / send-back / qc-run / disposition with forbidden, stale_version and 422 cases; Ready only inside approve/disposition; still absent from non-test builds. Not the W2 exit.
- Why: Ticket W2-10 of the delivery pack (issue #37).
- Next: Human review PR; W2-07 / W2-09 consume; W2-INT removes the extension from the app path.
- Author: operator=agent session=w2-10-w2-shapes model=composer
- Evidence: branch codex/w2-10-w2-shapes; `fixtures/src/substitutes/api/review.test.ts`

## 2026-09-22 (time not recorded) — CLAIM Lane C: W1-11 main promotion only
- What: Promote PR #68's mail sink onto main-based `codex/w1-11-main-promotion` in `/tmp/rai-w3-mail-promotion`; other Lane C tickets remain outside this claim.
- Author: operator=ta session=w1-11-main-promotion model=gpt-6
- Takes over from: session=w2-10-w2-shapes (reason: handoff; owner assigned this dependency promotion only)
- Why: PR #68 merged into `codex/w1-00-mail-dedup`; W3-03 needs the sink on main. Shared dedup/types already exist on main.
- Next: Local validation and commit; parent arranges independent review and PR. No push or merge.
- Evidence: [promotion plan](../../changes/2026-09-22-w1-11-main-promotion/plan.md)

## 2026-09-22 — CLAIM Lane C W3-08
- Author: operator=ta session=codex-w3-queue-substitute model=GPT-6
- Takes over from: session=w2-10-w2-shapes (reason: handoff; scoped queue substitute, separate worktree from mail promotion)
- Evidence: changes/2026-09-22-w3-08-queue-substitute/plan.md

## 2026-09-27 12:15 — CLAIM lane-c: W4-13 runner selection (#187)
- Author: operator=ta session=claude-code-w4-13-runner-selection model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #187)
- Scope: per changes/2026-09-27-w4-13-runner-selection/: `QC_MODE=deterministic` in every environment, `substitute` refused under production or a non-local identity mode, readiness `qc.kind` from the bound runner, `.env.example` deterministic with CI and the evidence harness pinned to substitute, W0-02 section 5, W0-07 3.9 and section 6, TESTING. One PR.

## 2026-09-27 — CLAIM lane-c: W7-01 backup command (#207)
- Author: operator=ta session=claude-code-w7-01-backup-command model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #207)
- Scope: per changes/2026-09-27-w7-01-backup-command-ci-rai/: `npm run backup` (`operator/pg-tools.ts`, `operator/backup.ts`, `operator/frozen-digest.ts`), `config.ts` `parseBackupConfig` (`RAI_PG_TOOLS`, `RAI_PG_CONTAINER_PORT`, `BACKUP_DIR`), `.env.example`, the CI integration-job `RAI_PG_TOOLS` line (lead-reviewed), W0-10 operator events, W0-02 section 5 keys, W0-04 backup recipe. One PR; no migration.

## 2026-09-27 20:24 — CLAIM lane-c: W4-09a evaluation set generator, dev split (#203)
- Author: operator=ta session=claude-code-w4-09a-eval-set model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #203)
- Scope: per changes/2026-09-27-w4-09a-evaluation-set-generator-dev/: `fixtures/src/evaluation/*` (cases, renderers, provisional per-lane labels, manifest), additive `fixtures/src/generate/{pdf,ooxml}.ts` builders, `npm run fixtures:eval:generate`. Dev split of `qc-eval-synthetic@1` only; held-out and freeze are W4-09b. One PR.

## 2026-09-28 — CLAIM lane-c: W7-10 rehearsal templates and timing capture (#210)
- Author: operator=ta session=claude-code-w7-10-rehearsal-templates-and-timing model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #210)
- Scope: per changes/2026-09-27-w7-10-rehearsal-templates-and-timing/: `docs/operations/rehearsal/{rehearsal-plan,deficiency-log,timing-sheet,acceptance-report}-template.md`, `rai-web/tests/rehearsal/timing.ts` (`createStepTimer(runId)` writing `timings.json` and `timings.csv` under `REHEARSAL_OUT_DIR`, refused outside `rai-web/.local/`) with its unit test. One PR; no migration, no product code.

## 2026-09-28 — CLAIM lane-c: W7-02 restore and verify (#216)
- Author: operator=ta session=claude-code-w7-02-restore-and-verify model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #216)
- Scope: per changes/2026-09-27-w7-02-restore-and-verify/: `npm run restore` (`operator/restore.ts`) and `npm run restore:verify` (`operator/restore-verify.ts`, checks `journal`, `counts`, `frozen_digest`, `manifest_hashes`, `blobs`, `a07_frozen_slot`, `a11_audit`, `grants`), `config.ts` `DATABASE_ADMIN_URL` (`parseRestoreConfig`), W0-10 operator restore events, `.env.example`, the CI integration-job `DATABASE_ADMIN_URL` line (lead-reviewed), W0-02 section 5 key, W0-04 restore recipe, TESTING. One PR; no migration.
