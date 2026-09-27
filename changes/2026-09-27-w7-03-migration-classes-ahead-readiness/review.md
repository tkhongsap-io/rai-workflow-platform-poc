# Review: migration classes, `ahead` readiness, rollback check (W7-03, #208)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-03, sections 3.3, 4, 6, 7, 8 and 14 (the plan wins over issue #208). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D8, W7-D9). Synthetic data only; no external network call; nothing deployed.

## Change

- **`server/src/db/migration-classes.ts`**: `ROLLBACK_CLASSES`, `isRollbackClass`, `MIGRATION_CLASSES` (0000-0006, 0008 and 0010 `additive`; 0007 and 0009 `restore-required`), `headerRollbackClass(sql)`, `MigrationClassError` (`migration_journal_mismatch`, `migration_class_missing`, `migration_class_changed`).
- **Migration `server/drizzle/0011_w7_03_migration_class.sql`** (generated from the new `db/schema/schema-migration-class.ts`, then completed by hand): `schema_migration_class (hash PK, tag UNIQUE, rollback_class CHECK the three, recorded_at)`, guard `rai_schema_migration_class_guard()` / trigger `schema_migration_class_guard` (`rai.append_only` on UPDATE or DELETE), `GRANT SELECT` to `rai_app` and `rai_operator`. Header `rollback expectation: additive;`. Journal and `0010_snapshot.json` from `drizzle-kit generate`.
- **`server/src/db/migrate.ts`**: `pairMigrationJournal`, `readMigrationJournal(folder)`, `recordMigrationClasses(client, folder, classes)`, called by `runMigrations` after the apply loop. Skips when `to_regclass('public.schema_migration_class')` is NULL; otherwise one transaction: `migration_class_missing` before any write, `INSERT … ON CONFLICT (hash) DO NOTHING` for every applied hash the journal names (back-fill included), then `migration_class_changed` if a stored class differs. `MigrateResult` unchanged.
- **Readiness**: `observability/probes.ts` `migrationStatus(expected, applied, classOf = () => undefined)` returns `ahead` when `expected` is a strict prefix of `applied` and every extra is `additive`; the store probe reads `schema_migration_class` for the extra hashes only when the journal is longer (a missing table means no classes, not `pending`). `observability/health.ts`: `bounded()` allows `ahead`; ready when migrations is `current` or `ahead`. `shared/src/schemas/observability.ts`: `store.migrations` gains `ahead`. `app.ts` unchanged (gate closes only on `pending`).
- **`server/src/operator/rollback-check.ts`** and script `release:check-rollback`: `rollbackVerdict`, `parseRollbackArgs`, `findMatchingBackups`, `runRollbackCheck`, `main`. Compares the target folder's journal with the database's (`DATABASE_URL`, `rai_app`), classes and tags from `schema_migration_class`. Exit 0 / 3 / 4; 64 arguments, 78 configuration, 1 runtime. One JSON line.
- **`server/src/config.ts`**: `parseOptionalBackupDir` (the `BACKUP_DIR` rule of `parseBackupConfig`, factored into `resolveBackupDir`, which `parseBackupConfig` now also uses; behaviour unchanged).
- **`server/src/observability/log.ts`**: `operator.rollback_check.completed` (`verdict`, `extraMigrations`, `blockingMigration`, `matchingBackups`) and `operator.rollback_check.failed` (`stage`, `reason`).
- **UI**: `web/src/i18n/operator-labels.ts` `ahead`; `desk-health.view-model.ts` `migrationsDisplay`; `desk-health-sections.tsx` renders `ahead` as a `Badge` (tone `warn`, glyph) plus the note; `desk-health.css` `.operator-note`. Keys th and en: `operator.value.ahead`, `operator.field.migrations_ahead_note`.
- **Docs** (dated amendments): W0-04 "W7-03 migration classes"; W0-10 section 3.3 rows and "W7-03 readiness `ahead` and rollback-check events"; W0-02 section 3.3 script line.
- **Tests**: `db/migration-classes.test.ts` (5), `db/migrate.test.ts` (3), `probes.test.ts` (+1 table), `health.test.ts` (+1), `shared/.../observability.test.ts` (+1), `operator/rollback-check.test.ts` (7), `desk-health.view-model.test.ts` (+1); `tests/integration/w7-03-migration-classes.test.ts` (6) with `tests/support/migration-folder.ts`; `tests/integration/w1-00-migrations.test.ts` lists (table, trigger, `rai_app` and `rai_operator` SELECT); `tests/browser/w7-03-desk-health-ahead.spec.ts` (real built server, 3 widths). `tests/integration/w3-07a-migration-contract.test.ts` **unchanged** and green.

## Deviations

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

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow). Migration-bearing: it rebases onto current `main` before merge and takes the next free number by hand if `main` gains a migration first (renaming the `MIGRATION_CLASSES` key with the file; the header boundary follows the tag suffix). Ta reviews the W7 exit record.
