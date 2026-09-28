# Review: RISK-TIER-UNKNOWN QC input (W5-10, #240)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 9 (the W5-10 row and "W5-10 merge order"), section 8 ("QC input (W5-10)"), section 7 (locale keys, substitute edits), decisions R-11 and R-17; the plan wins over issue #240. Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)". The rule and its severity are provisional until D09; the proposal comes from the SYNTHETIC PLACEHOLDER rubric (D07 open). Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Shared** (`rai-web/shared/src/qc/types.ts`): `QcRunRequest.riskProposal: QcRiskProposal | null` (required, R-17), `QcRiskProposal = { status: 'proposed' | 'unavailable'; tier: QcRiskTier | null }`, `QcRiskTier = 'high' | 'medium' | 'low' | 'unknown'`. `shared/src/qc/rule-registry.ts`: `RISK-TIER-UNKNOWN` as `metadata`, `['submit']`.
- **Orchestrator** (`server/src/qc/orchestrator.ts`, and the pure builder `server/src/qc/request.ts` that W4-08a split out, which gains a required `riskProposal` parameter before the optional `uploadSlot`): `buildRequest` loads the version's `submit` proposal (`risk/repository.ts` `readSubmitProposal`) for submit runs and passes `{ status, tier }`; `null` when there is none and always on upload and approve-attempt runs. `runKey` unchanged.
- **Rule** (`server/src/qc/deterministic/rules/risk-tier-unknown.ts`, registered in `rules/index.ts`): submit only, pack scope, owner from `owningLaneRule({ kind: 'pack' })` (AI/COE), catalogue severity; fires on `unavailable` or tier `unknown`, never on `null` or high/medium/low; evidence one pack-level `absent` locator; message `qc.finding.risk_tier_unknown` with `{ status }`.
- **Seed** (`server/src/configuration/seed.ts`): `RISK-TIER-UNKNOWN` (`metadata`, `['submit']`, `medium`) after the W4a metadata rules in both templates; label `w4a.1` → `w5.1`.
- **Builders** (one line each, the set `npm run typecheck` named): `server/src/qc/deterministic/request-builder.test-helper.ts` (new optional `riskProposal` shape, default `null`), `server/src/qc/content/request.test-helper.ts`, `fixtures/src/substitutes/qc/test-support.ts`, `fixtures/src/substitutes/api/routes-review.ts` (`buildLaneQcRequest`, `riskProposal: null`, the one substitute edit section 7 assigns), `fixtures/src/evaluation/content-rules.test.ts`; after the rebase onto W4-08a, `server/src/qc/request.test.ts` (each `requestOf` call passes the argument; the submit case now asserts the proposal passes through and the approve attempt asserts `null`) and `tests/evaluation/harness.ts` (`null`: the synthetic evaluation cases carry no risk proposal, so the harness's deterministic part raises nothing new and its labels are unchanged). The other files section 8 lists only import the type or wrap a runner, and the typecheck did not name them, so they are untouched (section 8: "`npm run typecheck` is the authority").
- **Locales**: `qc.finding.risk_tier_unknown` and `qc.rule.risk_tier_unknown` (th, en).
- **Docs**: W0-07 3.3 and 3.5 dated W5-10 amendments (`docs/engineering/qc-boundary-and-mail-sink.md`).

## Tests

- New unit tests in `server/src/qc/deterministic/rules.test.ts`: `QcRiskTier` equals `RiskTier` (type-level and `RISK_TIERS`); below (null, proposed high/medium/low → nothing), at (proposed unknown → one medium AI/COE pack finding, key `RISK-TIER-UNKNOWN:pack`, pack `absent` evidence, `{ status: 'unknown' }`), above (unavailable across every stage and vendor flag → the same finding with `{ status: 'unavailable' }`); seeded on submit only; severity carried; label keys in both locales. Every finding passes the W0-07 3.4 validator and the owning-lane check.
- New integration `rai-web/tests/integration/w5-10-risk-tier-unknown-qc.test.ts` (5 tests, real Postgres, deterministic runner wrapped to record requests): an answerless submit carries `{ proposed, unknown }`, stores one AI/COE pack finding with 4 rules evaluated, DPO waive 403 and AI/COE waive 201; a High submit (three high answers) carries `{ proposed, high }` and stores nothing; an engine-error submit carries `{ unavailable, null }` and stores the finding with `{ status: 'unavailable' }`; a version with its proposal row removed (as before W5) carries `null` and stores nothing; upload and the three approve attempts carry `null`.
- **Existing tests changed, each named by the W5-10 row or following from it:**
  1. Label `w4a.1` → `w5.1`: `server/src/configuration/seed.test.ts`, `tests/evaluation/identity.test.ts` (added by W4-08a after the plan), `tests/integration/w4-02-rule-catalogue.test.ts` (3), `tests/integration/w4-12-qc-runs.test.ts` (3), `tests/integration/w4a-int-deterministic-server.test.ts` (1), `tests/browser/w4-12-qc-log.spec.ts` (1).
  2. The seeded submit selection gains `RISK-TIER-UNKNOWN`: `w4-02-rule-catalogue` (row item 2), and for the same reason `seed.test.ts` (the v1.0 row list), `server/src/qc/select.test.ts` (two submit lists) and `server/src/qc/deterministic/runner.test.ts` (`rulesEvaluated` of the seeded submit). These two unit files are on section 8's builder list; their expectations change only by the added rule.
  3. `w4-03-deterministic-runner`: submit `rules_evaluated` and `qc.run.completed` `rulesEvaluated` 3 → 4; each fixture submit gains one `RISK-TIER-UNKNOWN` finding (pack, AI/COE) in the four submit assertions.
  4. `w4a-int-deterministic-server`: the same count (two places) and the extra finding through the findings endpoint (three tests); the W4-12 qc-runs row of the submit now has `findingCount` 1.
  5. W4b deterministic-runner suites merged before this ticket that count submit findings (W4-15, W4-17, W4-18): none exist on main, so nothing to change.
  - `runner.test.ts` "never reads document bytes … raises every rule" now also passes an unknown proposal so the run still raises every seeded submit rule (strengthened, not weakened).
- **Ordering fixes in tests (not behaviour changes).** With two findings in one run, finding IDs share a millisecond and their random uuidv7 tail orders them arbitrarily, so a test that compared lists in stored order became flaky: `w4-03`'s `findingRows` orders a run's rows by `rule_id, slot` after `created_at`; `w4a-int`'s `findings()` sorts by rule and slot; `w4-03`'s replay test compares the first and replayed findings sorted by finding ID. Every expected value is otherwise unchanged. Each of the three affected files passed three consecutive runs.
- Upload and approve-attempt runs are unchanged; `test:browser:substitute` (48) is unchanged because the scripted runner ignores `rules`.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **`QcRiskTier` is spelled out in `shared/src/qc/types.ts`** instead of importing `RiskTier` from `schemas/cases.ts`. The import pulled `schemas/cases.ts` and its graph into the in-memory substitute's module graph, which the structural test `fixtures/src/substitutes/qc/no-write-path.test.ts` refuses (a bare self-import in `schemas/slots.ts`). A unit test asserts the two unions are equal, so they cannot drift.
- **Evidence is one pack-level `absent` locator** (artifact, hash and slot null). The rule reads a recorded proposal, not a slot state; the rubric's evidence slot is configuration the runner does not see, so naming slot 1 would guess.
- **Message params `{ status }`** (`unknown` or `unavailable`, keys under the W4-06a param patterns). The th/en text covers both statuses without interpolating the English word.
- **Rule placement in the seed**: after the three W4a metadata rules, before the content rules, in both templates (the label rule of section 9 is unaffected; W4-13c, which depends on W5-10, keeps it and sets `w4b.1`).
- **Replay ordering noticed, not fixed**: a replayed run lists its findings in stored order, which for findings of one run is arbitrary (same `created_at`, random ID tail). No reader depends on the order today; the tests now compare order-independently. Fixing the store order is outside this ticket.
- **Rebase onto W4-08a (#316)**: main gained W4-08a while this branch was in its gate; it moved the pure request builder into `qc/request.ts` and added the evaluation harness. The conflict in `orchestrator.ts` was resolved by loading the proposal in `buildRequest` and passing it to `requestOf`; DEVLOG and CHANGELOG keep both entries, this one on top. No migration on either side. The full gate was rerun on the rebased head (table below), plus `npm run eval:qc`.
- **Local `.env` only**: `RAI_PG_TOOLS=docker-compose:rai-risk` (this lane's compose project; the first integration run failed the W7-01/W7-02 backup tests with `pg_tools_container_not_found` under the `.env.example` value `rai-dev`). `.env` is not committed.

## Commands and results

Worktree `/tmp/rai-w5-10-risk-tier-unknown-qc`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193, `OBS_MIGRATION_ADMIN_URL` on 55383). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-10-risk-tier-unknown-qc-logs/`. No port collision in this run.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/qc/deterministic/rules.test.ts server/src/configuration/seed.test.ts server/src/qc/rule-registry.test.ts` before the code | 6 fail, 28 pass (rule unknown to the runner, label, locale keys) |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w5-10-risk-tier-unknown-qc.test.ts` before the code | 5 fail: `riskProposal` absent from the request |
| GREEN: the unit command (plus `server/src/qc/*.test.ts`, `shared/src/qc/*.test.ts`, locales) | first 3 fail (seeded submit lists in `select.test.ts`, `runner.test.ts`; updated as above), then 74/74 |
| GREEN: the integration command | 5/5 |
| `npm ci` | exit 0 (again after the rebase) |
| First gate, before the rebase: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build && npm run check:substitute-absent`, `npm run test:browser:server`, `npm run test:browser:substitute` | unit first 1 fail (substitute module-graph structural test; fixed by the inline `QcRiskTier`); integration first run: the named W4 expectations (updated per the row) and W7-01/W7-02 (`RAI_PG_TOOLS`, local env); then all exit 0: unit 1217 pass, integration 500 pass, 1047 files scanned with 0 markers, browser server 244 passed, substitute 48 passed |
| Rebased onto `origin/main` `e4c6cbe` (W4-08a); full gate rerun: | |
| `npm run eval:qc` | exit 0; failures 0 (report under `.local/eval/`, git-ignored) |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | first 1 fail (`tests/evaluation/identity.test.ts` asserts the seeded label `w4a.1`, a W4-08a test of the same kind as row item 1; set to `w5.1`), then exit 0, 1253 pass, 0 fail |
| `npm run test:integration` | exit 0, 500 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 1063 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 244 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 525 Markdown files, 1422 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |
| Rebased again onto `origin/main` `7d81ab8` (W7-16: a docs note and `server/src/deployment-readiness.test.ts`; only DEVLOG and CHANGELOG overlapped, both entries kept). Rerun: | |
| `npm run typecheck`; `npm run lint` | exit 0; exit 0 |
| `npm run test:unit` | exit 0, 1260 pass, 0 fail (includes W7-16's test, 7 pass) |
| `node scripts/check-links.mjs` (root); `git diff --check origin/main...HEAD` | exit 0, 530 Markdown files, 1455 links, 0 broken; exit 0 |
| Integration and browser suites | not rerun after this rebase: W7-16 changes no code they exercise (the 1422-link / 500 / 244 / 48 results above are on `e4c6cbe` plus this branch) |

## Review verdicts

To be recorded by the independent reviewers on the PR head.
