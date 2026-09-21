# Plan: W1-00 amendment — the W1-06 locale keys

2026-09-22. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-w1-06-locale-contract`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-w1-06-locale-contract`. Lane A (`shared/src/`, contract PRs only). Written before code, per AGENTS.md.

## Intent

W0-02 section 10 makes `rai-web/shared/src/locales/{th,en}.json` the one catalogue every user-facing string reads from, and section 1.1 places `shared/src/` under Lane A, "contract PRs only; Lane B and C read". W1-06 (PR #82, Lane B) carried its 107 catalogue lines inside the ticket PR. Its review round 1 (after the integration onto W1-07) refused that touch on a Lane A module, exactly as the W1-07 review had refused #83 (the keys then landed through contract PR #84) and the W1-10 review had refused #69 (contract PR #74). This amendment lands the W1-06 keys as a contract PR so #82 can rebase on it and carry no `shared/` change.

## Scope (files)

- `rai-web/shared/src/locales/th.json`, `en.json` — 103 keys, Thai first (D12), one namespace per screen or concept, added in alphabetical position: `action.*` (2: the error notice's dismiss and reload), `case.*` (18: the overview's W0-04 fields, the three lane projections and readiness, status and next-action labels, the submission line), `error.field_list`, `lane.*` (3, the gating lanes of `LANE_MAPPING_V1`), `pack.*` (29: the nine-slot editor, its settings, save and submit), `projection.*` (3) and `readiness.*` (2, the W0-06 lane projection values), `slot.*` (29: the slot dialog, the state help, the nine slot names, the four states, the default-reason label), `stage.*` (3, D11 stage contexts), `version.*` (13: the version navigation and the frozen version). No existing value changes; no key removed. `case.placeholder_body` and `case.placeholder_title` stay because `main` still reads them (W1-07's placeholder screen and spec); W1-06 removes that screen, after which the two keys are unread until the next amendment drops them.
- `changes/2026-09-22-w1-00-w1-06-locale-contract/plan.md`, `review.md`.

Not touched: anything else. No dependency, script, config, migration or schema change; `keys.ts` derives the `LocaleKey` union from `th.json`, so the union widens by itself. The existing `locales.test.ts` parity and namespace checks cover both files. Decisions D07-D10 untouched; the frozen source spec untouched; no user-facing string is added anywhere but the catalogues.

## Checks to run afterwards

In `rai-web/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build && npm run check:substitute-absent`. `npm run test:integration` against Postgres on port 54320 (`docker compose -p rai-w1-00-w1-06-locale`) to show the merged suites still pass; this amendment adds no integration test. `node --test tests/*.test.mjs` and `node scripts/check-links.mjs` at the repository root. `git diff --check`.
