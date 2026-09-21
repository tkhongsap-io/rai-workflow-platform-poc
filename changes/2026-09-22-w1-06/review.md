# Review: W1-06 — case overview, nine-slot pack editor and version navigation

2026-09-22. Ticket W1-06 (issue #22), lane B, owner type Agent-eligible. Branch `codex/w1-06-case-pack-versions`, worktree `/Users/tkhongsap/github/rai-wt/W1-06`, Postgres `rai-w1-06` on port 54326 (only for the unchanged integration and real-server browser suites). Plan recorded before code in [plan.md](plan.md). Proves A02 **on the W1-13 substitute only**: substitute runs are development aids, never acceptance evidence (W0-02 section 8.1); A02 is realised when W1-INT runs the same spec against the real server. Decision implemented: D12 (every user-facing string through the locale catalogue, Thai default; dates in Asia/Bangkok). No decision recorded; D07-D10 untouched; the frozen source spec untouched; no server, substitute or fixture file edited. Board and DEVLOG/CHANGELOG entries are appended by the merge step.

**Fixture set: `fixture set slice1-synthetic@1 7c80ccd43663`** (`rai-web/fixtures/src/data/manifest.json`, unchanged).

## What landed

- **`rai-web/web/src/api/`** — `client.ts`: the only place `fetch` is called (section 1.1); same-origin, `cache: no-store`, `Idempotency-Key` when given, the W0-06 8.2 envelope parsed into `ApiError` (code, `messageKey`, `correlationId`, `details`; `fields` and `stale` accessors). `case.ts`: the 7.2-7.6 calls the flow uses (session, configuration, case, draft read/save, artifact upload (one `file` part) and metadata, version list/read, submit with a UUID key per press).
- **`rai-web/web/src/screens/case/`** — the W1-06 module, one flow:
  - `case-screen.tsx` — routes `/cases/:caseId` (open draft, or a redirect to the latest version when no draft is open) and `/cases/:caseId/versions/:versionId`; loads session → configuration, case, version list → draft (when `CaseView.draft` is not null) → artifact metadata; renders the overview, the version navigation and either the editor or the frozen version. A 401 from any call navigates to `/sign-in?returnTo=<path>`; a 403 or 404 renders the envelope's message key. **No client-side check decides access**: the editor's actions always render when a draft exists and the server's answer (including 403) is shown as received.
  - `case-overview.tsx` — registry id, submission line (`case.submission.none` / `case.submission.version`), status badge, next action, the W0-04 fields (source record id shown as the known value unchanged or the literal Unknown), the three lane projections and readiness, all as text plus colour.
  - `version-nav.tsx` — the open draft and every version `GET /api/cases/{id}/versions` lists, ascending, each a deep link; the latest marked.
  - `pack-editor.tsx` + `slot-dialog.tsx` + `slot-rows.tsx` — nine rows (number, name, gating lanes from `LANE_MAPPING_V1`, state badge, document link or reason, Change); pack settings (`checklistTemplateVersion` from `ConfigurationView`, `stageContext` idea / pre_build / pre_launch, D11); changes are held locally, marked on the row, and saved in one `PackDraftUpdateRequest` with the draft's `ExpectedVersion`; Submit is enabled only with nothing unsaved. The dialog is a native `<dialog>` with `showModal()`: focus lands on the radio of the current state, Tab wraps inside, Escape closes (or asks first when the reason field holds unsaved text), focus returns to the Change button. Every state is a radio: attached (file input → `POST /api/cases/{id}/artifacts`, then the slot points at the returned `artifactId`), not yet, missing, not applicable with a required reason (1..500 characters after trim; `validation.reason_required` shown inline and the dialog stays open; the API's own 422 is also rendered on the row).
  - `pack-frozen.tsx` — a `SubmittedVersion` read-only: submitter, time, template, stage context, `configurationRevisionId`, `laneMappingVersion`, the nine frozen slots with their embedded artifact references, no action.
  - `status-badge.tsx` (label required by type; `data-status`), `error-notice.tsx` (message key, stale guidance key, field keys, correlation id, reload), `locale.tsx` (interim context over the shared `t()`; see "Rebase onto W1-07"), `view-model.ts` (pure; unit-tested), `case.css` (handoff tokens, Thai-capable stack, line-height 1.6, 2 px focus ring on `:focus-visible` only, reflow at 1440 / 834 / 390), `routes.tsx`, `index.ts`.
  - `view-model.test.ts` (10 tests) and `no-literals.test.ts` (2 tests: the TypeScript-compiler scan of every `.tsx` in the directory for JSX text and literal `title` / `aria-label` / `aria-description` / `placeholder` / `alt`).
- **`rai-web/web/src/app.tsx`** — interim router mounting `caseRoutes()` plus placeholders for `/sign-in` and `*` (W1-07 replaces the file).
- **`rai-web/shared/src/locales/th.json`, `en.json`** — 132 W1-06 keys (`action.*`, `case.*`, `common.*`, `error.heading` / `correlation_id` / `field_list`, `lane.*`, `model_type.*`, `pack.*`, `projection.*`, `readiness.*`, `slot.*`, `stage.*`, `version.*`), identical key sets, Thai default.
- **`rai-web/eslint.config.js`** — `react/jsx-no-literals` narrowed to the section 10.2 text (JSX text and the named user-facing attributes, the latter through `no-restricted-syntax` selectors). As W1-00 configured it (`noAttributeStrings: true`, `ignoreProps: false`) the rule rejected every attribute string (`type="button"`, `className`, `href`), which no JSX can satisfy; the file is byte-identical to the W1-07 branch's version so the two Lane B PRs merge without conflict.
- **`rai-web/tests/browser/`** — `playwright.substitute.config.ts` (the second configuration the plan asks for: three width projects, one worker; starts `support/substitute-server.ts`, the W1-13 handler on loopback with a test-only `POST /__substitute/reset` so every test starts from the fixture state, and the Vite dev server with `VITE_API_SUBSTITUTE=true` proxying to it through `API_PROXY_TARGET`); `playwright.config.ts` ignores `*.substitute.spec.ts`; `w1-06-case-pack-versions.substitute.spec.ts` (7 tests × 3 widths). `web/vite.config.ts` reads `API_PROXY_TARGET` (dev server only). `package.json`: `test:browser` = `test:browser:server` + `test:browser:substitute` (same split as W1-07).
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
| Keyboard-only operation of every action | the slot journey, the save, the submit and the version link are driven with Tab / arrows / Enter through `tests/browser/support/keyboard.ts`, which asserts a visible focus ring at every stop; the dialog test Tabs 12 times forward and Shift+Tabs 8 times backward inside the dialog (focus never leaves in either direction), Escape closes and returns focus to the invoking Change button, Escape with unsaved reason text asks (Close and discard / Keep editing, both by keyboard) |
| Accessibility audit passes with zero critical issues | `expectAccessible` (axe-core, tags wcag2a / wcag2aa / wcag21a / wcag21aa / wcag22aa) on every state above with `lang="th"` and once with `lang="en"`: zero violations of any impact; `expectStatusElementsHaveText` on every screen; no horizontal scroll at 390 |
| No hard-coded user-facing string | `npm run lint` (`react/jsx-no-literals` + the attribute selectors over `web/`) and `no-literals.test.ts` (compiler scan of the W1-06 screens) both green; the spec resolves every label through `t()` from the shared catalogue, so a bare string in the UI would not be found |
| Version navigation shows the submitted versions the substitute serves | "submit freezes the pack…": after Submit on `fx-case-nonvendor` the URL is `/cases/<id>/versions/<versionId>`, the navigation lists exactly the items of `GET /api/cases/{id}/versions` (count, number, `href`), the latest is marked, no draft entry remains, the frozen view shows submitter, `lane-mapping/v1`, the configuration revision and the nine frozen slots with no Change or Submit; `/cases/<id>` redirects to the latest version |
| Also | stale save: another session's `PUT` first → the UI's save shows `error.stale_version` with `guidance.revision_changed` and a Reload that recovers the other session's change and drops the pending one; the Thai fixture name renders at 390; a save persists across reload and matches `GET /api/cases/{id}/draft` (revision 2, slot 7 attached, slot 8 N/A with the typed text) |

## Rebase onto W1-07 (required before merge)

The task brief has W1-07 create the shell, the locale provider and shared components and W1-06 rebase onto it. W1-07 had not pushed when this PR opened, so this branch carries interim pieces, each isolated so the rebase is mechanical:

- `web/src/screens/case/locale.tsx` — replace the body with re-exports over W1-07's `web/src/i18n/locale-provider.tsx` (`useLocale().t` / `.locale`); every W1-06 screen imports only `useT`, `useApiT`, `useLocale` and `LocaleProvider` from this file. The session-locale wiring in `case-screen.tsx` then moves to the provider.
- `web/src/api/client.ts` — W1-07 creates `createApiClient` / `API_PATHS`; port `web/src/api/case.ts` onto it and drop this file's `request()`.
- `web/src/app.tsx` — take W1-07's shell and router; mount `caseRoutes()` (or its two paths) inside it and delete the placeholders.
- `eslint.config.js`, `web/vite.config.ts`, `tests/browser/playwright.config.ts`, the `package.json` scripts — already identical to W1-07's working tree, so they merge clean. `tests/browser/playwright.substitute.config.ts` — keep one file; this one differs only in starting `support/substitute-server.ts` (the reset hook) instead of `serve.ts`.
- `shared/src/locales/*.json` — both add keys; textual merge.

## Deviations, defaults and limitations (for the reviewer)

- **Substitute versus section 7.** No disagreement affected this ticket. Two known substitute differences from W1-04's review are not exercised here (`default_non_vendor` from the client on other slots; unknown top-level keys on PUT): the UI never sends `default_non_vendor` (a user who chooses N/A types a reason) and sends only contract keys.
- **Upload sample.** The spec uploads a minimal `%PDF-` body, which the substitute's sniff accepts; the real server's structural checks (W1-03) would not. W1-INT switches the spec to a generated W1-09 document when it runs against the real server.
- **`VITE_API_SUBSTITUTE`** is set on the substitute run for consistency with the plan, but the SPA reaches the substitute through the Vite proxy (the substitute needs `node:crypto`, `node:http` and `@rai/server/authz`, so it cannot be bundled into a browser build); the flag has no effect in `web/src`, and `check-substitute-absent` proves the build carries no marker.
- **`businessOwner` and `submittedBy`** render as the subject id the API returns (`fixture:fx-user-owner-cm`); no user-lookup endpoint exists in the W1 contract (7.9).
- **Browser specs on `main`.** `npm run test:browser` now runs the real-server suite and then the substitute suite (same split as W1-07); CI row 7 therefore runs both.
- **Size.** The PR exceeds the ~600-line working rule because the ticket is declared "as one flow"; the plan (11.1) leaves a W1-06a/b split to the lead if wanted. Excluding the locale catalogues, the spec and tests, the screens, view model and API client are about 2,000 lines.
