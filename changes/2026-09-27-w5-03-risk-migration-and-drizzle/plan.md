# Plan

1. Board CLAIM on Lane A; MIGRATION-SLOT claim (queued behind W4-11b, #201) on the lead-integration stream. Change frame (this folder).
2. RED (tests first, run and watched failing on the current schema):
   - `tests/integration/w5-03-risk-migration.test.ts` (spec item 3);
   - `tests/integration/w1-00-migrations.test.ts` lists and `tests/support/db.ts` `BUSINESS_TABLES` (spec item 4).
3. GREEN:
   - Drizzle schema files (spec item 2); `npm run migrate:generate` to produce `0010_*.sql`, the journal entry and the snapshot; rename the tag to `0010_w5_03_risk`; replace the SQL with the hand-written migration (spec item 1).
   - Apply with `npm run migrate`; rerun the new and changed tests.
4. W0-04 amendment (spec item 5).
5. Full gate, one suite at a time, logs under `/tmp/rai-w5-03-risk-migration-and-drizzle-logs/`; `npm run reset` with `COMPOSE_PROJECT_NAME=rai-risk`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #205").
