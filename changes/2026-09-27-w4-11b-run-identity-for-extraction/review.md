# Review: run identity for extraction and model use; `unavailable_detail` (W4-11b, #201)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-11b, sections 7, 8 and 9. Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)". D07-D10 stay open; D08 decision 2(a) (no provider, disabled model port) is the working assumption this ticket encodes by allowing only `provider: 'local-fake'`. Synthetic data only; no extractor, model, provider or network call.

## Change

- **Migration `0013_w4_11b_run_extraction_identity`** (numbered 0010, then 0011, then 0012, until W5-03, W7-03 and W6-02 merged first; forward-only, `rai-web/server/drizzle/`, journal and snapshot from `npm run migrate:generate`, file renamed from the generated name, header added by hand, rollback class `additive`): `qc_run` gains `extractor_version`, `model_provider`, `model_id`, `prompt_revision` (text), `model_input_tokens`, `model_output_tokens`, `model_latency_ms` (integer), `model_cost_usd_micros` (bigint), each number with `CHECK (IS NULL OR >= 0)`, and `unavailable_detail` (text) with `CHECK (unavailable_detail IS NULL OR (status = 'unavailable' AND unavailable_detail ~ '^[a-z0-9_]{1,64}$'))`. All nullable; no trigger or grant change. `db/schema/qc-run.ts` matches; `drizzle-kit generate` afterwards reports no drift. W7-03's `MIGRATION_CLASSES` (merged first) gains `'0013_w4_11b_run_extraction_identity': 'additive'`, pinned by `migration-classes.test.ts` (Round 3 changes; renumbered at the merge-queue rebase onto W6-02).
- **Types and boundary check.** `shared/src/qc/types.ts`: `QcModelIdentity`, `QcModelUsage`, `QcEngineIdentity` and `engine?` on both `QcRunResult` statuses. `shared/src/qc/validate.ts`: `QcEngineIdentitySchema` (identifiers `^[A-Za-z0-9][A-Za-z0-9._+/@:-]{0,127}$`, provider `local-fake` only, int32 non-negative tokens and latency, safe-integer non-negative cost, no unknown key) and `engine` accepted by `QcRunResultSchema`. `qc/orchestrator.ts` `checkedResult`: an invalid `engine` makes the run `runner_error` / `engine_identity_invalid` with no identity recorded; a valid one is kept when a finding violation refuses the run.
- **Recording.** New `server/src/qc/engine-identity.ts` maps the engine to columns and log fields and computes the stored detail (bounded code, `unspecified`, or NULL). `recordRun` now takes the checked result and writes status, reason, rule count, identity columns and `unavailable_detail` from it; `qc/repository.ts` `InsertRunInput` carries them.
- **Logs** (`observability/log.ts`): `qc.run.completed` and `qc.run.unavailable` register the seven engine fields (emitted only when recorded); `qc.run.unavailable` also `unavailableDetail` (emitted when not NULL); `qc.extract.failed` registered (`qcRunId`, `slot`, `reason`, `durationMs`, `extractorVersion`), level `warn`, for W4-05b / W4-13b to emit.
- **Reads.** `QcRunSummarySchema` and `listQcRunsForVersion`: `extractorVersion`, `model`, `modelUsage`, `unavailableDetail` (cost not served). `DeskHealthReport.unavailableQc` rows: required `unavailableDetail: string | null`, bounded by the same pattern; `observability/operator.ts` reads it.
- **Documents** (dated notes): W0-02 section 7 (`implementation-plan-w1-w3.md`, after the W4-12 `QcRunSummary` paragraph), W0-04 (`persistence-and-artifact-store.md`, `qc_run` paragraph), the data contract (QC run row), W0-07 section 7 (`qc-boundary-and-mail-sink.md`, one new row) and W0-10 (`observability-contract.md`: section 3.3 rows, the new `qc.extract.failed` row, section 7.2 shape, a dated "W4-11b" section).
- **Tests.** New `tests/integration/w4-11b-run-extraction-identity.test.ts` (8 cases: completed run with identity on row, line and qc-runs read; run without identity; unavailable run with extractor version and detail on row, line, qc-runs read and desk health; `unspecified` and NULL detail; validator refusal keeps the violation and identity; invalid identity and a non-local provider → `engine_identity_invalid`; four runs differing only in extractor, model or prompt told apart from rows and lines; migration on the database of the migration before it (0009 at first, 0010 after the round 1 rebase, 0011 after the round 3 rebase) with a row in it, NULL on the old row, the rai_app role writes every column, every CHECK refuses its bad value, the row stays append-only). New `server/src/qc/engine-identity.test.ts` (3). `shared/src/qc/validate.test.ts` (+2), `shared/src/schemas/observability.test.ts` (extended).

## Deviations

- **Validator placement.** The plan's path list names `shared/src/qc/types.ts` but says the engine is "validated at the boundary". The schema went into `shared/src/qc/validate.ts` beside `QcRunResultSchema` (which must accept the new optional field anyway, being `additionalProperties: false`), and the column/log mapping into a new `server/src/qc/engine-identity.ts` so later orchestrator tickets (W4-05a, W4-15, W4-18) touch fewer lines of `orchestrator.ts`.
- **Where `ModelIdentity` lives.** Plan section 5 puts `ModelIdentity` in `shared/src/qc/model.ts` (W4-07a), which does not exist yet. This ticket defines `QcModelIdentity` / `QcModelUsage` in `types.ts` with the section 5 shape; W4-07a can re-export or alias them from `model.ts`.
- **Invalid identity.** The plan is silent on an `engine` that fails validation. Chosen: fail closed, as for a refused finding: `runner_error` with detail `engine_identity_invalid`, nothing of the identity recorded, so free text can never reach a row or a log line.
- **NULL versus `unspecified`.** The plan says the detail is written "when it matches the pattern, and as `unspecified` otherwise". Read as: a given detail that is not a code is `unspecified`; a null detail (thrown runner, timeout, unbound) stays NULL, so `unspecified` means "the runner said something we would not store", not "nothing was said". Completed runs are always NULL (the CHECK requires it).
- **Substitute detail.** The scripted substitute's details are `simulated:<reason>`, outside the pattern, so they are stored as `unspecified`. The substitute is left unchanged (its scripts are W4-06a's); the W4-12 qc-runs test states this.
- **`qc.extract.failed` level and optional fields.** The plan lists the fields but no level. `warn` was chosen (the run's own `qc.run.unavailable` is the `error` line); `qcRunId` and `slot` are optional because the start-up self-test has neither.
- **`modelUsage` requires all three numbers** and `model` all three identities; a row with only some would be served as null. `recordRun` always writes the model block whole, so this does not arise from product code.
- **Changed expectations in existing tests.** The plan widens `QcRunSummary` and the desk-health `unavailableQc` row, so `tests/integration/w4-12-qc-runs.test.ts` (its full-shape `deepEqual` gains the four fields, null except `unavailableDetail: 'unspecified'` on the simulated DPO outage), `web/src/screens/case/view-model.test.ts` `qcRun()`, `web/src/api/client.test.ts`, `tests/browser/support/operator-rehearsal.ts` and `shared/src/schemas/observability.test.ts` gained the fields. No assertion was removed or loosened.
- **Invalid engine hides the unavailable reason** (round 1 note). `checkedResult` checks `engine` before it looks at `status`, so an unavailable result (for example `timeout`) that carries an invalid engine is recorded as `runner_error` / `engine_identity_invalid` and its original reason is not kept. Kept as is: it fails closed, the run is still unavailable either way, and a runner that sends a malformed identity is itself the defect worth surfacing.
- **Migration renumbered at rebase (round 1).** W5-03 (#205) merged `0010_w5_03_risk` while this PR held 0010. The branch was rebased onto `origin/main` (`c5a267d`); main's `meta/_journal.json` and `0010_snapshot.json` were taken as they are, `npm run migrate:generate` produced idx 11 and `0011_snapshot.json`, and the generated SQL (byte-identical to the hand-reviewed body) was replaced by the hand-written file, now `0011_w4_11b_run_extraction_identity.sql`, with the journal tag renamed to match. `drizzle-kit generate` afterwards reports no drift. References to "migration 0010" for this ticket in the code comments, the change records, W0-02, W0-04, W0-10, DEVLOG and CHANGELOG now say 0011. (Round 2: the rebase had also changed three references to W5-03's own migration 0010 in W0-04, the `case.risk_tier` row, the `pack_version.risk_answers` row and the dated W5-03 section; those three lines were restored exactly as on `origin/main`, so only this ticket's references differ.) The integration test finds its migration by tag, so it now runs on a 0010 database; only its title changed.
- **MIGRATION-SLOT.** Claimed on `docs/board/lane-lead-integration.md` in this PR (plan section 15.2); released at merge.
- **Migration renumbered at rebase (round 3).** W7-03 (#287) merged `0011_w7_03_migration_class` while this PR held 0011. Rebased onto `origin/main` `dd59421` and regenerated by hand at 0012 (Round 3 changes); `MIGRATION_CLASSES` gains the `additive` entry that W7-03 would otherwise have added.
- **Migration renumbered at rebase (merge queue, round 5).** W6-02 (#214) merged `0012_w6_02_configuration_admin` while this PR held 0012. Under the merge lock the branch was rebased onto `origin/main` `ce87a4a` and regenerated at 0013 with `npx drizzle-kit generate --config server/drizzle.config.ts --name w4_11b_run_extraction_identity` (snapshot `prevId` = main's 0012 id); the SQL is the round 5 file statement for statement, only its header line now names 0013. The `MIGRATION_CLASSES` entry, `engine-identity.test.ts`, code comments and this ticket's own record references say 0013; historical round rows keep their numbers.
- **W7-03 test fixture journal (round 6).** After that rebase `tests/integration/w7-03-migration-classes.test.ts` failed one case ("rollback check: binary_only, restore_required ... exit 0, 3, 4", assertion `the pre-W7-03 journal`). Its `releaseLength()` took the longest journal ending with an additive migration; with this ticket's additive 0013 after W6-02's restore-required 0012 that became the full journal, so the trailing additive run was 0013 alone and the "pre-W7-03 target whose extras are all additive" scenario no longer existed (a W6-02 extra is reported `not_additive` first). The test assumed no additive migration would follow W6-02's. Changed only the fixture choice: `releaseLength()` is now the journal up to the end of the unbroken additive run that starts at W7-03's migration (today 0000-0011, exactly the release journal the test used on main before this PR). Every assertion is unchanged and keeps its meaning; the W4-11b migration is still covered by the class-map and back-fill cases and by `migration-classes.test.ts`. A W7-03-owned file edited by a W4 ticket, because the merge cannot land otherwise.

## Round 1 changes

- Rebased onto `origin/main` `c5a267d` and regenerated the migration at 0011 by hand (see Deviations). Conflicts in CHANGELOG, DEVLOG, the lane A and lead-integration board streams and W0-10 were resolved by keeping both sides (append-only entries kept in order; this ticket's CHANGELOG line and DEVLOG entry on top).
- `storedUnavailableDetail` checks `typeof detail === 'string'` before the pattern: a non-string detail was coerced by `RegExp.test` and returned unchanged (for example the number `42`), so it could reach the row as a non-code. It is now `unspecified`. Test first in `server/src/qc/engine-identity.test.ts` (failed with `actual: 42`).
- `QcRunSummarySchema` bounds what it serves: `extractorVersion`, `model.provider`, `model.modelId` and `model.promptRevision` use the `QcEngineIdentitySchema` label pattern, and `unavailableDetail` the CHECK pattern, as the desk-health schema already did. New `shared/src/schemas/review.test.ts` (2 cases; failed before the change).
- `rai-web/.env` regenerated from the new `.env.example` (W7-01 keys); `RAI_PG_TOOLS=docker-compose:rai-qc-core` for this lane's database. Not committed.

Deferred (not changed here):

- `qc.extract.failed` keeps `qcRunId?` and `slot?` optional; W4-05b and W4-13b should emit them whenever they exist.
- The qc-runs read serves `model` / `modelUsage` as null when only some of their columns are set; W4-07b must keep writing the model block whole through `recordRun`.
- The substitute's `simulated:<reason>` details are stored as `unspecified`, so W4-12b's UI will show `unspecified` for every substitute outage; W4-06a (substitute scripts) or W4-12b can switch to bounded codes.
- ~~W7-03 adds the `additive` class entry for `0011_w4_11b_run_extraction_identity` when it rebases (its class map is not on main).~~ Done here in round 3: W7-03 merged first, so this PR adds the `0012_w4_11b_run_extraction_identity: additive` entry itself.

## Round 2 changes

- Restored the three W5-03 migration references in `docs/engineering/persistence-and-artifact-store.md` (W0-04) that the round 1 rebase had changed from 0010 to 0011: the `case.risk_tier` row, the `pack_version.risk_answers` row and the dated "W5-03 risk proposal persistence" section. They now match `origin/main` exactly; `git diff origin/main` on that file shows only this ticket's added W4-11b paragraph.
- The engine-label pattern is exported once as `QC_ENGINE_LABEL_PATTERN` from `shared/src/qc/types.ts` and used by both `shared/src/qc/validate.ts` (runner-result check) and `shared/src/schemas/review.ts` (qc-runs read), so the two cannot drift apart. No behaviour change; the existing tests on both sides cover it.
- Round 1 verdict rows marked "(pre-rebase)"; PR description updated to name migration 0011.

## Round 3 changes

- Merge queue conflict: W7-03 (#287) merged `0011_w7_03_migration_class` first. Rebased onto `origin/main` (`dd59421`); main's `meta/_journal.json` and `meta/0011_snapshot.json` were taken as they are, `npm run migrate:generate --name w4_11b_run_extraction_identity` produced idx 12 and `meta/0012_snapshot.json`, and the generated SQL was statement-for-statement identical to the hand-written file, which was restored with its header (tag line now `0012`). Never renumbered by the queue. CHANGELOG, DEVLOG, both board streams and the W0-10 amendment list kept both sides (append-only; main's entries untouched).
- W7-03's `migration-classes.test.ts` failed on the rebased head (`no class for 0012_w4_11b_run_extraction_identity`); `MIGRATION_CLASSES` gains `0012_w4_11b_run_extraction_identity: 'additive'`, which matches the file's `-- rollback expectation: additive;` header, and the test now also asserts the W4-11b migration is additive.
- References this ticket makes to its own migration were moved to 0012 (schema, engine-identity, shared schemas, spec, plan, W0-02, W0-04, the dated W0-10 section, DEVLOG). Main's W5-03 and W7-03 references are untouched. (Round 4: two were missed, the `DeskHealthReport.unavailableDetail` line in W0-10 section 7.2 and the CHANGELOG line; both now say 0012.)
- Reviewer polish taken: the detail pattern is exported once as `QC_UNAVAILABLE_DETAIL_PATTERN` from `shared/src/qc/types.ts` and used by `engine-identity.ts`, `schemas/review.ts` and `schemas/observability.ts`; a new unit test checks the three agree with the migration CHECK literal (RED first: missing export). The Drizzle `qc-run.ts` CHECK keeps the literal so the snapshot does not change.
- Deferred, unchanged: the reviewer note that the qc-runs read returns `model` null when any one of its three columns is NULL (the writer always sets them together; listed above).

## Round 4 changes

- W0-10 contract (`docs/engineering/observability-contract.md` section 7.2): the `DeskHealthReport.unavailableDetail` line this PR adds said "null ... before migration 0011", which is W7-03's migration; it now says 0012, matching the dated W4-11b section and the shared schema comment.
- CHANGELOG W4-11b line: "(migration 0011)" now "(migration 0012)".
- review.md: the Change bullet on the migration now records the `MIGRATION_CLASSES` entry this PR adds (it said no entry was added); the Round 3 claim that every self-reference said 0012 is corrected in place with a note naming the two it missed; the Tests bullet names the 0011 base after the round 3 rebase; round 4 verdict rows filled in with the head and results.
- Documentation only: no code, migration, snapshot or test changed. Historical round 1 and round 2 notes that name 0011 describe that round and are left as written.

## Round 5 and 6 changes

- Merge queue (round 5): rebased onto `ce87a4a` and migration regenerated at 0013 (see Deviations). CHANGELOG, DEVLOG and board conflicts kept both sides; in `persistence-and-artifact-store.md` main's `risk_tier` row was kept and this branch's W4-11b `qc_run` paragraph kept; `migration-classes.ts` keeps both the W6-02 and W4-11b entries.
- Round 6: the W7-03 integration test's release journal selection fixed so the rebased branch passes (see Deviations). No product code, migration or snapshot changed in round 6.

## Commands and results

Worktree `/tmp/rai-w4-11b-run-identity-for-extraction`, Postgres project `rai-qc-core` on 55381, `rai-web/.env` from `.env.example` with 54320 → 55381, `PORT=8801`, `PUBLIC_BASE_URL=http://127.0.0.1:8801`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8802`, `SUBSTITUTE_PORT=8803`, `SUBSTITUTE_WEB_PORT=5191`, `OBS_MIGRATION_ADMIN_URL` set. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w4-11b-run-identity-for-extraction-logs/`. Hard-coded ports noted: several integration suites bind 127.0.0.1:8787 through the in-process adapter, and `w1-int-substitute-absent` uses 8789/5175.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: the new integration file, `w4-12-qc-runs.test.ts`, `engine-identity.test.ts`, `validate.test.ts`, `observability.test.ts` before the change | failed for the right reasons: `column "extractor_version" does not exist` (8 new cases and the W4-12 shape), `engine-identity.js` not found, `QcEngineIdentitySchema` not exported, desk-health report without `unavailableDetail` |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 653/653 |
| `npm run test:integration` | 382/382, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 683 files scanned, 0 with the marker |
| `npm run test:browser:server` | 202 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 373 Markdown files, 1069 links, 0 broken |
| `git diff --check` (root) | clean (also `git diff --cached --check` with the new files staged) |
| `npx drizzle-kit generate --config server/drizzle.config.ts` (after the migration) | "No schema changes, nothing to migrate" |
| **Round 1**, rebased head, fresh `rai-qc-core` database, `npm ci` exit 0 | |
| RED: `engine-identity.test.ts`, new `shared/src/schemas/review.test.ts` | 1 failed (`actual: 42`, expected `unspecified`); 1 failed (free-text detail and identity accepted) |
| `npm run migrate:generate` (after placing the hand-written 0011) | "No schema changes, nothing to migrate" |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 741/741 |
| `npm run test:integration` | 391/391, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 711 files scanned, 0 with the marker |
| `npm run test:browser:server` | 202 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 394 Markdown files, 1141 links, 0 broken |
| `git diff --check` (root) | clean |
| **Round 2**, head after the W0-04 restore and shared pattern, fresh `rai-qc-core` database | |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 741/741 |
| `npm run test:integration` | 391/391, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 711 files scanned, 0 with the marker |
| `npm run test:browser:server` | 202 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 394 Markdown files, 1141 links, 0 broken |
| `git diff --check` (root) | clean |
| `git diff origin/main -- docs/engineering/persistence-and-artifact-store.md` | only the added W4-11b paragraph; no removed lines |
| **Round 3**, rebased onto `dd59421`, fresh `rai-qc-core` database, `npm ci` exit 0 | |
| RED: `migration-classes.test.ts` on the rebased head; `engine-identity.test.ts` with the shared-pattern test | 3 failed (`no class for 0012_w4_11b_run_extraction_identity`); 1 failed (`QC_UNAVAILABLE_DETAIL_PATTERN` not exported) |
| `npx drizzle-kit generate --config server/drizzle.config.ts --name w4_11b_run_extraction_identity` | idx 12, `0012_snapshot.json`; SQL identical to the hand-written statements; rerun: "No schema changes, nothing to migrate" |
| `npm run lint` | exit 0 (after prettier on `engine-identity.ts`) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 816/816 |
| `npm run test:integration` | 402/402, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 735 files scanned, 0 with the marker |
| `npm run test:browser:server` | 205 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 407 Markdown files, 1171 links, 0 broken |
| `git diff --cached --check` (root) | clean |
| **Round 4**, head `0b98df8` plus documentation fixes, still on `dd59421` (no rebase), existing `rai-qc-core` database | |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 816/816 |
| `npm run test:integration` | 402/402, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 735 files scanned, 0 with the marker |
| `npm run test:browser:server` | 205 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 407 Markdown files, 1171 links, 0 broken |
| `git diff --check` (root) | clean |
| **Round 6**, merge-queue rebase onto `ce87a4a` (migration at 0013) plus the W7-03 test fix, `rai-qc-core` database reset (`db:down`, `db:up`) because it still held the 0012 numbering | |
| `diff` saved round 5 SQL against `0013_w4_11b_run_extraction_identity.sql`; journal tail; `0013_snapshot.json` `prevId` | header line only; `0011_w7_03`, `0012_w6_02`, `0013_w4_11b`; equals main's 0012 id |
| RED: `npm run test:integration` on the rebased head before the fix | 436 passed, 1 failed (`w7-03-migration-classes.test.ts:272`, `the pre-W7-03 journal`) |
| GREEN: `w7-03-migration-classes.test.ts` alone after the fix | 7/7 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 996/996 |
| `npm run test:integration` | 437/437, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 887 files scanned, 0 with the marker |
| `npm run test:browser:server` | 205 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 449 Markdown files, 1271 links, 0 broken |
| `git diff --check` (root) | clean |

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes |
|---|---|---|---|---|
| 1 | `4d87003` (pre-rebase) | reviewer 1 | pass, notes | tsc, lint, unit 653/653 locally; CI unit and browser still pending at the verdict, the other jobs green. Notes: engine checked before status (now a Deviation), unbounded read-schema strings (fixed), optional `qc.extract.failed` fields (deferred), verdict table (this row). |
| 1 | `4d87003` (pre-rebase) | reviewer 2 | pass, notes | tsc, lint, unit 653/653 locally; integration and browser relied on the recorded results. Notes: `typeof` check (fixed), partial model block reads as null (deferred), substitute `unspecified` (deferred), W7-03 class entry (deferred). |
| 1 | `4d87003` (pre-rebase) | merge queue | conflict | Migration 0010 taken by W5-03 on main; rebased and regenerated at 0011 (Round 1 changes). |
| 2 | `c344276` | reviewer 1 | changes requested | W0-04 contract: the rebase renumbered three W5-03 references (0010 to 0011); restored (Round 2 changes). Also: tsc, lint, unit 741/741 locally. |
| 2 | `c344276` | reviewer 2 | pass, notes | tsc, lint, unit 741/741; renumber verified (0010 snapshot and SQL identical to main, 0011 prevId chains). Notes: pre-rebase head label (fixed), duplicated engine-label pattern (fixed), PR body still names 0010 (fixed), deferred items unchanged. |
| 3 | `9239ee6` | reviewer 1 | pass, notes | tsc, lint, unit 741/741 locally. Notes: conflicting with main (rebase, keep both append-only entries), name the actual head in this table (done), no CI on a conflicting head. |
| 3 | `9239ee6` | reviewer 2 | pass, notes | tsc, lint, unit 741/741; migration additive and forward-only, snapshot and schema match. Notes: detail pattern repeated in three files (fixed, Round 3 changes), `model` null on a partial block (deferred). |
| 3 | `9239ee6` | merge queue | conflict | Migration 0011 taken by W7-03 on main; rebased onto `dd59421` and regenerated at 0012 (Round 3 changes). |
| 4 | `0b98df8` | reviewer 1 | changes requested | W0-10 contract: section 7.2 `unavailableDetail` line said "before migration 0011" (W7-03's number); records inaccurate (CHANGELOG said 0011, Round 3 claim overstated, Change bullet said no class entry). All fixed (Round 4 changes). Also: tsc, lint, unit 816/816 locally; CI 9 jobs green, integration and browser pending at the verdict. |
| 4 | `0b98df8` | reviewer 2 | pass, notes | tsc, lint, unit 816/816; migration chain (0012 prevId = main's 0011 id), class entry, shared pattern test and fail-closed orchestrator verified. Notes: same two 0011 references (fixed), Tests bullet said 0010 (fixed), fill in this row (done), deferred items unchanged. |
| 5 | `fb1f641` | reviewer 1 | pass, notes | tsc, lint, unit 816/816. Notes: conflicting with main (rebased, merge queue row), PR body numbers stale (body points at this file), deferred items unchanged. |
| 5 | `fb1f641` | reviewer 2 | pass, notes | tsc, lint, unit 816/816. Notes: record-only rebase needed, `qc.extract.failed` not emitted yet (plan: W4-05b / W4-13b), engine-invalid overwrites the original reason (Deviation). |
| 5 | `fb1f641` | merge queue | conflict | Migration 0012 taken by W6-02 on main; rebased onto `ce87a4a` and regenerated at 0013 (`5f72fa5`, not pushed). Integration then failed 1 case in `w7-03-migration-classes.test.ts` (Round 6). |
| 6 | round 6 head (named in the PR comment) | - | pending | Two independent reviewer verdicts on the new head (including the renumbered 0013 SQL against the round 5 file and the W7-03 test change), and green CI on that head, are recorded here before merge (D03 ticket flow). |
