# Review: run identity for deterministic runs (W4-11a, #184)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4a plan](../../docs/engineering/implementation-plan-w4a.md) section 6. Decisions implemented: register rows "W4a gate entry" and "W4a kickoff rulings" (Ta, 2026-09-26). Synthetic data only; no document parsing, model, provider or network call.

## Change

- **Migration `0009_w4_11a_run_identity`** (forward-only, `rai-web/server/drizzle/`, journal and snapshot from `drizzle-kit generate`, SQL reviewed by hand): `qc_run.runner_version text NOT NULL` added with `DEFAULT 'unrecorded'` and the default then dropped; `qc_run.rules_evaluated integer` with `qc_run_rules_evaluated_check` (`IS NULL OR >= 0`). No trigger or grant change. `db/schema/qc-run.ts` matches; `drizzle-kit generate` afterwards reports no drift.
- **Run rows** (`qc/orchestrator.ts`, `qc/repository.ts`): every new row records the bound runner's `identity.runner` (`engine_id`) and `identity.runnerVersion` (`runner_version`). A completed run stores `rules_evaluated` = the result's `rulesEvaluated.length`; an unavailable run stores 0, under the bound runner's identity (not the orchestrator's `QC-UNAVAILABLE` provenance); with no runner bound both identity columns read `unbound`.
- **Log lines** (`observability/log.ts` catalogue, orchestrator): `qc.run.started` gains `runner`, `runnerVersion`, `ruleRevision`, and `qcKind` now comes from the bound runner (`qc/kind.ts`: `deterministic` for runner `deterministic`, otherwise `substitute`); `qc.run.completed` gains `runner`, `runnerVersion`, `ruleRevision`, `rulesEvaluated`; `qc.run.unavailable` gains `runner`, `runnerVersion`, `ruleRevision`. Replays still emit nothing. No document text, filename or message parameter is added.
- **Operator report** (`observability/operator.ts`, `shared/src/schemas/observability.ts`): each `unavailableQc` row carries `runner` and `runnerVersion` (`unrecorded` on older rows). The schema requires both and bounds them as identifiers (`^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`). `lateQc` is unchanged.
- **W0-10** (`docs/engineering/observability-contract.md`): section 3.3 rows and section 7.2 shape amended with dated W4-11a notes, the open item on proposed `qc.run.*` fields annotated, and a dated "W4-11a run identity" section added.
- **Tests:** new `tests/integration/w4-11a-run-identity.test.ts` (7 cases: completed, `deterministic` kind with 0 rules, unavailable lane run, validation-refused result, unbound, two revisions on one version, desk-health runner label); new `server/src/qc/kind.test.ts`; `w3-07a-migration-contract.test.ts` (historical row reads `unrecorded`/NULL, the post-migration raw insert supplies `runner_version`, an insert without it and `rules_evaluated = -1` are refused); `shared/src/schemas/observability.test.ts` (runner label required and bounded).

## Deviations

- **Unbound runner version.** The plan is silent on what `runner_version` an unbound run (no runner in the composition) records. Smallest option: `unbound`, beside the existing `engine_id = 'unbound'`, so the row and line never claim a version for a runner that does not exist.
- **`qcKind` for other runner names.** Plan section 2 maps `deterministic` and `substitute-scripted`. The test-only probes bound through the `start.ts` override and the integration harness have other names; they are synthetic, so `qcKindOf` reports `substitute` for every runner except `deterministic`. The mapping lives in `server/src/qc/kind.ts` (a new file, not in the plan's path list) so W4-13 can reuse it for readiness `qc.kind`.
- **Other raw `qc_run` inserts.** Besides the two in `w3-07a-migration-contract.test.ts` that the plan names, five integration setups insert `qc_run` rows directly (`w2-02-lane-decision-immutability`, `w2-05-findings-immutability`, `w3-01-queue`, `w3-03a-notifications`, `w3-07a-operator-probes`). Each now supplies `runner_version`; only the setup changed, no assertion.
- **Changed expectation in existing tests.** The operator report's `unavailableQc` rows now require `runner` and `runnerVersion`, so the typed synthetic reports in `shared/src/schemas/observability.test.ts`, `web/src/api/client.test.ts` and `tests/browser/support/operator-rehearsal.ts` gained the two fields. This is the plan's behaviour change (the rows "gain the runner label"); no assertion was removed or loosened. The desk-health page does not render the label yet; W4a plan section 7 (W4-12) owns the UI.
- **Distinguishability test.** Before W4-04 no product path gives one version runs under two rule revisions. The test simulates the state W4-04 makes reachable by replacing the synthetic version's frozen `qc_rules` revision as `rai_owner`, with `pack_version_frozen` disabled inside one transaction. The replacement is a random UUID; W4-02, which loads the catalogue by that ID, may need to publish a real `qc_rules` revision there.
- **W0-07 section 10** still lists `runner`/`runnerVersion` as proposed fields. Plan section 12 assigns W4-11a only the W0-10 catalogue, so W0-07 is not edited here; W0-10's open item now says which fields are registered.

## Commands and results

Worktree `/tmp/rai-w4-11a-run-identity`, Postgres project `rai-w4a` on 55380, `rai-web/.env` from `.env.example` with the ports rewritten (8797/8798/8799/5185). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w4-11a-run-identity-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `w4-11a-run-identity.test.ts`, `w3-07a-migration-contract.test.ts`, `observability.test.ts` before the change | all failed for the right reason: `column "runner_version" does not exist`; `qcKind` was `substitute` for runner `deterministic`; the report had no `runner` |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 595/595 |
| `npm run test:integration` | 342/342, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 615 files scanned, 0 with the marker |
| `npm run test:browser:server` | 196 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 337 files, 921 links, 0 broken (rerun with the records added) |
| `git diff --check` (root) | clean |
| `npx drizzle-kit generate --config server/drizzle.config.ts` (after the migration) | "No schema changes" |

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes |
|---|---|---|---|---|
| - | - | - | pending | Two independent reviewer verdicts on the PR head, and green CI on that head, are recorded here before merge (D03 ticket flow). |
