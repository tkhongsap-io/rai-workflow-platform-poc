# Review: W1-06 — case overview, nine-slot pack editor and version navigation

2026-09-22. Ticket W1-06 (issue #22), lane B, owner type Agent-eligible. Branch `codex/w1-06-case-pack-versions`, worktree `/Users/tkhongsap/github/rai-wt/W1-06`, Postgres `rai-w1-06` on port 54326 (only for the unchanged integration and real-server browser suites). Plan recorded before code in [plan.md](plan.md). Proves A02 **on the W1-13 substitute only**: substitute runs are development aids, never acceptance evidence (W0-02 section 8.1); A02 is realised when W1-INT runs the same spec against the real server. Decision implemented: D12 (every user-facing string through the locale catalogue, Thai default; dates in Asia/Bangkok). No decision recorded; D07-D10 untouched; the frozen source spec untouched; no server, substitute or fixture file edited. Board and DEVLOG/CHANGELOG entries are appended by the merge step.

**Fixture set: `fixture set slice1-synthetic@1 7c80ccd43663`** (`rai-web/fixtures/src/data/manifest.json`, unchanged).

## What landed

- **`rai-web/web/src/api/client.ts`** (W1-07's typed client, extended; fix round 4) — the case-flow calls: `getDraft`, `saveDraft` (7.5), `uploadArtifact` (multipart, one `file` part) and `getArtifactMeta` (7.4), `listVersions`, `getVersion`, `submitDraft` with the caller-minted `Idempotency-Key` (7.6), `artifactDownloadPath`; `RequestOptions.form` for a multipart body (the browser sets the boundary); `ApiError.stale` exposes the 409 details (guidance key, current version, `refreshPath`). Tests in `client.test.ts`.
- **`rai-web/web/src/screens/case/`** — the W1-06 module, one flow:
  - `case-screen.tsx` — mounted by W1-07's `router.tsx` behind `RequireSession` at `/cases/:caseId` (open draft, or a redirect to the latest version when no draft is open) and `/cases/:caseId/versions/:versionId` (`ROUTES.caseVersion`); loads configuration, case, version list → draft (when `CaseView.draft` is not null) → artifact metadata through `api`; renders the overview, the version navigation and either the editor or the frozen version inside the shell. A 401 from any call drops the session (`useSession().signedOut('revoked')`) so `RequireSession` shows sign-in with `returnTo`; a 403 or 404 renders the envelope's message key through the shared `ErrorNotice`. **No client-side check decides access**: the editor's actions always render when a draft exists and the server's answer (including 403) is shown as received.
  - `case-overview.tsx` — registry id, submission line (`case.submission.none` / `case.submission.version`), status badge, next action, the W0-04 fields (source record id shown as the known value unchanged or the literal Unknown), the three lane projections and readiness, all as text plus colour.
  - `version-nav.tsx` — the open draft and every version `GET /api/cases/{id}/versions` lists, ascending, each a deep link; the latest marked.
  - `pack-editor.tsx` + `slot-dialog.tsx` + `slot-rows.tsx` — nine rows (number, name, gating lanes from `LANE_MAPPING_V1`, state badge, document link or reason, Change); pack settings (`checklistTemplateVersion` from `ConfigurationView`, `stageContext` idea / pre_build / pre_launch, D11); changes are held locally, marked on the row, and saved in one `PackDraftUpdateRequest` with the draft's `ExpectedVersion`; Submit is enabled only with nothing unsaved. The slot dialog renders inside W1-07's shared `components/dialog.tsx` (native `<dialog>` with `showModal()`, always mounted, the form remounted per slot): focus lands on the radio of the current state, Tab wraps inside in both directions, Escape closes (or asks first through the Dialog's `hasUnsavedInput` confirm, `dialog.discard_confirm`, when the reason field holds unsaved text), focus returns to the Change button on close. Every state is a radio: attached (file input → `POST /api/cases/{id}/artifacts`, then the slot points at the returned `artifactId`), not yet, missing, not applicable with a required reason (1..500 characters after trim; `validation.reason_required` shown inline and the dialog stays open; the API's own 422 is also rendered on the row).
  - `pack-frozen.tsx` — a `SubmittedVersion` read-only: submitter, time, template, stage context, `configurationRevisionId`, `laneMappingVersion`, the nine frozen slots with their embedded artifact references, no action.
  - `view-model.ts` (pure; unit-tested: slot catalogue, lanes, pending-change merge, counts, N/A reason rule, field-path → slot) and `case.css` (only the case layout — overview header, facts, lanes, version navigation beside the content, slot rows, pack settings, slot-state choices — on the W1-07 tokens and primitives of `styles.css`; reflow at 1440 / 834 / 390).
  - `view-model.test.ts` (8 tests). The no-hard-coded-string scan is W1-07's `web/src/i18n/no-hard-coded-strings.test.ts`, which covers every `.tsx` under `web/src`.
- **Shared Lane B modules extended (fix round 4)** — `components/status-badge.tsx`: a generic `Badge` (tone, machine value in `data-status`, label required) under `StatusBadge`, used for slot states, lane projections and the "latest" marker; `components/error-notice.tsx`: the stale-version guidance key, the invalid_input field list and an actions row (`children`); `components/dialog.tsx`: the first tab stop is the checked radio of a leading radio group (open focus and the backward wrap), an optional `className`; `i18n/locale-provider.tsx`: `translateApiKey` (a key the API sent, rendered when the catalogue knows it, verbatim otherwise); `i18n/format.ts`: `formatBytes`; `routes.ts`: `ROUTES.caseVersion`; `router.tsx`: the two case routes replace W1-07's placeholder (`screens/cases/case-placeholder-screen.tsx` removed); `styles.css`: badge tones, textarea and file inputs, `.notice-actions`, `.btn-small`, `.dialog-wide`.
- **Locale keys** — the 103 W1-06 keys land through the Lane A contract PR **W1-00 amendment: the W1-06 locale keys** (`codex/w1-00-w1-06-locale-contract`, [plan](../2026-09-22-w1-00-w1-06-locale-contract/plan.md), [review](../2026-09-22-w1-00-w1-06-locale-contract/review.md)); this PR is rebased on it and touches nothing under `shared/src/` (fix round 5). W1-06 keys that duplicated a W1-07 key were dropped in favour of it (`common.back_to_list`, `common.loading`, `common.cancel`, `common.error_title`, `common.correlation_id`, `next_action.*`, `dialog.discard_confirm`). W1-07's `case.placeholder_*` keys stay in the catalogue because `main` reads them until this PR merges; the next amendment drops them.
- **`rai-web/eslint.config.js`** — `react/jsx-no-literals` narrowed to the section 10.2 text (JSX text and the named user-facing attributes, the latter through `no-restricted-syntax` selectors). As W1-00 configured it (`noAttributeStrings: true`, `ignoreProps: false`) the rule rejected every attribute string (`type="button"`, `className`, `href`), which no JSX can satisfy; the file is byte-identical to the W1-07 branch's version so the two Lane B PRs merge without conflict.
- **`rai-web/tests/browser/`** — W1-07's `playwright.substitute.config.ts`, with one change: the substitute process is `support/substitute-server.ts` (the W1-13 handler on loopback plus a test-only `POST /__substitute/reset`, so a spec that saves, uploads or submits starts every test from the fixture state); `w1-06-case-pack-versions.substitute.spec.ts` (7 tests × 3 widths); `w1-07-shell-sign-in-cases.substitute.spec.ts` asserts the W1-06 screen where it asserted the placeholder (the CM SPOC opening an HR case sees the server's 403; the keyboard journey lands on the case's level-1 heading and version navigation).
- **Docs**: `TESTING.md` (the commands and how the substitute run works); `docs/architecture/README.md` "Path in repo" for the Product UI row.

## Commands run and results

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0, npm 11.19.0). Postgres: `POSTGRES_PORT=54326 docker compose -p rai-w1-06 up -d --wait` from the worktree root; `.env` copied from `.env.example` with every URL on 54326, `NODE_ENV=test`, `RAI_IDENTITY_MODE=fixture`. Branch on `origin/main` at `503eb4e` (W1-04 merged).

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| `npm ci` | exact versions; no dependency added |
| `npm run migrate` | `migrate: applied 4 migration(s), 0 already applied` (no migration in this ticket) |
| `npm run lint` | `eslint .` clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run typecheck` | `tsc -b` clean over the five workspaces |
| `npm run test:unit` | `tests 297, pass 297, fail 0` (285 on `main` + 12 new: `web/src/screens/case/view-model.test.ts` 10, `no-literals.test.ts` 2) |
| `npm run test:integration` | `tests 103, pass 103, fail 0` (unchanged) |
| `npm run verify` | lint, typecheck, unit and integration green (the counts above) |
| `npm run build && npm run check:substitute-absent` | shared → web → server; `check-substitute-absent: scanned 343 files, 0 with the marker` |
| `npm run test:browser:server` | `21 passed` (the W1-12 harness, unchanged, against the real server) |
| `npm run test:browser:substitute` | `21 passed (17.1s)`: the W1-06 spec, 7 tests at 1440 / 834 / 390; axe on 7 screen states per width (overview draft th, editor with pending changes, slot dialog, frozen version, forbidden, overview en) — **0 critical, 0 serious, 0 moderate, 0 minor** (no `axe-non-blocking` annotation in the JSON report). Run with `SUBSTITUTE_PORT=8791 SUBSTITUTE_WEB_PORT=5177` on the machine because the parallel W1-07 session held 8789 |
| `node --test tests/*.test.mjs` (repository root) | `tests 22, pass 22, fail 0` |
| `node scripts/check-links.mjs` (repository root) | `130 Markdown files, 666 relative links checked, 0 broken` |
| `node scripts/check-frozen-source.mjs` (repository root) | hash matches `docs/sources.md` |
| `git diff --check` | clean |
| `POSTGRES_PORT=54326 docker compose -p rai-w1-06 down -v` (repository root) | run after the PR opened |

### Fix round 1 (review finding: backward focus trap)

Finding: `trapFocus` wrapped Shift+Tab only when the active element was the first radio in DOM order (`attached`), but the dialog opens on the checked radio (`missing` for slot 7 of `fx-case-missing-slot`, third in DOM order), so one Shift+Tab from the opening state left the dialog (`document.activeElement` became `<body>`). The spec only Tabbed forward, so it could not see this.

Fix: the state radio group is one tab stop whose entry is the checked radio, so `trapFocus` now computes `entry` (the checked radio of the first group, else the first control) and wraps on Shift+Tab when the active element is `entry`, `first` or the dialog; the forward wrap from the last control lands on `entry` as well. `slot-dialog.tsx` only; no markup, locale or contract change. The dialog test gained an 8-press Shift+Tab loop beside the 12-press Tab loop, each press asserting a visible focus ring and focus inside `dialog[open]`. Sequence: the loop was added first and failed on all three widths against the unfixed component (`no element is focused (focus is on the body)` at the first Shift+Tab), then passed after the fix.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| `npx playwright test -c tests/browser/playwright.substitute.config.ts -g "contains focus"` (before the fix) | `3 failed` — first Shift+Tab leaves the dialog at 1440 / 834 / 390 |
| same (after the fix) | `3 passed (4.2s)` |
| `npm run lint` | eslint clean; Prettier clean; `check-css: no outline removal outside :focus-visible` |
| `npm run typecheck` | clean |
| `npm run test:unit` | `tests 297, pass 297, fail 0` |
| `npm run migrate` then `npm run test:integration` (Postgres `rai-w1-06`, port 54326) | `applied 4 migration(s)`; `tests 103, pass 103, fail 0` |
| `npm run build && npm run check:substitute-absent` | `scanned 343 files, 0 with the marker` |
| `npm run test:browser:server` | `21 passed (4.2s)` |
| `npm run test:browser:substitute` | `21 passed (17.2s)`; JSON report: 21 expected, 0 `axe-non-blocking` annotations (zero violations of any impact) |
| `node --test tests/*.test.mjs` (repository root) | `tests 22, pass 22, fail 0` |
| `node scripts/check-links.mjs` (repository root) | `130 Markdown files, 666 relative links checked, 0 broken` |
| `node scripts/check-frozen-source.mjs`; `git diff --check` (repository root) | hash matches; clean |
| `POSTGRES_PORT=54326 docker compose -p rai-w1-06 down -v` (repository root) | run after the push |

## Done-when clauses → evidence (`w1-06-case-pack-versions.substitute.spec.ts`, every width)

| Clause | Evidence |
| --- | --- |
| Every slot state and reason is reachable | "every slot state and reason is reachable by keyboard…": from the keyboard alone (Tab to the seventh Change, Enter, arrow keys on the radio group, Tab to Apply, Enter) slot 7 of `fx-case-missing-slot` goes missing → not applicable with a typed Thai reason → not yet → missing → attached (an upload through 7.4, the filename link appears); slot 8 goes to N/A with a reason; the default non-vendor reason renders from its locale key on slots 3 and 4; the typed reason of `fx-case-na-reasons` slot 4 renders verbatim |
| The N/A reason field cannot be skipped | same test: Apply with an empty reason and with whitespace keeps the dialog open, shows `validation.reason_required` in a `role="alert"` and moves focus to the field; the row only changes once a reason is typed. The API's own 422 for a reason-less N/A is rendered on the row through `slotOfFieldPath` (unit-tested), and `reasonIsValid` is unit-tested at 0 / whitespace / 1 / 500 / 501 characters |
| No client-side check decides access | "forbidden and unauthenticated answers are rendered as received": `fx-user-owner-cm-2` (no fixture case) opens the owner's case → the 403 envelope's `error.forbidden` is shown, no Change button and nothing about the case; signed out → `/sign-in?returnTo=%2Fcases%2F<id>`. A version id of another case → the 404 envelope. `web/src` holds no role, scope or policy logic (the only place scope is enforced is `server/src/authz/`, which the substitute calls) |
| Keyboard-only operation of every action | the slot journey, the save, the submit and the version link are driven with Tab / arrows / Enter through `tests/browser/support/keyboard.ts`, which asserts a visible focus ring at every stop; the dialog test Tabs 12 times forward and Shift+Tabs 8 times backward inside the dialog (focus never leaves in either direction), Escape closes and returns focus to the invoking Change button, Escape with unsaved reason text asks through the shared Dialog's native confirm (declining keeps the dialog and the text; accepting closes; fix round 4) |
| Accessibility audit passes with zero critical issues | `expectAccessible` (axe-core, tags wcag2a / wcag2aa / wcag21a / wcag21aa / wcag22aa) on every state above with `lang="th"` and once with `lang="en"`: zero violations of any impact; `expectStatusElementsHaveText` on every screen; no horizontal scroll at 390 |
| No hard-coded user-facing string | `npm run lint` (`react/jsx-no-literals` + the attribute selectors over `web/`) and W1-07's `i18n/no-hard-coded-strings.test.ts` (compiler scan of every `.tsx` under `web/src`) both green; the spec resolves every label through `t()` from the shared catalogue, so a bare string in the UI would not be found |
| Version navigation shows the submitted versions the substitute serves | "submit freezes the pack…": after Submit on `fx-case-nonvendor` the URL is `/cases/<id>/versions/<versionId>`, the navigation lists exactly the items of `GET /api/cases/{id}/versions` (count, number, `href`), the latest is marked, no draft entry remains, the frozen view shows submitter, `lane-mapping/v1`, the configuration revision and the nine frozen slots with no Change or Submit; `/cases/<id>` redirects to the latest version |
| Also | stale save: another session's `PUT` first → the UI's save shows `error.stale_version` with `guidance.revision_changed` and a Reload that recovers the other session's change and drops the pending one; the Thai fixture name renders at 390; a save persists across reload and matches `GET /api/cases/{id}/draft` (revision 2, slot 7 attached, slot 8 N/A with the typed text) |

## Fix round 4: integration onto W1-07 (#85)

Finding: the PR conflicted with `main` after W1-07 merged (`app.tsx`, `api/client.ts`, `playwright.substitute.config.ts`, both locale files, `TESTING.md`, `docs/architecture/README.md`); the branch carried its own shell, client, locale shim, error notice, status badge, substitute configuration and no-literals test instead of building on W1-07's.

Done: rebased onto `origin/main` (`de58182`), taking W1-07's `app.tsx`, `client.ts` and substitute configuration in the conflict and the union of the catalogues; then the integration commit: the case screens render inside W1-07's shell and router (`RequireSession`, `RouteFocus`, the locale switch and sign-out), use its typed client (extended with the case-flow calls), `useLocale()` and `translateApiKey`, `formatDateTime` / `formatBytes`, `ROUTES`, and its `Dialog`, `ErrorNotice` and `StatusBadge` / `Badge` (extended as listed above); `api/case.ts`, `screens/case/{locale,error-notice,status-badge,routes,index}.tsx`, `no-literals.test.ts` and W1-07's `case-placeholder-screen.tsx` deleted; `case.css` reduced to the case layout on the shared tokens; the substitute configuration is W1-07's file with the reset-capable process; the W1-07 spec's two placeholder assertions now assert the W1-06 screen. The slot dialog's inline "close and discard / keep editing" prompt became the shared Dialog's `hasUnsavedInput` confirm, so the dialog test answers the native confirm (declining keeps the dialog and the typed text; accepting closes and returns focus to the Change button); badge assertions use `toContainText` because the shared badge carries an `aria-hidden` glyph before the label. No decision, spec, server, substitute or fixture file changed.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| `git rebase origin/main` | 7 conflicts resolved as described; `eslint.config.js`, `package.json`, `web/vite.config.ts`, `tests/browser/playwright.config.ts` merged clean (identical on both sides) |
| `npm run lint` | `eslint .` clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run typecheck` | `tsc -b` clean |
| `npm run test:unit` | `tests 331, pass 331, fail 0` (W1-07's 323 on `main` + client 3, format 1, routes 1 changed, view-model 8; the removed `no-literals.test.ts` is covered by `i18n/no-hard-coded-strings.test.ts` over all of `web/src`) |
| `POSTGRES_PORT=54326 docker compose -p rai-w1-06 up -d --wait` (repository root); `npm run migrate`; `npm run test:integration` | `applied 4 migration(s)`; `tests 122, pass 122, fail 0` (unchanged) |
| `npm run build && npm run check:substitute-absent` | shared → web → server; `check-substitute-absent: scanned 375 files, 0 with the marker` |
| `npm run test:browser:server` | `21 passed (4.1s)` (the W1-12 harness against the real server) |
| `SUBSTITUTE_PORT=8793 SUBSTITUTE_WEB_PORT=5179 NODE_ENV=test npx playwright test -c tests/browser/playwright.substitute.config.ts --reporter=list,json` | `expected 78, unexpected 0, flaky 0` (W1-06 7 tests + W1-07 19 tests × 1440 / 834 / 390, 44.9 s); JSON report holds no `axe-non-blocking` annotation: zero axe violations of any impact on every audited state (overview draft th, editor with pending changes, slot dialog, frozen version, forbidden, overview en, and W1-07's screens) |
| `node --test tests/*.test.mjs` (repository root) | `tests 22, pass 22, fail 0` |
| `node scripts/check-links.mjs` (repository root) | `136 Markdown files, 670 relative links checked, 0 broken` |
| `node scripts/check-frozen-source.mjs`; `git diff --check` (repository root) | hash matches; clean |
| `POSTGRES_PORT=54326 docker compose -p rai-w1-06 down -v` (repository root) | run after the push |

## Fix round 5: review round 1 after the integration (three blocking findings)

1. **Double focus restoration in the shared Dialog (flaky "every slot state…" test).** `components/dialog.tsx` restored focus to the opener twice on close: the browser's own restoration inside `dialog.close()` and again in a `close` event listener, which fires as a queued task. When that task landed after the spec had already focused slot 8's Change button, focus snapped back to slot 7 and Enter reopened slot 7's dialog (`no focusable element matched within 5 Tab presses`, about 1 run in 8). Fix: the `[open]` effect restores focus synchronously right after `dialog.close()`; the `close` listener and its add/remove are gone. Component only; no markup, locale or contract change.
2. **Lane A module in a Lane B PR.** The two catalogue files are carved out into the contract PR named above (same shape as #84 → #85 for W1-07 and #74 for `qc.finding.*`); this branch is rebased onto `codex/w1-00-w1-06-locale-contract` with the catalogues resolved to the contract version, so `git diff <contract> -- rai-web/shared/` is empty. Base of this PR is the contract branch until it merges, then `main`.
3. **Arrow keys pressed before the dialog opened (flaky at 390).** After Enter on a Change button the spec pressed ArrowDown/ArrowUp before the dialog's `showModal()` and focus effect committed, so the arrows landed on the still-focused button. Fix: `openSlotDialog(page, dialog)` presses Enter, waits for the dialog to be visible and for the current-state radio to be focused, and every dialog open in the spec (slot 7 four times, slot 8, the focus test's unsaved-reason case) goes through it; slot 8 also waits for its own Change button to be focused first and opens its own dialog locator (title "ช่อง 8: …").

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| `git rebase --onto codex/w1-00-w1-06-locale-contract main` | 3 commits replayed; conflicts only in the two catalogue files, resolved to the contract branch's version |
| `NODE_ENV=test npx playwright test -c tests/browser/playwright.substitute.config.ts -g "every slot state" --repeat-each 6` | `18 passed (27.1s)` (6 × 1440 / 834 / 390) |
| `NODE_ENV=test npx playwright test -c tests/browser/playwright.substitute.config.ts --repeat-each 5 --reporter=list,json` (twice) | `expected 390, unexpected 0, flaky 0` both times (W1-06 7 + W1-07 19 tests × 3 widths × 5; 219 s); JSON report holds no `axe-non-blocking` annotation |
| `npm run lint` | eslint clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run typecheck` | `tsc -b` clean |
| `npm run test:unit` | `tests 331, pass 331, fail 0` |
| `POSTGRES_PORT=54326 docker compose -p rai-w1-06 up -d --wait` (repository root); `npm run migrate`; `npm run test:integration` | `applied 4 migration(s)`; `tests 122, pass 122, fail 0` |
| `npm run build && npm run check:substitute-absent` | `check-substitute-absent: scanned 375 files, 0 with the marker` |
| `npm run test:browser:server` | `21 passed (4.2s)` |
| `node --test tests/*.test.mjs` (repository root) | `tests 22, pass 22, fail 0` |
| `node scripts/check-links.mjs` (repository root) | `138 Markdown files, 674 relative links checked, 0 broken` |
| `node scripts/check-frozen-source.mjs`; `git diff --check` (repository root) | hash matches; clean |
| `POSTGRES_PORT=54326 docker compose -p rai-w1-06 down -v` (repository root) | run before the push |

## Deviations, defaults and limitations (for the reviewer)

- **Substitute versus section 7.** No disagreement affected this ticket. Two known substitute differences from W1-04's review are not exercised here (`default_non_vendor` from the client on other slots; unknown top-level keys on PUT): the UI never sends `default_non_vendor` (a user who chooses N/A types a reason) and sends only contract keys.
- **Upload sample.** The spec uploads a minimal `%PDF-` body, which the substitute's sniff accepts; the real server's structural checks (W1-03) would not. W1-INT switches the spec to a generated W1-09 document when it runs against the real server.
- **`VITE_API_SUBSTITUTE`** is set on the substitute run for consistency with the plan, but the SPA reaches the substitute through the Vite proxy (the substitute needs `node:crypto`, `node:http` and `@rai/server/authz`, so it cannot be bundled into a browser build); the flag has no effect in `web/src`, and `check-substitute-absent` proves the build carries no marker.
- **`businessOwner` and `submittedBy`** render as the subject id the API returns (`fixture:fx-user-owner-cm`); no user-lookup endpoint exists in the W1 contract (7.9).
- **Browser specs on `main`.** `npm run test:browser` now runs the real-server suite and then the substitute suite (same split as W1-07); CI row 7 therefore runs both.
- **Size.** The PR exceeds the ~600-line working rule because the ticket is declared "as one flow"; the plan (11.1) leaves a W1-06a/b split to the lead if wanted. Excluding the locale catalogues, the spec and tests, the screens, view model and API client are about 2,000 lines.
