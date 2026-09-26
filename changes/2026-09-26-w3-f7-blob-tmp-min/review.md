# Review: `BLOB_TMP_MAX_AGE_HOURS` below 1 is refused (W3-F7, #169)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 7 (Ta, 2026-09-26). Synthetic data only.

## Change

- `server/src/config.ts` `parseRetentionConfig`: `BLOB_TMP_MAX_AGE_HOURS` minimum 1 (was 0). The server start-up (`parseConfig`) and `store:cleanup` both read it, so 0 fails with `invalid:BLOB_TMP_MAX_AGE_HOURS` before anything is opened.
- W0-02 section 5 (`implementation-plan-w1-w3.md`): "Integer ≥ 1". W0-04 (`persistence-and-artifact-store.md`, failed uploads): states the floor and the ruling, closing the question from the W3 hardening review (H11). `.env.example` is already `1`; unchanged.

## Commands and results

Worktree `/tmp/rai-f7`, Postgres `rai-f3` on 55373, one suite at a time.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `config.test.ts` and `operator/cleanup.test.ts` before the change | 2 failed: start-up accepted 0; `store:cleanup` did not reject 0 |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 592/592 |
| `npm run test:integration` | 334/334, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `node scripts/check-links.mjs` (root) | 0 broken |
| `git diff --check` | clean |

The browser suites were not run: the change is a server configuration bound and has no UI, route or API change. CI runs them on the reviewed head before merge.

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes |
|---|---|---|---|---|
| 1 | fcab548 | contract | PASS | Browser-suite statement added above. Deferred: "below 1" wording in W0-02, and a direct exit-code test for `store:cleanup` (the wrapper exits 1 on any thrown error). |
| 1 | fcab548 | correctness | PASS | Checked every consumer sets ≥ 1; reverting `min` fails both new tests. `db:cleanup` also refuses 0, since it reads the same retention config (fail closed; no caller passes 0). Deferred: 59/61-minute boundary files, a `startServer` exit case, a `-1` case. |
