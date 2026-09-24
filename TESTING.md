# Verification

## Local design demo

The owner authorized the synthetic demo on 2026-09-21. This is a bounded exception to the earlier Markdown-only inventory rule. Production acceptance remains governed by docs/acceptance.md and the W0–W8 plan.

Start the app in one terminal:

```sh
python3 demo/serve.py
```

Run component and provenance tests from repository root (Node 18 or later):

```sh
node --test tests/*.test.mjs
```

The harness loads the actual Component from demo/index.html. Tests cover state transitions, negative role/version/Ready cases, QC, configuration, exact exported-source preservation and frozen product-source identity. These are prototype/UI invariants, not proof of backend authorization.

### Browser end-to-end suite

[tests/browser-journey.mjs](tests/browser-journey.mjs) exports runReviewJourney(page) and runAdditionalChecks(page). Both accept a Playwright-compatible page with getByRole, locator, and getByRole(...).all(). Tests assert user-visible state and interact only through UI controls. They work with a normal Playwright page or Codex tab.playwright. No fixed sleeps, private application state or direct event-handler calls.

For Codex, read the exported functions into the supported browser REPL, bind the localhost tab, and execute:

```js
await runReviewJourney(tab.playwright);
await runAdditionalChecks(tab.playwright);
await runFunctionalGate(tab.playwright);
await runDispositionChecks(tab.playwright);
```

The last two functions are exported from [tests/browser-functional-gate.mjs](tests/browser-functional-gate.mjs). They cover pack save/discard, negative validation, six-role controls, history/notification links, all disposition kinds and Admin recovery. See the [functional gate](changes/2026-09-21-local-design-demo/functional-gate.md) for executed outcomes and fixes. Small visual differences are accepted by the owner; functional failures are not.

With an existing developer Playwright installation, import the functions, navigate a page to http://127.0.0.1:5173/, and call all four with that page. Playwright is not bundled here and no standalone CLI browser runner is claimed. The app itself needs no npm packages.

The first function verifies submit with findings, send-back, document correction, version 2, three approvals, blocked readiness, dispositions and Ready. The second verifies new-case validation/Unknown/N/A, admin revision, all preview widths, unavailable QC, checklist v2 isolation and reset. See the dated [review](changes/2026-09-21-local-design-demo/review.md) for executed results.

### Visual verification

Compare the same synthetic state in the [Claude reference](https://claude.ai/artifact/25FPuPyj6aczLrXca3P9Mz) and local page. Match browser viewport, preview width and role. Import [compareArtboards](tests/visual/compare-artboards.mjs), then call `await compareArtboards(localPage, referenceFrame, exactHeading, stateLabel)` after UI navigation. Inspect the returned differences; this helper reports rather than throws. It normalizes the outer canvas offset and compares every positive-size element except script/style/option nodes and runtime interpolation spans. It checks tags, geometry (0.001 CSS-pixel numerical tolerance) and 25 computed CSS properties. Text and native control behavior require separate assertions.

The [expanded results](tests/visual/expanded-geometry-results.json) record 58 executed comparisons across the primary workflow and dialogs at 1440/834/390. Equal node counts and styles were observed throughout; maximum coordinate delta was 0.0001220703125 CSS pixels. Earlier sampled text/control results remain in tests/visual/geometry-results.json. Width controls close notifications, so reopen the drawer at each width before capturing that state. These are authored preview widths, not a claim of exhaustive real-device coverage.

Screenshot captures supplied by the current browser tool are lossy JPEG even when previous files were named .png. The current original JPEGs and decoded crops are named queue-fixed-*. A JPEG pixel difference is not a lossless visual assertion. Zero-pixel equality across the whole workflow has not been certified. Do not promote the exact sampled geometry result into that broader claim.

## Repository checks

Run git diff --check, inspect git status, run the two zero-dependency scripts W1-12 added from the repository root (`node scripts/check-links.mjs` for relative Markdown links and heading anchors; `node scripts/check-frozen-source.mjs` for the SHA-256 of docs/product/source-spec.md against the first row of docs/sources.md, which is the only place the expected value is stated), and inspect the change review for unresolved scope/acceptance gaps. `node --test scripts/*.test.mjs` runs the tests of those scripts, including the one that proves a deliberately altered copy of the snapshot fails the hash check. Product sources remain immutable. Only synthetic fixtures belong in demo/ and tests/; no credentials or real case material.

## Product build (W0-W3)

Authorized on 2026-09-21 (D03). The commands below are implemented under the [W0-02 file-level plan](docs/engineering/implementation-plan-w1-w3.md#3-commands), W1-00 and W1-12. The [W3 exit](changes/2026-09-23-w3-exit/review.md) records executed commands, exact source identities and remaining acceptance boundaries. W0-09 verified on 2026-09-21 that this section matches the plan after the W0 exit reconciliation ([exit review](changes/2026-09-21-w0-exit/review.md)); the [performance targets](docs/engineering/performance-targets.md) remain advisory; bounded synthetic measurements are recorded separately in the W3 exit. The demo suite above stays separate from the product suite; no command is shared.

All `npm` commands run from `rai-web/` with Node 24 (`export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` or `nvm use`). Docker must be running for anything that touches Postgres.

Install (once per checkout; `npx playwright install chromium` once per machine). `npm run dev` needs a local Google OAuth client (`RAI_IDENTITY_GOOGLE_CLIENT_ID`, `RAI_IDENTITY_GOOGLE_CLIENT_SECRET` in `.env`, never committed; plan section 3.1); the test commands do not, because they run with `NODE_ENV=test` and `RAI_IDENTITY_MODE=fixture`. There is no session secret to generate: the session cookie is a random value looked up by hash in Postgres (W0-03 section 6.3).

```sh
cd rai-web && cp .env.example .env
npm ci && npx playwright install chromium
```

Local Postgres (from the repository root; `POSTGRES_PORT` selects the loopback host port, default 54320; per-ticket isolation uses `-p rai-<ticket-id>` and port `54320 + <ticket number>`, with `DATABASE_URL` in that worktree's `.env` set to match):

```sh
POSTGRES_PORT=54320 docker compose -p rai-dev up -d --wait
POSTGRES_PORT=54320 docker compose -p rai-dev down -v
```

Migrate, seed, reset (migrations are forward-only SQL under `rai-web/server/drizzle/`, applied only by this explicit step, never on start):

```sh
npm run migrate            # apply pending migrations as rai_owner (DATABASE_MIGRATE_URL)
npm run fixtures:generate  # write the W0-08 synthetic documents to rai-web/.local/fixtures/ and check them against fixtures/src/data/manifest.json; prints the fixture set name, version and manifest hash (-- --write-manifest refreshes the manifest after a fixture change; bump its version in the same PR)
npm run fixtures:load      # synthetic fixture set (five cases, open drafts, slot rows, 33 objects under BLOB_DIR, artifact rows, the fixture_set row) into an empty database (W1-09); refuses a non-empty one, NODE_ENV outside development/test and RAI_IDENTITY_MODE outside local-google/fixture; -- --reset runs npm run reset first
npm run reset              # db:down, remove rai-web/.local (blobs, mail sink, generated fixtures), db:up, migrate, fixtures:load; development and test only
npm run db:cleanup         # operator command: expire idempotency keys and remove expired or revoked session rows (W1-01); --report lists stale drafts and objects under BLOB_DIR/sha256 that no artifact row references (W1-03; dry run until D08)
npm run store:verify       # operator command (W1-03): re-hash every object an artifact row references and compare hash and size; non-zero exit on any mismatch or missing object
npm run store:cleanup      # operator command (W1-03): remove temp files under BLOB_DIR/tmp older than BLOB_TMP_MAX_AGE_HOURS; objects are never removed (D08)
```

Run:

```sh
npm run dev                # API http://127.0.0.1:8787 (local-google identity, loopback only) + Vite http://127.0.0.1:5174
npm run build && npm start # the one deployable: server/dist serving web/dist
```

Sign-in surface (W1-01, W0-03 section 6): `POST /auth/sign-in` → `GET /auth/callback` for `local-google` (loopback only; the process refuses to start on a non-loopback bind, an unknown mode, a missing client or `TRUST_PROXY=true`, exit 78 with the reason code), `GET /auth/fixture/users` and `POST /auth/fixture/sign-in { fixtureUserId }` in `fixture` mode only (`NODE_ENV=test`, loopback; the built server loads the eight identities from `@rai/fixtures` at run time, so `fixtures/dist` must exist: `npm run typecheck` or `npm run build -w fixtures` emits it; the slice-1 BU keys come from the same module in every mode, so an installed fixtures package that fails to import refuses to start with `fixtures_import_failed`, exit 78, and only an absent package, as in a production install, starts without them), `GET /api/session`, `POST /api/session/locale`, `POST /auth/sign-out` (needs `Sec-Fetch-Site: same-origin` or `none`). Every route declares its `config.auth`; a request without a session is `401 unauthenticated` before anything else and a wrong role or out-of-scope case is `403 forbidden` from `rai-web/server/src/authz/middleware.ts`, the only place scope is enforced. The same middleware refuses any signed-in write whose `Sec-Fetch-Site` is present and neither `same-origin` nor `none` (403, `authz.denied` reason `cross_site`); a request without the header passes, so `app.inject()` and Playwright request helpers need none.

Artifacts (W1-03, W0-02 section 7.4, W0-08, W0-04 "Artifact store"): `POST /api/cases/{caseId}/artifacts` takes `multipart/form-data` with one part named `file` and nothing else (owner or BU SPOC of the case, which must have an open draft); the bytes are staged under `BLOB_DIR/tmp/` while hashed, checked in the W0-08 section 4 order (filename rule, 25 MiB per file, non-empty, magic sniff, extension match, structural check, 150 MiB per pack under the case lock) and committed as `BLOB_DIR/sha256/<h[0:2]>/<h[2:4]>/<h>` (root `0700`, objects `0600`, no extension, deduplicated by hash) together with the `artifact` row and the `artifact.uploaded` audit event; the answer is `201 ArtifactRef` with the sniffed media type, or `422 unsafe_upload` with `details.reasonKey` from the W0-08 section 5 vocabulary (nothing stored, no audit row, one `upload.rejected` log line without the filename). `GET /api/artifacts/{artifactId}` streams the bytes as an attachment (`Content-Disposition` with the RFC 8187 `filename*` so a Thai name round-trips, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; audit `artifact.downloaded`) and `GET /api/artifacts/{artifactId}/meta` returns the `ArtifactRef`; both follow the case-view scope of the owning case, answer `401` without a session, `403` out of scope (also for an unresolvable id when the caller holds only own/BU scope) and `404 not_found` (`resource: 'artifact'`) only for an `all_cases` holder. The blob directory is never served. `UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_PACK_BYTES` and `UPLOAD_MAX_IMAGE_PIXELS` above their W0-08 defaults are refused at start in `local-google` and `fixture` modes (exit 78). `tests/integration/w1-03-*.test.ts` run the Done-when clauses, the W0-05 T10/T11/T12/T33 rows for `artifact.*`, every W0-08 section 8.6 hostile row through the route (the per-file and pack-total boundaries at their real values), and the operator commands; `server/src/artifacts/*.test.ts` cover the sniff, the filename rule and the filesystem store.

Submit and versions (W1-05, W0-02 section 7.6, W0-06 4.3, W0-04 "Submit" row): `POST /api/cases/{caseId}/draft/submit` (owner or BU SPOC of the case; header `Idempotency-Key`; body `{ expectedVersion: { versionId: <draftId>, revision: <draftRevision> } }`) freezes the open draft in place as an immutable `pack_version` in one transaction under the case row lock: `submitted_by/role/at`, `configuration_revision_id` plus `frozen_configuration` (`{kind: revision_id}` for every configuration kind in force at that instant under the W1-00 activation rule), `lane_mapping_version = 'lane-mapping/v1'` with the D02 constant's content, the draft's `checklist_template_version` and `stage_context` (D11), the `manifest_hash` over the nine slot rows and the submit correlation id; the case then has no open draft (`current_version_id` set, `draft_version_id` NULL, `desk_status = 'in_review'`, the three lane projections `pending`, `caseRevision + 1`) and the audit event `version.submitted` carries actor, role, version, correlation id and the key. The answer is `201 SubmittedVersion` with the artifact references embedded; a replay under the same key and body returns the same body and writes nothing, the same key with another body is `422 error.invalid_input.idempotency_key_reused`, a missing header `422` at `header.idempotency-key`, a stale `expectedVersion` `409 stale_version` (`revision_changed`, or `version_superseded` once submitted) with nothing written, and missing or not-yet documents never block (L7). `GET /api/cases/{caseId}/versions`, `/versions/latest` and `/versions/{versionId}` (every role under the case's scope; `404 version` when never submitted or when the id belongs to another case) serialise the same body byte for byte on every read. No UPDATE or DELETE path exists for a submitted version or its slots in the data layer, and the W1-00 triggers `pack_version_frozen` / `artifact_slot_frozen` raise `rai.frozen_version` for any role. Lane opening, outbox rows and the SLA clock arrive with W2-01 / W3; the successor draft with W2-03. `tests/integration/w1-05-submit.test.ts` runs every Done-when clause, every 7.6 error row, the W0-05 T3/T9/T10/T11 rows and the trigger as `rai_app` and `rai_owner`; `tests/integration/w1-05-restart.test.ts` is the W0-04 restart recipe against a spawned server process (create → upload → attach → submit → SIGTERM → new process → read back and download); `server/src/versions/*.test.ts` cover the manifest hash and the pure freeze rules.

Test, lint, typecheck:

```sh
npm run test:unit          # node:test over server, shared, web and fixtures sources; no database
npm run test:integration   # node:test against the real Postgres + in-process substitutes (identity, QC, mail sink)
npm test                   # unit then integration
npm run test:browser       # both Playwright suites below, in order
npm run test:browser:server      # EVIDENCE: Playwright journeys + axe audit against the built deployable (SPA served by the server) in test mode on the real Postgres; the W1-INT journey, the promoted W1-06/W1-07 specs and the evidence-configuration check
npm run test:browser:substitute  # Lane B `*.substitute.spec.ts` against the W1-13 substitute behind the Vite dev server (no database; never evidence)
npm run lint               # eslint, prettier --check, focus-outline check
npm run typecheck          # tsc -b over all workspaces
npm run verify             # lint + typecheck + test: run before every PR
npm run verify:full        # verify + build + substitute-absence check + browser suite: what CI runs
```

Repository checks (from the repository root; the scripts and their tests arrived with W1-12):

```sh
node --test tests/*.test.mjs        # legacy demo suite and frozen-source hash
node scripts/check-links.mjs        # relative Markdown links and heading anchors resolve
node scripts/check-frozen-source.mjs  # docs/product/source-spec.md hash equals the docs/sources.md row
node --test scripts/*.test.mjs      # tests of the two scripts (altered snapshot copy fails; broken link fails)
git diff --check
```

Every PR runs the eleven CI checks in the plan's [section 6](docs/engineering/implementation-plan-w1-w3.md#6-ci-checks-on-every-pr) through [.github/workflows/ci.yml](.github/workflows/ci.yml) (W1-12; one job per row plus a `required` aggregate job that branch protection on `main` must require); all block merge. The browser job runs `npm run test:browser` against the one deployable started in test mode on loopback with Chromium only, and uploads the Playwright report and the axe results attached to each test. The browser harness helpers live in `rai-web/tests/browser/support/` (axe audit with the five WCAG tag sets, keyboard-only helpers, fixture sign-in) and the integration harness in `rai-web/tests/support/` (database bootstrap, spawned test server with log capture, fixture sign-in by `inject`, and `fixture-app.ts`: the in-process app built by the same `server/src/compose-app-deps.ts` that `start.ts` uses, reset to the fixture set before every test; it leaves submit-triggered QC unbound because those suites run it by hand); `rai-web/tests/browser/w1-12-harness.spec.ts` and `rai-web/tests/integration/w1-12-harness.test.ts` prove the runner itself. No browser or integration test reaches an external service. Evidence records cite the fixture set identity (`fixture set slice1-synthetic@1 <sha256[0:12]>`, the line `fixtures:generate` and `fixtures:load` print; the loaded database holds it in `fixture_set`) from the plan's [section 8.3](docs/engineering/implementation-plan-w1-w3.md#83-fixture-identity-convention) next to each command's output. The set's provenance statement and the identity each fixture cites are in [rai-web/fixtures/src/data/README.md](rai-web/fixtures/src/data/README.md); `fixtures/src/data/provenance.test.ts` greps the set against a pattern denylist on every unit run. Substitute runs (`VITE_API_SUBSTITUTE=true`) are never evidence. Lane B browser specs (W1-06, W1-07 onward) are named `rai-web/tests/browser/<ticket>-<topic>.substitute.spec.ts` and run through `rai-web/tests/browser/playwright.substitute.config.ts`: it starts the substitute on loopback port 8789 through `rai-web/tests/browser/support/substitute-server.ts` (the W1-13 handler plus a test-only `POST /__substitute/reset`, so a spec that saves, uploads or submits starts every test from the fixture state) and the Vite dev server on 5175 with `VITE_API_SUBSTITUTE=true` and `API_PROXY_TARGET` pointing the `/api` and `/auth` proxy at it (the ports follow `SUBSTITUTE_PORT` and `SUBSTITUTE_WEB_PORT`), one worker (the substitute's state is shared), the same three widths and the same axe, keyboard and sign-in helpers; the real-server configuration ignores those files; only a run through `rai-web/tests/browser/playwright.config.ts` counts as evidence. A substitute spec is removed once its Wx-INT spec is promoted, so each journey has one copy; the only one left is `w3-07b-operator.rehearsal.substitute.spec.ts`, which has no promoted twin. The evidence configuration runs every spec at 1440, 834 and 390 CSS px except `w3-int-fault-controls.spec.ts`, which drives the API only and runs at 1440 alone. The SPA shows a "substitute, never evidence" banner whenever it was built with `VITE_API_SUBSTITUTE=true`; `npm run build` forces it off. The W1-13 in-memory API substitute lives in [rai-web/fixtures/src/substitutes/api/](rai-web/fixtures/src/substitutes/api/README.md): it serves every W1 shape of the plan's section 7 from the fixture set, runs the W0-06 order of checks with the real policy module for every 401/403/404/409/422, and refuses to start outside `NODE_ENV=test|development` or off loopback. In-process: `createApiSubstitute()` and `createSubstituteFetch()`; on loopback for a Playwright `webServer` or a Lane B dev session: `startApiSubstitute()` or `NODE_ENV=development npx tsx --conditions=rai-source fixtures/src/substitutes/api/serve.ts --port 8787` from `rai-web/`. Its suites (`fixtures/src/substitutes/api/*.test.ts`) run inside `npm run test:unit`; `npm run check:substitute-absent` proves the built `web/dist` and `server/dist` carry no substitute.

W1 journey and exit evidence (W1-INT, W0-02 sections 7.6 and 8): the one deployable serves the built SPA from `rai-web/web/dist` through `rai-web/server/src/static.ts` (one route per built file, helmet headers with an explicit same-origin content-security policy, history fallback to `index.html` for every GET outside `/api` and `/auth`; a miss under those prefixes stays the W0-06 JSON 404; without a web build the process serves the API alone in development and test and refuses to start in production, `missing:web/dist`, exit 78). The evidence configuration `rai-web/tests/browser/playwright.config.ts` builds and starts `node server/dist/main.js` in fixture identity mode on `PLAYWRIGHT_BASE_URL` against the Postgres that `rai-web/.env` names, one worker; every spec resets the business tables and reloads fixture set `slice1-synthetic@1` into the server's `BLOB_DIR` before each test through `rai-web/tests/browser/support/database.ts` (no substitute reset hook exists). `rai-web/tests/browser/w1-int-07-shell-sign-in-cases.spec.ts` and `w1-int-06-case-pack-versions.spec.ts` are the W1-07 and W1-06 journeys promoted to evidence (the only changes: no substitute banner or `x-rai-substitute` header, both asserted absent, and the database reset); `w1-int-journey.spec.ts` is the W1 journey (owner signs in → creates a case → uploads and attaches in a slot → sets the other slots → submits → the spec SIGTERMs the built server process it spawned itself and starts a new one on the same port, database and blob directory → the case and version reopen in the same browser session with the 7.3/7.6 bodies, the stored rows and the artifact download bytes unchanged) plus the BU-SPOC-on-behalf positive (`fx-user-spoc-cm` submits `fx-case-nonvendor`, owned by `fx-user-owner-cm`; the `version.submitted` audit row names the SPOC, the owner column is unchanged); `w1-int-evidence-config.spec.ts` starts the built server with every substitute-shaped variable set and proves nothing of the substitute appears. The W1 exit negatives are direct-API tests over HTTP against a spawned real server process in `rai-web/tests/integration/w1-int-negatives.test.ts` (no session 401 including a copied artifact URL; wrong role 403 on create, draft write, upload and submit for every reviewer and the Admin; other BU 403 on read, draft, write, upload, submit, versions and artifact with the HR cases absent from the CM SPOC's list; a disguised executable refused `422 unsafe_upload`; `local-google` on a non-loopback bind or an unknown mode exits 78 without listening), and `w1-int-substitute-absent.test.ts` proves that no evidence test imports the W1-13 substitute (a transitive import walk under `rai-web/tests/`), that the evidence configuration names no substitute and sets no substitute variable, that the product source reads none, and that a server started with the substitute flags ignores them. Run the journey alone with `NODE_ENV=test RAI_IDENTITY_MODE=fixture npx playwright test -c tests/browser/playwright.config.ts w1-int` from `rai-web/` (the web server builds first; `npm run build` must have produced `server/dist` and `web/dist` for the journey's own process spawns, which the configuration's build step guarantees), the negatives and the substitute-absence checks with `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w1-int-negatives.test.ts tests/integration/w1-int-substitute-absent.test.ts` (both are part of `npm run test:integration`). `w1-int-shutdown.test.ts` proves the W0-04 graceful shutdown is bounded end to end (SIGTERM exits 0 within the drain budget while a connected socket that never sent a byte is held open — the Chromium pre-connect socket that hung the built server on the CI runner in the first review round; a request in flight at SIGTERM is answered first; the harness's `stop()` escalates to SIGKILL after its grace period and rejects with the captured lines), and `rai-web/server/src/shutdown.test.ts` proves the drain itself against plain Fastify instances. The W1 exit record itself (W1-08) runs these suites and cites the fixture set next to each output ([changes/2026-09-22-w1-exit/review.md](changes/2026-09-22-w1-exit/review.md), recorded 2026-09-22 from a clean checkout: 347 unit, 135 integration, 108 evidence browser tests, the exit negatives against the built server and the restart journey by hand); the manual `local-google` sign-in stays outside CI and follows the runbook below.

### Google sign-in on loopback (manual, W1-08)

The one W1 exit clause no test can run: a human signs in once with a Google account through the `local-google` adapter on a loopback bind (W0-03 section 4.1, obligation ID-14; work-breakdown row W1-08). It runs outside CI on Ta's machine. The OAuth client is Ta's own test client, held in the local `.env` and never committed; the record carries the one line at step 7 and never the account address. Until Ta records it, the [W1 exit review](changes/2026-09-22-w1-exit/review.md) and BUILD_PLAN say "pending Ta"; nothing else about M1 depends on it.

1. **Create a local OAuth client.** In Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, type **Web application**, any name (for example `rai-desk-loopback`). Authorised JavaScript origin `http://127.0.0.1:8787`; authorised redirect URI exactly `http://127.0.0.1:8787/auth/callback` (the adapter derives it from `PUBLIC_BASE_URL`; nothing else is accepted). If the project's OAuth consent screen is in "Testing", add the Google account you will use as a test user. Copy the client ID and secret once; they go nowhere but step 2.
2. **Set the variables locally, never commit them.** In `rai-web/.env` (gitignored; `git status` must not list it) set, using the W0-03 / W0-02 names as they already stand in `.env.example`:

   ```sh
   NODE_ENV=development
   HOST=127.0.0.1
   PORT=8787
   PUBLIC_BASE_URL=http://127.0.0.1:8787
   TRUST_PROXY=false
   RAI_IDENTITY_MODE=local-google
   RAI_IDENTITY_GOOGLE_CLIENT_ID=<the client id from step 1>
   RAI_IDENTITY_GOOGLE_CLIENT_SECRET=<the client secret from step 1>
   RAI_IDENTITY_LOCAL_ROLE_MAP=            # empty: the account receives the owner role on its own cases only (W0-03 4.1)
   ```

   `DATABASE_URL` and `DATABASE_MIGRATE_URL` point at a running local Postgres that has been migrated (`POSTGRES_PORT=54320 docker compose -p rai-dev up -d --wait` from the repository root, then `npm run migrate` from `rai-web/`; the fixture set is not needed). Leave the placeholders `set-locally` / `set-in-custody` in place for every other secret; the process refuses to start if either Google value is still a placeholder (`secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID`, exit 78), so a forgotten step 2 cannot pass silently.
3. **Start the built deployable on loopback** from `rai-web/` with Node 24:

   ```sh
   npm run build && npm start        # node server/dist/main.js: the API serving web/dist on http://127.0.0.1:8787
   ```

   Expected start-up lines: `Server listening at http://127.0.0.1:8787` and `process.started` with `"identityMode":"local-google","loopback":true`. (`npm run dev` also works with the same `.env`; it serves the SPA from Vite on 5174 and proxies `/api` and `/auth` to 8787. The redirect URI stays `http://127.0.0.1:8787/auth/callback` either way.) A `process.refused` line means the configuration failed closed: `bind_not_loopback` (HOST is not `127.0.0.1`, `::1` or `localhost`), `base_url_not_loopback`, `mode_unknown`, `secret_missing:…`, `discovery_failed` (no route to `accounts.google.com`) or `fixtures_import_failed` (`fixtures/dist` is missing or broken: `npm run build -w fixtures`). Fix the variable and start again; never work around a refusal.
4. **Sign in.** Open `http://127.0.0.1:8787/` in a browser. The sign-in screen probes `GET /auth/fixture/users`, gets the 404 of a non-fixture server, and shows the provider button: **เข้าสู่ระบบด้วย Google (เฉพาะเครื่องนี้)** (Thai default; "Sign in with Google (this machine only)" after the locale switch). Click it. The SPA posts `POST /auth/sign-in`, receives `{ redirectUrl }` and navigates to Google's account chooser (`prompt=select_account`). Choose the account, consent if asked. Google redirects to `http://127.0.0.1:8787/auth/callback?code=…&state=…`; the server completes the PKCE code exchange, verifies `iss`, `aud`, `exp`, `nonce` and `email_verified`, creates the session row and answers `303` to `/`.
5. **What "pass" looks like.** The case list renders for the signed-in account with **no cases** (an unmapped account is `owner` of its own cases only and owns none yet) and the header shows the account's display name; `GET /api/session` (visible in the browser's network panel) is `200` with `roles: [{ role: "owner", scope: { kind: "own_cases" } }]`; the server log has one `auth.signin.succeeded` line with `"identityMode":"local-google"`. Optional confirmation: create a case through **สร้างเคสใหม่** / "New case" and see it in the list; sign out through the header. Anything else — a `401`/`403` screen, an `auth.signin.failed` line, a redirect-URI mismatch page from Google — is not a pass; do not record one.
6. **Clean up.** Stop the server (Ctrl-C; `process.stopping` then exit 0). The client ID and secret stay in the local `.env` or are deleted from the Google project; they are never pasted into a document, an issue, a commit or a chat. Do not copy the `auth.signin.succeeded` line into any record (its `actorSubjectId` is `google:<provider subject>`, a stable identifier of the account); do not record the account address, the display name or the Google project name.
7. **Record exactly this line, with the date, and nothing else about the account:**

   ```text
   Google sign-in on loopback: pass — 2026-MM-DD
   ```

   Where: section 6 of [changes/2026-09-22-w1-exit/review.md](changes/2026-09-22-w1-exit/review.md) (replacing `pending Ta`), the "Milestone M1" entry in DEVLOG.md, and the W1 cell of the BUILD_PLAN status table (drop "(Google loopback sign-in pending Ta)"). One documentation PR on a `codex/w1-08-google-loopback` branch; `git diff` must show no `.env` and no client value.

## Production gates

No production stack, identity, persistence, model service or deployment is implemented by the demo. Before real-data rehearsal, approve handling/access/retention. Before production, enforce transitions and permissions server-side, evaluate QC, test concurrency, notifications, backup/restore and rollback, and obtain operator acceptance. Synthetic UI success is not production acceptance.
