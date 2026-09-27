# Review: questionnaire UI in the pack editor (W5-07, #230)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 9 (W5-07 row) and section 7 (the plan wins over issue #230). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)" (R-2 banner, R-4 non-recorded preview, R-13 values only, R-16 optional rubric read and the substitute route). D07 stays open for AI/COE: the questionnaire shows the labelled synthetic placeholder rubric, never the approved instrument. Synthetic data only; no network call, no model, no deploy. No migration, no server change.

## Change

- **API client** (`web/src/api/client.ts`): `API_PATHS.riskRubric` and `getRiskRubric()`, answering the W5-02 `RiskRubricView` or `null` on a 404 (as `getFixtureUsers` does); every other failure throws.
- **View model** (`web/src/screens/case/risk-questionnaire.view-model.ts`, new): `rubricStateFromValue` / `rubricStateFromError` (404 → `not_configured`, anything else → `unavailable`), `applyRiskAnswerChange` (a value equal to the saved one, or a clear of an unsaved one, is not pending), `effectiveRiskAnswers`, `riskPendingCount`, `previewRiskScore` (the shared `scoreRisk` over the effective answers and the editor's pending-merged slot states), `councilNoticeOf` (High → required; Unknown that could be High → possible), `riskTierLabel` (rubric `tierLabels` first, `risk.tier.*` fallback), `riskAnswerChoices` (options in rubric order, then Unknown), `riskQuestionOfFieldPath`.
- **Banner** (`web/src/components/placeholder-rubric-banner.tsx`, new): `role="note"`, `risk.placeholder.banner`, rendered only for `provenance: 'synthetic_placeholder'`.
- **Questionnaire** (`web/src/screens/case/risk-questionnaire.tsx`, new), mounted by `pack-editor.tsx` under the slot table: reads the rubric once; seven `fieldset`/`legend` groups of native radios (options plus "Unknown / not yet known"), a clear button per question (disabled when nothing is chosen), the evidence hint naming slot 1 and its current state, the saved answer's attribution (name, role, Bangkok time) or "changed, not saved yet", inline field errors from `body.riskAnswers.RQn`, and the preview (tier as text plus glyph, the range when Unknown, the Council line). Read-only (disabled) for non-writers and while saving or submitting. `not_configured` and `unavailable` are one muted line each; neither is an error notice and neither disables anything.
- **Pack editor and case screen**: `PendingSettings.riskAnswers` holds changed answers; the unsaved count adds them (the settings count is now explicit per field, so the new key does not count as one change); `onSave` sends `riskAnswers` in the one `PackDraftUpdateRequest`; discard and reload already clear the pending settings.
- **Substitute** (`fixtures/src/substitutes/api/routes-cases.ts`): `GET /api/configuration/risk-rubric/current` (`config.read_effective`) answers `CONFIGURATION_SEED.risk_rubric` as a `RiskRubricView` under a fixed synthetic revision ID (R-16). Its README lists the drift: answers are accepted and not stored, nothing is scored.
- **Locale**: 21 `risk.*` keys in `th.json` and `en.json` (section 7 list, the parts this ticket renders); styles in `case.css` and `styles.css`.

## Tests

- New unit `web/src/screens/case/risk-questionnaire.view-model.test.ts` (11 tests): ready / not configured (null and 404) / unavailable; pending changes and the count; effective merge without mutation; preview all-Unknown, High settled with four open, slot 1 not attached makes every answer Unknown (never Low); Council required / possible / none; tier labels from the rubric in both locales with key fallback; choices order; field-error paths. Uses the W5-01 agent-team synthetic `testRubric()` (web may not import `@rai/server`).
- `web/src/api/client.test.ts`: one added test (view, 404 → `null`, 500 throws, the path).
- `fixtures/src/substitutes/api/cases.test.ts`: one added test (the seed body, label, provenance, revision ID and date for owner, DPO and Admin; 401 without a session).
- New browser `tests/browser/w5-07-risk-questionnaire.spec.ts` (3 tests × 3 widths, real server): banner, seven groups, evidence hint, all-Unknown preview with range, three high answers → High with the Council line, nothing stored before save, the one PUT carries exactly the changed answers, attribution after save, submit enabled again; English text from the rubric and the locale; clear → Unknown with "may require", saved; axe (th and en) and no horizontal scroll; keyboard-only answering with native radios (Space, arrow keys, Tab to clear and Save); a 404 on the rubric read (Playwright route) shows "not configured", no error notice, no banner, and save and submit still work.
- No existing assertion changed.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **`case-screen.tsx` gains one line** (the save body carries `riskAnswers`), a file outside the row's "Main paths": the pending-change state and the save request live there, and the plan says answers "save through the existing save-draft request". Pending answers ride on `PendingSettings` so no new state or prop was added to the screen.
- **The preview is `aria-live="polite"`, not `role="status"`**: the editor's save notice is the page's one `role="status"`, and existing specs locate it with `getByRole('status')` in strict mode.
- **The rubric is read by the questionnaire itself**, not in `case-screen.tsx`'s `loadAll`, so a failure there can never fail the case load (R-16: "optional to the rest of the screen").
- **A non-404 failure** (for example 500) renders a one-line `risk.questionnaire.unavailable` note, treated like "not configured" (never an error banner); the plan names only the 404 path.
- **The preview shows the Council line** (`risk.council.required` / `risk.council.possible`) under the preview label, reusing the W5-08 keys, so the owner sees before submit that a High tier needs RAI Council confirmation. It records nothing.
- **Locale keys beyond section 7's list**: `risk.questionnaire.{heading,intro,not_configured,unavailable,rubric_label}`, `risk.answer.{clear_label,unsaved}`, `risk.answered_by` and `risk.preview.tier`, needed by the editor. The W5-08 keys (`risk.heading`, `risk.not_governance`, `risk.unavailable.*`, `risk.unknown_reason.*`, `risk.explanation.*`) are left to W5-08.
- **RED for the browser spec** was observed by building with `pack-editor.tsx` and `case-screen.tsx` restored from `origin/main` (the other new files present but unmounted): all three tests failed on the missing `[data-risk-questionnaire]`, and the other 69 desktop tests passed.
- **Local `.env` only**: `RAI_PG_TOOLS=docker-compose:rai-risk` (this lane's compose project; the W7-01 backup tests failed with `pg_tools_container_not_found` under `.env.example`'s `rai-dev`, then passed). `.env` is not committed.

## Commands and results

Worktree `/tmp/rai-w5-07-questionnaire-ui-in-the`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193, `OBS_MIGRATION_ADMIN_URL` on 55383). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-07-questionnaire-ui-in-the-logs/`. Hard-coded test ports (8787 in-process adapter, 8789/5175 in `w1-int-evidence-config.spec.ts`) did not collide in this run.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `node --import tsx --conditions=rai-source --test web/src/screens/case/risk-questionnaire.view-model.test.ts web/src/api/client.test.ts fixtures/src/substitutes/api/cases.test.ts` before the code | 3 failed for the right reasons: the view model module did not exist, `getRiskRubric is not a function`, and the substitute answered 404 for the rubric route |
| RED: `npx playwright test -c tests/browser/playwright.config.ts w5-07 --project=desktop-1440` with the editor mount reverted | 3 failed (`[data-risk-questionnaire="ready"]` not found), 69 passed |
| same unit command after the code | 58 pass, 0 fail (with `shared/src/locales/locales.test.ts`) |
| `npx playwright test -c tests/browser/playwright.config.ts tests/browser/w5-07-risk-questionnaire.spec.ts` | first run 6 passed, 3 failed on one extra assertion of my own (focus after save: the Save button disables, so focus returns to the body, as on `main`); the assertion was removed; then 9 passed |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 975 pass, 0 fail |
| `npm run test:integration` | first run 425 pass, 4 fail (W7-01 backup: `pg_tools_container_not_found`, local `RAI_PG_TOOLS` pointed at `rai-dev`); after setting it to `docker-compose:rai-risk`: exit 0, 429 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 867 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 214 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 444 Markdown files, 1253 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |

After rebasing onto `origin/main` `ce87a4a` (W4-05d; only DEVLOG and CHANGELOG conflicted, resolved as a union), the whole gate was run again on the rebased head:

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 1001 pass, 0 fail |
| `npm run test:integration` | exit 0, 429 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 879 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 214 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 449 Markdown files, 1267 relative links, 0 broken |
| `git diff --check origin/main...HEAD` (root) | exit 0 |

## Round 1 (2026-09-28)

Rebased onto `origin/main` `75c9b92` (W6-03, after W7-02 and W5-05); only DEVLOG and CHANGELOG conflicted, resolved as a union with W5-07 on top. No migration on this branch.

Fixes taken from the round-1 review:

- **Rebase gate, environment only**: W7-02 (#216) added `DATABASE_ADMIN_URL`; this worktree's local `.env` lacked it, so `tests/integration/w7-02-backup-restore.test.ts` exited 78 (`missing:DATABASE_ADMIN_URL`). The local `.env` now sets it to this lane's Postgres (`127.0.0.1:55383/postgres`). No code change; `.env` is not committed.
- **Empty `aria-describedby` target**: a question with neither help text nor an evidence slot pointed `aria-describedby` at an empty hint. The fieldset now carries `aria-describedby` and the hint only when there is something to say. RED first: a new browser test (the real rubric with RQ1's `evidenceSlot` and `help` removed through a Playwright route) failed on `aria-describedby="risk-RQ1-hint"`, then passed after the fix. The seeded rubric gives every question slot 1, so the shipped page is unchanged.
- **spec.md drift**: now names `rubricStateFromValue` / `rubricStateFromError`, lists `risk.preview.tier` (not `risk.preview.unknown_count`, which was never added) and gives `riskTierLabel` its `t` parameter.
- **plan.md step 5**: no W0-02 note is needed; the rubric route is already in W0-02 (added by W5-02) with the same shape.

Deferred (non-blocking, recorded for a later ticket):

- The rubric is read once per mounted editor; if a new revision is published mid-session the options can be stale. The server still rejects a stale option inline at `body.riskAnswers.RQn`.
- The substitute accepts `riskAnswers` on save but does not store them (drift listed in its README); no substitute test covers a save carrying `riskAnswers`.

## Review verdicts

| Round | Reviewer | Head | Verdict | Notes |
| --- | --- | --- | --- | --- |
| 1 | independent reviewer A | `2f3a560` | pass with polish | tsc, lint, unit (1001) green; spec.md drift and plan.md step 5 note (fixed in round 1) |
| 1 | independent reviewer B | `2f3a560` | pass, non-blocking notes | stale rubric mid-session and substitute not storing answers (deferred); empty `aria-describedby` hint (fixed in round 1) |
| 1 | rebase check | `ec9f697` | rebase broke the gate (environment) | `w7-02-backup-restore` exited 78 on the missing local `DATABASE_ADMIN_URL` (fixed in the local `.env`) |

Round-1 gate, one suite at a time on the round-1 head (rebased onto `75c9b92`, with the fixes above), logs `r2-*.log`:

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `npm run test:browser:server -- w5-07 --project=desktop-1440 -g dangling` before the fix | 1 failed: `aria-describedby` was `risk-RQ1-hint` |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 1032 pass, 0 fail |
| `npm run test:integration` | exit 0, 437 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 907 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 217 passed (the new test × 3 widths) |
| `npm run test:browser:substitute` | exit 0, 48 passed |
| `node scripts/check-links.mjs` (root) | exit 0; 457 Markdown files, 1287 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |
