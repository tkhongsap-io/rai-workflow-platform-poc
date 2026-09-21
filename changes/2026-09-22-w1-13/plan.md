# Plan: W1-13 — dev/test-only in-memory API substitute

2026-09-22. Ticket W1-13 (issue #28), lane C, Agent-eligible. Branch `codex/w1-13-api-substitute`, worktree `/Users/tkhongsap/github/rai-wt/W1-13`. No Postgres is needed by the substitute itself; the integration suite of the existing tickets runs against `rai-w1-13` on port 54333. Recorded before code.

## Intent

Give Lane B (W1-06, W1-07) a stand-in for the W1 server that answers every request/response shape of the W0-02 plan section 7.2-7.6 from the W1-09 fixture set, with the W0-06 8.2 error envelope for every forbidden, stale and not-found case the section names, so the UI tickets can be built and their Playwright specs run before W1-02 to W1-05 land. The substitute is a development aid: never deployed, never acceptance evidence, never a client-side permission rule.

## Spec (what is implemented, from where)

- Shapes and routes: [W0-02 section 7](../../docs/engineering/implementation-plan-w1-w3.md#7-w1-interface-shapes) 7.1 (envelope, scope rule), 7.2 (sign-in in `fixture` mode), 7.3 (case create/edit/read/list, configuration), 7.4 (upload, download, meta), 7.5 (pack draft), 7.6 (submit, version list, version by id, latest), verbatim through the TypeBox schemas in `rai-web/shared/src/schemas/*`.
- Order of checks: [W0-06 section 4](../../docs/engineering/workflow-transition-and-error-contract.md#4-events) (session → authorization → existence → validation → idempotency → expected version → apply); expected-version reasons from 5.2; idempotency from 5.3; envelope from 8.2.
- Authorization: [W0-05 section 6 "Substitute (W1-13)"](../../docs/engineering/authorization-policy-matrix.md#substitute-w1-13): the substitute imports the same policy rows and `authorize` (through W1-01's `authorizeRequest` helper, so the 403/404 paths cannot diverge from the real server) and never adds a row of its own. The unresolved-id rule of section 4 follows from the helper.
- Upload: [W0-08 section 4](../../docs/engineering/upload-safety-and-fixtures.md#4-order-of-checks) checks 1-8 and 10 (session, scope, open draft, filename rule, per-file limit, empty, magic sniff, extension match, pack total) with the section 5 reason keys; the structural checks (2.1, 2.2, PNG/JPEG rules, check 9) are W1-03's product sniffer and are not reproduced.
- Layout: [W0-02 section 1](../../docs/engineering/implementation-plan-w1-w3.md#1-repository-layout): `rai-web/fixtures/src/substitutes/api/`, marked with `substitute-marker.ts`; `VITE_API_SUBSTITUTE` semantics from section 5; `check:substitute-absent` from section 6.

## Files

- `rai-web/fixtures/src/substitutes/api/` — `README.md`, `index.ts`, `types.ts`, `store.ts` (in-memory state built from the W1-09 tables and the W1-00 seed), `support.ts` (envelope, validation → `FieldError`, cookies, correlation id), `multipart.ts`, `sniff.ts`, `handler.ts` (router: session → authorization → existence → validation → idempotency → expected version → apply), `routes-auth.ts`, `routes-cases.ts`, `routes-artifacts.ts`, `routes-pack.ts`, `routes-versions.ts`, `server.ts` (`startApiSubstitute` on loopback, fail-closed outside `NODE_ENV=test|development`), `serve.ts` (CLI for a Playwright `webServer` command or `npm run dev -w web`), `fetch.ts` (a `fetch`-shaped adapter with a cookie jar for in-process use), and the colocated `*.test.ts` files.
- `TESTING.md`: one paragraph on the substitute commands. `changes/2026-09-22-w1-13/{plan,review}.md`.

## Not touched

`docs/product/*`, `docs/engineering/*`, `rai-web/shared/*`, `rai-web/server/*`, `rai-web/web/*`, `rai-web/tests/*`, `rai-web/fixtures/src/data/*`, `docs/board/*`, `DEVLOG.md`, `CHANGELOG.md`, `.github/*`, root `package.json` scripts.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` (unit: the new suites; integration: the existing suites against `rai-w1-13`), `npm run build && npm run check:substitute-absent`, `npm run test:browser`, and from the repository root `node --test tests/*.test.mjs`, `node scripts/check-links.mjs`, `node scripts/check-frozen-source.mjs`, `git diff --check`.
