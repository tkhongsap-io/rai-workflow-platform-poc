# Review: remove the unused `scopedCases` helper (W3-F6, #168)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 5 (Ta, 2026-09-26). No behaviour change.

## Change

- `rai-web/server/src/cases/scope.ts`: `scopedCases` deleted (it had no callers); the module comment now names `caseScopeWhere` as the predicate every list query uses. The `Executor` import went with it.
- W0-04 Interfaces, W0-05's query-scope paragraph and `performance-targets.md` now name `caseScopeWhere`; W0-04 says the helper and the lint rule it once promised were never used or added. Dated `changes/` records keep their history.
- `git grep scopedCases` outside dated records and the board finds only the lines that record its removal.

## Commands and results

Worktree `/tmp/rai-names`, Postgres `rai-names` on 55372, one suite at a time. A deletion with no callers has no failing test to write; the evidence is the unchanged suite.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 590/590 |
| `npm run test:integration` | 334/334, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `npm run test:browser:server` | 196 passed (8.5m) |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 0 broken |

## Reviewer verdicts

On the PR.
