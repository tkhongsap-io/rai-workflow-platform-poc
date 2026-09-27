# Review: risk proposal at submit; `case.risk_tier` (W5-05, #229)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 9 (W5-05 row), sections 0, 2, 4, 5, 8 and 12 (the plan wins over issue #229). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)" (R-4 in-transaction scoring, R-5 missing evidence is Unknown, R-6 exact bounds, R-9 tier codes, R-10 `case.risk_tier`). D07 stays open for AI/COE: every proposal is scored against the labelled SYNTHETIC PLACEHOLDER rubric `synthetic-placeholder.1`, never the approved instrument. Synthetic data only; no network call, no model, no deploy. No migration (W5-03 added the table).

## Change

- **Proposal** (`server/src/risk/propose.ts`, new): `proposalOutcome` (pure) turns the frozen `risk_rubric` revision, the frozen answer values and the frozen slot states into the proposal's columns: `proposed` (tier, bounds, rubric id and label, `ENGINE_VERSION`, `inputsHash`, explanation of `questions`, `counts`, `matchedRule`, `escalation`, `unknownCount`) or `unavailable` with `not_configured` (no rubric frozen), `rubric_invalid` (frozen body fails `RiskRubricBodySchema` or `riskRubricBodyProblems`, or the frozen id names no row) or `engine_error` (the engine threw; the error is returned, never thrown). `proposeAtSubmit` reads the frozen revision, scores, and inserts the row through `server/src/risk/repository.ts` `insertRiskProposal` (new; the only writer). Helpers `tierForCase`, `answerValuesOf` (attribution dropped before scoring), `slotStatesOf`, `riskAuditRef`.
- **Submit** (`server/src/versions/service.ts`): in `submitDraft` `apply`, right after `freezeDraft`, `proposeAtSubmit` runs on the version just frozen (`frozen.byKind.risk_rubric`, the frozen `risk_answers`, the slot rows already read for the manifest); `closeDraftOnCase` writes the tier; `risk.proposed` is audited after `version.submitted` / `version.resubmitted` and before `lane.opened`. After the transaction, for a fresh (not replayed) result only, `risk.proposal.recorded` or `risk.proposal.unavailable` is logged and an engine error goes to `errors.internal`. `VersionServiceDeps` gains `emitter`, `errors` and the test seam `riskEngine`; `server/src/app.ts` hands the version routes the app's `emitter` and `errors`.
- **Projection** (`server/src/versions/repository.ts` `closeDraftOnCase`): takes `riskTier` and writes it in the same UPDATE, under `rai.workflow_write`; header comment corrected ("`risk_tier` is untouched" removed). `server/src/cases/repository.ts`: the "null throughout slice 1" comment corrected; the column is cast to the widened type.
- **Audit** (`server/src/audit/store.ts`): `risk.proposed` in `AUDIT_ACTIONS` (workflow group).
- **Logs** (`server/src/observability/log.ts`): `risk.proposal.recorded` (info) and `risk.proposal.unavailable` (error), with exactly the section 8 fields.
- **Shared** (`shared/src/schemas/cases.ts`): `RISK_TIERS` and `RiskTier = 'high' | 'medium' | 'low' | 'unknown'` replace the opaque placeholder.
- **Docs** (dated W5-05 notes, 2026-09-28): W0-06 4.3 (postcondition (h), audit row, "After commit" no longer writes the tier), 4.6 audit row, 9.2 closing note (`risk_answers` frozen by the whole-row comparison), 9.4 (`risk.proposed` row); W0-04 `risk_tier` writer text and the W5 checklist item; W0-10 section 3.3 (two events); W0-02 7.3 (`RiskTier` union, `CaseView.riskTier`).

## Tests

- New integration `tests/integration/w5-05-risk-submit.test.ts` (10 tests): no answers (all-Unknown, bounds low…high, row columns, `case.risk_tier` and `CaseView.riskTier` `unknown`, audit order `version.submitted` → `risk.proposed` → `lane.opened` × 3 and the exact target ref, the exact log line); partial answers (one low → unknown; three high → High despite four unanswered, `matchedRule` high/0); all seven low → Low, and a Low-tier case with no approvals is not Ready (three lanes, no `case.ready_for_launch`); `evidence_not_attached` (slot 1 `not_yet` → every question Unknown with its value kept, never Low); `not_configured` (no rubric; unavailable, NULL tier, exact audit ref and log line); `rubric_invalid` (a corrupt revision written directly as the owner); injected `engine_error` through the `riskEngine` seam (submit commits, 201, error captured, audit order intact); resubmit (v2 High, `case.risk_tier` follows, v1 row byte-identical); High opens all three lanes and an Idempotency-Key replay writes no second proposal, audit or log line; no answer value, question text or name in the log lines or the audit ref.
- New unit `server/src/risk/propose.test.ts` (7 tests): every outcome, `tierForCase`, the helpers, and `riskAuditRef` against `validateAuditRef` (a label that is not a ref string is recorded as null).
- New unit `server/src/risk/module-graph.test.ts` (4 tests): `workflow/ready.ts` and `authz/policy.ts` transitively reach no module under `server/src/risk/` or `shared/src/risk/` (resolving relative and `@rai/shared/*` imports); a positive control proves the walk finds `risk/propose.ts` from `versions/service.ts`; no `ACTIONS` entry or policy row names risk.
- **The four intended changes the plan names**, each exactly as the W5-05 row states:
  1. `tests/integration/w1-05-submit.test.ts` projections test: `risk_tier` left `PROJECTIONS`; renamed "…readiness not_ready; risk tier is the recorded proposal"; asserts `risk_tier` NULL before and `'unknown'` after, and `view.riskTier = 'unknown'`.
  2. `tests/integration/w1-05-submit.test.ts` audit allow-list gains `'risk.proposed'`.
  3. `tests/integration/w2-01-lanes.test.ts` "risk_tier = high still opens all three lanes": the raw `UPDATE … risk_tier = 'high'` precondition is replaced by three high answers saved on the draft (slot 1 asserted attached); asserts the proposal row `proposed`/`high`, `case.risk_tier = 'high'`, three `lane.opened` in lane order and the notification count. File header updated.
  4. `server/src/audit/store.test.ts` names `risk.proposed`.
- One further existing test adapted (see Deviations): `tests/integration/w5-03-risk-migration.test.ts`.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent or its test list is incomplete; each keeps the plan's contracts.

- **`w5-03-risk-migration.test.ts` preconditions adapted** (not in the plan's list of intended changes). Three of its tests submitted a version and then inserted a `submit` proposal by hand; now that submit writes that proposal itself (the plan's own contract change), those hand inserts hit the unique index. No guard assertion changed: the append-only test and the consistency test's last insert now use `trigger = 'recheck'` rows, and the unique-index test asserts that the submit wrote exactly one `submit` proposal and that a second one still violates `risk_proposal_one_submit_per_version_key`. Every guard (append-only for all roles, the unique index, the CHECK) is still exercised with the same expected errors.
- **`risk.proposed` target ref gains `unavailable_reason`** beyond the section 8 list, so the audit trail alone says why a proposal is unavailable (an enum; no text).
- **`rubric_label` in the audit ref is null when the label is not a valid audit ref string** (the rubric body allows up to 100 characters of text; the audit store refuses whitespace and more than 64 characters). The `risk_proposal` row keeps the full label and the ref always carries `rubric_revision_id`. Without this, an Admin-published label with a space would fail every submit.
- **Post-commit logging**: the `risk.proposal.*` line is emitted after the transaction commits and only for a fresh result, so a rolled-back or replayed submit logs nothing (as the section 8 events are facts about recorded rows). An engine error goes to `errors.internal` at the same point.
- **Test seam `riskEngine`** on `VersionServiceDeps` (absent in production; `compose-app-deps.ts` never sets it) for the plan's "injected engine error still commits"; the test calls `submitDraft` directly with the fixture app's `emitter` and `errors`, as other suites call services directly.
- **`app.ts` passes `emitter` and `errors` to the version routes** (two lines; the file is outside the row's "Main paths"). `AppDeps.versions` already excluded both as injected dependencies.
- **A frozen `risk_rubric` id that names no row** is recorded as `rubric_invalid` (corruption), not as `not_configured`.
- **`durationMs`** measures scoring and hashing only (not the insert), in milliseconds with microsecond precision.
- **Extra unit tests** beyond the row: the pure outcome builder, and "no policy action or row names risk" (section 6's unit test), placed with the module-graph test because both prove the tier gates nothing.
- **W0-02 7.3 note and the W0-04 checklist tick** added (section 12 assigns the `RiskTier` replacement to W5-05).
- **Local `.env` only**: `RAI_PG_TOOLS=docker-compose:rai-risk` (this lane's compose project, needed by the W7-01 backup tests) instead of `.env.example`'s `rai-dev`. `.env` is not committed.

## Commands and results

Worktree `/tmp/rai-w5-05-risk-proposal-at-submit`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193, `OBS_MIGRATION_ADMIN_URL` on 55383). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-05-risk-proposal-at-submit-logs/`. Hard-coded test ports (`tests/support/fixture-app.ts` 8787 for the in-process adapter, which never listens) did not collide in this run.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w5-05-risk-submit.test.ts` before the code | 9 fail, 1 pass: no `risk_proposal` row for any submitted version ("exactly one proposal per submitted version: 0 !== 1"); the PII test passed vacuously (no lines yet) |
| RED: `NODE_ENV=test node --import tsx --conditions=rai-source --test server/src/risk/*.test.ts server/src/audit/store.test.ts` before the code | 3 fail: `risk.proposed` not in `AUDIT_ACTIONS`; the positive module-graph control (no `risk/propose.ts`); `propose.test.ts` cannot import `./propose.js` |
| the same two commands after the code (plus `w1-05-submit` and `w2-01-lanes`) | unit 41/41; integration 32/32 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 947 pass, 0 fail |
| `npm run test:integration` | first run 420/423: the three `w5-03-risk-migration` preconditions above; after adapting them, exit 0, 423 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 855 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 205 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 427 Markdown files, 1203 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |

## Review verdicts

To be recorded by the independent reviewers on the PR head.
