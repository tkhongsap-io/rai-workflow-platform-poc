# Review: restore and verify (W7-02, #216)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-02, sections 2, 3.2, 8, 10 and 14 (the plan wins over issue #216). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D6, W7-D7). D10 keeps the production backup target, host and admin credential (working assumption: none). Synthetic data only; no external network call; nothing deployed; no migration.

## Change

- **`server/src/config.ts`**: `RestoreConfig` and `parseRestoreConfig(env, where?)` = `parseBackupConfig` plus `adminUrl` from `DATABASE_ADMIN_URL` (required postgres URL: `missing:` / `invalid:DATABASE_ADMIN_URL`, exit 78). `parseConfig` does not read it (unit-tested: no refusal, never echoed).
- **`server/src/operator/restore.ts`**: `parseRestoreArgs` (`--from`, `--target-db`, `--blob-dir`, each once; shared with verify), `checkTargetName` (`^[a-z_][a-z0-9_]{0,62}$`), `refuseLiveTarget` (the database any of `DATABASE_URL` / `_MIGRATE_URL` / `_OPERATOR_URL` names), `databaseUrlFor`, `readBackupManifest` (shape check), `runRestore(config, tools, input)` and `main`. Order: target name, live target, manifest, dump SHA-256 against `dumpSha256` (all before connecting or creating anything); connect as admin; existing database or blob directory → `restore_target_exists`; tool major against `server_version_num`; `CREATE DATABASE "<name>" OWNER rai_owner`; in it `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO rai_app, rai_operator`; `pg_restore --no-owner --role=rai_owner --exit-on-error` over stdin (W7-01 `pg-tools.ts`, admin password only as `PGPASSWORD`); blob directory created 0700, every `blobs/sha256/..` file copied 0600 and re-hashed against its key (layout checked). Any failure after creation drops the database it created (`WITH (FORCE)`) and removes the blob directory it created, never a pre-existing one. One JSON line; exit 0, 1, 64, 78.
- **`server/src/operator/restore-verify.ts`**: `CHECK_IDS`, `DELETE_GRANT_EXCEPTIONS = ['configuration_draft']`, `verifyRestore({ adminUrl, targetDb, from, blobDir })` → `{ backupId, ok, checks }` and `main`. Connects with the admin URL pointed at the target, `TimeZone = UTC`. `journal`, `counts` (detail names the differing tables), `frozen_digest` (W7-01 `frozenDigest`), `manifest_hashes` (`versions/repository.ts` `readSlotsWithArtifacts` + `versions/manifest.ts` `manifestHash` for every submitted version with a stored hash; detail `checked N, mismatched M, unhashed K`), `blobs` (`store-verify.ts` `verifyStore` on the restored directory; referenced count must equal the manifest's), `a07_frozen_slot` (as `rai_app`, `UPDATE artifact_slot` of a submitted version must raise `rai.frozen_version`), `a11_audit` (`UPDATE` and `DELETE` of the first audit row: `42501` as `rai_app`, `rai.append_only` as `rai_owner`), `grants` (`has_table_privilege('rai_app', …, 'DELETE')` over public relations minus `configuration_draft`; detail names the others). Each probe is `BEGIN; SET LOCAL ROLE …; …; ROLLBACK`. A check that throws is reported failed with its SQLSTATE, never skipped. One JSON line (`warn` level when a check failed); exit 0 only when every check passes.
- **`server/src/observability/log.ts`**: `operator.restore.completed` (`backupId`, `durationMs`), `operator.restore.failed` (`stage`, `reason`), `operator.restore_verify.completed` (`backupId`, `ok`, `failedChecks`), `operator.restore_verify.failed` (`stage`, `reason`).
- **`package.json`** scripts `restore`, `restore:verify`; **`.env.example`** `DATABASE_ADMIN_URL=postgres://postgres:postgres-local@127.0.0.1:54320/postgres` with a comment.
- **`.github/workflows/ci.yml`** (lead-reviewed): one line in the integration step's env, `DATABASE_ADMIN_URL: postgres://postgres:postgres-local@127.0.0.1:54320/rai`, the value `OBS_MIGRATION_ADMIN_URL` carries.
- **Docs** (dated): W0-10 section 3.3 rows and "W7-02 operator restore events"; W0-02 section 3.3 script lines and section 5 "W7-02 amendment"; W0-04 "W7-02 restore recipe"; TESTING restore paragraph.
- **Tests**: `config.test.ts` (+2), `operator/restore.test.ts` (8), `operator/restore-verify.test.ts` (5), `tests/integration/w7-02-backup-restore.test.ts` (2):
  1. Journey on `fx-case-vendor` with the scripted substitute (submit v1; AI/COE lane QC and a waived finding; DPO send-back; resubmit v2; DPO lane QC and approve; AI/COE lane QC on v2) → `runBackup` → `restore.ts` and `restore-verify.ts` run as commands (one completed line each, `failedChecks: []`, no URL, password or path in stdout or stderr) → in-process verify: all eight checks pass in order, both versions' manifest hashes recomputed → source app reads unchanged → `startTestServer` on the restored database and blob directory: `GET` versions list, v1, v2, their findings and QC runs deep-equal the source app's responses taken before the backup; one artifact download has the slot's size and SHA-256 (also the backup blob's); `/readyz` 200 → an existing database target and an existing blob directory are refused with no database created; the live database name is refused; a dump with one flipped byte is refused (`dump_sha256_mismatch`) with no database or blob directory created.
  2. On a second restored copy, each tamper fails exactly its check and reverting it restores a full pass: flipped blob byte → `['blobs']`; audit `occurred_at` changed behind the triggers → `['frozen_digest']`; a stored `manifest_hash` changed → `['frozen_digest', 'manifest_hashes']` (`mismatched 1`); `artifact_slot` user triggers disabled → `['a07_frozen_slot']`; `audit_event` user triggers disabled → `['a11_audit']`; `GRANT DELETE ON lane_decision TO rai_app` → `['grants']`, detail names `lane_decision` and not `configuration_draft`, while `has_table_privilege('rai_app', 'configuration_draft', 'DELETE')` is true on the copy (W6-02's exception passes); an extra `fixture_set` row → `['counts']` naming the table.
  `after` stops the server, drops every `rai_restore_w702_*` database the file generated (name recorded before the restore runs) and removes its temporary directories; the lane database had no `rai_restore%` database left after the run.

## Deviations

- **`parseRestoreConfig` instead of `DATABASE_ADMIN_URL` in `parseBackupConfig`.** The plan's paths put the key in `parseBackupConfig`, but `npm run backup` does not need an admin credential; requiring it there would make every backup fail without one. `parseRestoreConfig` wraps `parseBackupConfig` and adds the required key, so `restore` and `restore:verify` share the backup keys' rules. Consequence: `restore:verify` also requires `BACKUP_DIR` and `RAI_PG_TOOLS` (the plan lists `RAI_PG_TOOLS` for it; `BACKUP_DIR` is harmless because `.env.example` sets it).
- **Admin URL helper reuse.** `tests/support/observability-database.ts` is reused unchanged: the integration test asserts that `DATABASE_ADMIN_URL` and `observabilityDatabaseConfig(env).adminUrl` name the same user, password, host and port (one admin credential, two names). The suite reads `DATABASE_ADMIN_URL` itself, so a missing value fails it rather than falling back, as the plan requires.
- **`grants` uses `has_table_privilege`, not `information_schema.role_table_grants`.** The plan names the view; `has_table_privilege` also sees a `DELETE` granted to `PUBLIC` or through an inherited role, which the view (filtered on `grantee = 'rai_app'`) would miss. The rule checked is the plan's: the set must be a subset of `{configuration_draft}`.
- **A07 and A11 on a database without evidence fail with `detail: no_rows`.** The plan does not say. A verifier that passes because there was nothing to probe would re-prove nothing; a restore rehearsal must carry a submitted version and an audit row (every backup of a used desk does).
- **`manifest_hashes` skips a submitted version whose `manifest_hash` is NULL** and counts it as `unhashed` in the detail. Such a version was frozen before the column was written; the frozen digest still covers it.
- **Event `operator.restore_verify.failed`** is added so that an argument, configuration, manifest or connection failure of the verifier also prints one line (plan section 8 lists only the completed event). The completed verify line is `warn` when a check failed.
- **Cleanup on failure.** Not in the plan: a failed restore drops the database and removes the blob directory it created (only those), so a retry with the same names works and no half-restored copy can be mistaken for a good one.
- **Target name rule.** `--target-db` must be a lowercase identifier (`^[a-z_][a-z0-9_]{0,62}$`, exit 64 `invalid_target_db`), so it is safe to quote and cannot address another object.
- **Journey "create".** The plan's journey starts with "create"; the test uses the fixture set's `fx-case-vendor` case (created by `fixtures:load` through the real loader) rather than creating and populating a new case over the API, since uploads and slot filling are covered elsewhere and add nothing to the restore proof. Every later step is a real HTTP transition.
- **Tampered dump.** "A tampered dump fails the named check" is met by the restore's dump-hash check (`dump_sha256_mismatch`, stage `manifest`), which refuses before anything is created. Evidence changed after a restore is covered by `frozen_digest`, `manifest_hashes` and `counts` in the second test.

## Commands and results

Worktree `/tmp/rai-w7-02-restore-and-verify`, Postgres project `rai-ops` on 55385 (`POSTGRES_PORT=55385 docker compose -p rai-ops up -d --wait`), `rai-web/.env` from `.env.example` with 54320 → 55385, `PORT=8841`, `PUBLIC_BASE_URL=http://127.0.0.1:8841`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8842`, `SUBSTITUTE_PORT=8843`, `SUBSTITUTE_WEB_PORT=5195`, `OBS_MIGRATION_ADMIN_URL=postgres://postgres:postgres-local@127.0.0.1:55385/rai`, `RAI_PG_TOOLS=docker-compose:rai-ops`, `DATABASE_ADMIN_URL=postgres://postgres:postgres-local@127.0.0.1:55385/postgres`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-02-restore-and-verify-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/config.test.ts server/src/operator/restore.test.ts server/src/operator/restore-verify.test.ts` | all three files fail to load: `parseRestoreConfig` not exported, `restore.js` and `restore-verify.js` not found |
| RED: `node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w7-02-backup-restore.test.ts` | fails to load: `operator/restore.ts` not found |
| GREEN: the unit command above plus `server/src/observability/log.test.ts` | 41/41 |
| GREEN: the integration file alone | 2/2 (first run: 2 failures in the test itself, a wrong decision literal `approved` for `approve` and the audit column `created_at` for `occurred_at`; fixed in the test) |
| Mutation: `grants` query changed to `AND false` (never sees a DELETE grant), integration file rerun | 1 of 2 fails (the stray `lane_decision` grant is not caught); restored |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (first run: three `no-unsafe-*` errors from a closure-captured `let server`, fixed with a local const) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 964/964 |
| `npm run test:integration` | exit 0, 415/415, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 855 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 205 passed (8.0 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (29.3 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 437 Markdown files, 1245 relative links, 0 broken |
| `git diff --check` (repo root) | exit 0 |

After rebasing onto `origin/main` at `a7f2619` (W6-13; conflicts only in the DEVLOG and CHANGELOG heads, both entries kept), the whole gate was rerun:

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 966/966 |
| `npm run test:integration` | exit 0, 421/421, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 867 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 205 passed (8.2 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (29.9 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 441 Markdown files, 1255 relative links, 0 broken |
| `git diff --check origin/main` (repo root) | exit 0 |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow); the `.github/workflows/ci.yml` line is lead-reviewed. Ta reviews the W7 exit record.
