# File-level implementation plan: W1-W3

Status: **W0-02 draft for tech-lead and Ta review** (ticket [W0-02](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan), issue #7). Makes [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04) concrete: paths, commands, pinned dependencies, local configuration, CI checks, the W1 request/response shapes, the test-layer map, the UI quality bar and the language rule. Nothing here is installed or built; [W1-00](../delivery/slice-1-work-breakdown.md#w1--scoped-case-and-versioned-pack) creates the skeleton exactly as written here and [W1-12](../delivery/slice-1-work-breakdown.md#w1--scoped-case-and-versioned-pack) wires the CI checks.

What this document is not: it records no D01-D12 decision, resolves nothing in D07-D10, and does not edit the frozen [source spec](../product/source-spec.md). Where it names a value that another W0 spec owns (upload limits from W0-08, the 403-versus-404 answer from W0-05, the slot-5 and pack-level owning-lane rule from W0-06), it references that spec and carries a marked placeholder. Two items are proposals for Ta to confirm at the W0 exit review (W0-09): the [UI quality bar](#9-ui-quality-bar) and the [sub-ticket split](#11-pr-size-branch-rules-and-slice-1-sub-tickets); both are marked.

Read with: [W0 technical contract](../delivery/w0-technical-contract.md), [slice-1 work breakdown](../delivery/slice-1-work-breakdown.md), [team and roles](../delivery/team-and-roles.md), [architecture](../architecture/README.md), [decision register](../product/decisions.md), [workflow](../product/workflow.md), [data contract](../product/data-contract.md), [acceptance](../acceptance.md), [threat model](../security/threat-model.md), [design handoff](../design/DEVELOPER_HANDOFF.md), [TESTING](../../TESTING.md).

Sibling W0 specs this plan consumes (each lands in `docs/engineering/` under its own ticket; links point at the contract row until the spec merges): [W0-03 identity adapter](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec), [W0-04 persistence and artifact store](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec), [W0-05 authorization matrix](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix), [W0-06 workflow transition and error contract](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract), [W0-07 QC boundary and mail sink](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink), [W0-08 upload safety and fixtures](../delivery/w0-technical-contract.md#w0-08--upload-safety-policy-and-fixtures), [W0-10 observability](../delivery/w0-technical-contract.md#w0-10--observability-contract-for-the-desk-runtime).

---

## 1. Repository layout

One repository, one deployable (ADR-0003 shape B1). The product lives under `rai-web/`, an npm workspace root with five workspaces. The legacy `demo/` and its `tests/` stay untouched at the repository root as reference only (ADR-0002); the demo suite and the product suite never share a command.

```text
rai-workflow-platform-poc/
├── AGENTS.md, README.md, PRD.md, BUILD_PLAN.md, TESTING.md, DEVLOG.md, CHANGELOG.md
├── adr/, docs/, changes/, media/          # documents (unchanged by W1-W3 except where a ticket says)
├── demo/                                  # legacy synthetic demo; reference only, never imported by rai-web
├── tests/                                 # legacy demo suite: node --test tests/*.test.mjs (unchanged)
├── scripts/                               # repo-level checks, zero dependencies (W1-12)
│   ├── check-links.mjs                    #   relative Markdown links resolve
│   └── check-frozen-source.mjs            #   docs/product/source-spec.md hash equals docs/sources.md
├── docker-compose.yml                     # Postgres 16 for local + CI; POSTGRES_PORT selects the host port (W1-00)
├── .github/workflows/ci.yml               # the PR checks in section 6 (W1-12; agents never edit)
├── .gitignore                             # .env, .local/, node_modules/, dist/, playwright-report/, test-results/
└── rai-web/                               # npm workspace root; every npm command runs from here
    ├── package.json                       # workspaces: shared, server, web, fixtures, tests; scripts in section 3
    ├── package-lock.json                  # committed; npm ci fails on drift
    ├── .nvmrc                             # 24.21.0
    ├── .env.example                       # variable list of section 5 with placeholders (W1-00); .env is gitignored
    ├── tsconfig.base.json                 # strict, ES2024, module NodeNext, verbatimModuleSyntax
    ├── tsconfig.json                      # project references to the five workspaces (npm run typecheck = tsc -b)
    ├── eslint.config.js, .prettierrc      # one lint configuration for all workspaces
    ├── scripts/
    │   ├── dev.mjs                        # spawns the API (tsx watch) and the Vite dev server; no dependency
    │   ├── check-substitute-absent.mjs    # fails if web/dist or server/dist contains the substitute marker
    │   └── check-css.mjs                  # fails on outline removal outside :focus-visible (section 9)
    ├── .local/                            # gitignored runtime data: blobs/, mail/ (npm run reset removes it)
    │
    ├── shared/                            # @rai/shared — the typed contract both halves import (Lane A owns; contract PRs only)
    │   └── src/
    │       ├── index.ts
    │       ├── errors.ts                  # the eight error codes, HTTP status map, ApiError shape (section 7.1)
    │       ├── ids.ts                     # branded id types, RegistryId format
    │       ├── constants.ts               # APP_TIMEZONE = 'Asia/Bangkok' (D06), LANE_MAPPING (D02, versioned), SLOTS
    │       ├── schemas/                   # TypeBox schemas per section 7; types are inferred from them
    │       │   ├── auth.ts                #   sign-in (7.2)
    │       │   ├── cases.ts               #   case create/edit/read/list, configuration read (7.3)
    │       │   ├── artifacts.ts           #   upload/download (7.4)
    │       │   ├── pack.ts                #   pack draft (7.5)
    │       │   ├── versions.ts            #   submit and version navigation (7.6)
    │       │   ├── review.ts              #   W2 shapes — added by the W2-02 / W2-05 contract PRs (empty until then)
    │       │   └── queue.ts               #   W3 shapes — added by the W3-01 / W3-05 contract PRs (empty until then)
    │       ├── qc/types.ts                # typed finding, unavailable result, owning lane (W0-07)
    │       ├── mail/types.ts              # committed event, recipients, deep link, dedup key, delivery status (W0-07)
    │       └── locales/                   # section 10: th.json (default), en.json, keys.ts (typed key union)
    │
    ├── server/                            # @rai/server — Fastify API, serves web/dist (Lane A)
    │   ├── drizzle.config.ts
    │   ├── drizzle/                       # forward-only SQL migrations, numbered, reviewed, never edited after merge
    │   │   ├── 0000_w1_00_substrate.sql
    │   │   └── meta/
    │   └── src/
    │       ├── main.ts                    # reads config, refuses to start when config fails closed, listens
    │       ├── app.ts                     # buildApp(deps): registers plugins and routes; used by tests without listen
    │       ├── config.ts                  # section 5 variables parsed and validated; no other file reads process.env
    │       ├── identity/                  # W0-03 adapter: interface, local-google (openid-client), fixture (test only),
    │       │                              #   network and production (fail closed), session store (W1-01a)
    │       ├── authz/                     # W0-05 policy module (rows as data) + the one authorization middleware (W1-00, W1-01b)
    │       ├── db/                        # Drizzle client, schema/*.ts per entity, migrate.ts, transaction helper (W1-00)
    │       ├── cases/                     # case create/edit/read/list, configuration read, projections rule (W1-02)
    │       ├── artifacts/                 # blob-store interface, fs implementation, safety pipeline, routes (W1-03a/b)
    │       ├── pack/                      # nine-slot draft rules (W1-04)
    │       ├── versions/                  # submit/freeze, version navigation, idempotency keys (W1-05)
    │       ├── workflow/                  # W0-06 transitions, lanes, decisions, Ready predicate (W2-01 to W2-04, W2-06)
    │       ├── findings/                  # dispositions contract (W2-05, Lane B server half via contract PR)
    │       ├── queue/                     # W3-01 scoped query; sla/ for W3-05
    │       ├── notifications/             # W3-03/W3-04 composer, templates by locale key, retry, dedup
    │       ├── qc/                        # QC port; slice 1 binds the W1-10 substitute, marked as such
    │       ├── configuration/             # configuration revisions, seed, activation rule (W1-00)
    │       ├── audit/                     # append-only audit store; no update/delete function exists (W1-00)
    │       ├── observability/             # correlation id, redacted pino logger, /healthz, /readyz, operator view (W3-07)
    │       ├── static.ts                  # serves ../web/dist with CSP and history fallback for non-/api paths
    │       └── **/*.test.ts               # unit tests colocated with the module
    │
    ├── web/                               # @rai/web — React + Vite SPA (Lane B)
    │   ├── index.html, vite.config.ts     # dev server 127.0.0.1:5174 proxies /api and /auth to the API
    │   └── src/
    │       ├── main.tsx, app.tsx, router.tsx
    │       ├── api/                       # typed client over @rai/shared; the only place fetch is called
    │       ├── i18n/                      # locale provider, t(), date/time formatting in APP_TIMEZONE
    │       ├── screens/                   # shell, sign-in, cases (W1-07); pack editor, case, versions (W1-06);
    │       │                              #   reviewer, history (W2-07); findings (W2-09); queue (W3-02)
    │       ├── components/                # status badge (text + icon + colour), dialog (focus trap), forms
    │       └── **/*.test.ts               # unit tests for pure modules only (view models, formatting); no DOM tests here
    │
    ├── fixtures/                          # @rai/fixtures — Lane C synthetic data and substitutes; never in production build
    │   └── src/
    │       ├── data/                      # W1-09: users.ts (W1-00 owns the six users + dual-role identity), cases/, documents/
    │       │   └── manifest.json          #   fixture set name, version, sha256 of the data directory (section 8.3)
    │       ├── load.ts                    # npm run fixtures:load — loads data/ into an empty database
    │       ├── substitutes/
    │       │   ├── qc/                    # W1-10 scripted findings, unavailable, timeout
    │       │   ├── mail-sink/             # W1-11 file / in-memory sink
    │       │   └── api/                   # W1-13 in-memory API substitute for the web app (dev/test only; W2-10, W3-08 extend)
    │       └── substitute-marker.ts       # exported constant the build check greps for
    │
    └── tests/                             # @rai/tests — cross-module suites
        ├── support/                       # test server bootstrap, database reset per file, fixture sign-in helper (Lane C)
        ├── integration/                   # node:test against the real Postgres + in-process substitutes (owner: the ticket's lane)
        │   └── <ticket-id>-<topic>.test.ts
        └── browser/                       # Playwright journeys + axe audit (Lane B for UI tickets; Wx-INT for journeys)
            ├── playwright.config.ts
            ├── support/                   # axe helper, fixture sign-in, keyboard-only helpers
            └── <ticket-id>-<topic>.spec.ts
```

### 1.1 Module ownership

A PR touches one module from this table unless it is a declared contract PR or the package's Wx-INT ticket ([team and roles](../delivery/team-and-roles.md#working-agreement)). This table is the source of the "Path in repo" column of the [architecture boundary table](../architecture/README.md#boundaries-owners-and-tickets).

| Boundary (architecture README) | Path | Lane | Spec | Build tickets |
|---|---|---|---|---|
| Identity adapter | `rai-web/server/src/identity/` | A | W0-03 | W1-01a |
| Server authorization | `rai-web/server/src/authz/` | A | W0-05 | W1-00 (policy rows), W1-01b (middleware), W2-02a (D05 rows), W3-01 |
| Review workflow and Ready predicate | `rai-web/server/src/workflow/`, `rai-web/server/src/versions/` | A | W0-06 | W1-05, W2-01 to W2-04, W2-06 |
| Case metadata, configuration revisions and audit store | `rai-web/server/src/db/`, `rai-web/server/drizzle/`, `rai-web/server/src/cases/`, `rai-web/server/src/configuration/`, `rai-web/server/src/audit/` | A | W0-04 | W1-00, W1-02, W1-05 |
| Private artifact storage | `rai-web/server/src/artifacts/`, blob directory `rai-web/.local/blobs/` (gitignored) | A | W0-04, W0-08 | W1-03a, W1-03b |
| QC boundary (substitute in slice 1) | port `rai-web/server/src/qc/`, types `rai-web/shared/src/qc/`, substitute `rai-web/fixtures/src/substitutes/qc/` | B / C | W0-07 | W1-10, W2-05, W4 |
| UI substitute (dev/test only) | `rai-web/fixtures/src/substitutes/api/` | C | W0 interface specs, section 7 | W1-13, W2-10, W3-08 |
| Notification boundary (mail sink in slice 1) | `rai-web/server/src/notifications/`, types `rai-web/shared/src/mail/`, sink `rai-web/fixtures/src/substitutes/mail-sink/` | B / C | W0-07 | W1-11, W3-03a, W3-03b, W3-04 |
| Desk observability | `rai-web/server/src/observability/` | A | W0-10 | W3-07, W8 |
| Product UI | `rai-web/web/src/` | B | design handoff | W1-06, W1-07, W2-07, W2-09, W3-02 |
| Shared contract | `rai-web/shared/src/` | A (contract PRs only; Lane B and C read) | this document, section 7 | W1-00 creates; W2-02, W2-05, W3-01, W3-05 contract PRs extend |
| Synthetic fixtures | `rai-web/fixtures/src/data/` | C | W0-08 | W1-09 (cases, documents); W1-00 owns `users.ts` |
| Test support and suites | `rai-web/tests/` | C (support); each suite file belongs to its ticket's lane | section 8 | W1-12 and every ticket |
| Repo checks and CI | `scripts/`, `.github/workflows/ci.yml`, `docker-compose.yml` | C, HRR; agents never edit CI | section 6 | W1-00 (compose), W1-12 |
| External trackers | none; links only (L3, L6) | — | — | none |

Rules that follow from the layout:

- **`process.env` is read only in `server/src/config.ts`** and `web/vite.config.ts`. Everything else receives a typed config object. A misconfiguration is a start-up failure, never a default (W0-03, W0-10).
- **Scope is enforced only in `server/src/authz/`.** Routes declare the policy row they need; no route, service or query adds its own check ([merge order](../delivery/slice-1-work-breakdown.md#merge-order-and-shared-contract)). The SPA never decides access; it only hides what the API refuses.
- **`audit/` exports insert and read functions only.** No update or delete function exists in the data-access layer, and the migration that creates the table revokes `UPDATE` and `DELETE` on it from the application role (W0-04, A11).
- **Migrations run only through `npm run migrate`.** `main.ts` never migrates. A migration file is never edited after it merges; a correction is a new migration (W0-04 schema evolution).
- **`fixtures/` is a devDependency of `server` and `web`.** The production build (`npm run build`) must not contain `substitute-marker.ts`; `check-substitute-absent` proves it. The QC substitute (W1-10) is the slice-1 QC implementation by design and is bound in `server/src/qc/` behind `QC_MODE=substitute`, labelled as a substitute in the operator view; it is not "QC implemented" (W4).
- **`demo/` is never imported** by any `rai-web` package; ESLint `no-restricted-imports` blocks `../demo` and `../../demo`.

---

## 2. Toolchain

| Tool | Version | Reason |
|---|---|---|
| Node.js | 24.21.0 (`.nvmrc`); `engines.node` `>=24.0.0 <25` | D04. Node 24 is the LTS line with `node:test` globbing, `--import` loaders and stable `fetch`; the exact patch is the one the W0-W3 work was verified on. |
| npm | 11.x (bundled with Node 24) | Workspaces, `npm ci` lockfile enforcement, `--workspace` targeting. No pnpm/yarn: one fewer tool on the True host. |
| Docker + Compose v2 | any current | Postgres 16 locally and in CI (D04). No other container. |
| Postgres image | `postgres:16.15-alpine` | D04 Postgres 16; the current 16.x patch on Docker Hub at pin time; alpine for size. Upgrading the patch is a lead PR. |
| Playwright browsers | Chromium only, installed by `npx playwright install chromium` | One browser keeps CI under budget; the accessibility audit does not depend on the engine. Firefox/WebKit are a W7 rehearsal question. |

---

## 3. Commands

All `npm` commands run from `rai-web/`. Shell prerequisite on the development machine: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (or `nvm use`). Docker must be running for anything that touches the database.

### 3.1 Install

```sh
cd rai-web
cp .env.example .env            # first time only; edit nothing for fixture-mode development
npm ci                          # exact versions from package-lock.json; fails on drift
npx playwright install chromium # once per machine, for the browser suite
```

### 3.2 Database

```sh
# from the repository root; POSTGRES_PORT selects the host port, default 54320
POSTGRES_PORT=54320 docker compose -p rai-dev up -d --wait
POSTGRES_PORT=54320 docker compose -p rai-dev down -v      # discard data and volume
```

Per-ticket isolation: use project name `rai-<ticket-id-lowercase>` and port `54320 + <ticket number>` (W1-03 → `POSTGRES_PORT=54323 docker compose -p rai-w1-03 up -d --wait`; Wx-INT → 54399), and set `DATABASE_URL` in that worktree's `.env` to the same port. Compose binds `127.0.0.1` only.

From `rai-web/` the same two steps are `npm run db:up` and `npm run db:down`; they pass `POSTGRES_PORT` and `COMPOSE_PROJECT_NAME` through from the environment.

### 3.3 Migrate, seed, reset

```sh
npm run migrate            # applies pending forward-only SQL migrations from server/drizzle/ to DATABASE_URL; explicit, never on start
npm run migrate:generate   # drizzle-kit generate: writes a new numbered SQL file from schema changes for review (lead/HRR ticket only)
npm run fixtures:load      # loads rai-web/fixtures/src/data into an empty database (W1-09); refuses to run on a non-empty one
npm run reset              # db:down, db:up, migrate, fixtures:load, and removes rai-web/.local (blobs and mail sink)
```

### 3.4 Run

```sh
npm run dev                # API on http://127.0.0.1:8787 (tsx watch) + Vite on http://127.0.0.1:5174 proxying /api and /auth
npm run build              # shared → web (vite build to web/dist) → server (tsc to server/dist)
npm start                  # node server/dist/main.js: the one deployable, serving web/dist and the API on HOST:PORT
```

`IDENTITY_MODE=fixture` (default in `.env.example`, allowed only when `NODE_ENV` is `development` or `test`) signs in the six synthetic users and the dual-role identity without Google. `IDENTITY_MODE=local-google` needs a local OAuth client in `.env` (never committed) and binds loopback only; anything else refuses to start (W0-03). Lane B may also run the web app alone against the in-memory substitute: `VITE_API_SUBSTITUTE=true npm run dev -w web` (W1-13; never evidence).

### 3.5 Test, lint, typecheck

```sh
npm run test:unit          # node --import tsx --test across server/src, shared/src, web/src *.test.ts; no database
npm run test:integration   # node --import tsx --test tests/integration/**/*.test.ts against DATABASE_URL (real Postgres) + substitutes
npm test                   # test:unit then test:integration
npm run test:browser       # playwright test -c tests/browser/playwright.config.ts (builds, starts the API in test mode, runs journeys + axe)
npm run lint               # eslint . && prettier --check . && node scripts/check-css.mjs
npm run lint:fix           # eslint --fix . && prettier --write .
npm run typecheck          # tsc -b (project references over all five workspaces)
npm run verify             # lint, typecheck, test — the command every PR runs locally before it opens
npm run verify:full        # verify, build, check:substitute-absent, test:browser — what CI runs (section 6)
```

Repository-level checks, from the repository root (unchanged from today plus the two scripts W1-12 adds):

```sh
node --test tests/*.test.mjs        # legacy demo suite and frozen-source hash (22 tests today)
node scripts/check-links.mjs        # every relative Markdown link resolves
node scripts/check-frozen-source.mjs
git diff --check
```

### 3.6 What a ticket runs before its PR opens

1. `npm run reset` (fresh database, fixtures, empty blob store).
2. `npm run verify`.
3. `npm run build && npm run check:substitute-absent && npm run test:browser` if the ticket touches `web/` or a browser journey.
4. From the repository root: `node --test tests/*.test.mjs && node scripts/check-links.mjs && git diff --check`.
5. Paste the commands and their result counts into the PR body and the ticket's `changes/` review.

---

## 4. Pinned dependencies

Exact versions (no `^`/`~`) in every `package.json`; `package-lock.json` is committed; CI runs `npm ci`. **Agents may not add or bump a dependency** ([team and roles](../delivery/team-and-roles.md#what-ai-agents-may-and-may-not-do)); a change to this list is a lead PR that edits this section first. Versions are the latest published on 2026-09-21 unless a reason says otherwise.

### 4.1 Runtime (`dependencies`)

| Package | Version | Workspace | Reason |
|---|---|---|---|
| `fastify` | 5.12.5 | server | D04. Plain routes, built-in ajv validation, streaming multipart, pino logging, no framework auth or data layer to fight (ADR-0003 criteria 1, 2). Node ≥ 20. |
| `@fastify/static` | 10.1.4 | server | Serves `web/dist` from the API process (one deployable, one origin). |
| `@fastify/multipart` | 10.1.1 | server | Streamed uploads with size limits enforced before bytes reach the blob store (W0-08). |
| `@fastify/cookie` | 11.1.2 | server | Signed, `HttpOnly`, `SameSite=Lax` session cookie carrying an opaque session id; the session row lives in Postgres (`identity/session-store.ts`), so revocation and expiry are server-side and no session library is needed. |
| `@fastify/helmet` | 13.1.1 | server | Strict CSP for the served SPA, `X-Content-Type-Options: nosniff`, no-store on API responses (ADR-0003 consequences). |
| `@fastify/type-provider-typebox` | 6.1.0 | server | Fastify's native type provider: the section 7 TypeBox schemas validate requests with Fastify's ajv and give route handlers inferred types, so the shared schema is the single definition. |
| `typebox` | 1.3.34 | shared | Schema-to-type library the shared contract is written in; imported by server (validation), web (types, client-side form hints) and the W1-13 substitute. |
| `drizzle-orm` | 0.45.3 | server | D04. Typed SQL over `pg` with plain transactions and `FOR UPDATE`; migrations are SQL files applied by an explicit migrator call (W0-04). |
| `pg` | 8.23.0 | server | node-postgres driver Drizzle's `node-postgres` adapter uses; a dedicated client per transaction (freeze, decide, Ready). |
| `openid-client` | 6.8.8 | server | D04. Certified OIDC client; Google today, Entra later behind one adapter (W0-03). |
| `file-type` | 22.1.1 | server | Magic-byte sniffing of the allowed types (PDF, DOCX, XLSX, PNG, JPEG proposed in W0-08); the extension is never trusted. Node ≥ 22. |
| `react` | 19.3.0 | web | D04. |
| `react-dom` | 19.3.0 | web | D04. |
| `react-router-dom` | 7.18.4 | web | Deep links to cases and versions (A05 links must resolve inside the SPA and still require sign-in). |

Not added, on purpose: no i18n library (section 10 uses a typed key union, `Intl` and a 40-line `t()`), no date library (`Intl.DateTimeFormat` with `timeZone: 'Asia/Bangkok'`), no state-management library, no CSS framework (design tokens from the handoff as CSS custom properties), no separate logger (Fastify bundles pino), no session library (see `@fastify/cookie`), no mail transport (slice 1 has only the sink; a transport is a W7 decision), no ORM migration runner beyond Drizzle's own.

### 4.2 Development (`devDependencies`)

| Package | Version | Reason |
|---|---|---|
| `typescript` | 5.9.3 | Latest 5.x. TypeScript 7 (the native compiler) is published but `typescript-eslint` supports `<6.1`; the lead re-evaluates at W3 exit. |
| `tsx` | 4.23.15 | Runs TypeScript directly for `dev`, `migrate`, `fixtures:load` and `node --import tsx --test`; no build step before tests. |
| `@types/node` | 24.13.6 | Matches the Node 24 line. |
| `@types/react`, `@types/react-dom` | 19.3.0 | Match React. |
| `@types/pg` | 8.23.1 | Matches `pg`. |
| `vite` | 8.3.0 | D04. Dev server with proxy, production bundle to `web/dist`. Node ≥ 22.12. |
| `@vitejs/plugin-react` | 6.1.1 | React fast refresh for Vite 8. |
| `drizzle-kit` | 0.31.11 | Generates the numbered SQL migration from schema diffs; the generated file is reviewed and committed, never applied by the kit. |
| `@playwright/test` | 1.63.0 | D04. Browser journeys against the served SPA; `webServer` starts the API in test mode. |
| `@axe-core/playwright` | 4.13.0 | The named automated accessibility audit (section 9), run inside every browser spec. |
| `eslint` | 9.39.5 | Latest 9.x; ESLint 10 is out but `eslint-plugin-jsx-a11y` declares `^9` as its ceiling. |
| `@eslint/js` | 9.39.5 | Recommended base rules, matching ESLint. |
| `typescript-eslint` | 8.70.0 | Type-aware rules (`no-floating-promises`, `no-unsafe-*`) over all workspaces. |
| `eslint-plugin-react` | 7.37.5 | `react/jsx-no-literals` enforces the section 10 no-hard-coded-string rule in `web/`. |
| `eslint-plugin-react-hooks` | 7.1.1 | Hook rules for `web/`. |
| `eslint-plugin-jsx-a11y` | 6.10.2 | Static accessibility lint for JSX; complements the runtime axe audit. |
| `eslint-config-prettier` | 10.1.8 | Turns off formatting rules that would fight Prettier. |
| `prettier` | 3.9.8 | One formatter; `prettier --check` is part of `lint`. |
| `pino-pretty` | 13.1.3 | Readable local logs when `LOG_PRETTY=true`; never in production configuration. |

`fixtures` and `tests` workspaces depend only on the packages above through the workspace root. Playwright's browser binaries are installed per machine (`npx playwright install chromium`), not vendored.

### 4.3 Lockfile and audit rule

`npm ci` in CI fails when `package-lock.json` disagrees with any `package.json`, which is the "lockfile drift" check ADR-0003 names. `npm audit --omit=dev --audit-level=high` runs in CI and blocks on a high or critical advisory in a runtime dependency; the fix is a lead PR updating this section.

---

## 5. Local configuration and secrets

Rules: no secret in Git, ever; `.env` is gitignored; `.env.example` (created by W1-00) contains only the placeholders below; `server/src/config.ts` parses every variable at start, applies the fail-closed rules and exposes a typed object; an invalid combination exits with the error code and a locale-keyed message before any port is bound. Networked or production identity, mail and store credentials come from the custody mechanism approved under D10, never from `.env`; the adapter refuses to start in `network` or `production` mode without them (W0-03). For `local-google`, the OAuth client is held in the developer's local `.env` and never committed (W1-08).

| Variable | Placeholder in `.env.example` | Used by | Rule |
|---|---|---|---|
| `NODE_ENV` | `development` | all | `development` \| `test` \| `production`. |
| `HOST` | `127.0.0.1` | server | Bind address. Non-loopback is refused unless `IDENTITY_MODE` is `network` or `production` (W0-03, BUILD_PLAN W7). |
| `PORT` | `8787` | server | API and SPA port. Not 5173 (the demo). |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8787` | server | Origin for deep links in mail and for the OIDC redirect; must match `HOST`/`PORT` in local modes. |
| `DATABASE_URL` | `postgres://rai:rai-local@127.0.0.1:54320/rai` | server, drizzle-kit, tests | The synthetic local credentials that `docker-compose.yml` sets; the port follows `POSTGRES_PORT`. Production credentials come from custody (D10). |
| `POSTGRES_PORT` | `54320` | docker compose | Host port Postgres is published on (loopback only). Per-ticket: `54320 + <nn>`. |
| `BLOB_DIR` | `./.local/blobs` | server | Private artifact directory; created on start with mode `0700`; content-hash keyed (`<sha256[0:2]>/<sha256>`). |
| `UPLOAD_MAX_FILE_BYTES` | `<value from W0-08>` | server | Per-file limit enforced by `@fastify/multipart` before hashing (W0-08 sets the number; D08 revisits before real data). |
| `UPLOAD_MAX_PACK_BYTES` | `<value from W0-08>` | server | Per-pack total across a draft's attached artifacts (W0-08). |
| `IDENTITY_MODE` | `fixture` | server | `fixture` (only when `NODE_ENV` ≠ `production`) \| `local-google` (loopback only) \| `network` \| `production`. Unknown value: refuse to start. |
| `OIDC_ISSUER` | `https://accounts.google.com` | server | Required for `local-google`; production issuer (Entra) is set at W8 under D10. |
| `OIDC_CLIENT_ID` | `replace-me-local-only` | server | Required for `local-google`; empty → refuse to start in that mode. |
| `OIDC_CLIENT_SECRET` | `replace-me-local-only` | server | Same; never committed; `network`/`production` read it from custody, not from here. |
| `OIDC_REDIRECT_URI` | `http://127.0.0.1:8787/auth/callback` | server | Must be loopback in `local-google`. |
| `SESSION_SECRET` | `replace-me-run-openssl-rand-hex-32` | server | Cookie signing key, ≥ 32 bytes; the placeholder value is rejected outside `NODE_ENV=test`. |
| `SESSION_TTL_MINUTES` | `480` | server | Idle session lifetime. |
| `MAIL_MODE` | `sink-file` | server | `sink-file` \| `sink-memory` in slice 1. No transport value exists until W7 authorizes one (W0-07). |
| `MAIL_SINK_DIR` | `./.local/mail` | server | Where `sink-file` writes one JSON file per delivery attempt. |
| `QC_MODE` | `substitute` | server | The only slice-1 value (W1-10). W4 adds a real implementation under ADR-0006. |
| `LOG_LEVEL` | `info` | server | pino level. |
| `LOG_PRETTY` | `true` | server | `pino-pretty` transport in development only; refused when `NODE_ENV=production`. |
| `VITE_API_SUBSTITUTE` | `false` | web (build time) | `true` bundles the W1-13 in-memory substitute into a dev build; `npm run build` forces `false` and `check-substitute-absent` verifies it. |
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:8788` | tests | The browser suite starts its own API instance on this port with `NODE_ENV=test`, `IDENTITY_MODE=fixture`, its own `BLOB_DIR` and `MAIL_SINK_DIR` under `.local/test/`. |

Not configuration: the timezone (`Asia/Bangkok`, D06) and the lane mapping (D02) are constants in `shared/src/constants.ts`; SLA working-day values (DPO 3, others 5, D01) and `operator_recipients` are configuration *revisions* in the database seeded by W1-00, not environment variables (L12, D06). No TPM, VRO or AI Reporting Tool endpoint or credential exists in any configuration (L3, L6).

Docker Compose (`docker-compose.yml`, repository root, created by W1-00):

```yaml
services:
  postgres:
    image: postgres:16.15-alpine
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-54320}:5432"
    environment:
      POSTGRES_USER: rai
      POSTGRES_PASSWORD: rai-local   # synthetic, loopback-only development credential; production uses custody (D10)
      POSTGRES_DB: rai
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rai -d rai"]
      interval: 2s
      timeout: 2s
      retries: 30
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata: {}
```

---

## 6. CI checks on every PR

`.github/workflows/ci.yml` (W1-12; HRR; agents never edit CI). One workflow, one job per row, all required for merge, on every PR to `main` and on `main` after merge (team-and-roles: green on the branch and again on main). Runner: `ubuntu-latest`, Node from `.nvmrc`, Postgres 16 as a service container on the port `DATABASE_URL` names.

| # | Check | Command | Blocks merge |
|---|---|---|---|
| 1 | Install and lockfile drift | `npm ci` in `rai-web/` | Yes |
| 2 | Lint and format | `npm run lint` | Yes |
| 3 | Typecheck | `npm run typecheck` | Yes |
| 4 | Unit tests | `npm run test:unit` | Yes |
| 5 | Migrations and integration tests | `npm run migrate && npm run test:integration` against the service container | Yes |
| 6 | Build and substitute absence | `npm run build && npm run check:substitute-absent` | Yes |
| 7 | Browser journeys and accessibility audit | `npx playwright install --with-deps chromium && npm run test:browser`; report uploaded as an artifact | Yes |
| 8 | Legacy demo suite and frozen-source hash | `node --test tests/*.test.mjs && node scripts/check-frozen-source.mjs` from the repository root | Yes |
| 9 | Markdown link check | `node scripts/check-links.mjs` | Yes |
| 10 | Dependency advisories | `npm audit --omit=dev --audit-level=high` | Yes |
| 11 | Whitespace | `git diff --check origin/main...HEAD` | Yes |

Rules: no `continue-on-error`, no `test.skip` or `test.todo` merged to `main` (ESLint rule `no-restricted-syntax` over `describe.skip`, `test.skip`, `test.todo` in `tests/`); a red check is fixed in the same PR, never bypassed. A PR that changes `.github/`, `scripts/`, `docker-compose.yml` or section 4 is HRR and reviewed by the lead. CI never has Google, mail or external credentials; every check runs with `IDENTITY_MODE=fixture`, `MAIL_MODE=sink-memory`, `QC_MODE=substitute`.

Frozen-source hash: `scripts/check-frozen-source.mjs` reads the SHA-256 for `docs/product/source-spec.md` from `docs/sources.md` and compares it with the file, so the expected value is never a second literal; `tests/source.test.mjs` keeps its own literal check as today.

---

## 7. W1 interface shapes

The contract Lane A serves (W1-01 to W1-05), Lane C substitutes (W1-13) and Lane B builds against (W1-06, W1-07). Written in TypeScript type notation; `rai-web/shared/src/schemas/*` hold the equivalent TypeBox schemas from which these types are inferred, and the server validates every request body, params and query against them. W2 shapes (lane decision, send-back feedback, findings and dispositions, history) are added to 7.7 by the W2-02 and W2-05 contract PRs before those tickets start; W3 shapes (queue query, due dates, breach query, delivery status) to 7.8 by the W3-01 and W3-05 contract PRs. Any change to this section is its own PR merged before every consumer PR.

Conventions:

- JSON over HTTPS-in-production, HTTP on loopback. All paths are under `/api`; OIDC paths are under `/auth`. Field names are `camelCase` in JSON; the database columns keep the data contract's `snake_case` names.
- Every response carries `X-Correlation-Id` (W0-10). A client may send one; otherwise the server generates it. The same value is written to the audit event, the notification record and the QC run of that request.
- Every mutating request that the workflow treats as idempotent (submit in W1; decide, send back, resubmit, disposition, Ready in W2) carries an `Idempotency-Key` header (UUID generated by the client per user action). A replay with the same key and same actor returns the original success response and changes nothing (A07). A replay with a different body under the same key is `invalid_input`.
- Optimistic concurrency uses `expected*Revision` fields in the body; a mismatch is `stale_version` and changes nothing (W0-06).
- Timestamps are RFC 3339 UTC strings (`2026-09-21T03:00:00Z`); the client renders them in `Asia/Bangkok` (section 10).
- Every user-facing message from the API is a `LocaleKey` (`'error.forbidden'`), never rendered text (section 10).

### 7.1 Common types and error contract

```ts
// rai-web/shared/src/ids.ts
export type CaseId = string;        // UUID, server-generated
export type RegistryId = string;    // desk-local, 'RAI-<yyyy>-<nnnn>', server-generated, unique
export type DraftId = string;       // UUID
export type VersionId = string;     // UUID; a submitted, immutable version
export type ArtifactId = string;    // UUID; metadata row keyed to a sha256 blob
export type SubjectId = string;     // identity adapter subject (W0-03); opaque
export type ConfigurationRevisionId = string;
export type CorrelationId = string;
export type LocaleKey = string;     // a key present in shared/src/locales/th.json and en.json

// rai-web/shared/src/errors.ts
export type ErrorCode =
  | 'unauthenticated'       // 401
  | 'forbidden'             // 403
  | 'stale_version'         // 409
  | 'invalid_input'         // 422
  | 'unsafe_upload'         // 422
  | 'qc_unavailable'        // 503
  | 'mail_delivery_failed'  // 502 (on the notification record, never on the actor's business action)
  | 'not_found';            // 404, in-scope reference that does not exist (ADR-0003; W0-06 confirms)

export const HTTP_STATUS: Record<ErrorCode, 401 | 403 | 404 | 409 | 422 | 502 | 503>;

export interface FieldError {
  path: string;             // JSON pointer-ish: 'sourceRecordId.value', 'slots.3.reason'
  messageKey: LocaleKey;    // 'validation.required', 'validation.not_in_configured_list', ...
  params?: Record<string, string | number>;
}

export type ErrorDetails =
  | { code: 'invalid_input'; fields: FieldError[] }
  | { code: 'stale_version'; current: { revision: number; versionId?: VersionId; draftId?: DraftId } }
  | { code: 'unsafe_upload'; reasonKey:
        | 'upload.type_not_allowed'      // sniffed type not in the W0-08 list
        | 'upload.sniff_mismatch'        // declared type or extension disagrees with sniffed bytes
        | 'upload.too_large'             // > UPLOAD_MAX_FILE_BYTES
        | 'upload.pack_total_exceeded'   // > UPLOAD_MAX_PACK_BYTES
        | 'upload.empty' }
  | { code: 'qc_unavailable' | 'mail_delivery_failed' | 'unauthenticated' | 'forbidden' | 'not_found' };

export interface ApiError {
  code: ErrorCode;
  messageKey: LocaleKey;    // 'error.<code>' by default
  correlationId: CorrelationId;
  details?: ErrorDetails;
}
```

Scope rule for every read below: an in-scope reference that does not exist → `404 not_found`; an out-of-scope reference → `403 forbidden` in W1, with the body never revealing whether the case exists. Whether out-of-scope becomes `404` is decided in W0-05 with the threat model; until recorded, W1 implements `403` (ADR-0003 open item). Every request without a valid session → `401 unauthenticated`, checked before anything else, including on `GET /api/artifacts/{id}` (the "direct file URL" negative of A01).

### 7.2 Sign-in (W0-03; served by W1-01a, consumed by W1-07)

```ts
// rai-web/shared/src/schemas/auth.ts
export type Role = 'owner' | 'bu_spoc' | 'ai_coe' | 'dpo' | 'it_security' | 'admin';
export type Lane = 'ai_coe' | 'dpo' | 'it_security';

export type RoleScope =
  | { role: 'owner';       scope: { kind: 'own_cases' } }                        // cases whose businessOwner is this subject
  | { role: 'bu_spoc';     scope: { kind: 'business_unit'; businessUnit: string } }
  | { role: 'ai_coe';      scope: { kind: 'all_cases'; lane: 'ai_coe' } }
  | { role: 'dpo';         scope: { kind: 'all_cases'; lane: 'dpo' } }
  | { role: 'it_security'; scope: { kind: 'all_cases'; lane: 'it_security' } }
  | { role: 'admin';       scope: { kind: 'all_cases' } };                        // configuration only; never lane authority

export interface Principal {
  subjectId: SubjectId;
  displayName: string;
  email: string;
  roles: RoleScope[];       // one or more; the dual-role fixture identity has two (W0-03)
}

export type IdentityMode = 'fixture' | 'local-google' | 'network' | 'production';

export interface SessionInfo {
  principal: Principal;
  identityMode: IdentityMode;
  expiresAt: string;
  locale: 'th' | 'en';      // the viewer's stored preference; default 'th' (D12)
}
```

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `GET /api/session` | — | `200 SessionInfo` | `401` no or expired session |
| `POST /api/session/locale` | `{ locale: 'th' \| 'en' }` | `204` | `401`; `422 invalid_input` |
| `POST /auth/sign-in` | `{ returnTo?: string }` (path only, same-origin) | `200 { redirectUrl: string }` in `local-google`, `network`, `production`; the route does not exist in `fixture` mode | `422 invalid_input` when `returnTo` is not a same-origin path. There is no "identity unavailable" error: a misconfigured adapter refuses to start (W0-03), so the API is never up with a broken sign-in |
| `GET /auth/callback?code&state` | OIDC redirect | `303` to `returnTo` or `/`, sets the session cookie | `401 unauthenticated` on state mismatch or a provider error; in `production` a Google issuer is refused at start, not here |
| `POST /auth/fixture/sign-in` | `{ fixtureUserId: string }` | `200 SessionInfo`, sets cookie | `404 not_found` unknown fixture user; the route does not exist unless `IDENTITY_MODE=fixture` (W1-13 substitute mirrors it) |
| `POST /auth/sign-out` | — | `204`, session row deleted, cookie cleared | `401` |

Deep links: a request to any `/cases/...` SPA path without a session renders the sign-in screen with `returnTo` set; after sign-in the case loads only if in scope (A05 "link alone grants nothing").

### 7.3 Case create, edit, read, list (W1-02; consumed by W1-07, W1-06)

```ts
// rai-web/shared/src/schemas/cases.ts
export type SourceRecordId =
  | { kind: 'known'; value: string }     // 'TPM-…' or 'VRO-…', stored and read back unchanged; never looked up (L3, L6, L10)
  | { kind: 'unknown' };                 // the literal Unknown of the source spec

export type ModelType = 'llm' | 'classic_ml' | 'other';                   // desk-local (W0-04 fields)
export type RiskTier = 'high' | 'medium' | 'low';                          // read-only in slice 1; W5 proposes it (D07)
export type LaneProjectionStatus = 'pending' | 'approved' | 'sent_back';   // vocabulary confirmed by W0-04
export type ReadinessProjectionStatus = 'not_ready' | 'ready';
export type CaseStatus =
  | 'draft'                 // W1: created, never submitted
  | 'submitted'             // W1: current version frozen; W2-01 replaces this with 'in_review' once lanes open
  | 'in_review'             // W2
  | 'sent_back'             // W2: a successor draft exists
  | 'awaiting_disposition'  // W2
  | 'ready_for_launch';     // W2 (desk completion only; not Council or ITSM)

export interface CaseWritableFields {
  useCaseName: string;                   // 1..200 chars
  businessUnit: string;                  // 1..100 chars
  businessOwner: SubjectId;              // defaults to the actor for role owner; a BU SPOC may name an owner in its BU
  technicalOwner: string;                // free text 1..200 (a name, synthetic in fixtures)
  sourceRecordId: SourceRecordId;
  useCaseGroup: string;                  // must be in ConfigurationView.useCaseGroups (D11)
  vendorInvolved: boolean;               // desk-local; drives the slot 3/4 default (W1-04)
  modelType: ModelType;                  // desk-local
}

export interface CaseView extends CaseWritableFields {
  caseId: CaseId;
  registryId: RegistryId;
  status: CaseStatus;
  riskTier: RiskTier | null;             // null throughout slice 1
  privacyStatus: LaneProjectionStatus;   // written only by the workflow: DPO approval (W0-04 fields)
  securityStatus: LaneProjectionStatus;  // IT/Security approval
  raiStatus: LaneProjectionStatus;       // AI/COE approval
  aiReadinessStatus: ReadinessProjectionStatus; // Ready transition
  currentVersion: VersionSummary | null; // latest submitted version, null while never submitted
  draft: DraftSummary | null;            // the editable draft, null while the current version is under review
  caseRevision: number;                  // increments on every case-level write; used for expectedCaseRevision
  createdBy: SubjectId;
  createdAt: string;
  updatedAt: string;
}

export interface CaseSummary {           // list row
  caseId: CaseId; registryId: RegistryId; useCaseName: string; businessUnit: string;
  businessOwner: SubjectId; useCaseGroup: string; status: CaseStatus;
  currentVersionNumber: number | null; updatedAt: string;
}

export type CaseCreateRequest = CaseWritableFields;
export interface CaseUpdateRequest {
  expectedCaseRevision: number;
  fields: Partial<CaseWritableFields>;   // any key outside CaseWritableFields (for example privacyStatus) → 422 invalid_input
}
export interface CaseListQuery { page?: number; pageSize?: number }      // defaults 1 / 25; max pageSize 100; W3-01 adds search keys
export interface CaseListResponse { items: CaseSummary[]; page: number; pageSize: number; total: number }

export interface ConfigurationView {     // the published revision that applies now (W1-00 seed; W6 edits)
  revisionId: ConfigurationRevisionId;
  publishedAt: string;
  useCaseGroups: string[];               // D11 value list
  checklistTemplateVersions: string[];   // e.g. ['v1.0', 'v2.0']; the draft records one
  slaWorkingDays: Record<Lane, number>;  // { ai_coe: 5, dpo: 3, it_security: 5 } (D01)
  timezone: 'Asia/Bangkok';              // D06, constant
}
```

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `POST /api/cases` | `CaseCreateRequest` | `201 CaseView` with `status: 'draft'`, a `draft` (W1-04 creates the nine slots with defaults), `caseRevision: 1`; writes audit `case.created` | `401`; `403` role is not owner or bu_spoc, or bu_spoc names a BU outside its scope, or owner names a `businessOwner` other than itself; `422 invalid_input` (`useCaseGroup` not in list, empty name, `sourceRecordId.value` without `TPM-`/`VRO-` prefix) |
| `GET /api/cases/{caseId}` | — | `200 CaseView` | `401`; `403` out of scope (other BU, other owner); `404` |
| `PATCH /api/cases/{caseId}` | `CaseUpdateRequest` | `200 CaseView`, `caseRevision + 1`; writes audit `case.updated` | `401`; `403` (reviewer roles and admin never write cases; other BU); `404`; `409 stale_version`; `422 invalid_input` including any attempt to write `privacyStatus`, `securityStatus`, `raiStatus`, `aiReadinessStatus`, `riskTier`, `registryId` or `status` |
| `GET /api/cases?page&pageSize` | `CaseListQuery` | `200 CaseListResponse`, scoped: owner → own cases; bu_spoc → its BU; reviewers and admin → all. `total` counts only in-scope cases | `401`; `422 invalid_input` on a bad page |
| `GET /api/configuration/current` | — | `200 ConfigurationView` | `401` |

### 7.4 Artifact upload and download (W1-03a/b; consumed by W1-06)

```ts
// rai-web/shared/src/schemas/artifacts.ts
export type AllowedMediaType =       // W0-08 proposed list; W0-08 is authoritative and may change it
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'image/png'
  | 'image/jpeg';

export interface ArtifactRef {
  artifactId: ArtifactId;
  caseId: CaseId;
  sha256: string;                    // hex, 64 chars; the blob key
  filename: string;                  // original name, Unicode NFC, Thai preserved; path separators and control chars stripped
  mediaType: AllowedMediaType;       // the sniffed type, not the declared one
  sizeBytes: number;
  uploadedBy: SubjectId;
  uploadedAt: string;
}
```

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `POST /api/cases/{caseId}/artifacts` | `multipart/form-data`, one part named `file`; the case must have a draft | `201 ArtifactRef`; bytes hashed while streaming, sniffed, then written to `BLOB_DIR` under the hash (a second upload of identical bytes reuses the blob and creates a new metadata row); writes audit `artifact.uploaded` | `401`; `403` role not owner/bu_spoc for this case; `404` case; `422 unsafe_upload` with `reasonKey` (bytes discarded, nothing written); `422 invalid_input` when no `file` part or the case has no draft (`validation.no_open_draft`) |
| `GET /api/artifacts/{artifactId}` | — | `200` bytes, `Content-Type: <mediaType>`, `Content-Disposition: attachment; filename*=UTF-8''<RFC 8187 percent-encoded original>`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; writes audit `artifact.downloaded` | `401` (no session, including with a copied URL); `403` case out of scope; `404` |
| `GET /api/artifacts/{artifactId}/meta` | — | `200 ArtifactRef` | as above |

Safety pipeline (W1-03a, W0-08): size limit at the multipart layer → sniff the first bytes with `file-type` → compare with the allowed list and the declared extension → reject archives, executables, HTML and anything unrecognised → hash → per-pack total check → write. The reason key is the only detail returned; the rejected bytes are never stored or logged.

### 7.5 Pack draft (W1-04; consumed by W1-06)

```ts
// rai-web/shared/src/schemas/pack.ts
export type SlotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type StageContext = 'idea' | 'pre_build' | 'pre_launch';      // D11; stored, never a lifecycle state

export type NotApplicableReason =
  | { kind: 'default_non_vendor' }     // the server-set reason for slots 3 and 4 when vendorInvolved is false; rendered from a locale key
  | { kind: 'text'; text: string };    // 1..500 chars; required whenever the user chooses N/A

export type SlotState =
  | { state: 'attached'; artifactId: ArtifactId }
  | { state: 'not_yet' }
  | { state: 'missing' }
  | { state: 'not_applicable'; reason: NotApplicableReason };

export interface PackDraft {
  draftId: DraftId;
  caseId: CaseId;
  versionNumber: number;               // 1 for a new case; N+1 for a send-back successor (W2-03)
  parentVersionId: VersionId | null;
  checklistTemplateVersion: string;    // must be in ConfigurationView.checklistTemplateVersions
  stageContext: StageContext;
  slots: Record<SlotNumber, SlotState>;
  draftRevision: number;
  updatedAt: string;
}

export interface DraftSummary { draftId: DraftId; versionNumber: number; updatedAt: string }

export interface PackDraftUpdateRequest {
  expectedDraftRevision: number;
  checklistTemplateVersion?: string;
  stageContext?: StageContext;
  slots?: Partial<Record<SlotNumber, SlotState>>;   // only the slots being changed
}
```

Defaults when a draft is created (W1-02 create, W2-03 send-back): every slot `missing`; slots 3 (DPA) and 4 (SOW) `not_applicable` with `default_non_vendor` when `vendorInvolved` is `false`; `stageContext: 'idea'`; `checklistTemplateVersion` = the first configured value. If `vendorInvolved` later flips to `true` on the case, slots 3 and 4 that still carry `default_non_vendor` revert to `missing`; a user-typed reason is kept.

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `GET /api/cases/{caseId}/draft` | — | `200 PackDraft` | `401`; `403`; `404` case or no open draft |
| `PUT /api/cases/{caseId}/draft` | `PackDraftUpdateRequest` | `200 PackDraft`, `draftRevision + 1`; writes audit `draft.saved` | `401`; `403` role not owner/bu_spoc of this case; `404`; `409 stale_version`; `422 invalid_input`: `not_applicable` with an empty `text` reason (`validation.reason_required`), `attached` with an `artifactId` that belongs to another case or is unknown (`validation.artifact_not_in_case`), template version not configured, unknown slot number |

### 7.6 Submit and version navigation (W1-05; consumed by W1-06, W2-07)

```ts
// rai-web/shared/src/schemas/versions.ts
export type FrozenSlot =
  | { state: 'attached'; artifact: ArtifactRef }     // embedded, immutable copy of the reference
  | { state: 'not_yet' }
  | { state: 'missing' }
  | { state: 'not_applicable'; reason: NotApplicableReason };

export interface SubmittedVersion {
  versionId: VersionId;
  caseId: CaseId;
  versionNumber: number;
  parentVersionId: VersionId | null;
  submittedBy: SubjectId;                     // the actor; a BU SPOC submitting on the owner's behalf is recorded as itself
  submittedAt: string;
  checklistTemplateVersion: string;
  stageContext: StageContext;
  configurationRevisionId: ConfigurationRevisionId;   // QC, risk and SLA rules frozen with the version (L12)
  laneMappingVersion: string;                 // the D02 constant's version, e.g. 'lane-mapping-v1'
  slots: Record<SlotNumber, FrozenSlot>;
  isLatest: boolean;
  // W2 contract PRs add: lanes: LaneState[]; decisions: LaneDecision[]; findings: Finding[]; dispositions: Disposition[]
}

export interface VersionSummary {
  versionId: VersionId; versionNumber: number; submittedBy: SubjectId; submittedAt: string; isLatest: boolean;
}

export interface SubmitRequest { expectedDraftRevision: number }
export interface VersionListResponse { items: VersionSummary[] }    // ascending by versionNumber
```

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `POST /api/cases/{caseId}/draft/submit` | header `Idempotency-Key`; `SubmitRequest` | `201 SubmittedVersion`. In one transaction: freeze the draft into a version row plus frozen slot rows, copy the artifact references, record `configurationRevisionId` and `laneMappingVersion`, set the case's `currentVersion`, close the draft, store the idempotency key, write audit `version.submitted` with actor, version and correlation id. W2-01 extends the same transaction to open the three lanes. Replay with the same key → the same `201` body | `401`; `403`; `404`; `409 stale_version`; `422 invalid_input` when a slot is invalid at submit time (`validation.reason_required`) or the header is missing; missing documents are *not* an error (soft QC, L7): they become findings in W2 |
| `GET /api/cases/{caseId}/versions` | — | `200 VersionListResponse` | `401`; `403`; `404` |
| `GET /api/cases/{caseId}/versions/{versionId}` | — | `200 SubmittedVersion`, byte-identical on every read for the life of the row | `401`; `403`; `404` (also when the version belongs to another case) |
| `GET /api/cases/{caseId}/versions/latest` | — | `200 SubmittedVersion` | `401`; `403`; `404` when never submitted |

Immutability at the store (W0-04, A07): the version and frozen-slot tables have no `UPDATE` path in the data-access layer, and the migration that creates them adds a trigger that raises on `UPDATE`/`DELETE`; the W1-05 "second write to that version's artifact ref is rejected" test exercises the trigger directly. Restart proof: the W1-INT journey stops and restarts the API process against the same database and re-reads the version.

### 7.7 W2 shapes

Added here by the W2-02 contract PR (lane state, lane decision, send-back feedback naming an artifact, expected version, idempotency), the W2-05 contract PR (typed finding from `shared/src/qc/types.ts`, disposition with D05 authority) and the W2-03 successor-draft rule. Until then this subsection is intentionally empty; W2-10 extends the substitute from it.

### 7.8 W3 shapes

Added here by the W3-01 contract PR (scoped queue query: search by `sourceRecordId`, status, owner, `useCaseGroup` or all; counts; pagination; filter options) and the W3-05 contract PR (per-lane due date, breach query). Delivery-status shape for W3-07 comes with W3-03. Until then this subsection is intentionally empty; W3-08 extends the substitute from it.

### 7.9 Not in the W1 contract

No audit-read endpoint (W2-08 reconstructs the journey from the table through `tests/support`; an Admin/operator read arrives with W3-07's operator view under W0-10), no configuration write (W6), no lane, finding, disposition or Ready endpoint (W2), no search (W3), no risk (W5), no external-register call of any kind (L3, L6).

---

## 8. Test-layer map

### 8.1 Layers

| Layer | Runner | Lives in | Hits | Speed | Owner |
|---|---|---|---|---|---|
| **Unit** | `node:test` via `npm run test:unit` | `*.test.ts` next to the module in `server/`, `shared/`, `web/` | Nothing external: pure functions, policy rows, adapter mode logic, schema validation, formatting. Web unit tests cover view models and `i18n` only; no DOM runner. | ms | The module's lane |
| **Integration** | `node:test` via `npm run test:integration` | `rai-web/tests/integration/<ticket>-<topic>.test.ts` | The real Postgres (migrated, reset per file through `tests/support/db.ts`), the real blob directory under `.local/test/`, and the in-process substitutes: fixture identity (W0-03), QC substitute (W1-10), mail sink (W1-11). Calls the API through `app.inject()` (no port) or, for restart tests, a spawned process. | s | The ticket's lane; Wx-INT for journeys |
| **Browser journey** | Playwright via `npm run test:browser` | `rai-web/tests/browser/<ticket>-<topic>.spec.ts` | The built SPA served by a real API process in test mode against the real Postgres; fixture identity; every spec ends with the axe audit (section 9). Interacts only through the UI (roles, labels, keyboard); never through application state. | 10s+ | Lane B for UI tickets; Wx-INT for the package journey |
| **Manual, outside CI** | a person | `changes/<date>-<slug>/review.md` | `local-google` sign-in on a loopback bind (W1-08); keyboard-only pass and recorded walkthrough (W3-06) | — | Lead |

Substitute runs (W1-13 in the browser, `VITE_API_SUBSTITUTE=true`) are development aids and never evidence; a Lane B ticket's Proves IDs are realised only when Wx-INT runs the same spec against the real server.

### 8.2 Acceptance ID by layer

Each row names the layer that *proves* the ID for the package exit; other layers may add coverage. "Direct API" means the test calls the endpoint without the UI, so the SPA cannot mask a server gap.

| ID | Unit | Integration (real store + substitutes) | Browser journey | Manual | Tickets |
|---|---|---|---|---|---|
| A01 local-role access | Policy module rejects unknown roles and grants nothing without a row (W1-00); adapter refuses non-loopback bind and unknown mode (W1-01a) | **Proves:** direct API: no session → 401; wrong role → 403; other BU on read/list/write → 403; direct artifact URL without session → 401; each fixture user including the dual-role identity receives its (role, scope) pairs (W1-01, W1-02, W1-03, W1-INT) | Each fixture user's list shows only in-scope cases; out-of-scope case absent (W1-07, W1-INT) | Google `local-google` sign-in on loopback: pass, no account recorded (W1-08) | W1-01, W1-02, W1-03, W1-07, W1-INT, W1-08 |
| A02 nine slots, Unknown, non-vendor default | Slot validation rules (W1-04); `SourceRecordId` parsing (W1-02) | **Proves:** `Unknown` saves; known id read back unchanged; register never called (no client exists to call); all four slot states; N/A without reason → 422; slots 3/4 default only when `vendorInvolved` false; submit succeeds with missing slots (W1-02, W1-04, W1-05) | Every slot state and reason reachable by keyboard; N/A reason cannot be skipped (W1-06, W1-INT) | — | W1-02, W1-04, W1-06, W1-07, W1-INT, W1-08 |
| A04 three lanes atomically | D02 mapping constant (W2-01) | **Proves:** submit opens exactly three lanes in one transaction; injected failure rolls back all; High never skips (W2-01) | Three lane cards after submit (W2-INT) | — | W2-01, W2-INT, W2-08 |
| A05 notifications, links, failure | Template rendering with locale keys, Thai subject (W3-03a); backoff schedule (W3-04) | **Proves:** no mail for a rolled-back transition; one mail per event with the source-spec contents; dedup key sends nothing twice; forced sink failure recorded and retried three times; committed decision unchanged after permanent failure; breach digest lists only past-due cases (W3-03, W3-04, W3-05) | Deep link from the sink without a session → sign-in; with the wrong user → forbidden (W3-INT) | — | W3-03, W3-04, W3-05, W3-INT, W3-06 |
| A06 scoped queue | Query builder never emits an unscoped predicate (W3-01) | **Proves:** each search key returns only in-scope cases; counts and filter options for an out-of-scope user equal those of a user with no cases; pagination never leaks; Thai term matches (W3-01) | Cards show version, lane states, due dates, next action; out-of-scope absent (W3-02, W3-INT) | — | W3-01, W3-02, W3-INT, W3-06 |
| A07 immutable versions, one successor, idempotent replay | Idempotency-key comparison (W1-05) | **Proves:** second write to a frozen artifact ref rejected by the trigger; case and version identical after process restart; same `Idempotency-Key` returns the original body; two concurrent send-backs yield one N+1 draft; stale action → 409 and nothing changes; N stays readable; resubmit reopens all lanes (W1-03, W1-05, W2-03, W2-04) | History shows each frozen version unchanged (W2-07, W2-INT) | — | W1-03, W1-05, W1-INT, W1-08, W2-03, W2-04, W2-07, W2-INT, W2-08, W3-06 |
| A09 send-back feedback, dispositions, Ready | D05 authority rows as data (W2-02a); Ready predicate function (W2-06) | **Proves:** send-back without a named artifact → 422; reviewer acts only on own lane; Admin decision → 403; owner/SPOC self-approval → 403; waived/N/A without reason → 422; non-owning-lane waiver → 403 on single-lane, slot-5 and pack-level findings; owner's "fixed" stays proposed until confirmed; disposition appends, never modifies; `unavailable` QC recorded, not zero findings; Ready only with three current approvals and zero undispositioned findings, rechecked inside the transaction (W2-02, W2-05, W2-06) | Findings render before decision controls; feedback form cannot submit without an artifact; each disposition kind reachable; a finding never disappears (W2-07, W2-09, W2-INT) | — | W2-02, W2-05, W2-06, W2-07, W2-09, W2-INT, W2-08, W3-06 |
| A11 attributable, reconstructable | Audit module exports no update/delete (compile-time and a test that enumerates exports) (W1-00) | **Proves:** every transition writes one audit event with actor, version, correlation id; the W2 journey is rebuilt from audit rows alone and compared with the read model; `UPDATE`/`DELETE` on an audit row through the application role fails (W1-05, W2-02 to W2-06, W2-08) | — | — | W1-05, W2-02 to W2-06, W2-08 |
| A03, A08, A10 | not in slice 1 (W5, W4, W6) | | | | |

Negative tests for A01 are always direct-API integration tests, never only UI assertions (ADR-0003 risk table).

### 8.3 Fixture identity convention

- The fixture set lives in `rai-web/fixtures/src/data/` and is loaded only by `npm run fixtures:load` (empty database) and `tests/support/db.ts` (per file). Contents are synthetic: no text copied from any real case or Life-OS evidence, no real names, addresses or identifiers (W0-08; a reviewer confirms this in W1-09).
- `manifest.json` names the set: `{ "name": "slice1-synthetic", "version": "1", "sha256": "<hash of the sorted data files>" }`. `fixtures:load` writes the name, version and hash into a `fixture_set` row; every evidence record (`changes/<date>-<slug>/review.md`) cites `fixture set <name>@<version> <sha256[0:12]>` next to the command output. Changing any fixture bumps `version` and the hash in the same PR.
- Identifiers are stable and self-describing: users `fx-user-<role>[-<qualifier>]` (`fx-user-owner-cm`, `fx-user-spoc-cm`, `fx-user-ai-coe`, `fx-user-dpo`, `fx-user-it-security`, `fx-user-admin`, and the dual-role `fx-user-dpo-spoc-hr`, a DPO reviewer who is also BU SPOC of fixture BU `HR`); cases `fx-case-<kind>` (`fx-case-nonvendor`, `fx-case-vendor`, `fx-case-missing-slot`, `fx-case-na-reasons`, `fx-case-hr-dualrole`); documents `fx-doc-<slot>-<kind>.<ext>`, including one Thai-named file (`fx-doc-05-แผนธุรกิจ.pdf`). Email addresses use the reserved domain `rai-desk.example`; the single operator recipient is `operator@rai-desk.example` (D06 `operator_recipients` seed, W1-00).
- Registry ids in fixtures use the reserved year `RAI-2000-<nnnn>` so they can never collide with a server-generated id.
- A test names the fixture ids it uses in its `describe` title, so a failure names the data.

---

## 9. UI quality bar

Proposed for Ta to confirm at the W0 exit review (W0-09). Applies to every Lane B ticket's `Done when` (W1-06, W1-07, W2-07, W2-09, W3-02) and to the Wx-INT journeys.

1. **Conformance target: WCAG 2.2 Level AA.** Contrast of the implemented design tokens (handoff: red `#E00000`, ink `#303C46`, muted `#5B6878`, link `#00639F`) is verified in the UI ticket, not assumed from the handoff.
2. **Status is never colour-only.** Every status badge, lane state, slot state, due-date state and finding severity renders text plus an icon or pattern; the `components/status-badge` component makes it impossible to render one without a label. Automated check: the axe rule set plus a spec assertion that every `[data-status]` element has visible text.
3. **Dialog focus containment.** Every dialog (send-back feedback, disposition, N/A reason, sign-out) uses the native `<dialog>` element with `showModal()`; focus moves into it on open, is trapped inside, returns to the invoking control on close; `Escape` closes it unless the dialog holds unsaved input, in which case it asks. Spec: `tests/browser/support/dialog.ts` asserts all four behaviours.
4. **Visible focus.** A focus ring of at least 2 px with ≥ 3:1 contrast against adjacent colours on every focusable element (WCAG 2.2 SC 2.4.11 and 2.4.13). No stylesheet removes the outline: `outline: none` and `outline: 0` outside a `:focus-visible` rule that sets a replacement are forbidden, checked by a grep in `npm run lint` (`scripts/check-css.mjs`, W1-12). Each UI spec tabs through its screen and asserts the focused element has a non-zero computed `outline-width` or `box-shadow`.
5. **Keyboard-only operation** of every action in every screen: Tab order follows the visual order; no action is reachable only by pointer. Each UI ticket's spec drives its journey once with the keyboard only (`tests/browser/support/keyboard.ts`).
6. **Named automated accessibility audit: axe-core through `@axe-core/playwright`**, run at the end of every browser spec on every screen state the spec reaches, with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. `Done when` for each UI ticket is **zero critical and zero serious violations**; moderate and minor are listed in the PR and fixed or recorded as an open item with an owner. The audit result is attached to the CI run.
7. **Reflow.** The three handoff widths (1440, 834, 390 CSS px) are Playwright projects; no horizontal scroll at 390 except inside tables that declare it.
8. **Language and locale.** As in section 10; the audit runs with `lang="th"` on `<html>` by default and once with `lang="en"`.
9. **Static lint.** `eslint-plugin-jsx-a11y` recommended rules are errors, not warnings.

---

## 10. Language rule

D12: bilingual, Thai default. From the first screen (W1-07 sign-in), not retrofitted.

1. **Every user-facing string carries a locale key.** UI copy, validation messages, API error messages, email subjects and bodies, finding messages from QC, notification texts, `aria-label`s, document titles. The catalogues are `rai-web/shared/src/locales/th.json` and `en.json` with identical key sets; `keys.ts` derives the `LocaleKey` union from `th.json`, so a key missing from either file is a type error and a CI failure (`shared/src/locales/locales.test.ts` checks both files have the same keys and no empty values).
2. **No hard-coded user-facing string** in `web/src`, `server/src/notifications`, `server/src/qc` or the substitutes. Lint: `web/` uses a `t(key, params)` helper; a JSX text node or string attribute in `title`, `aria-label`, `placeholder`, `alt` that is not a `t()` call is an ESLint error (`react/jsx-no-literals` with the allow-list of punctuation and numerals). The UI tickets' `Done when` "no hard-coded user-facing string" is this rule passing.
3. **The API returns keys, not text.** `ApiError.messageKey` and `FieldError.messageKey` are keys; the client renders them in the viewer's locale. Server-rendered text exists only in email, which renders both languages in one message (Thai first, then English) because recipient preference is not stored in slice 1; the subject is Thai with the case's `registryId`.
4. **Locale selection.** `SessionInfo.locale` defaults to `th`; the user switches from the shell; the choice is stored on the session (`POST /api/session/locale`) and mirrored in `localStorage` as a convenience for the sign-in screen. `<html lang>` follows it.
5. **Dates and times render in `Asia/Bangkok`** (D06) through `Intl.DateTimeFormat(locale, { timeZone: APP_TIMEZONE, ... })`, with the Gregorian calendar and `th-TH-u-ca-gregory` for Thai so the year is not Buddhist-era by accident; working-day arithmetic (W3-05) is done on the server in the same zone with the configured holiday list. The API never returns a formatted date.
6. **Thai text is handled correctly** where the contract names it: filenames round-trip through upload and download unchanged, NFC-normalised, with `filename*=UTF-8''` encoding and no transliteration (W1-03); search (W3-01) compares NFC-normalised strings with a Postgres `ILIKE` over a `text` column in a UTF-8 database with the `th_TH.UTF-8` or `C.UTF-8` collation (the migration sets the database encoding; W3-01 chooses the collation with a Thai fixture case that must match); email subjects (W3-03) are RFC 2047 encoded-words in UTF-8, and the sink stores the decoded subject so the test can assert the Thai text intact.
7. **Fonts and rendering.** The SPA declares a Thai-capable system font stack (`"Noto Sans Thai", "Sarabun", system-ui, sans-serif`) without bundling a font; line height ≥ 1.6 for Thai combining marks; the 390 px project in the browser suite renders a Thai fixture name.
8. **Finding messages** (W1-10 substitute, W4 real) are emitted as `{ messageKey, params }` and rendered by the client; a finding never carries free text from a document as its message (threat model: document content is data).

---

## 11. PR size, branch rules and slice-1 sub-tickets

From [team and roles](../delivery/team-and-roles.md#working-agreement), restated so an engineer needs no second document:

- One ticket per branch and PR: `codex/<ticket-id>-<topic>` for ticket work (`codex/w1-03a-upload-safety`), `codex/<short-topic>` for documentation. Sub-ticket ids are lower-cased in the branch name.
- One PR touches one module from [section 1.1](#11-module-ownership), except a contract PR (which touches `shared/` and this document's section 7) and the package's Wx-INT ticket.
- A PR is reviewable by one human in one sitting: as a working rule, under about 600 changed lines excluding lockfile, generated migrations, fixtures and snapshots. Over that, split before opening.
- A contract change (section 7, `shared/`, the policy module's rows, a migration) is its own PR and merges before every consumer.
- The PR body states the ticket id, the R/A ids it proves, the exact commands run and their output, the fixture set identity, documents updated and any limitation. Merge follows the D03 amendment flow (tests green → independent reviewer agents → fixes until clean → merge); the full suite runs again on `main`.
- Agents implement one ticket from a task brief inside the listed paths; they never add dependencies, edit CI, open issues, record decisions or merge.

### 11.1 Sub-ticket list for slice 1 (proposal for the lead to confirm at W0 exit)

Applying the rule to the four candidates the working agreement names, each sub-ticket inherits its parent's Proves, Decisions, Lane and Owner type. The lead opens the issues at W0 exit and mirrors the split in the work breakdown; this document is the record of the split.

| Sub-ticket | Outcome | Module | Depends on | Done when (inherits the parent's clauses named) |
|---|---|---|---|---|
| **W1-01a** | Identity adapter: interface, `local-google` mode with `openid-client` on loopback only, `fixture` mode gated to non-production, `network`/`production` fail closed without custody credentials, Postgres session store and cookie | `server/src/identity/` | W1-00, W0-03 | `local-google` refuses a non-loopback bind and an unknown mode; each fixture user including the dual-role identity signs in and receives its (role, scope) pairs; a session expires and is revocable |
| **W1-01b** | Authorization middleware: the only place scope is enforced; route declaration of the policy row; request principal context | `server/src/authz/` | W1-01a, W0-05 | A request without a session is unauthenticated; a wrong-role request is forbidden; a route without a declared policy row fails at start-up |
| **W1-03a** | Upload safety pipeline and blob store: size limits, sniffing, allowed-type list, hashing, per-pack total, `BlobStore` interface with the filesystem implementation; no HTTP route | `server/src/artifacts/` (no routes) | W1-00, W0-08 | A permitted file's hash is recorded; an executable disguised by extension is rejected with `unsafe_upload`; oversize rejected; identical bytes share one blob; the blob directory is created `0700` |
| **W1-03b** | Upload and download routes under authorization, Thai filenames, download headers, audit events | `server/src/artifacts/` (routes) | W1-03a, W1-01b, W1-09 | A direct file URL without a session is refused; downloaded bytes match the stored hash; a Thai filename round-trips unchanged; another BU's user gets `forbidden` |
| **W2-02a** | Contract PR: D05 rows (owning-lane disposition authority, owner proposes "fixed", no self-approval) added to the policy module as data; W2 shapes added to section 7.7 | `server/src/authz/`, `shared/` | W2-01, W0-05 | Policy tests for each D05 row including the dual-role identity; section 7.7 populated; nothing else changes |
| **W2-02b** | Lane decision: approve or send back on own lane with expected version and idempotency key; send-back requires feedback naming an artifact; Admin has no lane authority; audit event | `server/src/workflow/` | W2-02a | The parent's remaining clauses |
| **W3-03a** | Notification composer and templates: lane open, send-back, Ready, from committed events only, through the W1-11 sink, locale-keyed bilingual templates, Thai-safe subject, deep link | `server/src/notifications/` | W2-08, W1-11, W3-05 contract | No mail for a rolled-back transition; each of the three events produces one mail with the specified contents; deep link without session is unauthenticated; Thai subject intact |
| **W3-03b** | SLA-breach daily digest to `operator_recipients` using the W3-05 breach query | `server/src/notifications/` | W3-03a, W3-05 | A breach mail lists only cases past SLA; one digest per day; recipients come from configuration, never a role |

Not split, with the reason: **W1-00** is declared "in one PR" by the work breakdown because every later ticket extends it; it is the one deliberately large substrate PR and the lead reviews it as HRR. **W1-06** ("as one flow") stays whole; if its PR exceeds the size rule, the lead splits it at W1 into W1-06a (pack editor) and W1-06b (case overview and version navigation) under the same rule as above. **W1-INT, W2-INT, W3-INT** are the declared multi-module exceptions.

---

## 12. Ticket cross-reference

| Consumer ticket | Uses from this document |
|---|---|
| W1-00 | Sections 1, 2, 3, 4, 5 (creates the skeleton, `.env.example`, `docker-compose.yml`, `shared/` with the 7.1-7.6 TypeBox schemas transcribed from this document and the empty 7.7 and 7.8 files, the audit and configuration modules; it is the only ticket that creates shared modules) |
| W1-01a/b | 7.2, 5 (`IDENTITY_MODE`, `HOST` rule), 8.2 A01 |
| W1-02 | 7.3, 8.2 A02 |
| W1-03a/b | 7.4, 5 (`BLOB_DIR`, upload limits from W0-08), 10.6 filenames |
| W1-04 | 7.5 |
| W1-05 | 7.6, 8.2 A07 |
| W1-06, W1-07, W2-07, W2-09, W3-02 | 7 (against W1-13), 9, 10 |
| W1-09 | 8.3 |
| W1-10, W1-11 | 1.1 paths, `shared/src/qc`, `shared/src/mail` (types from W0-07) |
| W1-12 | 3, 6, `scripts/`, `tests/support`, `tests/browser/support` |
| W1-13, W2-10, W3-08 | 7 (every shape and its error cases), `fixtures/src/substitutes/api/` |
| W2-02a, W2-05, W3-01, W3-05 | 7.7 / 7.8 (they write it) |
| W1-INT, W2-INT, W3-INT | 8.1 browser layer, 8.2 rows, 3.6 |
| W1-08, W2-08, W3-06 | 8.3 fixture identity in the evidence record; 3.5 commands |
| W0-09 | Verifies section 3 is mirrored in [TESTING](../../TESTING.md) "Product build (W0-W3)"; confirms the section 9 proposal and 11.1 split with Ta |

## 13. Open items carried, not resolved here

- Upload type list, per-file and per-pack limits: **W0-08** (placeholders in section 5 and 7.4).
- Out-of-scope reference answers 403 (W1) or 404: **W0-05** with the threat model.
- `not_found` as the eighth error code: **W0-06** confirms (ADR-0003).
- Owning lane for slot 5, slot 9, pack-level and QC-unavailable findings: **W0-06** refinement by the review leads before W2-05; the A09 row in 8.2 tests whatever it records.
- Projection-status vocabulary (`LaneProjectionStatus`, `ReadinessProjectionStatus` in 7.3): **W0-04** confirms the words; the rule (workflow-only writer) is recorded (W0-04 fields).
- Performance budgets and the W0 exit review: **W0-09**.
- D07-D10 stay open at their gates; nothing in this plan pre-empts them (no rubric, no retention rule, no model, no host).
