# Spec: A01 network clause suite (W7-08)

Source: W7 plan section 5.2, section 9 row W7-08, sections 1.2 (W7-D1, W7-D2, W7-D3), 13 and 14; the plan wins over issue #233.

## Configuration under test

The published W1-00 configuration seed (`applyConfigurationSeed`) is applied first; no fixture case is loaded (the fixture loader refuses `network`).


`RAI_IDENTITY_MODE=network`, `RAI_IDENTITY_NETWORK_SOURCE=allow-list`, `HOST=127.0.0.1`, `PUBLIC_BASE_URL=https://desk.rai-desk.test`, `TRUST_PROXY=true`, `NODE_ENV=test`, `QC_MODE=deterministic`, `MAIL_MODE=sink-file`. Issuer `https://idp.rai-desk.test`; synthetic client ID and secret. Allow-list (all `@rai-desk.example`, synthetic): one account per role (owner, BU SPOC CM, AI/COE, DPO, IT Security, Admin), plus a BU SPOC for HR and a second owner. Discovery seam: a document for the synthetic issuer whose token endpoint is a closed loopback port. Exchange seam: returns the claims of the synthetic account named by the callback `code`, with the transaction nonce. Every request carries `X-Forwarded-Proto: https`.

## `rai-web/tests/support/network-sign-in.ts`

- `NETWORK_ISSUER`, `NETWORK_BASE_URL`, `SESSION_COOKIE` (`__Host-rai_session`), `TRANSACTION_COOKIE`, `PROXY_HEADERS`; `NetworkAccount` (`sub`, `email`, `name`, `emailVerified?`); `allowListJson(entries)`.
- `networkEnv(root, allowList, overrides?)`: the shell's database URLs plus the configuration above, with `BLOB_DIR` and `MAIL_SINK_DIR` under `root`.
- `startNetworkDesk({ db, env, accounts })`: the `start.ts` composition for `network` / `allow-list` with `MAIL_MODE=sink-file`, built from its parts (the real `parseConfig`; the identity adapter with the two seams; the BU directory with the configured grants; the file drop; the live recipient directory loaded before listen; the blob store; the deterministic QC runner; the readiness reader; `composeAppDeps`; the audited `buildApp`), listening on a free loopback port; returns `{ origin, close }`.
- `signInNetwork(origin, code)`: `POST /auth/sign-in` then `GET /auth/callback?code=<code>&state=<state>` with the `__Host-rai_signin` cookie, over HTTP; returns the callback status and body, the `__Host-rai_session` pair (if any), the `Set-Cookie` list and the authorization URL.

## `rai-web/tests/integration/w7-08-network-a01.test.ts`

1. `/readyz`: `identity { mode: network, loopbackBind: true, status: ok }`, overall `ready`; `GET /auth/fixture/users` and `POST /auth/fixture/sign-in` answer 404; `/auth/sign-in-method` is `organization`.
2. Each listed account signs in (303, `__Host-rai_session` with `Secure; HttpOnly; SameSite=Lax; Path=/`, no plain `rai_session`); `GET /api/session` shows `identityMode network`, subject `oidc:<issuer hash>:<sub>` and exactly its allow-list roles.
3. A verified but unlisted email: 403 `forbidden`, no session cookie, no session row, one `identity.sign_in_refused` audit row with reason `not_allow_listed`, issuer key `oidc`. `email_verified: false` for a listed email: 401 `unauthenticated`, no session, audit reason `email_not_verified`.
4. Over cases created through the API by owner A (one CM, one HR, each with an uploaded artifact; CM submitted): owner B is 403 on read, draft, write, upload and direct artifact download of A's cases and lists none; the CM SPOC reads the CM case and is 403 on the HR case and its artifact; each reviewer is 403 approving and sending back another lane (the refusal happens before the body is read, so the body carries a random `qcRunId`); Admin is 403 approving or sending back any lane and on create, upload and submit; the case's owner and BU SPOC are 403 approving a lane (D05); reviewers and Admin read the case (200) but are 403 on owner writes; no session is 401 on the API and the direct artifact URL; an unknown case id is 403 for a scoped actor and 404 for an all-cases actor. Same codes and envelope as the fixture-mode suites; no lane decision is written.
5. Allow-list change: restart the desk on the same database with the DPO account moved to IT Security and the second owner removed. The DPO session from before the restart keeps its recorded principal (`dpo`); a fresh DPO sign-in has `it_security`; the removed owner's old session still resolves, a fresh sign-in is 403 `not_allow_listed`.
6. A signed-in owner write marked `Sec-Fetch-Site: cross-site` is 403 and writes nothing; the same request `same-origin` succeeds.
7. `main.ts` spawned with the same configuration but `PUBLIC_BASE_URL=http://desk.rai-desk.test` exits 78 with `process.refused` `base_url_not_https` and never listens.

## `server/src/start.test.ts` (one new case)

`startServer` in process with the network configuration and seams (no Postgres): listens on loopback, readiness identity `network` / `ok` / `loopbackBind true`, fixture routes 404, `POST /auth/sign-in` issues `__Host-rai_signin` and redirects to the synthetic issuer's authorization endpoint.

## Docs

`docs/acceptance.md`: dated A01 evidence line "A01 network clause on loopback in `network` mode; no non-loopback bind performed (D10)". W0-03 section 11 row ID-16: evidence pointer to this suite. Threat model row "Networked test exposed with arbitrary Google login": W7-08 evidence link.
