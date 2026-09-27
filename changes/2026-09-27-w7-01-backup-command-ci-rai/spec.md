# Specification

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-01 (the plan wins over issue #207), sections 2, 3.1, 8, 10, 13 and 14.

Done when:

1. **`config.ts` `parseBackupConfig(env, { cwd?, repoRoot? })`** returns `{ pgTools, containerPort, backupDir }`; `parseConfig` does not read these keys.
   - `RAI_PG_TOOLS`: `path`, `docker:<container>`, `docker-compose:<project>`. Unset or blank → `missing:RAI_PG_TOOLS`; any other value (including an empty or malformed container or project name) → `invalid:RAI_PG_TOOLS`. `docker-compose:*` under `NODE_ENV=production` → `invalid:RAI_PG_TOOLS`. All are `ConfigError` (exit 78).
   - `RAI_PG_CONTAINER_PORT`: optional, default `5432`, integer 1-65535, otherwise `invalid:RAI_PG_CONTAINER_PORT`.
   - `BACKUP_DIR`: required (`missing:BACKUP_DIR`); resolved against the working directory; `invalid:BACKUP_DIR` when it resolves inside the Git worktree anywhere other than under `rai-web/.local/`.
2. **`operator/pg-tools.ts` `resolvePgTools(config, { run? })`** → `{ dump(conn, args, outPath), restore(conn | null, args, inPath), version() }`.
   - `path` mode runs `pg_dump`/`pg_restore` from `PATH` against the URL's host and port as given.
   - `docker:<c>` runs `docker exec -i -e PGPASSWORD <c> <tool> ...`; `docker-compose:<p>` first resolves the project's `postgres` service container (by compose labels) and then does the same. In both, the connection target is rewritten to host `127.0.0.1` and the container port; user and database are kept.
   - The password reaches the child only as `PGPASSWORD` in its environment; no argv element carries it or the URL. Dump output streams over stdout into the host file (created `wx`, mode 0600); restore input streams over stdin.
   - `version()` returns the tool's major version from `pg_dump --version`.
3. **`operator/frozen-digest.ts` `frozenDigest(exec)`**: SHA-256 over the canonical JSON (keys sorted, no whitespace) of the rows, ordered by `id`, of submitted `pack_version`, the `artifact_slot` rows of submitted versions, `artifact`, `lane_decision`, `qc_run`, `qc_finding`, `disposition_event`, `audit_event` and published `configuration_revision`. Refuses to run unless the session `TimeZone` is `UTC` (row timestamps are rendered by the server).
4. **`operator/backup.ts` `runBackup(config, tools, now)`** (plan 3.1 steps 1-5):
   1. refuses `pg_tools_version_mismatch` unless the tool major equals `SHOW server_version_num` major, before writing anything;
   2. creates `<BACKUP_DIR>/<id>` (0700; `<id>` = `YYYYMMDDTHHMMSSZ-<label>`), refusing an existing one (`backup_exists`);
   3. `pg_dump --format=custom --no-owner --exclude-table-data=public.session` as `rai_owner` (`DATABASE_MIGRATE_URL`) to `db.dump`, taken from a snapshot exported by a repeatable-read transaction in which the manifest's journal, table counts, frozen digest, fixture set and blob list are read, so the manifest describes exactly the dump;
   4. after the dump, copies every blob `artifact` references with `bytes_state = 'present'` into `<id>/blobs/sha256/<h[0:2]>/<h[2:4]>/<h>`, verifying hash and size while copying (`blob_missing`, `blob_hash_mismatch`, `blob_size_mismatch`);
   5. writes `manifest.json` `{ backupId, createdAt, buildCommit, journal: [{ tag, hash }], dumpSha256, blobs: { count, totalBytes }, tableCounts, frozenDigest, fixtureSet }` last; directories 0700, files 0600. A failure removes the partial backup directory.
5. **`npm run backup [-- --label <text>]`** (`tsx --conditions=rai-source`) prints exactly one JSON line through `buildLogLine`: `operator.backup.completed` (`backupId`, `blobCount`, `tableCount`, `durationMs`) and exit 0, or `operator.backup.failed` (`stage`, `reason`) and exit 78 for configuration refusals, 64 for invalid arguments, 1 otherwise. No URL, password, path, email or row content in the output. Both events are registered in `EVENT_CATALOGUE` and W0-10 section 3.3.
6. **`.env.example`**: `RAI_PG_TOOLS=docker-compose:rai-dev`, `BACKUP_DIR=./.local/backups` (and a `RAI_PG_CONTAINER_PORT` comment). `DATABASE_ADMIN_URL` and the `network` comment block are W7-02's and W7-07's.
7. **CI**: the integration job gains `RAI_PG_TOOLS: docker:${{ job.services.postgres.id }}` only (lead-reviewed).
8. **Tests.** Unit: `parseBackupConfig` table, `resolvePgTools` parse, docker-mode connection-target rewrite (host `127.0.0.1`, container port), argv carries no password (every mode), version refusal, `BACKUP_DIR` inside-repo refusal, `frozenDigest` canonical ordering, the command's JSON output. Integration (`tests/integration/w7-01-backup.test.ts`): after a journey (submit, approve, send back) on the fixture database, a backup writes dump, blobs and a manifest whose `frozenDigest` equals a direct computation, whose counts, journal and dump hash match, whose dump holds no session data, and whose blob copies re-hash; a tool of another major writes nothing; the command prints one completed line with no secret. A missing `RAI_PG_TOOLS` fails the test, never skips it.
9. **Docs**, dated amendments: W0-10 section 3.3 events (`observability-contract.md`); W0-02 section 5 keys and section 3.3 script (`implementation-plan-w1-w3.md`); W0-04 "Schema evolution" backup recipe with session data excluded (`persistence-and-artifact-store.md`); TESTING backup prerequisite.
10. Full plan section 10 gate green.
