# Plan: W1-00 amendment — the W1-07 locale keys

2026-09-22. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-w1-07-locale-contract`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-w1-07-locale-contract`. Lane A (`shared/src/`, contract PRs only). Written before code, per AGENTS.md.

## Intent

W0-02 section 10 makes `rai-web/shared/src/locales/{th,en}.json` the one catalogue every user-facing string reads from, and section 1.1 places `shared/src/` under Lane A, "contract PRs only; Lane B and C read". W1-07 (PR #83, Lane B) carried its 96 catalogue lines inside the ticket PR. Its review round 1 refused that touch on a Lane A module, exactly as the W1-10 review had refused PR #69 one day earlier (the `qc.finding.*` keys then landed through contract PR #74). This amendment lands the W1-07 keys as a contract PR so #83 can rebase on it and carry no `shared/` change.

## Scope (files)

- `rai-web/shared/src/locales/th.json`, `en.json` — 88 keys, Thai first (D12), one namespace per screen or concept: `case.*` (the `/cases/:caseId` placeholder that W1-06 replaces), `cases.*` (the scoped list), `common.*` (shared controls, loading, network error, correlation id, required marker), `dialog.discard_confirm`, `field.*` (new-case form fields and hints), `model_type.*`, `new_case.*`, `next_action.*` (one per case status, W0-06 section 4), `not_found.*`, `scope.*` (the three scope lines the list shows for the principal's grant), `shell.*` (skip link, locale switch, navigation, sign-out dialog, substitute banner), `sign_in.*`. The two rows `validation.subject_unresolvable` / `validation.unknown_field` swap places so the file stays alphabetical; no existing value changes. The four keys #83 added but never read (`common.close`, `common.confirm`, `common.status`, `shell.session_status`) are dropped, per the same review.
- `changes/2026-09-22-w1-00-w1-07-locale-contract/plan.md`, `review.md`.

Not touched: anything else. No dependency, script, config, migration or schema change; `keys.ts` derives the `LocaleKey` union from `th.json`, so the union widens by itself. The existing `locales.test.ts` parity and namespace checks cover both files. Decisions D07-D10 untouched; the frozen source spec untouched; no user-facing string is added anywhere but the catalogues.

## Checks to run afterwards

In `rai-web/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build && npm run check:substitute-absent`. `npm run test:integration` against Postgres on port 54320 (`docker compose -p rai-w1-00-w1-07-locale`) to show the merged suites still pass; this amendment adds no integration test. `node --test tests/*.test.mjs` and `node scripts/check-links.mjs` at the repository root. `git diff --check`.
