# Review: W1-00 amendment — the W1-06 locale keys

2026-09-22. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-w1-06-locale-contract`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-w1-06-locale-contract`. Lane A. Plan recorded before code in [plan.md](plan.md). Human review remains authoritative; nothing here is merged or published.

## What landed

- `rai-web/shared/src/locales/th.json`, `en.json` — 103 keys, Thai first (D12), placeholders in `{name}` form for `t()`, added in alphabetical position: `action.*` (2), `case.*` (18), `error.field_list`, `lane.*` (3), `pack.*` (29), `projection.*` (3), `readiness.*` (2), `slot.*` (29), `stage.*` (3), `version.*` (13). No existing value changes; no key is removed. Both catalogues hold the same key set (259); the existing `locales.test.ts` parity and namespace checks pass; `keys.ts` widens the `LocaleKey` union from `th.json` with no edit. Every key is read by a W1-06 screen (`web/src/screens/case/`), the shared `ErrorNotice`, or the W1-06 spec; the keys that look unread in a plain-text search (`lane.*`, `projection.*`, `readiness.*`, `slot.help.*`, `slot.s1..s9.name`, `stage.*`) are composed from the API's enum values in `view-model.ts` and `case-overview.tsx`.

Why a separate PR: PR #82 (W1-06, Lane B) carried these rows. Its review round 1 refused the touch on a Lane A module per the [working agreement](../../docs/delivery/team-and-roles.md) (a PR that touches another lane's module is refused unless it is a contract PR; W0-02 section 1.1 places `shared/src/` under Lane A, "contract PRs only; Lane B and C read"), as the W1-07 review had refused #83 (the keys landed through #84) and the W1-10 review had refused #69 (#74). Same shape as #84: #82 is rebased on this branch and drops the two catalogue files; nothing else in it changes because of this PR.

`case.placeholder_body` and `case.placeholder_title` are kept: `main` still reads them (W1-07's `screens/cases/case-placeholder-screen.tsx` and its spec), so dropping them here would break the typecheck on `main`. W1-06 removes the placeholder screen; once #82 merges the two keys are unread and the next W1-00 amendment (or W1-INT) drops them.

Not touched: anything outside the two catalogues and this record; no dependency, script, `.env.example`, `config.ts`, migration or schema change; the frozen source spec; `docs/product/decisions.md` (D07-D10 open); `docs/board`, DEVLOG, CHANGELOG.

## Commands run and results

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (Node 24.21.0, npm 11). Postgres: `POSTGRES_PORT=54320 docker compose -p rai-w1-00-w1-06-locale up -d --wait` from the worktree root, `.env` copied from `.env.example` (port 54320, `NODE_ENV=test`, `RAI_IDENTITY_MODE=fixture`), `down -v` afterwards. Branch on `origin/main` at `de58182`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm ci` | installed from the committed lock file; no dependency change |
| `npm run typecheck` | `tsc -b` clean |
| `npm run lint` | eslint clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run test:unit` | tests 320, pass 320, fail 0 (unchanged count; the catalogue tests cover the new rows) |
| `npm run migrate` (port 54320) | `migrate: applied 4 migration(s), 0 already applied` |
| `npm run test:integration` (port 54320) | tests 122, pass 122, fail 0 (unchanged; this amendment adds no integration test) |
| `npm run build && npm run check:substitute-absent` | `check-substitute-absent: scanned 375 files, 0 with the marker` |
| `node --test tests/*.test.mjs` (repository root) | tests 22, pass 22, fail 0 (frozen-source hash unchanged) |
| `node scripts/check-links.mjs` (repository root) | 136 Markdown files, 671 relative links checked, 0 broken |
| `node scripts/check-frozen-source.mjs` (repository root) | hash matches `docs/sources.md` |
| `git diff --check` | clean |
| `POSTGRES_PORT=54320 docker compose -p rai-w1-00-w1-06-locale down -v` | removed |

## Notes for the lead

- The Thai and English strings are the ones #82 carried, unchanged.
- Merge order: this PR, then #82 (W1-06), whose base is this branch until it merges.
