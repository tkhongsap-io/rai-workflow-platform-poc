# Review: W1-00 amendment — `shared/src/mail/dedup.ts`

2026-09-21. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-mail-dedup`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-mail-dedup`. Lane A. Plan recorded before code in [plan.md](plan.md). Human review remains authoritative; nothing here is merged or published.

## What landed

- `rai-web/shared/src/mail/dedup.ts` — `buildDedupKey(event, recipient)`, the function body of [W0-07 section 4.4](../../docs/engineering/qc-boundary-and-mail-sink.md#44-dedup-key) verbatim: `${NOTIFICATION_EVENT_BY_KIND[kind]}:${versionId | digestDay}:${lane ?? '-'}:${recipient.address}`; `RangeError('event.versionId' | 'event.digestDay')` for an incomplete identity, so no key ever contains `null`. Imports `./types.js` only.
- `rai-web/shared/src/mail/dedup.test.ts` — four `node:test` cases: the W0-04 `event` value (`lane_open`, not `lane_opened`); the address is the identity and `recipientId` is not; `'-'` lane for `ready_for_launch` and the digest with the day from `event.digestDay` only; `RangeError` naming the field for `versionId = null`, `versionId = ''` and `digestDay = null`.

Why a separate PR: W0-07 section 9 assigns this file to W1-00, which shipped `mail/types.ts` only. PR #68 (W1-11, Lane C) carried it; review round 1 refused the touch on a Lane A module per the [working agreement](../../docs/delivery/team-and-roles.md) (a shared-contract change is its own PR, merged before any consumer PR). #68 is rebased on this branch and drops the file; the W1-11 4.8 dedup-key row keeps asserting on it from `fixtures/`.

Not touched: dependencies, scripts, `.env.example`, `config.ts`, migrations, the frozen source spec, `docs/product/decisions.md` (D07-D10 open), `docs/board`, DEVLOG, CHANGELOG.

## Commands run and results

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (Node 24.21.0, npm 11). Postgres: `POSTGRES_PORT=54320 docker compose -p rai-w1-00 up -d --wait`, `DATABASE_URL` / `DATABASE_MIGRATE_URL` / `DATABASE_OPERATOR_URL` on port 54320, `down -v` afterwards.

| Command (from `rai-web/`) | Result |
|---|---|
| `npm ci` | installed from the committed lock file; no dependency change |
| `npm run typecheck` | `tsc -b` clean |
| `npm run lint` | eslint clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run test:unit` | tests 62, pass 62, fail 0 (58 from W1-00 + 4 in `dedup.test.ts`) |
| `npm run migrate` (port 54320) | `migrate: applied 1 migration(s), 0 already applied` |
| `npm run test:integration` (port 54320) | tests 14, pass 14, fail 0 (the W1-00 suite; this amendment adds no integration test) |
| `npm run build && npm run check:substitute-absent` | `check-substitute-absent: scanned 138 files, 0 with the marker` |
| `npm run test:browser` | not run: no spec exists yet under `tests/browser/` |
| `docker compose -p rai-w1-00 down -v` | removed |

## Notes for the lead

- The file is the spec text; the only addition is the header comment naming this amendment. If W3-03's contract PR changes the digest identity (W0-07 section 10), that PR amends this file.
- Merge order: this PR, then #68 (W1-11), whose base is this branch until it merges.
