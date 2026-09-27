# Review: migration classes, `ahead` readiness, rollback check (W7-03, #208)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-03, sections 3.3, 4, 6, 7, 8 and 14 (the plan wins over issue #208). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D8, W7-D9). Synthetic data only; no external network call; nothing deployed.

## Change

- **`server/src/db/migration-classes.ts`**: `ROLLBACK_CLASSES`, `isRollbackClass`, `MIGRATION_CLASSES` (0000-0006, 0008 and 0011 `additive`; 0007, 0009 and W5-03's `0010_w5_03_risk` `restore-required`), `AHEAD_READINESS_TAG_SUFFIX`, `headerRollbackClass(sql)`, `MigrationClassError` (`migration_journal_mismatch`, `migration_class_missing`, `migration_class_changed`).
- **Migration `server/drizzle/0011_w7_03_migration_class.sql`** (generated from the new `db/schema/schema-migration-class.ts`, then completed by hand): `schema_migration_class (hash PK, tag UNIQUE, rollback_class CHECK the three, recorded_at)`, guard `rai_schema_migration_class_guard()` / trigger `schema_migration_class_guard` (`rai.append_only` on UPDATE or DELETE), `GRANT SELECT` to `rai_app` and `rai_operator`. Header `rollback expectation: additive;`. Journal and `0010_snapshot.json` from `drizzle-kit generate`.
- **`server/src/db/migrate.ts`**: `pairMigrationJournal`, `readMigrationJournal(folder)`, `recordMigrationClasses(client, folder, classes)`, called by `runMigrations` after the apply loop. Skips when `to_regclass('public.schema_migration_class')` is NULL; otherwise one transaction: `migration_class_missing` before any write, `INSERT … ON CONFLICT (hash) DO NOTHING` for every applied hash the journal names (back-fill included), then `migration_class_changed` if a stored class differs. `MigrateResult` unchanged.
- **Readiness**: `observability/probes.ts` `migrationStatus(expected, applied, classOf = () => undefined)` returns `ahead` when `expected` is a strict prefix of `applied` and every extra is `additive`; the store probe reads `schema_migration_class` for the extra hashes only when the journal is longer (a missing table means no classes, not `pending`). `observability/health.ts`: `bounded()` allows `ahead`; ready when migrations is `current` or `ahead`. `shared/src/schemas/observability.ts`: `store.migrations` gains `ahead`. `app.ts` unchanged (gate closes only on `pending`).
- **`server/src/operator/rollback-check.ts`** and script `release:check-rollback`: `rollbackVerdict` (with `aheadHash`: a target before W7-03 gets `restore_required`, `blockingReason: target_predates_ahead_readiness`, when the database has newer migrations), `aheadReadinessHash`, `parseRollbackArgs`, `findMatchingBackups`, `runRollbackCheck`, `main`. Compares the target folder's journal with the database's (`DATABASE_URL`, `rai_app`), classes and tags from `schema_migration_class`. Exit 0 / 3 / 4; 64 arguments, 78 configuration, 1 runtime. One JSON line.
- **`server/src/config.ts`**: `parseOptionalBackupDir` (the `BACKUP_DIR` rule of `parseBackupConfig`, factored into `resolveBackupDir`, which `parseBackupConfig` now also uses; behaviour unchanged).
- **`server/src/observability/log.ts`**: `operator.rollback_check.completed` (`verdict`, `extraMigrations`, `blockingMigration`, `blockingReason`, `matchingBackups`) and `operator.rollback_check.failed` (`stage`, `reason`).
- **UI**: `web/src/i18n/operator-labels.ts` `ahead`; `desk-health.view-model.ts` `migrationsDisplay`; `desk-health-sections.tsx` renders `ahead` as a `Badge` (tone `warn`, glyph) plus the note; `desk-health.css` `.operator-note`. Keys th and en: `operator.value.ahead`, `operator.field.migrations_ahead_note`.
- **Docs** (dated amendments): W0-04 "W7-03 migration classes"; W0-10 section 3.3 rows and "W7-03 readiness `ahead` and rollback-check events"; W0-02 section 3.3 script line.
- **Tests**: `db/migration-classes.test.ts` (5), `db/migrate.test.ts` (3), `probes.test.ts` (+1 table), `health.test.ts` (+1), `shared/.../observability.test.ts` (+1), `operator/rollback-check.test.ts` (9), `desk-health.view-model.test.ts` (+1); `tests/integration/w7-03-migration-classes.test.ts` (7) with `tests/support/migration-folder.ts` (`prefixMigrationFolder`, `extendedMigrationFolder`); `tests/integration/w1-00-migrations.test.ts` lists (table, trigger, `rai_app` and `rai_operator` SELECT); `tests/browser/w7-03-desk-health-ahead.spec.ts` (real built server, 3 widths). `tests/integration/w3-07a-migration-contract.test.ts` **unchanged** and green.

## Deviations

- **Migration slot: queued, not held (round 1).** W7 plan section 9.1 allows one migration-bearing PR in review across all packages, holding the `MIGRATION-SLOT` claim on `docs/board/lane-lead-integration.md`. W4-11b (#201, PR #282) holds it; W5-03 (#286) merged first with `0010_w5_03_risk`. This PR files a **queued** `MIGRATION-SLOT` claim (2026-09-27 21:41) and **must not merge while W4-11b holds the slot**. It has been rebased onto W5-03 and renumbered by hand to `0011_w7_03_migration_class` (hand-written SQL, guard, grants and class header kept; journal and `0011_snapshot.json` regenerated by `drizzle-kit generate`), with `MIGRATION_CLASSES` gaining `0010_w5_03_risk: restore-required` (its header) and the `w1-00-migrations` lists a union of both. Before merge it rebases again onto current `main`, renumbers by hand at the next free number and adds a `MIGRATION_CLASSES` entry for every migration merged first (W4-11b's: `additive`), then reruns the full gate.
- **Binary-only only to a build at or after W7-03 (round 1).** Round 1 found that a target journal from before W7-03 (for example W7-01) got `binary_only` when every newer migration was additive, although that build's readiness answers `unknown` for any longer journal. `rollbackVerdict` now takes `aheadHash` (the W7-03 migration's hash, found in this build's journal by its `_w7_03_migration_class` suffix): with extras and a target that lacks it, the verdict is `restore_required` naming the first extra, with the new event field `blockingReason: target_predates_ahead_readiness`; a non-additive extra is still reported first (`not_additive`), since no build can pass it without a restore. `blockingReason` is registered in W0-10 section 3.3. The round-0 integration expectation `binary_only` for the pre-W7-03 journal (`additivePrefix()`) was wrong against plan section 3.3 and the W0-04 amendment, so it now expects `restore_required` (exit 3) with the backup whose journal matches; the `binary_only`-with-extras case is proved instead against a synthetic newer release (this build's journal plus one additive migration), which also shows this build's readiness `ahead` on that database. Existing unit cases gained the fourth argument (`AHEAD = 'h0'`, carried by every target in them) and `blockingReason` in their expected objects; their verdicts are unchanged.

- **The rollback check reads the database, not the current build's folder.** Plan section 3.3 does not say what the target journal is compared with. It is compared with the database's applied journal and the classes recorded there, the same source the target build's readiness probe will read, so `binary_only` means that build's `/readyz` answers `ahead` (or `current`). The command therefore needs `DATABASE_URL` (read as `rai_app`, which has `SELECT` on both tables).
- **Extra event fields and a failed event.** Plan section 8 lists `verdict` and `extraMigrations`; section 3.3 requires the command to name the first non-additive migration and list the matching backups, so `blockingMigration` and `matchingBackups` (backup IDs, never paths) are registered too, plus `operator.rollback_check.failed` (`stage`, `reason`) for arguments, configuration, an unreadable target and an unreachable database.
- **`BACKUP_DIR` is optional for the rollback check** (it only names backups); when set, the `backup` rule applies. `RAI_PG_TOOLS` is not read.
- **`classOf` default.** `migrationStatus` takes `classOf` as an optional third argument (default: no class), so the existing unit test and every caller keep their meaning; the probe passes the database classes.
- **Header boundary by tag suffix.** The header rule applies from the migration whose tag ends in `_w7_03_migration_class`, not a fixed number, so a renumbering on rebase keeps the boundary.
- **0007 stays `restore-required`.** The plan lets a reviewer downgrade it. It is kept: 0007's deferred trigger `digest_requires_job` refuses an SLA digest notification without an `operator_job_notification` link, which a pre-W3-07a build never writes, so that build's digest job would fail.
- **Warning state.** The plan says "a warning state"; the existing `Badge` component (tone `warn`, glyph) is reused so the state is not colour-only.
- **Drizzle schema file.** Not named in the plan's paths: `db/schema/schema-migration-class.ts` is added so `migrate:generate` produced the migration and the snapshot stays in step with the database.
- **Lane environment.** `rai-web/.env` sets `RAI_PG_TOOLS=docker-compose:rai-ops` (the lane's compose project), as W7-01 did, so the W7-01 backup tests reach this lane's Postgres.

## Commands and results

Worktree `/tmp/rai-w7-03-migration-classes-ahead-readiness`, Postgres project `rai-ops` on 55385, `rai-web/.env` from `.env.example` with 54320 → 55385, `PORT=8841`, `PUBLIC_BASE_URL=http://127.0.0.1:8841`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8842`, `SUBSTITUTE_PORT=8843`, `SUBSTITUTE_WEB_PORT=5195`, `OBS_MIGRATION_ADMIN_URL` for 55385, `RAI_PG_TOOLS=docker-compose:rai-ops`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-03-migration-classes-ahead-readiness-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test` the seven unit files above | 7 failing (modules `migration-classes.js`, `rollback-check.js` not found; `migrationsDisplay` not exported; `ahead` unknown to `migrationStatus`, `computeReadiness` and the schema), 11 passing |
| RED: `node … --test --test-concurrency=1 tests/integration/w7-03-migration-classes.test.ts tests/integration/w1-00-migrations.test.ts` | 2 failing (module not found; schema lists) |
| GREEN: the same unit files plus `log.test.ts`, `locales.test.ts`, `config.test.ts` | 62/62 |
| GREEN: the two integration files plus `w3-07a-migration-contract.test.ts` and `w3-07a-operator-probes.test.ts` | 13/13, 0 skipped |
| Mutation: `migrationStatus` accepting any recorded class instead of only `additive` | unit table and the integration readiness test fail; restored |
| `npx drizzle-kit generate --config server/drizzle.config.ts --name w7_03_migration_class` | `0011_w7_03_migration_class.sql`, only the new table in the diff |
| `NODE_ENV=test RAI_IDENTITY_MODE=fixture npx playwright test -c tests/browser/playwright.config.ts w7-03-desk-health-ahead` | 3 passed |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (first run: one unused import in the new support file, fixed) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 731/731 |
| `npm run test:integration` | exit 0, 384/384, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 723 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 205 passed (7.9 min; 202 before plus the new spec at three widths) |
| `npm run test:browser:substitute` | exit 0, 48 passed (29.0 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 386 Markdown files, 1121 relative links, 0 broken |
| `git diff --check` (repo root) | exit 0 |
| **Round 2** (after `git rebase origin/main` onto `ca68342`, W5-03; fresh `rai-ops` database) | |
| RED: `node --import tsx --conditions=rai-source --test tests/integration/w7-03-migration-classes.test.ts` | 1 failing: the pre-W7-03 target got `code: 0`, `binary_only` (expected 3, `restore_required`, `target_predates_ahead_readiness`); unit file failed to compile (`rollbackVerdict` 3 arguments, `aheadReadinessHash` missing) |
| GREEN: `rollback-check.test.ts` and `w7-03-migration-classes.test.ts` | 16/16 (one intermediate failure fixed: a non-additive extra is now reported before `target_predates_ahead_readiness`) |
| `npx drizzle-kit generate --config server/drizzle.config.ts --name w7_03_migration_class` (after removing 0010) | `0011_w7_03_migration_class.sql` with only the new table; hand-written SQL restored, header renumbered |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 733/733 |
| `npm run test:integration` | exit 0, 390/390, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 727 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 205 passed (8.5 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (31.3 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 390 Markdown files, 1129 relative links, 0 broken |
| `git diff --check` (repo root) | exit 0 |

## Review verdicts

| Round | Head | Reviewer | Verdict | Problems |
|---|---|---|---|---|
| 1 | `8aaedb3` | two independent reviewer agents | changes requested | (1) contract: no `MIGRATION-SLOT` claim, held or queued, while #282 holds the slot and #286 queued on 0010; (2) correctness: `release:check-rollback` answered `binary_only` for a target journal before W7-03, whose readiness cannot answer `ahead`. Both fixed in round 2 (see Deviations). |

Deferred reviewer notes (round 1), not changed here:
- The append-only guard on `schema_migration_class` covers `UPDATE` and `DELETE`, not `TRUNCATE` by the owner. Only `rai_owner` could truncate, and the next `npm run migrate` back-fills the rows; left for the W7 hardening pass.
- The same tag recorded with a different hash makes `recordMigrationClasses` fail with a raw `unique_violation` on the tag constraint rather than a `MigrationClassError`. It still fails closed (the transaction writes nothing).
- Class recording runs after the per-file apply transactions; if it fails, the migrations stay applied without classes. That fails closed (readiness falls back from `ahead` to `unknown`); now documented by the round-2 integration test (`migration_class_missing`, then readiness `unknown`, then `ahead` once recorded).
- `recordMigrationClasses` takes `(client, folder, classes)` where the W7 plan says `(client, folder, migrations)`: harmless; kept.

Fixed from the polish notes: the top-level catch of `rollback-check.ts` reports stage `read` (not `config`) for an internal error; plan.md now names `parseOptionalBackupDir` / `resolveBackupDir`.

Pending: two independent reviewer verdicts on the round-2 head and green CI on that head (D03 ticket flow), and the `MIGRATION-SLOT` (queued behind W4-11b). Ta reviews the W7 exit record.
