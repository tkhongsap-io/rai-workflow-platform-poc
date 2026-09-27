# Review: risk proposal read endpoint (W5-06, #238)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 9 (W5-06 row) and section 6 (the endpoint row, `RiskProposalView`, "No new policy row"), R-14 (the plan wins over issue #238). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)". D07 stays open for AI/COE: every rubric served is the labelled SYNTHETIC PLACEHOLDER `synthetic-placeholder.1`. Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Route** (`rai-web/server/src/risk/routes.ts`, new): `GET /api/cases/{caseId}/versions/{versionId}/risk-proposal`, `config.auth` = W0-05 `version.view` on the case (the middleware answers 401, 403 and the unknown-case 404), then the qc-runs 404 rule (malformed, unknown or other-case version → `404 not_found` `version`) and also 404 for a draft (`submitted_at IS NULL`). `200 { proposal: null }` for a submitted version with no `submit` proposal (submitted before W5); otherwise the view. Reads only.
- **View** (`rai-web/server/src/risk/view.ts`, new, pure): `riskProposalView` maps the stored row to `RiskProposalView`: stored tier, `bounds` from `lowest_tier`/`highest_tier`, `councilConfirmation` (`councilConfirmationOf`: `required` for `high`, `possible` for `unknown` with highest `high`, else `not_indicated`), `rubric` from the revision the row names (the version's frozen revision; null when none or when its body fails `RiskRubricBodySchema` / `riskRubricBodyProblems`), `createdAt` ISO, and the stored explanation with each frozen answer's `answeredBy`, `answeredRole`, `answeredAt` and resolved `answeredByName` merged in (`answererIds` lists the subjects to resolve).
- **Repository** (`rai-web/server/src/risk/repository.ts`): `readSubmitProposal(exec, versionId)`, the version's `submit` row.
- **Shared** (`rai-web/shared/src/schemas/risk.ts`, new): `RiskProposalViewSchema`, `RiskProposalQuestionSchema`, `RiskProposalResponseSchema`, `RISK_COUNCIL_CONFIRMATIONS` and the types; the route's 200 response schema.
- **App** (`rai-web/server/src/app.ts`): `registerRiskRoutes` inside the version routes' registration, with the same database and subject directory.
- **Docs**: W0-02 section 7.7 dated W5-06 amendment (`docs/engineering/implementation-plan-w1-w3.md`).

## Tests

- New integration `rai-web/tests/integration/w5-06-risk-proposal-read.test.ts` (7 tests, real Postgres, fixture app): a High proposal (three high answers) reads with bounds high…high, Council `required`, the frozen rubric equal to the seed's questions and tier labels, the stored explanation and RQ1's attribution with the owner's display name, no attribution on an unanswered question, and the read writes no proposal, audit event or run; an all-Unknown proposal reads `unknown`, low…high, Council `possible` for owner, BU SPOC and Admin; `not_configured` reads `unavailable` with tier, bounds, rubric, explanation and hash null and Council `not_indicated` (never Low); a submitted version with no proposal row reads `{ proposal: null }`; after a newer `risk_rubric` revision (`synthetic-placeholder.2`, changed question text) is published and in force, v1 still reads its frozen revision id, label and questions; the 401/403/404 matrix is identical, status and error code, to the qc-runs read for seven sessions over five targets; a draft is 404 `version` for everyone in scope and 403 for another owner.
- New unit `rai-web/server/src/risk/view.test.ts` (4 tests): the Council rule; a proposed view (schema-valid, bounds, frozen rubric, attribution and names merged only where an answer is stored); an unavailable view (all null, never Low); an invalid frozen rubric body served as `rubric: null`.
- No existing test changed.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **Registered with the version routes** in `app.ts` rather than as a new `AppDeps` group: the read needs exactly the version routes' database and subject directory, so `main.ts`, `compose-app-deps.ts` and the test harness are unchanged.
- **The read serves the version's `submit` proposal.** `recheck` rows are W6-19's; which one a later read prefers is W6-19's to decide when it writes them.
- **`explanation.questions[].evidence.state` admits null** (the engine's stored type): null when the version holds no row for the slot, which the engine counts as not attached. The plan's sketch writes `SlotStateName`.
- **`councilConfirmation` is `not_indicated` for an `unavailable` proposal**, the literal reading of the section 6 comment; the UI (W5-08) shows `unavailable` as its own state, never Low.
- **A draft is 404 `version`** (section 6 "404 for a draft"), including for reviewers and Admin; the draft's qc-runs read still lists its upload runs (W4-12), so the two reads differ only here, as the plan states.
- **Answerer names** resolve through the same `readNames` memo the version reads use (W3-F1); no name is stored or logged.
- **Local `.env` only**: `RAI_PG_TOOLS=docker-compose:rai-risk` (this lane's compose project, needed by the W7-01 and W7-02 backup tests) instead of `.env.example`'s `rai-dev`. `.env` is not committed.

## Commands and results

Worktree `/tmp/rai-w5-06-risk-proposal-read-endpoint`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193, `OBS_MIGRATION_ADMIN_URL` on 55383). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-06-risk-proposal-read-endpoint-logs/`. Hard-coded test ports (`tests/support/fixture-app.ts` 8787 for the in-process adapter, which never listens) did not collide in this run.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test node --import tsx --conditions=rai-source --test server/src/risk/view.test.ts` before the code | fail: cannot import `./view.js` |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w5-06-risk-proposal-read.test.ts` before the code | 7 fail: every read 404 (no such route; anonymous 404 where qc-runs answers 401) |
| the same two commands after the code | unit 4/4; integration first 6/7 (a sign-in inside the "writes nothing" count window; the sign-in moved before the count, no assertion changed), then 7/7 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | first run exit 2 (`SlotNumberSchema`'s mapped union infers `never`; replaced by a literal tuple in `schemas/risk.ts`), then exit 0 |
| `npm run test:unit` | exit 0, 1049 pass, 0 fail |
| `npm run test:integration` | first run 450/456: the six W7-01/W7-02 backup tests failed `pg_tools_container_not_found` (`.env` still named `rai-dev`); with `RAI_PG_TOOLS=docker-compose:rai-risk`, exit 0, 456 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 931 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 217 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 469 Markdown files, 1314 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |

## Review verdicts

To be recorded by the independent reviewers on the PR head.
