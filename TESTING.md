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

Run git diff --check, inspect git status and relative Markdown links, verify frozen source SHA-256 against docs/sources.md, and inspect the change review for unresolved scope/acceptance gaps. Product sources remain immutable. Only synthetic fixtures belong in demo/ and tests/; no credentials or real case material.

## Product build (W0-W3)

Authorized on 2026-09-21 (D03). The commands below are specified by the [W0-02 file-level plan](docs/engineering/implementation-plan-w1-w3.md#3-commands) and become runnable when W1-00 creates `rai-web/` and W1-12 wires CI; until those tickets merge, none of them runs and no runtime success is claimed (W0-09 verifies only that this section matches the plan). The demo suite above stays separate from the product suite; no command is shared.

All `npm` commands run from `rai-web/` with Node 24 (`export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` or `nvm use`). Docker must be running for anything that touches Postgres.

Install (once per checkout; `npx playwright install chromium` once per machine):

```sh
cd rai-web && cp .env.example .env && npm ci && npx playwright install chromium
```

Local Postgres (from the repository root; `POSTGRES_PORT` selects the loopback host port, default 54320; per-ticket isolation uses `-p rai-<ticket-id>` and port `54320 + <ticket number>`, with `DATABASE_URL` in that worktree's `.env` set to match):

```sh
POSTGRES_PORT=54320 docker compose -p rai-dev up -d --wait
POSTGRES_PORT=54320 docker compose -p rai-dev down -v
```

Migrate, seed, reset (migrations are forward-only SQL under `rai-web/server/drizzle/`, applied only by this explicit step, never on start):

```sh
npm run migrate            # apply pending migrations to DATABASE_URL
npm run fixtures:load      # synthetic fixture set into an empty database (W1-09); refuses a non-empty one
npm run reset              # db:down, db:up, migrate, fixtures:load, remove rai-web/.local (blobs, mail sink)
```

Run:

```sh
npm run dev                # API http://127.0.0.1:8787 (fixture identity by default) + Vite http://127.0.0.1:5174
npm run build && npm start # the one deployable: server/dist serving web/dist
```

Test, lint, typecheck:

```sh
npm run test:unit          # node:test, no database
npm run test:integration   # node:test against the real Postgres + in-process substitutes (identity, QC, mail sink)
npm test                   # unit then integration
npm run test:browser       # Playwright journeys with the axe-core accessibility audit, against the served SPA
npm run lint               # eslint, prettier --check, focus-outline check
npm run typecheck          # tsc -b over all workspaces
npm run verify             # lint + typecheck + test: run before every PR
npm run verify:full        # verify + build + substitute-absence check + browser suite: what CI runs
```

Repository checks (from the repository root; the two scripts arrive with W1-12):

```sh
node --test tests/*.test.mjs        # legacy demo suite and frozen-source hash
node scripts/check-links.mjs        # relative Markdown links resolve
node scripts/check-frozen-source.mjs
git diff --check
```

Every PR runs the eleven CI checks in the plan's [section 6](docs/engineering/implementation-plan-w1-w3.md#6-ci-checks-on-every-pr); all block merge. Evidence records cite the fixture set identity from the plan's [section 8.3](docs/engineering/implementation-plan-w1-w3.md#83-fixture-identity-convention) next to each command's output. Substitute runs (`VITE_API_SUBSTITUTE=true`) are never evidence.

## Production gates

No production stack, identity, persistence, model service or deployment is implemented by the demo. Before real-data rehearsal, approve handling/access/retention. Before production, enforce transitions and permissions server-side, evaluate QC, test concurrency, notifications, backup/restore and rollback, and obtain operator acceptance. Synthetic UI success is not production acceptance.
