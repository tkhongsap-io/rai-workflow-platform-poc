# Review: draft risk answers (W5-04, #222)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 9 (W5-04 row), sections 2, 4, 6 and 12 (the plan wins over issue #222). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)" (R-3 answers on the draft, R-13 no free text). D07 stays open for AI/COE: answers are validated against the labelled synthetic placeholder rubric, not the approved instrument. Synthetic data only; no network call, no model, no deploy. No migration (W5-03 added the column).

## Change

- **Shapes** (`shared/src/schemas/pack.ts`): `RiskAnswerSchema` `{ value, answeredBy, answeredByName?, answeredRole, answeredAt }`; `PackDraft.riskAnswers` (required, `{}` when none); `PackDraftUpdateRequest.riskAnswers?` as a record from `^RQ[1-9]$` to an option value (`^[a-z][a-z0-9_]{0,39}$`) or `null`, `additionalProperties: false`, at most 20 keys. Free text and malformed keys fail the shape (422 `invalid_input` under `body.riskAnswers`).
- **Pure helpers** (`server/src/pack/risk-answers.ts`, new): `riskAnswerProblems` (step 4 against the rubric in force), `mergeRiskAnswers` (attribution kept on an unchanged value, replaced on a change, `null` removes), `riskAnswerAuditRefs`, `storedRiskAnswers` (defensive read of the jsonb column).
- **Save** (`server/src/pack/service.ts`): `validateValues` checks `riskAnswers` against the `risk_rubric` revision in force at the save's `now`, collecting its errors with the other field errors into the one 422: `error.risk.not_configured` at `body.riskAnswers` for a non-null answer with no rubric in force; `validation.not_in_configured_list` at `body.riskAnswers.<questionId>` for an unknown question or option. `saveDraft` merges and writes the answers (`updateDraftRiskAnswers`, only when something changed), adds `risk_answers` to `changed_fields` when it did, and adds `targetRef.risk_answers = [{ question_id, value }]` when the request carried answers.
- **Read** (`server/src/pack/repository.ts` `packDraftView`, `service.ts` `readDraft`, `routes.ts`): `riskAnswers` from the column, with `answeredByName` from the subject directory when it resolves (W3-F1 `readNames`). `compose-app-deps.ts` hands the pack routes the same directory the case and version routes use.
- **Successor copy** (`server/src/workflow/repository.ts` `ensureSuccessorDraft`): the N+1 insert copies `risk_answers` from the parent, attribution included.
- **Substitute** (`fixtures/src/substitutes/api/store.ts`, `workflow.ts`): `riskAnswers: {}` in the three `PackDraft` literals, exactly the plan's section 7 edit.
- **Locale**: `error.risk.not_configured` in `th.json` and `en.json` (a `FieldError.messageKey` must be a `LocaleKey`).
- **Spec amendment**: W0-02 (`implementation-plan-w1-w3.md`) section 7.5 gains the dated "W5-04 amendment (2026-09-27)" note (both shapes, the two 422 rows, attribution, audit refs, successor copy).

## Tests

- New unit `server/src/pack/risk-answers.test.ts` (12 tests): validation (options, `unknown`, `null`, unknown question and option, not configured, clears always allowed), merge (new, unchanged keeps attribution, changed replaces, clear, absent clear, no mutation), audit refs, defensive column read, request and `PackDraft` shapes.
- New integration `tests/integration/w5-04-risk-answers.test.ts` (8 tests): owner save with attribution, stored without names, returned with the name, audited as IDs and values (no name in the audit event or the log); attribution kept until changed (owner then BU SPOC) and an unchanged re-send lists no changed field; clear and absent clear, and a save without `riskAnswers` keeps them and the pre-W5 audit shape; 422 `not_in_configured_list` collected with a template-version error, nothing written; 422 shape failures (lower-case ID, `RQ10`, free text, object, number, array), nothing written; 422 `error.risk.not_configured` on a database with no `risk_rubric`, while a clear saves; DPO and Admin 403; freeze at submit (the submitted row keeps the answers, the draft route answers 409, a direct UPDATE raises `rai.frozen_version`).
- `tests/integration/w2-03-successor-draft.test.ts`: one added test: the send-back successor starts with the parent's answers and attribution (API and row), and a second send-back reuses the draft with the owner's later edit intact. Existing tests unchanged.
- No existing assertion changed. `draft.saved` keeps its exact `{ changed_fields, slots }` shape whenever the request has no `riskAnswers`, so the W1-04 `deepEqual` checks pass untouched.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **Rubric lookup uses `currentBody`** (the W1-00 activation rule already used for the template list) rather than the `revisionsInForce` plus `readRevisionById` pair section 4 names; the result is the same revision, in one query.
- **`null` is always accepted**, with or without a rubric and for a question the rubric no longer has. Section 2 refuses "an answer" when no rubric is in force; a clear is not an answer, and refusing it would strand an answer given under an earlier rubric (`not_in_rubric` in W5-05).
- **Audit ref scope**: `targetRef.risk_answers` lists every answer the request carried (as `slots` lists every slot the request carried), and appears only when the request had `riskAnswers`, so existing `draft.saved` shapes are unchanged. `changed_fields` names `risk_answers` only when the stored answers actually changed (as for `stage_context`).
- **An unchanged value keeps its attribution** and is not rewritten; only a different value takes the new answerer ("attribution stays with the original answerer until someone changes the answer", section 4, applied to the draft as well as the successor).
- **`answeredByName`** is resolved on read through the existing subject directory (W3-F1), never stored, so no name enters the column, the audit or the logs. This needed the pack routes to receive the directory (`compose-app-deps.ts`, one line), a file outside the row's "Main paths".
- **New file `server/src/pack/risk-answers.ts`** holds the pure helpers so they are unit-tested without a database; `pack/service.ts` and `pack/repository.ts` call them as the plan says.
- **The frozen-version check** reuses the W5-03 trigger with no code change; the W5-04 test proves it through the route and the row.
- **Local `.env` only**: `RAI_PG_TOOLS=docker-compose:rai-risk` (this lane's compose project, needed by the W7-01 backup tests) instead of `.env.example`'s `rai-dev`. `.env` is not committed.

## Commands and results

Worktree `/tmp/rai-w5-04-draft-risk-answers`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193, `OBS_MIGRATION_ADMIN_URL` on 55383). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-04-draft-risk-answers-logs/`. Hard-coded test ports (`tests/support/fixture-app.ts` 8787 for the in-process adapter, `tests/browser/w1-int-evidence-config.spec.ts` 8789/5175) did not collide in this run.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `node --import tsx --conditions=rai-source --test server/src/pack/risk-answers.test.ts` before the code | failed for the right reason: `./risk-answers.js` does not exist |
| RED: `node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w5-04-risk-answers.test.ts tests/integration/w2-03-successor-draft.test.ts` before the code | 6 pass, 8 fail: `riskAnswers` absent from every draft response, and the request's `riskAnswers` silently dropped as an unknown key instead of stored or refused (the 403 test and the five existing W2-03 tests passed) |
| same commands after the code | unit 12/12; integration 12/14 on the first run: two test-harness mistakes, fixed in the test (a `TRUNCATE configuration_revision CASCADE` also removed the fixture cases, so the not-configured test now creates its own case after the truncate; the frozen-row assertion now reads the driver error's `cause`, `rai.frozen_version`); then 8/8 and 6/6 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 820 pass, 0 fail |
| `npm run test:integration` | exit 0, 403 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 735 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 205 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 406 Markdown files, 1162 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |

## Review verdicts

To be recorded by the independent reviewers on the PR head.
