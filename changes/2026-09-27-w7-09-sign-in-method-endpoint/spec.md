# Spec: sign-in method endpoint and UI (W7-09, #218)

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 6 (route table row `GET /auth/sign-in-method`), section 7 (UI and proof), section 9 row W7-09, section 14 (W0-02 section 7 amendment). The plan wins over issue #218.

## Contract (`shared/src/schemas/auth.ts`)

- `SIGN_IN_METHODS = ['fixture', 'google', 'organization']`, `SignInMethod`.
- `SignInMethodResponseSchema = { method: SignInMethod }` (no other property).
- `signInMethodOf(mode: IdentityMode): SignInMethod`: `fixture` → `fixture`, `local-google` → `google`, `network` and `production` → `organization`. Exhaustive over `IdentityMode`.

## Route (`server/src/identity/routes.ts`)

`GET /auth/sign-in-method`, auth `public`, registered in every identity mode (before the fixture branch), response schema `SignInMethodResponseSchema`, header `Cache-Control: no-store` (the answer follows the running mode). The body is `{ method: signInMethodOf(deps.adapter.mode) }` and nothing else: no issuer URL, client id, tenant id or allow-list value.

## Client (`web/src/api/client.ts`)

`API_PATHS.signInMethod = '/auth/sign-in-method'`, part of the sign-in flow paths (a 401 there never calls the unauthenticated handler). `api.getSignInMethod()` GETs it and checks the body against `SignInMethodResponseSchema`; a body that does not match throws `InvalidResponseError`.

## Sign-in screen

- New `web/src/screens/sign-in/sign-in.view-model.ts`:
  - `PickerState`: `loading` | `fixture` (users) | `provider` (method `google` | `organization`) | `failed` (error).
  - `PROVIDER_COPY`: `google` → button `auth.sign_in_with_google`, note `sign_in.google_note`; `organization` → button `auth.sign_in_with_organization`, note `sign_in.organization_note`.
  - `loadSignInPicker(source)`: fixture users 200 → `fixture`; 404 → reads the method; `google`/`organization` → `provider`; `fixture` after a 404 (an inconsistent server) → `failed` with `InvalidResponseError`; any thrown error → `failed`.
  - `describeRoles` moves here unchanged (only the screen uses it).
- `sign-in-screen.tsx` uses `loadSignInPicker` and renders the provider button and note from `PROVIDER_COPY[picker.method]`. The fixture branch is unchanged.

## Locales

`auth.sign_in_with_organization` and `sign_in.organization_note`, th and en. No key renamed or removed.

## Docs

W0-02 section 7.2: a dated "W7-09 amendment (2026-09-28)" paragraph after the table naming the route, its answers and what it never carries.

## Tests

- `shared/src/schemas/auth.test.ts` (new): `signInMethodOf` for all four modes; the schema accepts the three values and refuses an extra property or another value.
- `server/src/identity/routes.test.ts`: `local-google` → `google`; `fixture` → `fixture`; `network`/`allow-list` → `organization`; public (no cookie), `no-store`, body has exactly `method`, and no configured issuer, client id or allow-list email appears in the raw body.
- `web/src/api/client.test.ts`: `getSignInMethod` path, method and credentials; invalid body → `InvalidResponseError`; a 401 does not call the unauthenticated handler.
- `web/src/screens/sign-in/sign-in.view-model.test.ts` (new): the four `loadSignInPicker` outcomes and `PROVIDER_COPY` keys.
- `tests/browser/w7-09-sign-in-method.spec.ts` (real built server, fixture mode): the real server answers `{ method: 'fixture' }`; with `page.route` answering `/auth/fixture/users` 404 and `/auth/sign-in-method` `organization`, the screen shows the organisation button and note and no Google button, th then en (locale switch by keyboard), the button reachable and focused by Tab with a visible ring, axe zero critical and serious, no horizontal scroll; at 1440, 834 and 390 (the config's projects). The button is not pressed: that would call `POST /auth/sign-in`, which fixture mode does not serve.
