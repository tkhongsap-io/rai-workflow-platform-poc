# Plan

1. Board CLAIM (lane A stream). Change frame (this folder).
2. RED:
   - `server/src/db/migration-classes.test.ts`: class map covers the folder; header rule from W7-03 on.
   - `server/src/db/migrate.test.ts`: `pairMigrationJournal` pairing and `migration_journal_mismatch`; `readMigrationJournal` on the real folder (hash is SHA-256 of the file named by the tag).
   - `server/src/observability/probes.test.ts`: `migrationStatus` table with `classOf`.
   - `server/src/observability/health.test.ts`: `ahead` is ready and kept.
   - `shared/src/schemas/observability.test.ts`: `ahead` accepted.
   - `server/src/operator/rollback-check.test.ts`: three journals, argument parsing, one JSON line.
   - `web/src/screens/operator/desk-health.view-model.test.ts`: migrations display.
   - `tests/integration/w7-03-migration-classes.test.ts`, `tests/integration/w1-00-migrations.test.ts` lists.
   - `tests/browser/w7-03-desk-health-ahead.spec.ts`.
3. GREEN: `db/schema/schema-migration-class.ts`, `npm run migrate:generate` then hand-written guard, grants and header in `server/drizzle/0011_w7_03_migration_class.sql`; `db/migration-classes.ts`; `db/migrate.ts`; `observability/probes.ts`, `observability/health.ts`, `observability/log.ts`; `shared/src/schemas/observability.ts`; `config.ts` (`parseOptionalBackupDir`, `resolveBackupDir`); `operator/rollback-check.ts`; `package.json` script; `web/src/i18n/operator-labels.ts`, desk-health view and view model; locales.
4. Docs: W0-04, W0-10, W0-02.
5. Full gate one suite at a time, logs under `/tmp/rai-w7-03-migration-classes-ahead-readiness-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #208").

## Round 1 fixes (2026-09-27)

7. RED: `rollback-check.test.ts` cases for a target before W7-03 (`restore_required`, `target_predates_ahead_readiness`), a non-additive extra named first, and `aheadReadinessHash` on this build's journal; `w7-03-migration-classes.test.ts`: the pre-W7-03 target answers `restore_required` (exit 3) with its matching backup, and a synthetic newer release's additive migration rolls back `binary_only` to this build with readiness `ahead`.
8. GREEN: `rollbackVerdict(target, applied, classOf, aheadHash)`, `aheadReadinessHash`, `AHEAD_READINESS_TAG_SUFFIX`, event field `blockingReason`.
9. Rebase onto main (W5-03 merged `0010_w5_03_risk`): regenerate as `0011_w7_03_migration_class` by hand, add `0010_w5_03_risk: restore-required`, union the `w1-00-migrations` lists; queued `MIGRATION-SLOT` claim on `docs/board/lane-lead-integration.md`; full gate.
