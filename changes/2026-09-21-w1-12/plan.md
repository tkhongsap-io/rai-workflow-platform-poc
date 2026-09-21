# Plan: W1-12 — CI checks and local test harness

2026-09-21. Ticket W1-12 (issue #27), branch `codex/w1-12-ci-harness`, worktree `/Users/tkhongsap/github/rai-wt/W1-12`. Lane C, owner type HRR (agents may not change CI): this PR is drafted by an agent under the ticket brief and is not effective until the tech lead reviews it and Ta merges it; nothing in it runs in CI before that merge. Written before code, per AGENTS.md.

## Intent

Wire the eleven PR checks of the W0-02 plan ([section 6](../../docs/engineering/implementation-plan-w1-w3.md#6-ci-checks-on-every-pr)) into `.github/workflows/ci.yml`, add the two zero-dependency repository scripts the plan names (`scripts/check-links.mjs`, `scripts/check-frozen-source.mjs`), and give the product suite its test harness pieces under `rai-web/tests/` (browser support: axe audit, keyboard-only helpers, fixture sign-in; integration support: test-server process with log capture, fixture sign-in by `inject`), so that the browser suite runs locally without external services. The demo suite (`node --test tests/*.test.mjs`) stays a separate job and is not edited.

## Scope (files)

- Root: `.github/workflows/ci.yml` (new), `scripts/check-links.mjs`, `scripts/check-frozen-source.mjs`, `scripts/*.test.mjs` (tests of the two scripts, run with `node --test scripts/*.test.mjs`).
- `rai-web/tests/browser/`: `playwright.config.ts` (readiness by port until W3-07a adds `/healthz`; axe report attached), `support/axe.ts`, `support/keyboard.ts`, `support/sign-in.ts`, `w1-12-harness.spec.ts`.
- `rai-web/tests/support/`: `process.ts` (spawn the one deployable in test mode, capture JSON log lines, wait for `process.started`, stop), `sign-in.ts` (fixture sign-in through `app.inject()` per W0-02 7.2).
- `rai-web/tests/integration/w1-12-harness.test.ts`.
- `TESTING.md` "Repository checks" (the scripts exist; the script tests), `changes/2026-09-21-w1-12/{plan,review}.md`.

Not touched: `docs/product/*` (frozen source, decisions), `docs/board/*`, DEVLOG, CHANGELOG, `demo/`, root `tests/`, `rai-web/server/src/*`, `rai-web/web/*`, `rai-web/fixtures/*`, `rai-web/package.json` scripts (every command already exists from W1-00), dependencies (none added).

## Tests first (Done when → test)

| Clause | Test |
|---|---|
| Every PR runs all checks and blocks merge on failure | `ci.yml`: one job per section-6 row, `on: pull_request` to `main` and `push` to `main`, no `continue-on-error`, plus an aggregate `required` job that fails when any check failed, was cancelled or skipped, so branch protection needs one required check. Branch protection itself is a repository setting outside an agent's authority; the review records the rule to enable. Proof on this PR: the run on the branch. |
| A deliberately altered source snapshot fails the hash check | `scripts/check-frozen-source.test.mjs`: the committed file passes; a copy with one byte changed exits 1 and names the file; a copy of `docs/sources.md` with the hash row removed exits 1 |
| Browser tests run locally without external services | `npm run test:browser` runs `tests/browser/w1-12-harness.spec.ts` against the test-mode API on loopback (fixture identity, in-memory mail sink, QC substitute, local Postgres) with Chromium: the API answers with the W0-06 envelope and headers; the axe helper reports a synthetic critical violation and passes a clean page; the keyboard helper sees a visible focus ring |
| Link check | `scripts/check-links.test.mjs`: a fixture tree with a broken relative link exits 1; the repository's own Markdown passes |
| Integration harness | `tests/integration/w1-12-harness.test.ts`: the spawned test server logs `process.started` with `identityMode: fixture`, `loopback: true`; answers `GET /api/anything` with the envelope; stops on `SIGTERM` with `process.stopping`; the inject sign-in helper fails loudly (`404`) while W1-01a's route is absent |

## Postgres for this ticket

`POSTGRES_PORT=54332 docker compose -p rai-w1-12 up -d --wait`; `DATABASE_URL` on 54332; `down -v` when finished.
