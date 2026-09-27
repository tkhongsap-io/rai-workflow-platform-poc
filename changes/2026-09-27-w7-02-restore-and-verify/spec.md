# Specification

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-02 (the plan wins over issue #216), sections 2, 3.2, 8, 10, 13 and 14.

Done when:

1. **`config.ts` `parseRestoreConfig(env, where?)`** returns `parseBackupConfig`'s `{ pgTools, containerPort, backupDir }` plus `adminUrl` from `DATABASE_ADMIN_URL` (required: unset → `missing:DATABASE_ADMIN_URL`, not a postgres URL → `invalid:DATABASE_ADMIN_URL`; exit 78). `parseConfig` never reads the key and never echoes it.
2. **`operator/restore.ts` `runRestore(config, tools, input)`** (`input`: `from`, `targetDb`, `blobDir`):
   - `targetDb` must be a lowercase identifier (`^[a-z_][a-z0-9_]{0,62}$`, else `invalid_target_db`, exit 64);
   - refuses `restore_target_is_live` when `targetDb` equals the database named by `DATABASE_URL`, `DATABASE_MIGRATE_URL` or `DATABASE_OPERATOR_URL`;
   - refuses `restore_target_exists` when the database or the blob directory exists;
   - refuses `manifest_unreadable` when `manifest.json` is missing or malformed, and `dump_sha256_mismatch` when the SHA-256 of `db.dump` differs from the manifest's `dumpSha256`, before creating anything;
   - refuses `pg_tools_version_mismatch` unless the tool major equals the server's;
   - as `DATABASE_ADMIN_URL`: `CREATE DATABASE <name> OWNER rai_owner`; in it, `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO rai_app, rai_operator`; then `pg_restore --no-owner --role=rai_owner --exit-on-error` from the dump over stdin;
   - copies `<from>/blobs/` into `blobDir` in the W0-04 layout, re-hashing each file against its key (`blob_hash_mismatch`); directories 0700, files 0600;
   - a failure after the database or blob directory was created drops that database (`WITH (FORCE)`) and removes that directory: a failed restore leaves nothing behind. The live database and blob directory are never touched.
3. **`operator/restore-verify.ts` `verifyRestore(input)`** → `{ ok, checks: [{ id, ok, detail? }] }`, connecting with `DATABASE_ADMIN_URL` with the database name replaced by `targetDb`. Every role check runs in its own transaction after `SET LOCAL ROLE`, and every transaction is rolled back; nothing is written. Checks, in this order:
   - `journal`: `drizzle.__drizzle_migrations` hashes, in order, equal the manifest's journal;
   - `counts`: per-table row counts (every public table except `session`) equal `tableCounts`; `detail` names the differing tables;
   - `frozen_digest`: `frozenDigest` (UTC session) equals the manifest's;
   - `manifest_hashes`: for every submitted `pack_version` with a stored `manifest_hash`, `manifestHash` of its slot rows (`versions/repository.ts` `readSlotsWithArtifacts`) equals it; `detail` names the count of mismatches;
   - `blobs`: `verifyStore` on the restored blob directory reports no failure and the referenced count equals the manifest's `blobs.count`;
   - `a07_frozen_slot`: as `rai_app`, `UPDATE artifact_slot` of a submitted version fails with `rai.frozen_version`;
   - `a11_audit`: `UPDATE` and `DELETE` of an `audit_event` row fail with `42501` as `rai_app` and with `rai.append_only` as `rai_owner`;
   - `grants`: the public tables on which `rai_app` holds `DELETE` are a subset of `{configuration_draft}`; `detail` names any other table.
   The A07 and A11 probes need a submitted version and an audit row; on a database without one the check fails with `detail: no_rows` (a restore rehearsal must carry evidence to re-prove).
4. **Commands.** `npm run restore` and `npm run restore:verify` (`tsx --conditions=rai-source`) print exactly one JSON line through `buildLogLine`:
   - restore: `operator.restore.completed` (`backupId`, `durationMs`) or `operator.restore.failed` (`stage`, `reason`);
   - verify: `operator.restore_verify.completed` (`backupId`, `ok`, `failedChecks`: check ids only) or, when it cannot run, `operator.restore_verify.failed` (`stage`, `reason`).
   Exit 0 on success (verify: every check passes), 1 on a failed check or runtime failure, 64 on bad arguments, 78 on configuration refusal. No URL, password, path, email or row content in the output. All events are in `EVENT_CATALOGUE` and W0-10 section 3.3.
5. **`.env.example`**: `DATABASE_ADMIN_URL=postgres://postgres:postgres-local@127.0.0.1:54320/postgres` (the synthetic loopback credential of `docker-compose.yml`).
6. **CI**: the integration step gains `DATABASE_ADMIN_URL`, the value `OBS_MIGRATION_ADMIN_URL` already carries (lead-reviewed; disposable service container only).
7. **Tests.** Unit: `parseRestoreConfig` table and `parseConfig` ignoring `DATABASE_ADMIN_URL`; restore and verify argument parsing, target-name rule, live-target refusal, check-list shape and the commands' JSON lines for configuration and argument refusals. Integration (`tests/integration/w7-02-backup-restore.test.ts`): journey (submit v1, lane QC, disposition, send back, resubmit v2, lane QC and approve on v2) → backup → restore to a new database and blob dir → every check passes → the real server (`startTestServer`) on the restored copy serves v1 and v2, their findings and decisions exactly as the source app did, and a download whose SHA-256 equals the frozen slot's hash; a second restore to an existing target is refused; a tampered dump is refused before anything is created; on a second restored copy a tampered blob fails `blobs`, a tampered frozen row fails `frozen_digest`, a scratch `GRANT DELETE` on `lane_decision` fails `grants` (named) while `configuration_draft`'s `DELETE` passes; `restore:verify` prints one line with no secret. `after` stops the server, drops every `rai_restore_*` database the file created and removes its blob directories. A missing `RAI_PG_TOOLS` or `DATABASE_ADMIN_URL` fails the suite, never skips it.
8. **Docs**, dated amendments: W0-10 section 3.3 events; W0-02 section 5 key and section 3.3 scripts; W0-04 restore recipe; TESTING restore prerequisites.
9. Full plan section 10 gate green.
