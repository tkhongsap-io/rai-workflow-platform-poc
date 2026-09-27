# Intent: migration classes, `ahead` readiness, rollback check (W7-03, #208)

W7-00 needs an operator-run rollback of one deployment before any real case is loaded (BUILD_PLAN W7). Rolling back a build across a schema change is only safe when the older build can still run against the newer schema. W0-04 already says so ("if ahead by an additive migration, it serves") and asks every migration to carry a `rollback expectation` of `additive`, `restore-required` or `copy-forward`, but nothing enforces it: two merged headers (0007, 0009) say "forward repair only", the database does not record any class, and readiness answers `unknown` (not ready) for any applied migration the build does not know.

This ticket makes the rollback decision mechanical, under the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 3.3 and the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D8 classify and serve `ahead` when every newer migration is additive; W7-D9 0007 and 0009 `restore-required`):

- a class map in code for every migration, with a unit test that fails when a migration has no class or (from W7-03 on) no matching header;
- a `schema_migration_class` table, written by `npm run migrate`, so an older build can read the class of a newer migration it has never seen;
- readiness `store.migrations: ahead` (ready, served) when the database is ahead only by additive migrations, shown on the desk-health screen;
- `npm run release:check-rollback -- --target-migrations <folder>`, which answers `binary_only`, `restore_required` (with the first blocking migration and the matching backups) or `incompatible`.

Not here: restore and verify (W7-02), runbooks (W7-04), `subject_profile` (W7-06), the W7-13 rehearsal record. Synthetic data only; no external network call; nothing is deployed.
