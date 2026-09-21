# Plan: W1-00 amendment — `shared/src/mail/dedup.ts`

2026-09-21. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-mail-dedup`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-mail-dedup`. Lane A (`shared/`, contract PRs only). Written before code, per AGENTS.md.

## Intent

W0-07 section 9 assigns `rai-web/shared/src/mail/dedup.ts` (`buildDedupKey`, section 4.4) to W1-00. W1-00 (#67) shipped `mail/types.ts` only. PR #68 (W1-11, Lane C) added the file; its review refused the touch on a Lane A module (team-and-roles: a change to a shared contract is its own PR and merges before any consumer PR). This amendment lands the one file as a contract PR so #68 can rebase on it with no other change.

## Scope (files)

- `rai-web/shared/src/mail/dedup.ts` — `buildDedupKey`, the function body of W0-07 section 4.4 verbatim; no design choice.
- `rai-web/shared/src/mail/dedup.test.ts` — colocated unit test so the amendment verifies on its own (W0-04 `event` value, address not `recipientId`, `'-'` lane, `digestDay` only, `RangeError` naming the field). The full 4.8 row stays with W1-11.
- `changes/2026-09-21-w1-00-mail-dedup/plan.md`, `review.md`.

Not touched: anything else. No dependency, script, config or migration change. Decisions D07-D10 untouched; the frozen source spec untouched.

## Checks to run afterwards

In `rai-web/`: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build && npm run check:substitute-absent`. `npm run test:integration` against Postgres on port 54320 (`docker compose -p rai-w1-00`) to show the W1-00 suite still passes; this amendment adds no integration test.
