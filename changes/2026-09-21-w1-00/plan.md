# Plan: W1-00 — shared W1 substrate

2026-09-21. Ticket W1-00 (issue #16), branch `codex/w1-00-substrate`, worktree `/Users/tkhongsap/github/rai-wt/W1-00`. Lane A, owner type HRR. Written before code, per AGENTS.md.

## Intent

Create the `rai-web/` skeleton and the shared substrate every later W1-W3 ticket extends, exactly as the W0-02 plan ([implementation-plan-w1-w3.md](../../docs/engineering/implementation-plan-w1-w3.md)) lays it out, with the persistence base of W0-04, the error contract of W0-06, the policy rows of W0-05, the fixture identities of W0-03 and the logger allow-list of W0-10. No endpoints, no UI, no decision.

## Scope (files)

- Root: `docker-compose.yml` (Postgres 16.15-alpine, `POSTGRES_PORT`), `docker/postgres/init/001-roles.sql` (rai_owner, rai_app, rai_operator), `.gitignore` additions.
- `rai-web/`: workspace root (`package.json` with the section 3 scripts, `package-lock.json`, `.nvmrc`, `.env.example`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `scripts/`).
- `rai-web/shared/src/`: `errors.ts` (eight codes, statuses, envelope, typed error classes), `ids.ts`, `constants.ts` (APP_TIMEZONE, LANE_MAPPING_V1, SLOTS), `schemas/*` (7.2-7.6 TypeBox schemas; 7.7 and 7.8 empty), `qc/types.ts`, `mail/types.ts`, `locales/` (th.json, en.json, keys.ts).
- `rai-web/server/`: `drizzle.config.ts`, `drizzle/0000_w1_00_substrate.sql` + `meta/`, `src/config.ts`, `src/db/` (client, schema per entity, migrate, transaction helper), `src/authz/policy.ts`, `src/configuration/` (store, seed, activation rule), `src/audit/store.ts`, `src/observability/` (context, log), `src/identity/fixture.ts`, minimal `app.ts` / `main.ts`.
- `rai-web/fixtures/src/`: `data/users.ts` (eight W0-03 identities), `substitute-marker.ts`, `load.ts` (configuration seed only; W1-09 extends).
- `rai-web/web/`: minimal Vite + React shell so `build`, `lint` and `typecheck` run over the workspace.
- `rai-web/tests/`: `support/db.ts`, `integration/w1-00-*.test.ts`, `browser/playwright.config.ts` (no specs).
- `changes/2026-09-21-w1-00/review.md` with commands and output.

Not touched: `docs/product/source-spec.md`, `docs/product/decisions.md`, `docs/board/*`, DEVLOG, CHANGELOG, `.github/workflows/` (CI is W1-12), `demo/`, `tests/` at the root.

## Tests first (Done when → test)

| Clause | Test |
|---|---|
| Installs and tests from a clean checkout with the W0-02 commands | `npm ci && npm run verify` from a fresh clone of the branch |
| Each error type has a test | `shared/src/errors.test.ts`: every code → status, `error.<code>` in th and en, envelope shape, `forbidden`/`unauthenticated` carry no details |
| Policy rejects an unknown role | `server/src/authz/policy.test.ts`: `authorize` throws on unknown role and unknown action |
| Nothing grants access without a policy row | same file, table-driven over every role × action in the module |
| Published revision cannot be updated or deleted; read back unchanged after a later revision | `tests/integration/w1-00-configuration.test.ts` (trigger as rai_owner, grant as rai_app, deep-equal read by id) |
| Audit store has no update or delete path | `server/src/audit/store.test.ts` (exports enumerated) + `tests/integration/w1-00-audit.test.ts` (raw UPDATE/DELETE rejected as rai_app and rai_owner) |
| Migrations apply from empty and rerun idempotently | `tests/integration/w1-00-migrations.test.ts` |

## Postgres for this ticket

`POSTGRES_PORT=54320 docker compose -p rai-w1-00 up -d --wait`; `DATABASE_URL` on 54320; `down -v` when finished.
