# Review: run identity for extraction and model use; `unavailable_detail` (W4-11b, #201)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-11b, sections 7, 8 and 9. Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)". D07-D10 stay open; D08 decision 2(a) (no provider, disabled model port) is the working assumption this ticket encodes by allowing only `provider: 'local-fake'`. Synthetic data only; no extractor, model, provider or network call.

## Change

- **Migration `0011_w4_11b_run_extraction_identity`** (forward-only, `rai-web/server/drizzle/`, journal and snapshot from `npm run migrate:generate`, file renamed from the generated name, header added by hand, rollback class `additive`): `qc_run` gains `extractor_version`, `model_provider`, `model_id`, `prompt_revision` (text), `model_input_tokens`, `model_output_tokens`, `model_latency_ms` (integer), `model_cost_usd_micros` (bigint), each number with `CHECK (IS NULL OR >= 0)`, and `unavailable_detail` (text) with `CHECK (unavailable_detail IS NULL OR (status = 'unavailable' AND unavailable_detail ~ '^[a-z0-9_]{1,64}$'))`. All nullable; no trigger or grant change. `db/schema/qc-run.ts` matches; `drizzle-kit generate` afterwards reports no drift. W7-03's `MIGRATION_CLASSES` map has not merged, so no class entry is added (W7-03 adds it when it rebases, per the W7 plan).
- **Types and boundary check.** `shared/src/qc/types.ts`: `QcModelIdentity`, `QcModelUsage`, `QcEngineIdentity` and `engine?` on both `QcRunResult` statuses. `shared/src/qc/validate.ts`: `QcEngineIdentitySchema` (identifiers `^[A-Za-z0-9][A-Za-z0-9._+/@:-]{0,127}$`, provider `local-fake` only, int32 non-negative tokens and latency, safe-integer non-negative cost, no unknown key) and `engine` accepted by `QcRunResultSchema`. `qc/orchestrator.ts` `checkedResult`: an invalid `engine` makes the run `runner_error` / `engine_identity_invalid` with no identity recorded; a valid one is kept when a finding violation refuses the run.
- **Recording.** New `server/src/qc/engine-identity.ts` maps the engine to columns and log fields and computes the stored detail (bounded code, `unspecified`, or NULL). `recordRun` now takes the checked result and writes status, reason, rule count, identity columns and `unavailable_detail` from it; `qc/repository.ts` `InsertRunInput` carries them.
- **Logs** (`observability/log.ts`): `qc.run.completed` and `qc.run.unavailable` register the seven engine fields (emitted only when recorded); `qc.run.unavailable` also `unavailableDetail` (emitted when not NULL); `qc.extract.failed` registered (`qcRunId`, `slot`, `reason`, `durationMs`, `extractorVersion`), level `warn`, for W4-05b / W4-13b to emit.
- **Reads.** `QcRunSummarySchema` and `listQcRunsForVersion`: `extractorVersion`, `model`, `modelUsage`, `unavailableDetail` (cost not served). `DeskHealthReport.unavailableQc` rows: required `unavailableDetail: string | null`, bounded by the same pattern; `observability/operator.ts` reads it.
- **Documents** (dated notes): W0-02 section 7 (`implementation-plan-w1-w3.md`, after the W4-12 `QcRunSummary` paragraph), W0-04 (`persistence-and-artifact-store.md`, `qc_run` paragraph), the data contract (QC run row), W0-07 section 7 (`qc-boundary-and-mail-sink.md`, one new row) and W0-10 (`observability-contract.md`: section 3.3 rows, the new `qc.extract.failed` row, section 7.2 shape, a dated "W4-11b" section).
- **Tests.** New `tests/integration/w4-11b-run-extraction-identity.test.ts` (8 cases: completed run with identity on row, line and qc-runs read; run without identity; unavailable run with extractor version and detail on row, line, qc-runs read and desk health; `unspecified` and NULL detail; validator refusal keeps the violation and identity; invalid identity and a non-local provider → `engine_identity_invalid`; four runs differing only in extractor, model or prompt told apart from rows and lines; migration on a 0009 database with a row in it, NULL on the old row, the rai_app role writes every column, every CHECK refuses its bad value, the row stays append-only). New `server/src/qc/engine-identity.test.ts` (3). `shared/src/qc/validate.test.ts` (+2), `shared/src/schemas/observability.test.ts` (extended).

## Deviations

- **Validator placement.** The plan's path list names `shared/src/qc/types.ts` but says the engine is "validated at the boundary". The schema went into `shared/src/qc/validate.ts` beside `QcRunResultSchema` (which must accept the new optional field anyway, being `additionalProperties: false`), and the column/log mapping into a new `server/src/qc/engine-identity.ts` so later orchestrator tickets (W4-05a, W4-15, W4-18) touch fewer lines of `orchestrator.ts`.
- **Where `ModelIdentity` lives.** Plan section 5 puts `ModelIdentity` in `shared/src/qc/model.ts` (W4-07a), which does not exist yet. This ticket defines `QcModelIdentity` / `QcModelUsage` in `types.ts` with the section 5 shape; W4-07a can re-export or alias them from `model.ts`.
- **Invalid identity.** The plan is silent on an `engine` that fails validation. Chosen: fail closed, as for a refused finding: `runner_error` with detail `engine_identity_invalid`, nothing of the identity recorded, so free text can never reach a row or a log line.
- **NULL versus `unspecified`.** The plan says the detail is written "when it matches the pattern, and as `unspecified` otherwise". Read as: a given detail that is not a code is `unspecified`; a null detail (thrown runner, timeout, unbound) stays NULL, so `unspecified` means "the runner said something we would not store", not "nothing was said". Completed runs are always NULL (the CHECK requires it).
- **Substitute detail.** The scripted substitute's details are `simulated:<reason>`, outside the pattern, so they are stored as `unspecified`. The substitute is left unchanged (its scripts are W4-06a's); the W4-12 qc-runs test states this.
- **`qc.extract.failed` level and optional fields.** The plan lists the fields but no level. `warn` was chosen (the run's own `qc.run.unavailable` is the `error` line); `qcRunId` and `slot` are optional because the start-up self-test has neither.
- **`modelUsage` requires all three numbers** and `model` all three identities; a row with only some would be served as null. `recordRun` always writes the model block whole, so this does not arise from product code.
- **Changed expectations in existing tests.** The plan widens `QcRunSummary` and the desk-health `unavailableQc` row, so `tests/integration/w4-12-qc-runs.test.ts` (its full-shape `deepEqual` gains the four fields, null except `unavailableDetail: 'unspecified'` on the simulated DPO outage), `web/src/screens/case/view-model.test.ts` `qcRun()`, `web/src/api/client.test.ts`, `tests/browser/support/operator-rehearsal.ts` and `shared/src/schemas/observability.test.ts` gained the fields. No assertion was removed or loosened.
- **MIGRATION-SLOT.** Claimed on `docs/board/lane-lead-integration.md` in this PR (plan section 15.2); released at merge.

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

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes |
|---|---|---|---|---|
| - | - | - | pending | Two independent reviewer verdicts on the PR head, and green CI on that head, are recorded here before merge (D03 ticket flow). |
