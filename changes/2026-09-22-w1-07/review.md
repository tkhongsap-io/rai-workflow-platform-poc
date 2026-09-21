# Review: W1-07 — UI shell, sign-in, new-case form, scoped case list

2026-09-22. Ticket W1-07 (issue #23), lane B, owner type Agent-eligible. Branch `codex/w1-07-ui-shell-sign-in-cases`, worktree `/Users/tkhongsap/github/rai-wt/W1-07`, Postgres `rai-w1-07` on port 54327 (used only by the unchanged integration and real-server browser suites). Plan recorded before code in [plan.md](plan.md). Proves A01 and A02 at the browser layer against the W1-13 substitute; the Proves IDs are realised when W1-INT runs the same spec against the real server (W0-02 section 8.1). Decision implemented: D12 (bilingual, Thai default, every string a locale key, dates in the D06 timezone). No decision recorded; D07-D10 untouched; the frozen source spec untouched. Board and DEVLOG/CHANGELOG entries are appended by the merge step.

**Fixture set: `fixture set slice1-synthetic@1 7c80ccd43663`** (`rai-web/fixtures/src/data/manifest.json`, unchanged; served by the substitute).

## What landed

- **`rai-web/web/src/`** (Lane B; W1-06 rebases onto this):
  - `app.tsx`, `main.tsx`, `router.tsx`, `routes.ts`, `route-focus.tsx`, `styles.css`, `vite-env.d.ts` — providers, route table, `RequireSession` (no session → `/sign-in?returnTo=<path>`; scope is never decided here), `/cases/:caseId` placeholder element for W1-06 to replace, not-found screen, handoff tokens as CSS custom properties, `:focus-visible` ring (3 px, `#00639F`), Thai-capable font stack, line height 1.6, focus to the main landmark after a client-side navigation.
  - `api/client.ts` — the only `fetch` in the SPA; `ApiError` from the W0-06 8.2 envelope (`code`, `messageKey`, `correlationId`, `details`), `NetworkError`; 7.2 and 7.3 calls; `Idempotency-Key` minted by the caller per user action (W0-06 5.3).
  - `i18n/` — `LocaleProvider` (`t()` bound to the locale, localStorage mirror, `<html lang>`, document title), `format.ts` (Intl in `Asia/Bangkok`, `th-TH-u-ca-gregory`), `no-hard-coded-strings.test.ts` (TypeScript-AST scan of every `.tsx` under `web/src`: JSX text, string children, string literals in `title`/`alt`/`placeholder`/`aria-label`/`aria-description`/`aria-roledescription`/`aria-valuetext`).
  - `session/session-provider.tsx` — the `SessionInfo` the API returned and a signed-out reason (`initial` / `user` / `revoked`); a 401 on any call clears it.
  - `components/` — `StatusBadge` (text + glyph + colour, `data-status`, cannot render without its label), `Dialog` (native `<dialog>` + `showModal()`; focus moves in, Tab wraps inside, returns to the opener on close; Escape closes, or asks first when the caller declares unsaved input), `ErrorNotice` (messageKey in the viewer's locale + correlation id).
  - `screens/shell/app-shell.tsx` — skip link, brand line, locale switch (stored with `POST /api/session/locale`), signed-in principal, sign-out behind the dialog, primary navigation, and the "substitute; never evidence" banner when built with `VITE_API_SUBSTITUTE=true`.
  - `screens/sign-in/sign-in-screen.tsx` — `GET /auth/fixture/users` 200 → picker (display names and the (role, scope) pairs the server listed), 404 → provider button (`POST /auth/sign-in` → `redirectUrl`); `returnTo` accepted only as a same-origin path; the signed-out and session-expired notices.
  - `screens/cases/case-list-screen.tsx` (+ `case-list.view-model.ts`) — `GET /api/cases` rendered as returned: cards with registry id, name, status badge, BU, group, owner, submission version or "not yet submitted", next action by status, updated time in Bangkok, "Open case" link; scope line from the principal's grants (display only); empty state; pagination when `total > pageSize`.
  - `screens/cases/new-case-screen.tsx` (+ `new-case.view-model.ts`) — every `CaseWritableFields` input (`businessOwner` defaults to the actor; a SPOC's single BU grant pre-fills the key and is offered as a datalist suggestion, never enforced; `useCaseGroup` from `GET /api/configuration/current`, D11; `sourceRecordId` Unknown / known; `vendorInvolved`; `modelType`); `POST /api/cases` with a fresh UUID key per attempt; 201 → the list with a created notice; 422 → the server's field errors on their inputs (a field sent blank reads `validation.required`); 403 → the forbidden notice; 401 → sign-in. No role check anywhere: a reviewer reaches the form and the server's 403 is what stops the create.
- **`rai-web/shared/src/locales/th.json`, `en.json`** — 96 new keys (`shell.*`, `common.*`, `sign_in.*`, `scope.*`, `cases.*`, `next_action.*`, `new_case.*`, `field.*`, `model_type.*`, `not_found.*`, `case.placeholder_*`, `dialog.discard_confirm`); identical key sets (`locales.test.ts`).
- **`rai-web/eslint.config.js`** (`web/**` block only) — `react/jsx-no-literals` with `ignoreProps: true` (the rule cannot distinguish `className` from `aria-label`; as merged it flagged every attribute including `type="button"`, which made the rule unusable) plus `no-restricted-syntax` selectors for the section 10 user-facing attributes; `·` and `*` join the punctuation allow-list.
- **`rai-web/web/vite.config.ts`** — `API_PROXY_TARGET` for the dev-server proxy (default unchanged: the API on 8787). **`rai-web/web/tsconfig.json`** — `node` types for the colocated unit tests.
- **Browser suite** — `rai-web/tests/browser/playwright.substitute.config.ts` (substitute CLI on 8789 + Vite dev server on 5175 with `VITE_API_SUBSTITUTE=true`, three widths, one worker) and `w1-07-shell-sign-in-cases.substitute.spec.ts` (19 tests × 3 widths); `playwright.config.ts` ignores `*.substitute.spec.ts`; `package.json` `test:browser` now runs `test:browser:server` then `test:browser:substitute`, so CI's browser job (unchanged, HRR) covers both.
- **Docs**: `TESTING.md` (commands, substitute configuration), `docs/architecture/README.md` "Path in repo" (Product UI row), this record.

## Commands run and results

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0, npm 11). Postgres: `POSTGRES_PORT=54327 docker compose -p rai-w1-07 up -d --wait` from the worktree root; `.env` copied from `.env.example` with every URL on port 54327. Branch created from `origin/main` at `503eb4e` (W1-04 merged).

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| `npm ci` | exact versions from `package-lock.json`; no dependency added |
| `npm run migrate` | `migrate: applied 4 migration(s), 0 already applied` (no migration in this ticket) |
| `npm run lint` | `eslint .` clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run typecheck` | `tsc -b` clean over the five workspaces |
| `npm run test:unit` | `tests 306, pass 306, fail 0` (285 on `main` + 21 new: `api/client.test.ts` 7, `i18n/format.test.ts` 3, `i18n/no-hard-coded-strings.test.ts` 2, `routes.test.ts` 2, `case-list.view-model.test.ts` 3, `new-case.view-model.test.ts` 4) |
| `npm run test:integration` | `tests 103, pass 103, fail 0` (unchanged) |
| `npm run build && npm run check:substitute-absent` | shared → web (`dist/assets/index-*.js` 362.6 kB, css 8.5 kB) → server; `check-substitute-absent: scanned 343 files, 0 with the marker` |
| `npm run test:browser` | `test:browser:server`: `21 passed` (W1-12 harness, unchanged); `test:browser:substitute`: `57 passed` (19 tests × desktop-1440, tablet-834, phone-390); run three times, green each time |
| axe (`@axe-core/playwright`, tags wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa) | zero critical, zero serious, and zero moderate or minor annotations, on: sign-in (th), list for owner-cm and owner-cm-2 (th), new-case form (th), form with server field errors (th), sign-out dialog open (th), list (en) — at all three widths |
| `node --test tests/*.test.mjs` (repository root) | `tests 22, pass 22, fail 0` |
| `node scripts/check-links.mjs` (repository root) | `129 Markdown files, 665 relative links checked, 0 broken` |
| `node scripts/check-frozen-source.mjs` (repository root) | hash matches `docs/sources.md` |
| `node --test scripts/*.test.mjs` (repository root) | `tests 18, pass 18, fail 0` |
| `git diff --check` | clean |
| `POSTGRES_PORT=54327 docker compose -p rai-w1-07 down -v` (repository root) | run after the PR opened |

## Done-when clauses → evidence (`w1-07-shell-sign-in-cases.substitute.spec.ts`)

| Clause | Evidence |
| --- | --- |
| Sign-in for each fixture user lands on that user's scoped list | one test per fixture user (all eight, including the dual-role `fx-user-dpo-spoc-hr`) drives the picker through the UI and asserts the URL `/cases`, the signed-in name, the scope line and the registry ids the server listed: owner-cm all five; owner-cm-2 none (empty state); spoc-cm `RAI-2000-0001`, `0003`; reviewers, admin and the dual-role user all five |
| An out-of-scope case is absent from the list | the same tests assert absence: `RAI-2000-0002/0004/0005` for spoc-cm; all five for owner-cm-2 |
| No client-side check decides access | the SPA has no role or scope branch (the scope line and the BU suggestion are display of what the server returned); `fx-user-dpo` reaches the new-case form and the create is stopped by the server's `403 forbidden` (asserted on the response and on the rendered notice with the correlation id); a deep link to an HR case without a session goes to sign-in with `returnTo` and, after sign-in, resolves inside the SPA (scope is the API's answer on the W1-06 screen); an absolute `returnTo` is dropped |
| Keyboard-only operation | one test drives sign-in (skip link → picker by type-ahead → button), the list (Open case), the placeholder, the new-case form (every field, radio group, select, submit), the created card, the sign-out dialog (Enter opens; focus moves in; four Tabs stay inside; Escape closes and returns focus to the opener; Enter on the confirmation signs out) and the revoked session (`/cases` bounces to sign-in) with the keyboard alone, asserting a visible focus ring (computed outline or box-shadow) at every stop |
| Accessibility audit zero critical | `expectAccessible` on every screen state above (th and en): zero critical, zero serious; no moderate or minor either; `expectStatusElementsHaveText` on every list |
| No hard-coded user-facing string | `react/jsx-no-literals` + `no-restricted-syntax` in `npm run lint`, and `no-hard-coded-strings.test.ts` in `npm run test:unit` (self-tested against the six shapes it must catch); every assertion in the spec reads its copy from the catalogues |

Also proved: the locale switch renders English, `<html lang>` follows, the choice persists on the session across a reload (`GET /api/session` reports `en`), and switching back restores Thai; no horizontal scroll on sign-in, list and form at 390 (and the other widths); the Thai fixture name renders; the not-found screen; the substitute banner shows in this configuration; the fixture picker hides the Google button in fixture mode.

## Deviations, defaults and limitations (for the reviewer)

- **Locale catalogues.** The keys live in `shared/src/locales/` because W0-02 section 10 names those files as the one catalogue; `shared/` is Lane A contract territory, and the ticket brief assigns each Lane B ticket its keys. No other `shared/` file changed.
- **ESLint rule change.** As merged, `react/jsx-no-literals` with `ignoreProps: false, noAttributeStrings: true` flagged every attribute string (`className`, `type`, `href`), which no screen can satisfy. The web block now ignores props and names the user-facing attributes explicitly; the unit test scans the same shapes. Text nodes and string children are still errors.
- **`/cases/:caseId`** is a placeholder element so list rows, `refreshPath` values and deep links resolve inside the SPA and require a session; W1-06 replaces the element in `router.tsx`. After a create the form returns to the list with a notice; W1-06 may redirect to the case screen instead.
- **Business unit key.** The contract has no BU-list read; the form takes the key as text (a SPOC's grant pre-fills it) and the server's 422 names an unknown key. `businessOwner` is a subject-id text field defaulting to the actor.
- **Blank fields.** The server (and the substitute) report an empty required string as `validation.not_in_configured_list` (the Ajv `minLength` mapping in `app.ts`); the form renders `validation.required` for a field it sent blank, keeping the server's key otherwise. The server's 422 remains the decision.
- **Substitute runs are never evidence.** The real-server Playwright configuration cannot render the SPA yet (`server/src/static.ts` arrives with W1-INT), so the Lane B spec runs against the substitute in its own configuration and `test:browser` runs both. The `SUBSTITUTE_PORT` / `SUBSTITUTE_WEB_PORT` / `API_PROXY_TARGET` variables are dev/test-only and outside the section 5 table.
- **Headless first Tab.** After a fresh navigation headless Chromium occasionally sends the first Tab to its own UI; the keyboard test presses again once before asserting the stop order (documented in the spec).
- **`VITE_API_SUBSTITUTE`** does not bundle the substitute (it depends on `node:*`); it marks the dev build (banner) while the Vite proxy points at the substitute process. `npm run build` forces it off; `check-substitute-absent` proves the bundle is clean.
