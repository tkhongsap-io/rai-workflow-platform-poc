# Plan: W1-07 — UI shell, sign-in, new-case form, scoped case list

2026-09-22. Ticket W1-07 (issue #23), branch `codex/w1-07-ui-shell-sign-in-cases`, worktree `/Users/tkhongsap/github/rai-wt/W1-07`, Postgres `rai-w1-07` on port 54327 (needed only for the unchanged integration and real-server browser suites). Lane B, Agent-eligible. Recorded before code (AGENTS.md).

## Intent

The first product screens of the review desk, built against the W0-02 section 7.2 and 7.3 contracts on the W1-13 substitute: the application shell (brand line, locale switch, signed-in principal, sign-out behind a dialog, primary navigation), the sign-in screen (fixture picker when `GET /auth/fixture/users` answers 200, provider button when it answers 404), the viewer's scoped case list (`GET /api/cases`, rendered exactly as the server returns it) and the new-case form (`POST /api/cases` with a client-minted `Idempotency-Key`, the D11 use-case group list from `GET /api/configuration/current`). Prove A01 (each fixture user's list shows only in-scope cases; an out-of-scope case is absent because the server left it out; no client-side check decides access) and A02 (the form carries `sourceRecordId` as `Unknown` or a known id, `vendorInvolved`, `modelType`, the configured group). Implement D12 from the first screen: every user-facing string is a locale key, Thai default, English second, dates in `Asia/Bangkok` (D06).

## Spec (owning documents, read in full)

W0-02 plan sections 1 (layout: `web/src/{main,app,router}.tsx`, `api/`, `i18n/`, `screens/`, `components/`), 1.1 (the SPA never decides access), 3.4 (`VITE_API_SUBSTITUTE=true` dev mode), 5 (`VITE_API_SUBSTITUTE`, `PLAYWRIGHT_BASE_URL`), 7.1 (error envelope), 7.2 (sign-in: session, locale, fixture picker, provider redirect, sign-out, deep links with `returnTo`), 7.3 (case list, create, configuration read), 8.1-8.2 (browser layer; substitute runs are never evidence), 9 (UI quality bar: WCAG 2.2 AA, status text + icon + colour, native `<dialog>` with `showModal()`, visible focus, keyboard-only, axe with the five tag sets and zero critical/serious, the three widths, `lang` th then en, jsx-a11y as errors), 10 (language rule: catalogues in `shared/src/locales`, `t()` helper, no hard-coded string, API keys rendered by the client, locale on the session mirrored in localStorage, Gregorian Thai dates, Thai-capable font stack, line height ≥ 1.6); W0-03 section 7 (the eight fixture identities); W0-05 section 4 (403 for out-of-scope) and the create target (owner names itself; a SPOC may name an owner in its BU; reviewers and Admin 403 `role`); W0-06 5.3 (idempotency key per user action), 8.2 (field paths); design handoff (tokens, cards for the queue, status text + colour, identity / version / next action prominent) and `demo/reference/Main.dc.html` for layout and copy (not its client-side permissions); decisions D12, D06, D11.

## Files

- `rai-web/web/src/` (Lane B; W1-06 rebases onto this):
  - `main.tsx`, `app.tsx` (providers + router + shell), `router.tsx` (`RequireSession` redirects to `/sign-in?returnTo=` and never decides scope; `/cases/:caseId` placeholder element that W1-06 replaces), `routes.ts` (paths, `safeReturnTo`), `route-focus.tsx` (focus to the main landmark after a client-side navigation), `styles.css` (handoff tokens as custom properties, focus ring, Thai font stack), `vite-env.d.ts`.
  - `api/client.ts` — the only `fetch`; `ApiError` from the W0-06 8.2 envelope, `NetworkError`; session, locale, fixture users/sign-in, provider sign-in, sign-out, list, get, create (caller-minted key), configuration.
  - `i18n/locale-provider.tsx` (`t()` bound to the locale, localStorage mirror, `<html lang>` and title), `i18n/format.ts` (Intl in `Asia/Bangkok`, `th-TH-u-ca-gregory`), `i18n/no-hard-coded-strings.test.ts` (TypeScript-AST scan of every `.tsx` under `web/src`).
  - `session/session-provider.tsx` — holds the `SessionInfo` the API returned; a 401 anywhere clears it (`reason: 'revoked'`); user sign-out is `reason: 'user'`.
  - `components/status-badge.tsx` (text + glyph + colour, `data-status`), `components/dialog.tsx` (native `<dialog>`, `showModal()`, focus in / wrap / return, Escape with an unsaved-input guard), `components/error-notice.tsx` (messageKey + correlation id).
  - `screens/shell/app-shell.tsx`, `screens/sign-in/sign-in-screen.tsx`, `screens/cases/case-list-screen.tsx` + `case-list.view-model.ts`, `screens/cases/new-case-screen.tsx` + `new-case.view-model.ts`, `screens/cases/case-placeholder-screen.tsx`, `screens/not-found-screen.tsx`; unit tests next to the pure modules.
- `rai-web/shared/src/locales/th.json`, `en.json` — the W1-07 keys (shell, sign-in, scope lines, cases, next actions, new-case fields, model types, dialog, not-found) land through a W1-00 amendment contract PR (Lane A; W0-02 section 1.1: `shared/src/` is contract PRs only), as #74 did for the `qc.finding.*` keys. This ticket's branch is based on that PR and carries no `shared/` change. (Amended in fix round 1: the first cut put the keys in this PR.)
- `rai-web/eslint.config.js` — the `web/**` block: `react/jsx-no-literals` keeps flagging text nodes and string children but ignores props (the rule cannot tell `className` from `aria-label`); `no-restricted-syntax` selectors flag string literals in `title`, `alt`, `placeholder`, `aria-label`, `aria-description`, `aria-roledescription`, `aria-valuetext`.
- `rai-web/web/vite.config.ts` — `API_PROXY_TARGET` (dev-server proxy target; default unchanged). `rai-web/web/tsconfig.json` — `node` types for the colocated unit tests.
- `rai-web/tests/browser/playwright.substitute.config.ts` (substitute CLI + Vite dev server, three widths, one worker), `playwright.config.ts` (`testIgnore` for `*.substitute.spec.ts`), `w1-07-shell-sign-in-cases.substitute.spec.ts`; `rai-web/package.json` scripts `test:browser` (both suites), `test:browser:server`, `test:browser:substitute`.
- `TESTING.md` (commands), `docs/architecture/README.md` "Path in repo" (Product UI row), this record.

## Order

1. Locale keys; `i18n`, `api`, `routes` with unit tests (red → green).
2. Shell, sign-in, list, new-case screens; lint rule and the no-hard-coded-strings test.
3. Substitute Playwright configuration and the spec: one test per Done-when clause, keyboard journey, dialog, locale, reflow, axe on every screen state.
4. `npm run verify`, build + substitute-absence, both browser suites, repository checks; record in `review.md`; PR.
