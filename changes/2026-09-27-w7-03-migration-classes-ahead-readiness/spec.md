# Spec: migration classes, `ahead` readiness, rollback check (W7-03, #208)

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 3.3, section 4 (migration table), section 6 (`/readyz`, desk-health), section 7 (UI and keys), section 8 (event `operator.rollback_check.completed`), section 9 row W7-03, section 14 (W0-04 and W0-10 amendments). The plan wins over issue #208.

## Class map

- `server/src/db/migration-classes.ts`: `ROLLBACK_CLASSES = ['additive', 'restore-required', 'copy-forward']`, `MIGRATION_CLASSES: Readonly<Record<tag, RollbackClass>>`. Values (W7-D9): 0000-0006 and 0008 `additive`; 0007 and 0009 `restore-required`; W5-03's `0010_w5_03_risk` `restore-required` (its header; added at the rebase, 2026-09-27); the W7-03 migration `additive`.
- `headerRollbackClass(sql)`: the value of the first `-- rollback expectation: <value>;` line, or `undefined`.
- Unit test over `server/drizzle/`: every journal tag has an entry and every entry names a journal tag; every migration from W7-03's own (found by its `_w7_03_migration_class` tag suffix, so a renumbering on rebase does not move the boundary) has a header whose value is one of the three and equals its entry. Migrations before it keep their headers.

## Migration `0011_w7_03_migration_class`

`schema_migration_class (hash text PRIMARY KEY, tag text NOT NULL UNIQUE, rollback_class text NOT NULL CHECK (IN the three), recorded_at timestamptz NOT NULL DEFAULT now())`; `rai_schema_migration_class_guard()` raises `rai.append_only` on UPDATE or DELETE (trigger `schema_migration_class_guard`); `GRANT SELECT` to `rai_app` and `rai_operator`. Header `rollback expectation: additive;`. Drizzle schema file `db/schema/schema-migration-class.ts` so the snapshot matches.

## Writer

`db/migrate.ts`:
- `readMigrationJournal(folder)` → `{ tag, hash, folderMillis }[]`, pairing `readMigrationFiles` with `meta/_journal.json` entries by index; `pairMigrationJournal(files, entries)` is the pure pairing and throws `MigrationClassError('migration_journal_mismatch')` on a count mismatch.
- `recordMigrationClasses(client, folder, classes = MIGRATION_CLASSES)`, called by `runMigrations` after the apply loop: `to_regclass('public.schema_migration_class')` NULL → return. Otherwise, in one transaction, for every hash in `drizzle.__drizzle_migrations` that the folder's journal names: no entry → `migration_class_missing`; `INSERT … ON CONFLICT (hash) DO NOTHING`; a stored class that differs → `migration_class_changed`. `MigrateResult` is unchanged.

## Readiness

- `migrationStatus(expected, applied, classOf = () => undefined)` → `current | pending | ahead | unknown`. `ahead` iff `expected` is a strict prefix of `applied` and every extra hash has `classOf(hash) === 'additive'`; a hash with no class is not additive.
- `createStoreProbes(…).migrations()` reads `schema_migration_class` (by the extra hashes) only when the journal is ahead; a missing table counts as no classes. It never reads the in-code map.
- `ReadinessReportSchema.store.migrations` gains `ahead`; `computeReadiness` accepts it from the probe and `status` is `ready` when migrations is `current` or `ahead` (other gates unchanged). The `app.ts` business gate still closes only on `pending`.

## Rollback check

`npm run release:check-rollback -- --target-migrations <path to the target release's server/drizzle>` → `server/src/operator/rollback-check.ts`.
- Pure `rollbackVerdict(target, applied, classOf, aheadHash)`: `incompatible` when the target journal (hashes) is not a prefix of the applied journal; otherwise the extras are the applied migrations after the target's; `restore_required` with `blockingMigration` = the first non-additive extra and `blockingReason: not_additive` when there is one; else `restore_required` with `blockingMigration` = the first extra and `blockingReason: target_predates_ahead_readiness` when there are extras and the target journal lacks `aheadHash` (the W7-03 migration, found in this build's journal by its `_w7_03_migration_class` suffix); else `binary_only`.
- The command compares against the **database** (`DATABASE_URL`, `rai_app`): `drizzle.__drizzle_migrations` in order and `schema_migration_class` (tag and class by hash). The same source readiness uses, so `binary_only` means the target build's `/readyz` will answer `ahead` or `current`. A hash with no class row is named by the current build's journal tag or, failing that, its hash.
- `restore_required` also lists `matchingBackups`: backup IDs under `BACKUP_DIR` (optional here; same inside-repository rule as `backup`) whose `manifest.json` journal hashes equal the target's, newest first.
- One JSON line `operator.rollback_check.completed` (`verdict`, `extraMigrations` tags, `blockingMigration`, `blockingReason`, `matchingBackups`); exit 0 `binary_only`, 3 `restore_required`, 4 `incompatible`; `operator.rollback_check.failed` (`stage`, `reason`) with 64 (arguments), 78 (configuration) or 1 (runtime). No URL, password or path is printed.

## UI

Desk health: the migrations row renders `ahead` as a warning badge (`data-status="ahead"`, `data-tone="warn"`, glyph) with the label `operator.value.ahead` and the note `operator.field.migrations_ahead_note`. `operator-labels.ts` gains `ahead`. New th and en keys: `operator.value.ahead`, `operator.field.migrations_ahead_note`.

## Docs

W0-04 "Schema evolution": dated W7-03 amendment (class map, `schema_migration_class`, header rule, 0007/0009 classification). W0-10 section 5.3: `ahead`; section 3.3: the two operator events. W0-02 section 3.3: `npm run release:check-rollback`.

## Tests

- Unit: class map and header test; journal pairing; `migrationStatus` table (current, pending, ahead-additive, ahead-restore-required, ahead with no class row, divergent); `computeReadiness` `ahead` ready and bounded; schema accepts `ahead`; rollback verdicts on three synthetic journals; argument parsing; desk-health view model.
- Integration (`tests/integration/w7-03-migration-classes.test.ts`): back-fill and rerun idempotence; grants and guard; `migration_class_missing` / `migration_class_changed`; the writer skips on a scratch database without the table and back-fills when the W7-03 migration is applied; readiness `ahead` (ready) with a build folder one additive migration behind, `unknown` when a restore-required one is extra or the class rows are gone; the command's three verdicts and exit codes, with a matching backup listed. `w1-00-migrations.test.ts` lists gain the table, trigger and grants. `w3-07a-migration-contract.test.ts` unchanged and green.
- Browser (real server): desk-health shows `ahead` with the note, th and en, axe clean, at the three widths.

## Amendment (2026-09-27, review round 1)

- **Target before W7-03.** A build before W7-03 has no `ahead` state: its readiness answers `unknown` (not ready) for any journal longer than its own. `binary_only` is therefore given only when the target journal equals the database's or carries the W7-03 migration (W7 plan section 3.3; W0-04 amendment "Binary-only rollback is therefore possible only to a build at or after W7-03"). Otherwise, with extras that are all additive, the verdict is `restore_required` with `blockingReason: target_predates_ahead_readiness`. The new field `blockingReason` (`not_additive` / `target_predates_ahead_readiness`) is registered in W0-10 section 3.3.
- **Renumbered to 0011.** W5-03 (#286) merged `0010_w5_03_risk` first; this migration is regenerated by hand as `0011_w7_03_migration_class` (hand-written SQL kept; journal and snapshot regenerated), and `MIGRATION_CLASSES` gains `0010_w5_03_risk: restore-required` (its header). The PR holds a queued `MIGRATION-SLOT` claim behind W4-11b (#282).
