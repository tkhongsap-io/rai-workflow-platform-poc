# Review: content runner, claim grammar and ACC-METRIC-CITED (W4-06a, #221)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-06a and sections 3.1-3.3. Decisions implemented: register row "W4b delegated rulings (provisional)" decisions 10 (WA-D09), 11 (WA-D09), 22, 26, 27, 28 and 30, under "Ta's delegation (2026-09-27)". D07-D10 stay open. No migration, no route, no UI, no model, no network call; synthetic data only. The runner is not bound in any `QC_MODE` (W4-13b).

## Change

- **Content runner** (`server/src/qc/content/runner.ts`): `createContentQcRunner({ extractor, now?, runnerVersion?, onExtractFailed? })`, identity `content`. Executes only `content` rules through `CONTENT_RULES` (`rules/index.ts`, `rules/rule.ts`). Decides before any read: `not_configured` / `no_qc_rules_revision`; `runner_error` / `unknown_lane_mapping`, `approve_attempt_without_lane`, `unknown_content_rule`, `unsupported_rule_trigger`, `invalid_rule_params`; `not_configured` / `model_disabled` for a `grammar+model` rule. Lane-scoped readable slots (decisions 22, 28; never slot 9). Each artifact in scope is read once (at most `byteLength` bytes, sha256 = `contentHash`, else `hash_mismatch`; a rejected read is `blob_missing`; a media type outside the allow-list is `extract_unreadable`) and extracted once; extraction failures map to `artifact_unreadable` / `extract_<reason>`, `runner_error` / `extract_crash`, or `timeout` on an abort; `onExtractFailed` receives `{ slot, reason, durationMs, extractorVersion }` for W4-13b's `qc.extract.failed` line. A run that called the extractor reports `engine.extractorVersion`.
- **Grammar** (`claims.ts`), **decimals** (`decimal.ts`, exact `compareDecimal` over scaled bigints), **excerpts** (`excerpt.ts`, `excerptHashOf`, `claimKeyOf`).
- **Rule** `ACC-METRIC-CITED` (`rules/acc-metric-cited.ts`): one finding per defective claim, `claimKey`, locator plus `excerptHash`, params `{ slot, missing, item? }`, `measure` only with an accepted metric and a value.
- **Shared contract** (`shared/src/qc/{types,validate}.ts`): `QcFinding.claimKey?`, `CLAIM_KEY_PATTERN`; `findingKeyOf(ruleId, scope, claimKey?)`; optional `QcFindingContext.artifacts`; violations `evidence_outside_request`, `message_param_text` (`MESSAGE_PARAM_PATTERNS`, `isAllowedMessageParam`), `duplicate_finding_key` (`duplicateFindingKey`).
- **Orchestrator** (`qc/orchestrator.ts` `checkedResult`): the run-level `duplicate_finding_key` check after the per-finding checks; the request (with its artifacts) was already the validation context, so `evidence_outside_request` applies to every runner.
- **Catalogue**: `AccMetricCitedParamsSchema`, `ClaimLabelsSchema`, `BilingualLabelListSchema`, `CLAIM_COLUMN_KEYS`, `ContentRuleBaseParams` in `shared/src/schemas/cases.ts`, registered in `QC_RULE_PARAMS_SCHEMAS`; the seed's `ACC-METRIC-CITED` entries (both templates) carry `ACC_METRIC_CITED_PARAMS` (`slots [1, 5]`, `CLAIM_LABELS` en/th, items, `acceptedMetrics ['hallucination_rate', 'accuracy']`, `claimSource 'grammar'`). Label stays `w4a.1`.
- **Documents**: dated W4-06a notes on W0-07 3.4 (step 5, lane-scoped content reading and the new step-4 checks) and 3.5 (the rule row) in `qc-boundary-and-mail-sink.md`.
- **Tests**: new `server/src/qc/content/{runner,claims,decimal,excerpt,module-graph}.test.ts`, `rules/acc-metric-cited.test.ts` and `request.test-helper.ts` (recording fake `Extractor`); new cases in `shared/src/qc/validate.test.ts`, `server/src/configuration/{qc-rules,seed}.test.ts`, `fixtures/src/substitutes/qc/scripts.test.ts`; new `tests/integration/w4-06a-content-checks.test.ts` (orchestrator refusals and two stored claim findings) and `fixtures/src/evaluation/content-rules.test.ts` (dev-split cross-check).

## Deviations

- **Unread-byte failures all map to `blob_missing`.** Plan 4.1 names `blob_missing` for a missing blob and "`artifact_unreadable`" when `read()` rejects for any other reason; the content module may not import `artifacts/` to recognise `BlobMissingError`, and section 10's detail list names no other read code. Chosen: every rejected `read()` or failing stream is `artifact_unreadable` / `blob_missing`.
- **An unallowed media type** is `artifact_unreadable` / `extract_unreadable` without calling the extractor (the port's `extract` takes only `AllowedMediaType`). Uploads are sniffed against the same list, so this path is defensive.
- **Extractor abort.** The plan maps `timeout` (not an `ExtractResult` reason) to `unavailable:timeout`; implemented as: an aborted run signal before or after an extraction is `timeout` (detail null). `limit_time` is a `limit_*` reason → `extract_limit_time`, as the plan's rule says.
- **Identical claim text in one artifact** gives one `claimKey`; instead of letting `duplicate_finding_key` fail the run, the rule emits one finding with one evidence entry per occurrence (same claim, same disposition).
- **`grammar+model` before W4-07** answers `not_configured` / `model_disabled` whether or not a model would be bound, since no `ModelPort` exists yet; W4-07a replaces the check.
- **Unimplemented content rules.** Until W4-06b-d, a request selecting `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3` or `ACC-CLASSIC-ML-METRIC` is `runner_error` / `unknown_content_rule` (fail closed, as the deterministic runner does for metadata rules). The runner is unbound until W4-13b, which follows W4-06d, so no running desk sees it.
- **Grammar details the plan leaves open**: labels compare after NFC, lower-casing, whitespace collapse and trim; a full-width colon also separates key and value; the first occurrence of a key wins and unknown keys are ignored; an XLSX row is a claim only with a non-empty answer cell, and its excerpt is its non-empty cells in column order; a metric name normalises spaces and hyphens to `_`; a field counts as present only when it parses (value, denominator, threshold) or is non-empty (evidence); a stated `unit` field decides the unit of a bare number. The Thai labels are agent-team values (WA-D09, provisional).
- **Paths outside the row's list** (test-only): `tests/integration/w4-06a-content-checks.test.ts` (the orchestrator check needs a database) and `fixtures/src/evaluation/content-rules.test.ts` (the dev-split cross-check, W4-09a's labels unchanged). No locale key was needed: the rule uses the existing `qc.finding.acc_metric_cited`; W4-12b adds the measure and missing-field keys.
- **Changed expectation**: `qc-rules.test.ts` first case now gives `ACC-METRIC-CITED` its params, because the registered schema makes a params-less entry invalid (named in the plan's row).
- **Lane environment**: `RAI_PG_TOOLS=docker-compose:rai-qc-content` in the uncommitted `.env`.
- **Process note**: the implementation files were written right after their tests; RED was then recorded by hiding the implementation (every new content test fails with `ERR_MODULE_NOT_FOUND`) and by a lane-scope mutation (5 runner tests fail); the validator, catalogue and orchestrator cases were run red before their code.

## Checks

Logs under `/tmp/rai-w4-06a-content-runner-claim-grammar-logs/`. Database `rai-qc-content` on port 55382.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `validate.test.ts` before the shared change | fails (`duplicateFindingKey` not exported) |
| RED: `qc-rules.test.ts` before the schema | fails (`ACC_METRIC_CITED_PARAMS` not exported) |
| RED: content tests with the implementation hidden | every file fails `ERR_MODULE_NOT_FOUND`; module-graph 1/2 fail |
| RED: lane-scope mutation of `runner.ts` | 5 of 14 runner tests fail |
| RED: `w4-06a-content-checks.test.ts` before `checkedResult` | 3/4; `duplicate_finding_key` case fails |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1105/1105 |
| `npm run test:integration` | 458/458, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 983 files scanned, 0 with the marker |
| `npm run test:browser:server` | 217 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 477 Markdown files, 1330 links, 0 broken |
| `git diff --check` (root, staged) | clean |

## Verdicts

Pending: two independent reviewer verdicts on the exact head (D03 ticket flow).
