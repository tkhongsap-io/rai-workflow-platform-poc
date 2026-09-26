# Review: case-query scope guard test (W3-F8, #180)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 13 (Ta, 2026-09-26: build the guard rather than record it as never built). No product code changes.

## Change

- New `rai-web/server/src/cases/scope-guard.test.ts` (in `npm run test:unit`, no database). It resolves names with the TypeScript binder and lists every read of the `case` table under `rai-web/server/src`: builder `from`, joins and `$count`, relational `query.cases`, SQL literals that name the table, and escapes (table handed somewhere the guard cannot follow). A read passes only when every `where` on it is conjunctive in `caseScopeWhere(p)`, where `p` is a parameter of the calling code, or when it matches the allow-list (file + function + count + reason). Stale and over-count entries fail. The spec and the test header state the known limits.
- Allow-list (9 reads): `authz/facts.ts` `byCaseId`, `byArtifactId` (pre-authorization facts); `cases/repository.ts` `readCaseRow`, `caseViewFrom` (one case by id after `authorize`); `artifacts/pipeline.ts` `openDraftOf`; `db/transaction.ts` `lockCase` (`FOR UPDATE` by id); `notifications/service.ts` `loadCommittedCaseRequest`; `sla/breach.ts` `openReviewTargets` (operator digest); `operator/db-cleanup.ts` `main` (operator CLI). Scoped reads found: `listCases` (page and count) and `readQueue`. No actor-facing unscoped read exists.
- W0-05 "Query scope", second bullet, now describes the test that exists and names its file.
- Board claim, breakdown row W3-F8 and register item 13 are in the first commit.

## Adversarial check

After the first analyzer passed its self-tests, two adversary agents in isolated worktrees wrote leaking queries into actor-facing files and recorded which shapes passed the guard: `$count`, a table in a const or passed to a helper, re-exports, `sql.raw`, UNION, `or()` around the scope, shadowing, `$dynamic` re-`where`, and others. The owner re-ran each shape, then closed every realistic one with a synthetic self-test. The spec lists the shapes. Hand mutations in `queue/repository.ts` (an unscoped `.from(cases)`, `where(sql\`TRUE\`)` in place of the scope, `const t = cases; $count(t)`) each failed the test with file, line and function, and were reverted.

## Commands and results

Worktree `keen-sinoussi-cfb0d1`, Postgres `rai-w3-f8` on 54500, HTTP 18880/18881/15180, one suite at a time, Node 24.21.0.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 606/606 (the guard adds 14) |
| `npm run test:integration` | 334 pass, 1 skipped (the migration contract, which needs `OBS_MIGRATION_ADMIN_URL`) |
| the same contract test with `OBS_MIGRATION_ADMIN_URL` set to the 54500 database | 1/1 |
| `npm run build && npm run check:substitute-absent` | 611 files, 0 markers |
| `npm run test:browser:server` | 196 passed (8.3m) |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 323 files, 0 broken |

## Reviewer verdicts

On the PR.
