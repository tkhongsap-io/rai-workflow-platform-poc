# File-level implementation plan: W1-W3

Status: **W0-02 plan, reconciled at the W0 exit review** (ticket [W0-02](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan), issue #7; cross-spec fixes applied by [W0-09](../../changes/2026-09-21-w0-exit/review.md) on 2026-09-21, each marked "W0-09:" where it lands). Makes [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04) concrete: paths, commands, pinned dependencies, local configuration, CI checks, the W1 request/response shapes, the test-layer map, the UI quality bar and the language rule. Nothing here is installed or built; [W1-00](../delivery/slice-1-work-breakdown.md#w1--scoped-case-and-versioned-pack) creates the skeleton exactly as written here and [W1-12](../delivery/slice-1-work-breakdown.md#w1--scoped-case-and-versioned-pack) wires the CI checks.

What this document is not: it records no D01-D12 decision, resolves nothing in D07-D10, and does not edit the frozen [source spec](../product/source-spec.md). Where it names a value that another W0 spec owns (upload limits from W0-08, the 403-versus-404 answer from W0-05, the slot-5 and pack-level owning-lane rule from W0-06), it references that spec and carries a marked placeholder. Two items are proposals for Ta to confirm at the W0 exit review (W0-09): the [UI quality bar](#9-ui-quality-bar) and the [sub-ticket split](#11-pr-size-branch-rules-and-slice-1-sub-tickets); both are marked.

Read with: [W0 technical contract](../delivery/w0-technical-contract.md), [slice-1 work breakdown](../delivery/slice-1-work-breakdown.md), [team and roles](../delivery/team-and-roles.md), [architecture](../architecture/README.md), [decision register](../product/decisions.md), [workflow](../product/workflow.md), [data contract](../product/data-contract.md), [acceptance](../acceptance.md), [threat model](../security/threat-model.md), [design handoff](../design/DEVELOPER_HANDOFF.md), [TESTING](../../TESTING.md).

Sibling W0 specs this plan consumes, all merged: [W0-03 identity adapter](identity-adapter.md), [W0-04 persistence and artifact store](persistence-and-artifact-store.md), [W0-05 authorization matrix](authorization-policy-matrix.md), [W0-06 workflow transition and error contract](workflow-transition-and-error-contract.md), [W0-07 QC boundary and mail sink](qc-boundary-and-mail-sink.md), [W0-08 upload safety and fixtures](upload-safety-and-fixtures.md), [W0-10 observability](observability-contract.md), [performance targets](performance-targets.md) (W0-09). Ownership at the seams, as reconciled at W0 exit: this plan owns routes, request/response shapes, commands, layout paths and the non-identity environment variables; W0-03 owns identity behaviour and the `RAI_IDENTITY_*`, `RAI_SECRET_*` and `RAI_SESSION_*` variable names; W0-04 owns storage, indexes and database roles; W0-06 owns the error contract and the order of checks; W0-08 owns upload safety and the fixture content; W0-10 owns the log field allow-list.

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
├── docker/postgres/init/                  # init SQL creating the W0-04 roles rai_owner, rai_app, rai_operator (W1-00)
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
    │       ├── errors.ts                  # the eight error codes, HTTP_STATUS_BY_CODE, ErrorResponse envelope (section 7.1; W0-06 8.2)
    │       ├── ids.ts                     # branded id types, RegistryId format
    │       ├── constants.ts               # APP_TIMEZONE = 'Asia/Bangkok' (D06), LANE_MAPPING_V1 / CURRENT_LANE_MAPPING (D02, W0-06 section 3), SLOTS
    │       ├── schemas/                   # TypeBox schemas per section 7; types are inferred from them
    │       │   ├── auth.ts                #   sign-in (7.2)
    │       │   ├── cases.ts               #   case create/edit/read/list, configuration read (7.3)
    │       │   ├── artifacts.ts           #   upload/download (7.4)
    │       │   ├── pack.ts                #   pack draft (7.5)
    │       │   ├── versions.ts            #   submit and version navigation (7.6); ExpectedVersion (W0-06 5.1)
    │       │   ├── review.ts              #   W2 shapes (7.7)
    │       │   ├── sla.ts                 #   W3-05 due date and breach query (7.8); on main
    │       │   └── queue.ts               #   W3-01 scoped queue (not written yet)
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
    │       ├── sla/                       # W3-05 due dates and breach query (on main)
    │       ├── queue/                     # W3-01 scoped query (not written yet)
    │       ├── notifications/             # W3-03/W3-04 composer, templates by locale key, retry, dedup
    │       ├── qc/                        # QC port; slice 1 binds the W1-10 substitute, marked as such
    │       ├── configuration/             # configuration revisions, seed, activation rule (W1-00)
    │       ├── audit/                     # append-only audit store; no update/delete function exists (W1-00)
    │       ├── observability/             # correlation id, redacted pino logger, /healthz, /readyz, operator view (W3-07)
    │       ├── static.ts                  # serves ../web/dist with CSP and history fallback for non-/api paths
    │       ├── shutdown.ts                # W0-04 graceful shutdown: bounded drain, then every remaining socket destroyed
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
    │       ├── data/                      # W1-09: users.ts (W1-00 owns the eight W0-03 fixture identities), cases/, documents/
    │       │   └── manifest.json          #   fixture set name, version, sha256 of the data directory (section 8.3)
    │       ├── generate.ts                # npm run fixtures:generate — writes the W0-08 documents to a gitignored output dir (W1-09)
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

- **`process.env` is read only in `server/src/config.ts`** and `web/vite.config.ts` (the identity adapter's `parseIdentityConfig(env, bind)` receives the environment object from `config.ts`, W0-03 section 5). Everything else receives a typed config object. A misconfiguration is a start-up failure, never a default (W0-03, W0-10).
- **Scope is enforced only in `server/src/authz/`.** Routes declare the policy row they need; no route, service or query adds its own check ([merge order](../delivery/slice-1-work-breakdown.md#merge-order-and-shared-contract)). The SPA never decides access; it only hides what the API refuses.
- **`audit/` exports insert and read functions only.** No update or delete function exists in the data-access layer, and the migration that creates the table revokes `UPDATE` and `DELETE` on it from the application role (W0-04, A11).
- **Migrations run only through `npm run migrate`.** `main.ts` never migrates. A migration file is never edited after it merges; a correction is a new migration (W0-04 schema evolution).
- **`fixtures/` is a devDependency of `server` and `web`.** The production build (`npm run build`) must not contain `substitute-marker.ts`; `check-substitute-absent` proves it. The QC substitute (W1-10) is the slice-1 QC implementation by design and is bound in `server/src/qc/` behind `QC_MODE=substitute`, labelled as a substitute in the operator view; it is not "QC implemented" (W4). W0-09: the colocated unit tests of the QC and mail-sink substitutes (`fixtures/src/substitutes/**/*.test.ts`, W0-07 sections 3.9 and 4.8) are part of `npm run test:unit` (section 3.5).
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
cp .env.example .env                                                              # first time only
npm ci                                                                            # exact versions from package-lock.json; fails on drift
npx playwright install chromium                                                   # once per machine, for the browser suite
```

Then, for `npm run dev` (section 3.4), set `RAI_IDENTITY_GOOGLE_CLIENT_ID` and `RAI_IDENTITY_GOOGLE_CLIENT_SECRET` in `.env` from a Google OAuth client you create for yourself (type "Web application", authorised redirect URI exactly `http://127.0.0.1:8787/auth/callback`, which the adapter derives from `PUBLIC_BASE_URL`; W0-03 section 4.1); this is the L11 development login and the client stays in your local `.env`. The test commands in section 3.5 need this step only if they are run outside `NODE_ENV=test`, which they never are: they set `NODE_ENV=test` and `RAI_IDENTITY_MODE=fixture` themselves. W0-09: there is no `SESSION_SECRET` to generate; the session cookie is a random value looked up by hash in the Postgres `sessions` table, so no signing key exists (W0-03 section 6.3, confirmed at W0 exit).

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
npm run migrate            # applies pending forward-only SQL migrations from server/drizzle/ to DATABASE_MIGRATE_URL as rai_owner (W0-04); explicit, never on start
npm run migrate:generate   # drizzle-kit generate: writes a new numbered SQL file from schema changes for review (lead/HRR ticket only)
npm run fixtures:generate  # writes the W0-08 synthetic documents from fixtures/src/data/manifest.json into the gitignored output directory; prints the fixture set name, version and manifest hash (W1-09)
npm run fixtures:load      # runs fixtures:generate if the output is absent, then loads rai-web/fixtures/src/data into an empty database (W1-09); refuses to run on a non-empty one and outside NODE_ENV development/test
npm run reset              # db:down, db:up, migrate, fixtures:load, and removes rai-web/.local (blobs and mail sink); development and test only
npm run db:cleanup         # operator command (rai_operator, W0-04): expires idempotency keys; --report lists stale drafts and orphan blobs (dry run only until D08)
npm run store:verify       # operator command: re-hashes every blob an artifact row references; non-zero exit on any mismatch (W0-04; W1-12 migration tests, W7-00)
npm run store:cleanup      # operator command: removes stale temp files under BLOB_DIR/tmp; orphan-blob removal only after D08
```

W0-09: the three operator commands are carried from W0-04 "Configuration and commands handed to W0-02" under this plan's naming (`migrate` and `reset` replace W0-04's proposed `db:migrate` and `db:reset`; `fixtures:generate` is W0-08's name, kept).

### 3.4 Run

```sh
npm run dev                # API on http://127.0.0.1:8787 (tsx watch) + Vite on http://127.0.0.1:5174 proxying /api and /auth
npm run build              # shared → web (vite build to web/dist) → server (tsc to server/dist)
npm start                  # node server/dist/main.js: the one deployable, serving web/dist and the API on HOST:PORT
```

`RAI_IDENTITY_MODE=local-google` (default in `.env.example`; the L11 development login) needs a local OAuth client in `.env` (never committed; section 3.1) and binds loopback only. `RAI_IDENTITY_MODE=fixture` signs in the fixture identities of W0-03 section 7 without Google and is accepted only when `NODE_ENV=test` and the bind is loopback (W0-03 rows S13, S14); the test commands in section 3.5 set that themselves, and `npm run dev` never does. Anything else refuses to start with exit code 78 (W0-03 section 5). Lane B may also run the web app alone against the in-memory substitute: `VITE_API_SUBSTITUTE=true npm run dev -w web` (W1-13; never evidence).

### 3.5 Test, lint, typecheck

```sh
npm run test:unit          # node --import tsx --test across server/src, shared/src, web/src, fixtures/src *.test.ts; no database
npm run test:integration   # node --import tsx --test tests/integration/**/*.test.ts against DATABASE_URL (real Postgres) + substitutes
npm test                   # test:unit then test:integration
npm run test:browser       # playwright test -c tests/browser/playwright.config.ts (builds, starts the API in test mode, runs journeys + axe)
npm run lint               # eslint . && prettier --check . && node scripts/check-css.mjs
npm run lint:fix           # eslint --fix . && prettier --write .
npm run typecheck          # tsc -b (project references over all five workspaces)
npm run verify             # lint, typecheck, test — the command every PR runs locally before it opens
npm run verify:full        # verify, build, check:substitute-absent, test:browser — what CI runs (section 6)
```

`test:unit`, `test:integration` and `test:browser` run with `NODE_ENV=test` and `RAI_IDENTITY_MODE=fixture` set by the npm script itself (POSIX `VAR=value` prefix; CI and development machines are POSIX), overriding `.env`; no test ever reads the developer's Google client.

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
| `@fastify/cookie` | 11.1.2 | server | Parses and sets the `HttpOnly`, `SameSite=Lax` session cookie. W0-09: the cookie value is a 256-bit random string looked up by its SHA-256 in the Postgres `sessions` table (W0-03 section 6.3), so the cookie is not signed, no `SESSION_SECRET` exists, and revocation and expiry are server-side; no session library is needed. |
| `@fastify/helmet` | 13.1.1 | server | Strict CSP for the served SPA, `X-Content-Type-Options: nosniff`, no-store on API responses (ADR-0003 consequences). |
| `@fastify/type-provider-typebox` | 6.1.0 | server | Fastify's native type provider: the section 7 TypeBox schemas validate requests with Fastify's ajv and give route handlers inferred types, so the shared schema is the single definition. |
| `typebox` | 1.3.34 | shared | Schema-to-type library the shared contract is written in; imported by server (validation), web (types, client-side form hints) and the W1-13 substitute. |
| `drizzle-orm` | 0.45.3 | server | D04. Typed SQL over `pg` with plain transactions and `FOR UPDATE`; migrations are SQL files applied by an explicit migrator call (W0-04). |
| `pg` | 8.23.0 | server | node-postgres driver Drizzle's `node-postgres` adapter uses; a dedicated client per transaction (freeze, decide, Ready). |
| `openid-client` | 6.8.8 | server | D04. Certified OIDC client; Google today, Entra later behind one adapter (W0-03). |
| `react` | 19.3.0 | web | D04. |
| `react-dom` | 19.3.0 | web | D04. |
| `react-router-dom` | 7.18.4 | web | Deep links to cases and versions (A05 links must resolve inside the SPA and still require sign-in). |

Not added, on purpose: no i18n library (section 10 uses a typed key union, `Intl` and a 40-line `t()`), no date library (`Intl.DateTimeFormat` with `timeZone: 'Asia/Bangkok'`), no state-management library, no CSS framework (design tokens from the handoff as CSS custom properties), no separate logger (Fastify bundles pino), no session library (see `@fastify/cookie`), no mail transport (slice 1 has only the sink; a transport is a W7 decision), no ORM migration runner beyond Drizzle's own, and no file-type detector: W0-09 removed the earlier `file-type` row because W0-08 section 2.5 specifies a hand-written sniff over Node built-ins (five explicit structures, deny by default); reconsidering a library detector is a D08 item.

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

Rules: no secret in Git, ever; `.env` is gitignored; `.env.example` (created by W1-00) contains only the placeholders below; `server/src/config.ts` parses every variable at start, applies the fail-closed rules and exposes a typed object; an invalid combination exits with the error code and a locale-keyed message before any port is bound (identity misconfiguration exits 78, W0-03 section 5). Networked or production identity, mail and store credentials come from the custody mechanism approved under D10 (`RAI_SECRET_SOURCE`, W0-03 section 8), never from `.env`; the adapter refuses to start in `network` or `production` mode without them (W0-03). For `local-google`, the OAuth client is held in the developer's local `.env` and never committed (W1-08). W0-09: the identity, secret-source and session variables carry W0-03's `RAI_IDENTITY_*`, `RAI_SECRET_*` and `RAI_SESSION_*` names (W0-03 owns them, section 9.1 there); every other variable keeps this plan's unprefixed name (W0-03 section 9.1: "W0-02 owns their final names"). The earlier `IDENTITY_MODE`, `OIDC_*`, `SESSION_SECRET` and `SESSION_TTL_MINUTES` rows are withdrawn.

| Variable | Placeholder in `.env.example` | Used by | Rule |
|---|---|---|---|
| `NODE_ENV` | `development` | all | `development` \| `test` \| `production`. |
| `HOST` | `127.0.0.1` | server | Bind address. Non-loopback is refused unless `IDENTITY_MODE` is `network` or `production` (W0-03, BUILD_PLAN W7). |
| `PORT` | `8787` | server | API and SPA port. Not 5173 (the demo). |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8787` | server | Origin for deep links in mail and for the OIDC redirect; must match `HOST`/`PORT` in local modes. |
| `TRUST_PROXY` | `false` | server | Fastify `trustProxy`; `true` is refused in `local-google` (W0-03 row S5) and is set only by the W8 host configuration under D10. |
| `DATABASE_URL` | `postgres://rai_app:rai_app@127.0.0.1:54320/rai` | server, tests | The `rai_app` connection (W0-04 database roles: SELECT/INSERT, UPDATE on the mutable tables only, no DELETE, no DDL); synthetic local credentials created by `docker/postgres/init/`; the port follows `POSTGRES_PORT`. Production credentials come from custody (D10). |
| `DATABASE_MIGRATE_URL` | `postgres://rai_owner:rai_owner@127.0.0.1:54320/rai` | `npm run migrate`, drizzle-kit | The `rai_owner` connection that owns the schema (W0-04); the only connection that runs DDL. |
| `DATABASE_OPERATOR_URL` | `postgres://rai_operator:rai_operator@127.0.0.1:54320/rai` | `db:cleanup`, `store:verify`, `store:cleanup`, `reset`, integration and browser tests | The `rai_operator` connection (W0-04); synthetic local credentials created by `docker/postgres/init/`; the port follows `POSTGRES_PORT`. When empty the commands use `DATABASE_MIGRATE_URL` locally. |
| `POSTGRES_PORT` | `54320` | docker compose | Host port Postgres is published on (loopback only). Per-ticket: `54320 + <nn>`. |
| `BLOB_DIR` | `./.local/blobs` | server | Private artifact directory; created on start with mode `0700`, files `0600`; content-hash keyed `sha256/<h[0:2]>/<h[2:4]>/<h>` with temp files under `tmp/` (W0-04 "Layout and write path"). |
| `UPLOAD_MAX_FILE_BYTES` | `26214400` | server | Per-file limit (25 MiB, W0-08 section 3) enforced by `@fastify/multipart` before hashing; a configured value larger than the default is refused at start in `local-google` and test modes (W0-08); D08 revisits before real data. |
| `UPLOAD_MAX_PACK_BYTES` | `157286400` | server | Per-pack total (150 MiB, W0-08 section 3) across a draft's attached artifacts plus the file being uploaded. |
| `UPLOAD_MAX_IMAGE_PIXELS` | `40000000` | server | Width × height cap for PNG and JPEG (W0-08 section 3). |
| `IDEMPOTENCY_TTL_HOURS` | `72` | `db:cleanup` | Idempotency-key expiry (W0-04). Integer ≥ 1; an empty or invalid value is refused, never replaced by a fallback. |
| `BLOB_ORPHAN_MIN_AGE_HOURS` | `24` | `store:cleanup` | Orphan-blob age threshold (W0-04); removal itself waits for D08. Integer ≥ 0. |
| `BLOB_TMP_MAX_AGE_HOURS` | `1` | `store:cleanup` | Stale temp-file threshold (W0-04). Integer ≥ 0; empty is refused, not read as 0. |
| `RAI_IDENTITY_MODE` | `local-google` | server | `local-google` (loopback only; the L11 development login) \| `fixture` (only when `NODE_ENV=test` and the bind is loopback; W0-03 S13, S14) \| `network` \| `production`. Missing or unknown value: refuse to start (`mode_unknown`). Name and values: W0-03 section 9.1. |
| `RAI_IDENTITY_GOOGLE_CLIENT_ID` | `set-locally` | server | Required in `local-google` (S4); forbidden in `production` and `network`/`ad` (S10). The issuer is fixed at `https://accounts.google.com` in that mode (W0-03 section 4.1) and is not a variable. |
| `RAI_IDENTITY_GOOGLE_CLIENT_SECRET` | `set-in-custody` | server | Same; held in the developer's local `.env`, never committed. `set-in-custody`, empty or whitespace counts as absent (S15). |
| `RAI_IDENTITY_LOCAL_ROLE_MAP` | empty | server | `local-google` only: optional path to an untracked allow-list-format JSON; absent means every account is `owner` (W0-03 section 4.1). |
| `RAI_IDENTITY_NETWORK_SOURCE` | `allow-list` | server | `network` only: `allow-list` or `ad` (S6). |
| `RAI_IDENTITY_OIDC_ISSUER_URL` | `https://issuer.example.test` | server | `network`/`allow-list` only (S7). |
| `RAI_IDENTITY_OIDC_CLIENT_ID`, `RAI_IDENTITY_OIDC_CLIENT_SECRET` | `set-in-custody` | server | `network` and `production` (S7, S9); read through `RAI_SECRET_SOURCE`, never from `.env` on a networked host. |
| `RAI_IDENTITY_ALLOW_LIST_JSON` | `set-in-custody` | server | `network`/`allow-list` only (S7, S8); a secret because it holds staff addresses. |
| `RAI_IDENTITY_ENTRA_TENANT_ID` | `00000000-0000-0000-0000-000000000000` | server | `network`/`ad` and `production` (S9, S11). |
| `RAI_SECRET_SOURCE` | `env` | server | `env` \| `file` (W0-03 section 8). |
| `RAI_SECRET_DIR` | `/run/secrets` | server | `file` source only. |
| `RAI_SESSION_ABSOLUTE_HOURS` | `12` | server | Absolute session lifetime, 1-24 (W0-03 section 6.3). |
| `RAI_SESSION_IDLE_MINUTES` | `120` | server | Idle session lifetime, 5-720 (W0-03 section 6.3). |
| `MAIL_MODE` | `sink-file` | server | `sink-file` \| `sink-memory` in slice 1. No transport value exists until W7 authorizes one (W0-07). |
| `MAIL_SINK_DIR` | `./.local/mail` | server | Where `sink-file` writes one JSON file per delivery attempt. |
| `QC_MODE` | `substitute` | server | The only slice-1 value (W1-10). W4 adds a real implementation under ADR-0006. |
| `LOG_LEVEL` | `info` | server | pino level. |
| `LOG_PRETTY` | `true` | server | `pino-pretty` transport in development only; refused when `NODE_ENV=production` and never set by the test commands (W0-10 section 3.1). |
| `BUILD_COMMIT` | `dev` | server | Reported as `build.commit` by `GET /readyz` (W0-10 section 5.3); set by the build in CI and on the host. |
| `VITE_API_SUBSTITUTE` | `false` | web (build time) | `true` bundles the W1-13 in-memory substitute into a dev build; `npm run build` forces `false` and `check-substitute-absent` verifies it. |
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:8788` | tests | The browser suite starts its own API instance on this port with `NODE_ENV=test`, `RAI_IDENTITY_MODE=fixture`, its own `BLOB_DIR` and `MAIL_SINK_DIR` under `.local/test/`. |

Not configuration: the timezone (`Asia/Bangkok`, D06) and the lane mapping (D02) are constants in `shared/src/constants.ts`; SLA working-day values (DPO 3, others 5, D01) and `operator_recipients` are configuration *revisions* in the database seeded by W1-00, not environment variables (L12, D06). No TPM, VRO or AI Reporting Tool endpoint or credential exists in any configuration (L3, L6).

Docker Compose (`docker-compose.yml`, repository root, created by W1-00). W0-09: the init script mount and the three application roles come from W0-04 "Database roles" (`rai_owner` owns the schema, `rai_app` is the process, `rai_operator` runs the cleanup and verify commands); the superuser below is used only by the init script.

```yaml
services:
  postgres:
    image: postgres:16.15-alpine
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-54320}:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres-local   # synthetic, loopback-only development credential; production uses custody (D10)
      POSTGRES_DB: rai
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d rai"]
      interval: 2s
      timeout: 2s
      retries: 30
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro   # creates rai_owner, rai_app, rai_operator with the W0-04 grants (synthetic passwords rai_owner / rai_app / rai_operator)
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

Rules: no `continue-on-error`, no `test.skip` or `test.todo` merged to `main` (ESLint rule `no-restricted-syntax` over `describe.skip`, `test.skip`, `test.todo` in `tests/`); a red check is fixed in the same PR, never bypassed. A PR that changes `.github/`, `scripts/`, `docker-compose.yml` or section 4 is HRR and reviewed by the lead. CI never has Google, mail or external credentials; every check runs with `NODE_ENV=test`, `RAI_IDENTITY_MODE=fixture`, `MAIL_MODE=sink-memory`, `QC_MODE=substitute`.

Frozen-source hash: `scripts/check-frozen-source.mjs` reads the SHA-256 for `docs/product/source-spec.md` from `docs/sources.md` and compares it with the file, so the expected value is never a second literal; `tests/source.test.mjs` keeps its own literal check as today.

---

## 7. W1 interface shapes

The contract Lane A serves (W1-01 to W1-05), Lane C substitutes (W1-13) and Lane B builds against (W1-06, W1-07). Written in TypeScript type notation; `rai-web/shared/src/schemas/*` hold the equivalent TypeBox schemas from which these types are inferred, and the server validates every request body, params and query against them. W2 shapes (lane decision, send-back feedback, findings and dispositions, history) are added to 7.7 by the W2-02 and W2-05 contract PRs before those tickets start; W3 shapes (queue query, due dates, breach query, delivery status) to 7.8 by the W3-01 and W3-05 contract PRs. Any change to this section is its own PR merged before every consumer PR.

Conventions:

- JSON over HTTPS-in-production, HTTP on loopback. All paths are under `/api`; OIDC paths are under `/auth`. Field names are `camelCase` in JSON; the database columns keep the data contract's `snake_case` names.
- Every response carries `X-Correlation-Id` (W0-10). W0-09: the value is always server-minted; a client-supplied header is never read (W0-10 section 2.2). The same value is written to the audit event, the notification record and the QC run of that request.
- Every mutating request that the workflow treats as idempotent (create and submit in W1; decide, send back, resubmit and disposition in W2; Ready is system-triggered and has no key) carries an `Idempotency-Key` header (UUID generated by the client per user action; W0-06 section 5.3). A replay with the same key and same actor returns the original success response and changes nothing (A07). A replay with a different body under the same key is `invalid_input` (`error.invalid_input.idempotency_key_reused`). Records expire after `IDEMPOTENCY_TTL_HOURS` (W0-04).
- Optimistic concurrency uses the W0-06 section 5.1 `ExpectedVersion { versionId, revision }` for draft and version actions (`expectedVersion` in the body; `versionId` is the draft's or version's id, `revision` the W0-04 `case.row_version` counter that every draft-time write on the case increments) and `expectedCaseRevision` for case-field edits (the same counter); a mismatch is `409 stale_version` with the W0-06 8.2 `reason`, `guidanceKey`, `current` and `refreshPath`, and changes nothing.
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

// rai-web/shared/src/errors.ts — W0-09: the envelope is W0-06 section 8.2, reproduced here; W0-06 is authoritative
export type ErrorCode =
  | 'unauthenticated'       // 401
  | 'forbidden'             // 403
  | 'stale_version'         // 409
  | 'invalid_input'         // 422
  | 'unsafe_upload'         // 422
  | 'qc_unavailable'        // 503 (only from a synchronous QC endpoint; none in slice 1)
  | 'mail_delivery_failed'  // 502 (on the notification record, never on the actor's business action)
  | 'not_found';            // 404, in-scope reference that does not exist (ADR-0003; confirmed by W0-06 8.1)
// Outside the contract types: HTTP 500 with code 'internal_error' (W0-06 8.1), body = messageKey 'error.internal_error' + correlationId only.

export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>>;   // W0-06 8.2 values

export interface FieldError {
  path: string;             // request JSON path: 'sourceRecordId.value', 'slots[3].reason', 'header.idempotency-key'
  messageKey: LocaleKey;    // 'validation.required', 'validation.not_in_configured_list', 'error.invalid_input.projected_field', ...
  params?: Record<string, string | number>;
}

export type StaleReason = 'version_superseded' | 'revision_changed' | 'version_closed' | 'lane_already_decided' | 'qc_run_superseded';   // W0-06 8.2

export interface ErrorDetails {
  invalid_input: { fields: FieldError[] };
  stale_version: {
    reason: StaleReason;
    guidanceKey: `error.stale_version.guidance.${StaleReason | 'ready'}`;
    current: { versionId: string; versionNumber: number; revision: number; state: 'draft' | 'submitted'; ready: boolean };
    refreshPath: string;    // relative SPA path of the current version
  };
  unsafe_upload: { reasonKey: `error.unsafe_upload.${UnsafeUploadReason}`; params?: Record<string, string | number> };   // reason vocabulary: W0-08 section 5 (13 reasons); params carry the limit for too_large, pack_total_exceeded, image_too_large
  qc_unavailable: { qcRunId?: string };
  mail_delivery_failed: { notificationId: string; attempts: number; nextRetryAt?: string };
  not_found: { resource: 'case' | 'version' | 'finding' | 'artifact' | 'notification' };
  unauthenticated: never; forbidden: never;      // nothing about the resource leaks
}

export interface ErrorResponse<C extends ErrorCode = ErrorCode> {
  error: {
    code: C;
    messageKey: `error.${C}`;   // Thai default (D12)
    correlationId: CorrelationId;
    details?: ErrorDetails[C];
  };
}
```

Scope rule for every read below, as recorded by [W0-05 section 4](authorization-policy-matrix.md#4-out-of-scope-references-403-with-non-guessable-identifiers) at W0 exit: an out-of-scope reference → `403 forbidden`, with the body never revealing whether the case exists (route identifiers are non-guessable UUIDs); an unresolvable case or artifact id → `404 not_found` only for an actor holding an `all_cases` row for the action (reviewers, Admin), and `403 forbidden` for an owner or BU SPOC, so an out-of-scope caller gets 403 whether or not the case exists; a version, finding or artifact id that does not resolve under an authorized case → `404 not_found` with `details.resource`. Every request without a valid session → `401 unauthenticated`, checked before anything else, including on `GET /api/artifacts/{id}` (the "direct file URL" negative of A01).

### 7.2 Sign-in (W0-03; served by W1-01a, consumed by W1-07)

```ts
// rai-web/shared/src/schemas/auth.ts
export type Role = 'owner' | 'bu_spoc' | 'ai_coe' | 'dpo' | 'it_security' | 'admin';
export type Lane = 'ai_coe' | 'dpo' | 'it_security';

export type RoleScope =
  | { role: 'owner';       scope: { kind: 'own_cases' } }                        // cases whose owner_subject_id (W0-04) is this subject
  | { role: 'bu_spoc';     scope: { kind: 'business_unit'; businessUnit: string } }
  | { role: 'ai_coe';      scope: { kind: 'all_cases'; lane: 'ai_coe' } }
  | { role: 'dpo';         scope: { kind: 'all_cases'; lane: 'dpo' } }
  | { role: 'it_security'; scope: { kind: 'all_cases'; lane: 'it_security' } }
  | { role: 'admin';       scope: { kind: 'all_cases' } };                        // configuration only; never lane authority

export interface Principal {                // W0-09: the shape W0-03 section 2 follows (the W0-02 spelling is authoritative, W0-03 section 14 d)
  subjectId: SubjectId;                     // '<issuerKey>:<subject>', W0-03 section 2.2; never the email
  displayName: string;
  email: string;                            // lower-cased; display and notification addressing only
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
| `GET /api/session` | — | `200 SessionInfo`; `Cache-Control: no-store` | `401` no, expired, idle-expired or revoked session (W0-03 section 6.4); the body is the plain W0-06 envelope with no details |
| `POST /api/session/locale` | `{ locale: 'th' \| 'en' }` | `204` | `401`; `422 invalid_input` |
| `POST /auth/sign-in` | `{ returnTo?: string }` (path only, same-origin) | `200 { redirectUrl: string }` in `local-google`, `network`, `production`; stores the W0-03 `SignInTransaction` in the short-lived transaction cookie; the route does not exist in `fixture` mode | `422 invalid_input` when `returnTo` is not a same-origin path. There is no "identity unavailable" error: a misconfigured adapter refuses to start (W0-03), so the API is never up with a broken sign-in |
| `GET /auth/callback?code&state` | OIDC redirect | `303` to `returnTo` or `/`, sets the session cookie, clears the transaction cookie | `401 unauthenticated` (`error.unauthenticated`) on state, nonce or transaction-cookie mismatch, a failed code exchange or an unverified email; `403 forbidden` (`error.forbidden`) for a verified login with no (role, scope) pair (W0-03 section 6.4); in `production` a Google issuer is refused at start, not here |
| `GET /auth/fixture/users` | — | `200 { users: Array<{ fixtureUserId: string; displayName: string; roles: RoleScope[] }> }`: the fixture identities of W0-03 section 7 for the test sign-in picker (W1-07 shows the picker when this route answers 200 and the Google button when it answers 404) | `404 not_found` in every mode but `fixture`. W0-09: carried into this table from W0-03 section 6.1 |
| `POST /auth/fixture/sign-in` | `{ fixtureUserId: string }` | `200 SessionInfo`, sets cookie | `404 not_found` unknown fixture user; the route does not exist (404) unless `RAI_IDENTITY_MODE=fixture` (W1-13 substitute mirrors it) |
| `POST /auth/sign-out` | — | `204`, session row revoked, cookie cleared | `401`; `403 forbidden` when `Sec-Fetch-Site` is neither `same-origin` nor `none` (W0-03 section 6.1 CSRF rule) |

Deep links: a request to any `/cases/...` SPA path without a session renders the sign-in screen with `returnTo` set; after sign-in the case loads only if in scope (A05 "link alone grants nothing").

### 7.3 Case create, edit, read, list (W1-02; consumed by W1-07, W1-06)

```ts
// rai-web/shared/src/schemas/cases.ts
export type SourceRecordId =
  | { kind: 'known'; value: string }     // 'TPM-…' or 'VRO-…', stored and read back unchanged; never looked up (L3, L6, L10)
  | { kind: 'unknown' };                 // the literal Unknown of the source spec

export type ModelType = 'llm' | 'classic_ml' | 'other';                   // desk-local (W0-04 fields)
export type RiskTier = string;   // opaque placeholder: the tier labels are recorded by D07 before W5; no literal set is fixed here
export type LaneProjectionStatus = 'pending' | 'approved' | 'sent_back';   // vocabulary confirmed by W0-04
export type ReadinessProjectionStatus = 'not_ready' | 'ready';
export type CaseStatus =                  // W0-09: the W0-06 section 2.4 derived vocabulary, verbatim; no other value exists
  | 'draft'                 // current version is a draft with no parent (never submitted)
  | 'in_review'             // current version is submitted and at least one lane is pending (from the first submit in W1; W2-01 opens the lanes)
  | 'sent_back'             // W2: a successor draft exists
  | 'awaiting_disposition'  // W2: all three lanes approved, at least one undispositioned finding
  | 'ready_for_launch';     // W2 (desk completion only; not Council or ITSM)

export interface CaseWritableFields {
  useCaseName: string;                   // 1..200 chars
  businessUnitId: string;                // W0-09: the scope key stored in W0-04 case.business_unit_id; must be a configured BU key (fixture BUs 'CM', 'HR'; W0-03 section 7) or 422 invalid_input; the value W0-05 compares (W0-05 section 8 reconciliation)
  businessUnit: string;                  // 1..100 chars; the inherited descriptive text (W0-04 case.business_unit); never used for access
  businessOwner: SubjectId;              // stored as W0-04 case.owner_subject_id; defaults to the actor for role owner; a BU SPOC may name an owner in its BU. The server fills the W0-04 descriptive business_owner text from that subject's display name (W0-05 section 8 reconciliation)
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
  riskTier: RiskTier | null;             // null throughout slice 1; W5's contract PR replaces the placeholder with D07's labels
  privacyStatus: LaneProjectionStatus;   // written only by the workflow: DPO approval (W0-04 fields)
  securityStatus: LaneProjectionStatus;  // IT/Security approval
  raiStatus: LaneProjectionStatus;       // AI/COE approval
  aiReadinessStatus: ReadinessProjectionStatus; // Ready transition
  currentVersion: VersionSummary | null; // latest submitted version, null while never submitted
  draft: DraftSummary | null;            // the editable draft, null while the current version is under review
  caseRevision: number;                  // W0-04 case.row_version: increments on every case-level or draft write on this case; used for expectedCaseRevision and as ExpectedVersion.revision
  createdBy: SubjectId;
  createdAt: string;
  updatedAt: string;
}

export interface CaseSummary {           // list row
  caseId: CaseId; registryId: RegistryId; useCaseName: string; businessUnitId: string; businessUnit: string;
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
| `POST /api/cases` | header `Idempotency-Key` (W0-06 5.3); `CaseCreateRequest` | `201 CaseView` with `status: 'draft'`, a `draft` (W1-04 creates the nine slots with defaults), `caseRevision: 1`; writes audit `case.created` | `401`; `403` role is not owner or bu_spoc, or bu_spoc names a `businessUnitId` outside its grants, or owner names a `businessOwner` other than itself (W0-05 create target); `422 invalid_input` (`useCaseGroup` not in list, empty name, `sourceRecordId.value` without `TPM-`/`VRO-` prefix, unknown `businessUnitId`, unresolvable `businessOwner`, missing `Idempotency-Key`, a projected status field in the body → `error.invalid_input.projected_field`) |
| `GET /api/cases/{caseId}` | — | `200 CaseView` | `401`; `403` out of scope (other BU, other owner); `404` |
| `PATCH /api/cases/{caseId}` | `CaseUpdateRequest` | `200 CaseView`, `caseRevision + 1`; writes audit `draft.saved` with the changed-field list (W0-06 4.2; a change of `businessOwner` or `businessUnitId` records the old and new scope values, W0-05 edit target) | `401`; `403` (reviewer roles and admin never write cases; other BU; a scope-field change that would move the case out of the actor's scope, W0-05); `404`; `409 stale_version` (`revision_changed`, or `version_superseded` when the case has no open draft); `422 invalid_input` including any attempt to write `privacyStatus`, `securityStatus`, `raiStatus`, `aiReadinessStatus`, `riskTier`, `registryId` or `status` (`error.invalid_input.projected_field`) |
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
| `POST /api/cases/{caseId}/artifacts` | `multipart/form-data`, one part named `file`, no other field is read (W0-08 section 3); the case must have a draft; no idempotency key (idempotent by content hash, W0-06 5.3) | `201 ArtifactRef`; bytes hashed while streaming, sniffed, then written to `BLOB_DIR` under the hash (a second upload of identical bytes reuses the blob and creates a new metadata row); writes audit `artifact.uploaded`. Attaching the artifact to a slot is the separate `PUT /api/cases/{caseId}/draft` (7.5), which fires the on-upload QC trigger after it commits (W0-07 3.2) | `401`; `403` role not owner/bu_spoc for this case; `404` case; `422 unsafe_upload` with `details.reasonKey` from the W0-08 section 5 vocabulary (bytes discarded, nothing written); `422 invalid_input` when no `file` part or the case has no draft (`validation.no_open_draft`) |
| `GET /api/artifacts/{artifactId}` | — | `200` bytes, `Content-Type: <mediaType>`, `Content-Disposition: attachment; filename*=UTF-8''<RFC 8187 percent-encoded original>`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; writes audit `artifact.downloaded` | `401` (no session, including with a copied URL); `403` case out of scope; `404` |
| `GET /api/artifacts/{artifactId}/meta` | — | `200 ArtifactRef` | as above |

Safety pipeline (W1-03a, W0-08 section 4, checks 1-13): filename rule → stream with the per-file limit while hashing → non-empty → magic sniff on the first 8 KiB with the hand-written W0-08 section 2 sniffer (no library detector) → sniffed kind must match the declared extension's row → structural check on the full bytes (PDF active-content scan, ZIP central-directory rules, PNG/JPEG rules) → per-pack total (the draft's attached artifacts plus this file; re-checked at attach) → blob write → artifact row and audit event in one transaction. The reason key is the only detail returned; the rejected bytes are never stored or logged.

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
  draftId: DraftId;                    // the draft pack_version row's id (W0-04); ExpectedVersion.versionId for draft actions
  caseId: CaseId;
  versionNumber: number;               // 1 for a new case; N+1 for a send-back successor (W2-03)
  parentVersionId: VersionId | null;
  checklistTemplateVersion: string;    // must be in ConfigurationView.checklistTemplateVersions
  stageContext: StageContext;
  slots: Record<SlotNumber, SlotState>;
  draftRevision: number;               // = CaseView.caseRevision (W0-04 case.row_version, one counter per case); ExpectedVersion.revision
  updatedAt: string;
}

export interface DraftSummary { draftId: DraftId; versionNumber: number; updatedAt: string }

export interface PackDraftUpdateRequest {
  expectedVersion: ExpectedVersion;    // { versionId: draftId, revision: draftRevision } (W0-06 5.1; type in 7.6)
  checklistTemplateVersion?: string;
  stageContext?: StageContext;
  slots?: Partial<Record<SlotNumber, SlotState>>;   // only the slots being changed
}
```

Defaults when a draft is created (W1-02 create, W2-03 send-back): every slot `missing`; slots 3 (DPA) and 4 (SOW) `not_applicable` with `default_non_vendor` when `vendorInvolved` is `false`; `stageContext: 'idea'`; `checklistTemplateVersion` = the first configured value. If `vendorInvolved` later flips to `true` on the case, slots 3 and 4 that still carry `default_non_vendor` revert to `missing`; a user-typed reason is kept.

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `GET /api/cases/{caseId}/draft` | — | `200 PackDraft` | `401`; `403`; `404` case or no open draft |
| `PUT /api/cases/{caseId}/draft` | `PackDraftUpdateRequest` | `200 PackDraft`, `draftRevision + 1`; writes audit `draft.saved`; a slot newly `attached` fires the W0-07 `upload` QC trigger after commit | `401`; `403` role not owner/bu_spoc of this case; `404` case; `409 stale_version` `revision_changed` (someone else saved) or `version_superseded` (`expectedVersion.versionId` is not the open draft: the draft was submitted meanwhile, or no draft is open; W0-06 4.2); `422 invalid_input`: `not_applicable` with an empty `text` reason (`validation.reason_required`), `attached` with an `artifactId` that belongs to another case or is unknown (`error.artifact_case_mismatch`, W0-04), template version not configured, unknown slot number; `422 unsafe_upload` `pack_total_exceeded` when attaching would take the version over `UPLOAD_MAX_PACK_BYTES` (W0-08 check 10) |

The case screen offers the editor's Change, Save and Submit controls only to a writer of the case (an owner grant on the case's business owner, or the SPOC of its BU: the `case.edit_draft` rows). Anyone else in scope reads the draft's settings and slots with no editing control. This is presentation only; the `PUT` and submit still answer `403` to them.

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
  decisions: LaneDecision[];                  // the version's decided lanes as of the read, ascending by decidedAt then lane
}

// rai-web/shared/src/schemas/review.ts (7.7): one lane_decision row of the version
export interface LaneDecision {
  lane: Lane;
  decision: 'approve' | 'send_back';
  decidedBy: SubjectId;                       // same convention as submittedBy
  decidedAt: string;
  feedback: SendBackFeedback | null;          // the send-back feedback the owner revises against; null on approve
}

export interface VersionSummary {
  versionId: VersionId; versionNumber: number; submittedBy: SubjectId; submittedAt: string; isLatest: boolean;
}

export interface ExpectedVersion { versionId: string; revision: number }   // W0-06 section 5.1, verbatim; versionId = draftId for draft actions
export interface SubmitRequest { expectedVersion: ExpectedVersion }
export interface VersionListResponse { items: VersionSummary[] }    // ascending by versionNumber
```

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `POST /api/cases/{caseId}/draft/submit` | header `Idempotency-Key`; `SubmitRequest` | `201 SubmittedVersion`. In one transaction (W0-06 4.3): freeze the draft into a version row plus frozen slot rows, copy the artifact references, record `configurationRevisionId` and `laneMappingVersion`, set the case's `currentVersion`, close the draft, reset the three lane projections to `pending`, store the idempotency key, write audit `version.submitted` with actor, version and correlation id. W2-01 extends the same transaction to open the three lanes (`lane.opened` × 3, outbox rows). Pack QC runs after commit in its own transaction (W0-06 4.3, W0-07 3.4); the response does not wait for it. Replay with the same key → the same `201` body | `401`; `403`; `404`; `409 stale_version` (`revision_changed`, `version_superseded`); `422 invalid_input` when a slot is invalid at submit time (`validation.reason_required`) or the header is missing (`header.idempotency-key`); missing documents are *not* an error (soft QC, L7): they become findings in W2 |
| `GET /api/cases/{caseId}/versions` | — | `200 VersionListResponse` | `401`; `403`; `404` |
| `GET /api/cases/{caseId}/versions/{versionId}` | — | `200 SubmittedVersion`. The frozen fields are byte-identical on every read for the life of the row; `isLatest` and `decisions` are read in the same snapshot and reflect the case at that instant | `401`; `403`; `404` (also when the version belongs to another case) |
| `GET /api/cases/{caseId}/versions/latest` | — | `200 SubmittedVersion`, as by id | `401`; `403`; `404` when never submitted |

`decisions` carries every `lane_decision` row of the version, send-back feedback included, under the same `version.view` authorization as the rest of the body: whoever may read the version may read its decisions, and there is no separate route. The submit `201` carries `decisions: []` (nothing is decided at the freeze), and so does its replay. Feedback is reviewer text: it is never logged and never written to an audit ref. The case screen lists the decisions on the version, and shows version N's send-backs above the N+1 draft it opened.

Immutability at the store (W0-04, A07): the version and frozen-slot tables have no `UPDATE` path in the data-access layer, and the migration that creates them adds a trigger that raises on `UPDATE`/`DELETE`; the W1-05 "second write to that version's artifact ref is rejected" test exercises the trigger directly. Restart proof: the W1-INT journey stops and restarts the API process against the same database and re-reads the version.

### 7.7 W2 shapes

Added by W2-02 (lane decision / send-back) and extended by W2-05 (findings/dispositions) and W2-03 (successor-draft read fields). TypeBox schemas live in `rai-web/shared/src/schemas/review.ts`.

| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `POST /api/cases/{caseId}/versions/{versionId}/lanes/{lane}/approve` | header `Idempotency-Key`; `ApproveLaneRequest` (`expectedVersion`, `qcRunId`) | `201 LaneDecisionResponse` | `401`; `403` (wrong lane, Admin, D05 self-approval); `404`; `409 stale_version`; `422` missing key / `lane_qc_not_run` |
| `POST /api/cases/{caseId}/versions/{versionId}/lanes/{lane}/send-back` | header `Idempotency-Key`; `SendBackLaneRequest` (`expectedVersion`, `feedback` with ≥1 item naming a slot) | `201 LaneDecisionResponse` (creates or reuses successor draft) | as approve, plus `422` when feedback does not name an artifact |

Approve records `lane_decision` (`approve`), writes the lane projection, audits `lane.approved`. Send-back records `send_back` with feedback, writes the projection, creates version N+1 draft when none exists (`draft.successor_created`), queues a `send_back` notification to the owner, audits `lane.sent_back`. Ready is not evaluated here (W2-06). The recorded decision, its feedback included, is read back as `SubmittedVersion.decisions` (7.6).

### 7.8 W3 shapes

W3-01 adds the scoped queue query here (search by `sourceRecordId`, status, owner, `useCaseGroup` or all; counts; pagination; filter options). Delivery-status shape for W3-07 comes with W3-03. W3-08 extends the substitute from those shapes.

W3-05 adds the due-date and breach-query shapes in `rai-web/shared/src/schemas/sla.ts`. There is no SLA HTTP route: the due date is a function of `submitted_at`, the SLA revision and the calendar revision frozen on the version (W0-06 4.3 (e)), not a stored column.

| Shape | Meaning |
|---|---|
| `LaneDue` | `{ lane, openedAt, dueOn }` for one lane. `openedAt` is that version's `submitted_at`. `dueOn` is `YYYY-MM-DD` in Asia/Bangkok: `workingDays` weekdays after the open date, skipping Saturday, Sunday and the frozen holiday list. The open date itself is not counted. DPO days and the other lanes' days come from the frozen `sla` body (D01 defaults 3 and 5), never from the revision published later. |
| `SlaBreach` | `{ caseId, versionId, lane, dueOn }` for a lane that is still `pending` on the current submitted version, that version is still the review target (`draft_version_id` is null and `ready_at` is null), and `dueOn` is strictly before the as-of Bangkok date. `listSlaBreaches` is what the W3-03 digest consumes. No escalation. |

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
| A09 send-back feedback, dispositions, Ready | D05 authority rows as data (W2-02a); Ready predicate function (W2-06) | **Proves:** send-back without a named artifact → 422; reviewer acts only on own lane; Admin decision → 403; owner/SPOC self-approval → 403; waived/N/A without reason → 422; non-owning-lane waiver → 403 on single-lane, slot-5 and pack-level findings; owner's "fixed" stays proposed until confirmed; disposition appends, never modifies; `unavailable` QC recorded, not zero findings; Ready only with three current approvals and zero undispositioned findings, rechecked inside the transaction (W2-02, W2-05, W2-06) | Findings render before decision controls; feedback form cannot submit without an artifact; the version lists its lane decisions and the owner sees version N's send-back feedback, slot and deficiency, on N and above the N+1 draft; each disposition kind reachable; a finding never disappears (W2-07, W2-09, W2-INT) | — | W2-02, W2-05, W2-06, W2-07, W2-09, W2-INT, W2-08, W3-06 |
| A11 attributable, reconstructable | Audit module exports no update/delete (compile-time and a test that enumerates exports) (W1-00) | **Proves:** every transition writes one audit event with actor, version, correlation id; the W2 journey is rebuilt from audit rows alone and compared with the read model; `UPDATE`/`DELETE` on an audit row through the application role fails (W1-05, W2-02 to W2-06, W2-08) | — | — | W1-05, W2-02 to W2-06, W2-08 |
| A03, A08, A10 | not in slice 1 (W5, W4, W6) | | | | |

Negative tests for A01 are always direct-API integration tests, never only UI assertions (ADR-0003 risk table).

### 8.3 Fixture identity convention

- The fixture set lives in `rai-web/fixtures/src/data/` and is loaded only by `npm run fixtures:load` (empty database) and `tests/support/db.ts` (per file). Contents are synthetic: no text copied from any real case or Life-OS evidence, no real names, addresses or identifiers (W0-08; a reviewer confirms this in W1-09).
- `manifest.json` names the set: `{ "name": "slice1-synthetic", "version": "1", "sha256": "<hash of the sorted data files>" }`. `fixtures:generate` prints it and `fixtures:load` writes the name, version and hash into a `fixture_set` row; every evidence record (`changes/<date>-<slug>/review.md`) cites `fixture set <name>@<version> <sha256[0:12]>` next to the command output. Changing any fixture bumps `version` and the hash in the same PR. (W0-08 section 8.1 follows this convention since W0-09.)
- Identifiers are stable and self-describing: users `fx-user-<role>[-<qualifier>]` (`fx-user-owner-cm`, `fx-user-owner-cm-2` (W0-09: the second owner W0-05 section 8 asked for; owns no fixture case), `fx-user-spoc-cm`, `fx-user-ai-coe`, `fx-user-dpo`, `fx-user-it-security`, `fx-user-admin`, and the dual-role `fx-user-dpo-spoc-hr`, a DPO reviewer who is also BU SPOC of fixture BU `HR`; display names, subjects and (role, scope) pairs in [W0-03 section 7](identity-adapter.md#7-test-substitute-the-fixture-identity-provider)); cases `fx-case-<kind>` (`fx-case-nonvendor`, `fx-case-vendor`, `fx-case-missing-slot`, `fx-case-na-reasons`, `fx-case-hr-dualrole`; content in [W0-08 section 8.3](upload-safety-and-fixtures.md#83-cases-owned-by-w1-09)); documents carry the fixture id `fx-doc-<case number>-<slot>` and a realistic `filename` from [W0-08 section 8.4](upload-safety-and-fixtures.md#84-documents-owned-by-w1-09), including one Thai-named file (`fx-doc-0002-09`, `เอกสารประกอบ_ผู้ให้บริการ_2569.pdf`; W0-09 aligned this example to W0-08, which owns the fixture content). Email addresses use the reserved domain `rai-desk.example`; the single operator recipient is `operator-digest@rai-desk.example` (W0-08 section 8.2; D06 `operator_recipients` seed, W1-00).
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
6. **Thai text is handled correctly** where the contract names it: filenames round-trip through upload and download unchanged, NFC-normalised, with `filename*=UTF-8''` encoding and no transliteration (W1-03); search (W3-01) compares NFC-normalised strings with a Postgres `ILIKE` over a `text` column in a UTF-8 database with the pinned database’s UTF-8 collation (`en_US.utf8` in the verified Postgres 16 image); W3-01 proves NFC-normalized Thai owner-name and case-insensitive search with real database fixtures. The originally suggested `th_TH.UTF-8` / `C.UTF-8` names are not supplied by this image; no locale or access configuration is changed; email subjects (W3-03) are RFC 2047 encoded-words in UTF-8, and the sink stores the decoded subject so the test can assert the Thai text intact.
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
| **W1-01a** | Identity adapter: interface, `local-google` mode with `openid-client` on loopback only, `fixture` mode gated to `NODE_ENV=test`, `network`/`production` fail closed without custody credentials, Postgres session store and cookie | `server/src/identity/` | W1-00, W0-03 | `local-google` refuses a non-loopback bind and an unknown mode; each fixture user including the dual-role identity signs in and receives its (role, scope) pairs; a session expires and is revocable |
| **W1-01b** | Authorization middleware: the only place scope is enforced; route declaration of the policy row; request principal context | `server/src/authz/` | W1-01a, W0-05 | A request without a session is unauthenticated; a wrong-role request is forbidden; a route without a declared policy row fails at start-up |
| **W1-03a** | Upload safety pipeline and blob store: size limits, sniffing, allowed-type list, hashing, per-pack total, `BlobStore` interface with the filesystem implementation; no HTTP route | `server/src/artifacts/` (no routes) | W1-00, W0-08 | A permitted file's hash is recorded; an executable disguised by extension is rejected with `unsafe_upload`; oversize rejected; identical bytes share one blob; the blob directory is created `0700` |
| **W1-03b** | Upload and download routes under authorization, Thai filenames, download headers, audit events | `server/src/artifacts/` (routes) | W1-03a, W1-01b, W1-09 | A direct file URL without a session is refused; downloaded bytes match the stored hash; a Thai filename round-trips unchanged; another BU's user gets `forbidden` |
| **W2-02a** | Contract PR: D05 rows (owning-lane disposition authority, owner proposes "fixed", no self-approval) added to the policy module as data; W2 shapes added to section 7.7 | `server/src/authz/`, `shared/` | W2-01, W0-05 | Policy tests for each D05 row including the dual-role identity; section 7.7 populated; nothing else changes |
| **W2-02b** | Lane decision: approve or send back on own lane with expected version and idempotency key; send-back requires feedback naming an artifact; Admin has no lane authority; audit event | `server/src/workflow/` | W2-02a | The parent's remaining clauses |
| **W3-03a** | Notification composer and templates: lane open, send-back, Ready, from committed events only, through the W1-11 sink, locale-keyed bilingual templates, Thai-safe subject, deep link | `server/src/notifications/` | W2-08, W1-11, W3-05 contract | No mail for a rolled-back transition; each of the three events produces one mail with the specified contents; deep link without session is unauthenticated; Thai subject intact |
| **W3-03b** | SLA-breach daily digest to `operator_recipients` using the W3-05 breach query | `server/src/notifications/` | W3-03a, W3-05 | A breach mail lists only cases past SLA; one digest per day; recipients come from configuration, never a role |
| **W3-07a** (W0-09: listed from W0-10 section 7.4 for the lead) | Observability baseline API: correlation IDs, redacted logger, `/healthz`, `/readyz`, `GET /api/operator/desk-health`, the `operator_job_run` migration | `server/src/observability/` | W3-03, W3-04, W0-10 | OBS-01 to OBS-16 of W0-10 section 8.2 |
| **W3-07b** (same) | Operator page `/operator/desk-health` in the SPA | `web/src/screens/operator/` | W3-07a | OBS-17 of W0-10 section 8.2; UI quality bar |

Not split, with the reason: **W1-00** is declared "in one PR" by the work breakdown because every later ticket extends it; it is the one deliberately large substrate PR and the lead reviews it as HRR. **W1-06** ("as one flow") stays whole; if its PR exceeds the size rule, the lead splits it at W1 into W1-06a (pack editor) and W1-06b (case overview and version navigation) under the same rule as above. **W1-INT, W2-INT, W3-INT** are the declared multi-module exceptions.

---

## 12. Ticket cross-reference

| Consumer ticket | Uses from this document |
|---|---|
| W1-00 | Sections 1, 2, 3, 4, 5 (creates the skeleton, `.env.example`, `docker-compose.yml` with `docker/postgres/init/`, `shared/` with the 7.1-7.6 TypeBox schemas transcribed from this document and the empty 7.7 and 7.8 files, the audit and configuration modules; it is the only ticket that creates shared modules) |
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
| W0-09 | Verified section 3 is mirrored in [TESTING](../../TESTING.md) "Product build (W0-W3)" and reconciled this plan with the sibling specs ([exit review](../../changes/2026-09-21-w0-exit/review.md)); the section 9 proposal and the 11.1 split remain for Ta and the lead to confirm before W1-06 and W1-01 start; [performance targets](performance-targets.md) recorded |

## 13. Open items carried, not resolved here

Closed at W0 exit (W0-09), recorded here so the list stays honest: upload types and limits (W0-08 sections 2-3, values now in section 5); 403 versus 404 (W0-05 section 4: 403, non-guessable ids, 404 only for an `all_cases` holder); `not_found` and `internal_error` (W0-06 8.1); projection-status vocabulary (W0-04: `pending` / `approved` / `sent_back`, `not_ready` / `ready`); `fixture` mode outside `NODE_ENV=test` (W0-03 S13: no); performance targets ([performance targets](performance-targets.md)).

- Owning lane for slot 5, slot 9, pack-level and QC-unavailable findings: **W0-06** refinement by the review leads before W2-05; the A09 row in 8.2 tests whatever it records.
- Section 9 UI quality bar and the 11.1 sub-ticket split: proposals for Ta and the lead to confirm before W1-06 and W1-01 start (W0-09 could not confirm them on Ta's behalf; the W0 exit checklist requires only that they are written).
- Configuration keys proposed by W0-07 section 10 (`QC_TIMEOUT_MS`, `MAIL_RETRY_BACKOFF_MS`, `MAIL_SINK_FAIL_NEXT`, a disabled `QC_MODE` value): not added; the values stay module constants (QC timeout 10 000 ms, backoff 1 s / 5 s / 25 s) recorded in [performance targets](performance-targets.md), and the lead may add keys in a W1-00 amendment.
- Read-shape additions requested by W0-05 section 8 (`allowedActions: Action[]` and a per-action reason on case, version and finding reads): not added in W1; a W2-02 or W2-05 contract PR adds them if Lane B needs them.
- W3-07 page split (W0-10 section 7.4: W3-07a API in Lane A, W3-07b page in Lane B): listed in 11.1 for the lead.
- Risk-tier labels (`RiskTier` in 7.3 is an opaque `string` and `riskTier` is `null` throughout slice 1): **D07** records the questionnaire, rubric version and labels before W5; W5's contract PR replaces the placeholder type.
- D07-D10 stay open at their gates; nothing in this plan pre-empts them (no rubric, no retention rule, no model, no host).

### W3-01 queue contract amendment — 2026-09-22

`GET /api/queue` uses `case.list`, with `QueueQuerySchema` and `QueueResponse` in `rai-web/shared/src/schemas/queue.ts`. The existing `/api/cases` contract remains unchanged. Search, filters, counts, options, current lane due dates and deterministic pagination follow the [queue contract](../../changes/2026-09-22-w3-01-queue-contract/spec.md). This is a shared-contract PR before W3-01 server, W3-08 substitute and W3-02 UI consumers; it does not close #42.

### W3-03a notification template contract

The W3-03a prerequisite adds `mail.lane_opened.body`, `mail.sent_back.body` and `mail.ready_for_launch.body` to both shared locale catalogues. Existing `mail.lane_opened`, `mail.sent_back`, `mail.ready_for_launch` remain the subject and persisted template keys. Body parameters are `caseName`, `caseLink`; lane-open additionally `laneLabel`, `defectCount`, `dueDate` (frozen SLA date in Asia/Bangkok); send-back additionally `laneLabel`, `feedback` (reviewer text bounded to 500 code units). Thai is the default. All rendering uses shared `t()`; no new HTTP, database, authorization or mail-interface shape. W3-03b digest and W3-04 retries remain separate.

## W3-07a prerequisite amendment — 2026-09-22

Section 7.8 adds `ReadinessReport`, `DeskHealthReport` (including mandatory `lateQc`), `SafeErrorFields` and `DigestJobProvenance` under shared `schemas/observability.ts`, re-exported from `schemas/queue.ts`. The [engineering reconciliation](../../changes/2026-09-22-w3-07a-observability-contract/spec.md) owns exact fields and OBS semantics. W3-07a adds migration `0007_w3_07a_observability`; W3-03b consumes job/linkage persistence only after the coordinated mail provenance/sink contract. W3-INT proves submit-trigger timeout and late-QC refusal with the synthetic runner. No consumer code is part of this prerequisite.

### W3-03b mail provenance prerequisite

Before the digest consumer, shared mail types expose CaseMailEvent | CommittedDigestEvent as DeliveryRequest.event; the original CommittedEvent still requires auditEventId. Digest requires W3-07a DigestJobProvenance, real calendar day and matching correlation, without business audit provenance. Shared mail helper, both sink validators/fixtures/tests and file text provenance evolve together. No migration or observability schema edit. The server loader, not a sink, must prove the persisted run/link. Empty breaches complete count 0 with no mail; day is Bangkok job-start day and recipients are configured operators. Consumer follows independent prerequisite review and coordination with W3-04's single dispatcher.
