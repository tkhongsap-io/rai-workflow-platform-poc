# Review: W1-00 amendment — the W1-07 locale keys

2026-09-22. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-w1-07-locale-contract`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-w1-07-locale-contract`. Lane A. Plan recorded before code in [plan.md](plan.md). Human review remains authoritative; nothing here is merged or published.

## What landed

- `rai-web/shared/src/locales/th.json`, `en.json` — 88 keys, Thai first (D12), placeholders in `{name}` form for `t()`, added in alphabetical position: `case.*` (2), `cases.*` (20), `common.*` (10), `dialog.discard_confirm`, `field.*` (17), `model_type.*` (3), `new_case.*` (5), `next_action.*` (5, one per W0-06 section 4 status), `not_found.*` (2), `scope.*` (3), `shell.*` (12), `sign_in.*` (8). The rows `validation.subject_unresolvable` / `validation.unknown_field` swap places so the file stays sorted; no existing value changes; no key is removed. Both catalogues hold the same key set; the existing `locales.test.ts` parity and namespace checks pass; `keys.ts` widens the `LocaleKey` union from `th.json` with no edit.

Why a separate PR: PR #83 (W1-07, Lane B) carried these rows. Its review round 1 refused the touch on a Lane A module per the [working agreement](../../docs/delivery/team-and-roles.md) (a PR that touches another lane's module is refused unless it is a contract PR; W0-02 section 1.1 places `shared/src/` under Lane A, "contract PRs only; Lane B and C read"), as the W1-10 review had refused #69 a day earlier (the `qc.finding.*` keys then landed through #74). Same shape as #74: #83 is rebased on this branch and drops the two catalogue files; nothing else in it changes. The four keys #83 added but never read (`common.close`, `common.confirm`, `common.status`, `shell.session_status`) are dropped here per the same review, so the catalogue carries only keys a screen renders.

Not touched: anything outside the two catalogues and this record; no dependency, script, `.env.example`, `config.ts`, migration or schema change; the frozen source spec; `docs/product/decisions.md` (D07-D10 open); `docs/board`, DEVLOG, CHANGELOG.

## Commands run and results

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (Node 24.21.0, npm 11). Postgres: `POSTGRES_PORT=54320 docker compose -p rai-w1-00-w1-07-locale up -d --wait` from the worktree root, `.env` copied from `.env.example` (port 54320), `down -v` afterwards.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm ci` | installed from the committed lock file; no dependency change |
| `npm run typecheck` | `tsc -b` clean |
| `npm run lint` | eslint clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run test:unit` | tests 285, pass 285, fail 0 (unchanged count; the catalogue tests cover the new rows) |
| `npm run migrate` (port 54320) | `migrate: applied 4 migration(s), 0 already applied` |
| `npm run test:integration` (port 54320) | tests 103, pass 103, fail 0 (unchanged; this amendment adds no integration test) |
| `npm run build && npm run check:substitute-absent` | `check-substitute-absent: scanned 342 files, 0 with the marker` |
| `node --test tests/*.test.mjs` (repository root) | tests 22, pass 22, fail 0 (frozen-source hash unchanged) |
| `node scripts/check-links.mjs` (repository root) | 129 Markdown files, 665 relative links checked, 0 broken |
| `node scripts/check-frozen-source.mjs` (repository root) | hash matches `docs/sources.md` |
| `git diff --check` | clean |
| `docker compose -p rai-w1-00-w1-07-locale down -v` | removed |

## Notes for the lead

- The Thai and English strings are the ones #83 carried, unchanged; every key is read by a W1-07 screen or its spec (the four unread ones are gone).
- W1-06 (`/cases/:caseId`) and later Lane B tickets that need keys land them the same way: a W1-00 amendment contract PR first, unless the section 1.1 ownership table is amended to let Lane B tickets own their web keys.
- Merge order: this PR, then #83 (W1-07), whose base is this branch until it merges.
