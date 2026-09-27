# Review: sign-in method endpoint and UI (W7-09, #218)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-09, sections 6, 7 and 14 (the plan wins over issue #218). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)". D07-D10 stay open. HRR: adds a public auth route; a tech-lead reviewer is required. Synthetic data only; no external network call; nothing deployed. No migration.

## Change

- **`shared/src/schemas/auth.ts`**: `SIGN_IN_METHODS`, `SignInMethod`, `SignInMethodResponseSchema` (`{ method }`, `additionalProperties: false`), `signInMethodOf(mode)` (`fixture` → `fixture`, `local-google` → `google`, `network`/`production` → `organization`; exhaustive switch).
- **`server/src/identity/routes.ts`**: `GET /auth/sign-in-method`, auth `public`, registered before the fixture branch so every mode serves it; response schema above; `Cache-Control: no-store`; body `{ method: signInMethodOf(adapter.mode) }` only.
- **`web/src/api/client.ts`**: `API_PATHS.signInMethod`, added to the sign-in-flow paths (a 401 there never calls the unauthenticated handler); `getSignInMethod()` checks the body with `Value.Check` and throws `InvalidResponseError` otherwise.
- **`web/src/screens/sign-in/sign-in.view-model.ts`** (new): `PickerState` (provider carries its method), `PROVIDER_COPY`, `loadSignInPicker(source)`, and `describeRoles` moved from the screen unchanged. **`sign-in-screen.tsx`** loads its state through `loadSignInPicker(api)` and renders the provider button and note from `PROVIDER_COPY[picker.method]`; the fixture branch is unchanged.
- **Locales**: `auth.sign_in_with_organization`, `sign_in.organization_note` (th, en). No key renamed or removed.
- **Docs**: W0-02 section 7.2 "W7-09 amendment (2026-09-28)".
- **Tests**: `shared/src/schemas/auth.test.ts` (new, 2); `server/src/identity/routes.test.ts` (+3: local-google `google`, fixture `fixture`, network allow-list `organization`; each 200 without a cookie, `no-store`, body exactly `{ method }`, and none of the configured issuer, client id, client secret or allow-listed email in the raw body); `web/src/api/client.test.ts` (+2); `web/src/screens/sign-in/sign-in.view-model.test.ts` (new, 4); `tests/browser/w7-09-sign-in-method.spec.ts` (new; 1440, 834, 390).

## Deviations

- **A `fixture` answer after the fixture-users 404, or a failed method read, is an error.** The plan names only the two provider labels. The screen shows the existing `ErrorNotice` instead of falling back to the Google label, because a wrong label would send people to the wrong sign-in.
- **The browser spec also presses the provider button by keyboard.** The plan asks for the organisation variant rendered through `page.route`. The spec also Tabs to the button and presses Enter, answering `POST /auth/sign-in` (which fixture mode does not serve) through `page.route` with a same-origin redirect, so it proves the button works by keyboard without leaving loopback. It also asserts, before any routing, that the real server answers `{ method: 'fixture' }` with `no-store`.
- **The W1-13 API substitute does not serve the route.** It is not in the plan's file list, and the substitute is fixture-mode only: the screen reads the method only after the fixture-users 404, which the substitute never gives. The W0-02 amendment says so.
- **`Cache-Control: no-store`** on the answer (the plan does not say): the method follows the running mode, which can change at a restart.
- **Lane environment.** `rai-web/.env` (never committed) sets `RAI_PG_TOOLS=docker-compose:rai-ops`, as earlier W7 lanes did, so the W7-01/W7-02 backup tests find this lane's Postgres container.

## Commands and results

Worktree `/tmp/rai-w7-09-sign-in-method-endpoint`, Postgres project `rai-ops` on 55385 (`docker compose -p rai-ops down -v; POSTGRES_PORT=55385 docker compose -p rai-ops up -d --wait`), `rai-web/.env` from `.env.example` with 54320 → 55385, `PORT=8841`, `PUBLIC_BASE_URL=http://127.0.0.1:8841`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8842`, `SUBSTITUTE_PORT=8843`, `SUBSTITUTE_WEB_PORT=5195`, `OBS_MIGRATION_ADMIN_URL` for 55385, `RAI_PG_TOOLS=docker-compose:rai-ops`; `npm ci`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-09-sign-in-method-endpoint-logs/`. Base `origin/main` cac09e0.

| Command (from `rai-web/` unless noted)                                                                                                                             | Result                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/identity/routes.test.ts shared/src/schemas/auth.test.ts` | 21 tests, 17 pass, 4 fail (the three route tests 404; `auth.test.ts` missing export `SIGN_IN_METHODS`) |
| RED: same runner on `web/src/api/client.test.ts web/src/screens/sign-in/sign-in.view-model.test.ts`                                                                | 27 tests, 24 pass, 3 fail (`getSignInMethod is not a function`; view-model module not found)           |
| RED: `npm run build` (new unit tests set aside), then `npx playwright test -c tests/browser/playwright.config.ts --project desktop-1440`                           | W7-09 spec failed: `GET /auth/sign-in-method` 404, expected 200; 69 other specs passed                 |
| GREEN: the unit runs above plus `shared/src/locales/locales.test.ts`                                                                                               | 56/56                                                                                                  |
| GREEN: `npm run build`; `npx playwright test -c tests/browser/playwright.config.ts tests/browser/w7-09-sign-in-method.spec.ts`                                     | 3 passed (1440, 834, 390)                                                                              |
| `npm run lint`                                                                                                                                                     | pass                                                                                                   |
| `npm run typecheck`                                                                                                                                                | pass                                                                                                   |
| `npm run test:unit`                                                                                                                                                | 1035 tests, 1035 pass                                                                                  |
| `npm run test:integration`                                                                                                                                         | 441 tests, 441 pass                                                                                    |
| `npm run build && npm run check:substitute-absent`                                                                                                                 | pass; scanned 911 files, 0 with the marker                                                             |
| `npm run test:browser:server`                                                                                                                                      | 208 passed (8.1m)                                                                                      |
| `npm run test:browser:substitute`                                                                                                                                  | 48 passed                                                                                              |
| `node scripts/check-links.mjs` (repository root)                                                                                                                   | 0 broken                                                                                               |
| `git diff --check` (repository root)                                                                                                                               | clean                                                                                                  |

## Reviewer notes

- Tech-lead review (HRR): the route is public and answers in every mode; it discloses only which of three sign-in kinds runs, which the provider button already reveals to any visitor. Unit tests assert no issuer, client id or secret, or allow-list email appears in the body.
