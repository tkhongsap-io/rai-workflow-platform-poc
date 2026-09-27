# Review: backup command (W7-01, #207)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-01, sections 2, 3.1, 8, 10 and 14 (the plan wins over issue #207). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D5, W7-D6). D10 keeps the production backup target and schedule (working assumption: none). Synthetic data only; no external network call; nothing deployed.

## Change

- **`server/src/config.ts`**: `parseBackupConfig(env, { cwd?, repoRoot? })` → `{ pgTools, containerPort, backupDir }` and `REPO_ROOT`. `RAI_PG_TOOLS`: `path`, `docker:<name>`, `docker-compose:<name>` (name `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`); unset → `missing:RAI_PG_TOOLS`, anything else → `invalid:RAI_PG_TOOLS`; `docker-compose:*` refused under `NODE_ENV=production`. `RAI_PG_CONTAINER_PORT` optional, default 5432, 1-65535. `BACKUP_DIR` required, resolved against the working directory, `invalid:BACKUP_DIR` inside the repository unless strictly under `rai-web/.local/`. `parseConfig` does not read these keys (unit-tested).
- **`server/src/operator/pg-tools.ts`**: `connectionFromUrl`, `toolTarget` (path: URL host and port; docker modes: `127.0.0.1` and the container port, user and database kept), `resolvePgTools(config, { run? })` → `{ dump, restore, version }`. Docker modes run `docker exec [-i] -e PGPASSWORD <container> <tool> …`; `docker-compose:<p>` finds the one running container labelled `com.docker.compose.project=<p>`, `com.docker.compose.service=postgres` (cached). The password is only `PGPASSWORD` in the child environment; argv has `--host/--port/--username/--dbname/--no-password`, never a URL or password. Dump stdout streams to a new file (`wx`, 0600); restore reads stdin. Errors carry codes only (no argv, no stderr).
- **`server/src/operator/frozen-digest.ts`**: `FROZEN_TABLES`, `canonicalJson`, `frozenDigest(exec)`: SHA-256 over canonical JSON `{table: [to_jsonb rows in id order]}` for submitted `pack_version`, slots of submitted versions, `artifact`, `lane_decision`, `qc_run`, `qc_finding`, `disposition_event`, `audit_event`, published `configuration_revision`; refuses a session `TimeZone` other than UTC.
- **`server/src/operator/backup.ts`**: `runBackup(config, tools, now)` and `main(argv, env, write)`: connect as `rai_owner`; version check against `server_version_num` before anything is written; create `<BACKUP_DIR>/<id>` (0700, `backup_exists` if present); `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, `pg_export_snapshot()`, read journal (tags from the build's journal), table counts (public, session excluded), frozen digest, `fixture_set` rows and present blob hashes; `pg_dump --format=custom --no-owner --exclude-table-data=public.session --snapshot=<id>`; commit; copy blobs with hash and size checks; write `manifest.json` last (0600). Any failure after the directory exists removes it. One JSON line through `buildLogLine`; exit 0, 1, 64 (arguments) or 78 (configuration).
- **`server/src/observability/log.ts`**: `operator.backup.completed` (`backupId`, `blobCount`, `tableCount`, `durationMs`), `operator.backup.failed` (`stage`, `reason`).
- **`package.json`** script `backup`; **`.env.example`** `RAI_PG_TOOLS=docker-compose:rai-dev`, commented `RAI_PG_CONTAINER_PORT=5432`, `BACKUP_DIR=./.local/backups`.
- **`.github/workflows/ci.yml`** (lead-reviewed): one line in the integration job's test step env, `RAI_PG_TOOLS: docker:${{ job.services.postgres.id }}`.
- **`tests/support/fixture-app.ts`**: read-only `fixtureBlobDir()` accessor for the suite's private blob directory.
- **Docs** (dated): W0-10 section 3.3 rows plus a "W7-01 operator backup events" amendment; W0-02 section 3.3 `npm run backup` line and a section 5 "W7-01 amendment"; W0-04 "W7-01 backup recipe" (session data excluded); TESTING backup paragraph.
- **Tests**: `config.test.ts` (+6), `operator/pg-tools.test.ts` (10), `operator/frozen-digest.test.ts` (4), `operator/backup.test.ts` (6), `tests/integration/w7-01-backup.test.ts` (4: journeyed backup with manifest, digest, counts, journal, fixture set, blob re-hash, modes, dump listing without session data, second backup with same id refused; tool of another major writes nothing; missing blob fails and removes the partial directory; `npm run backup`'s entry file prints one completed line with no URL, password or path).

## Deviations

- **CI line placement.** The plan says "integration-job env line". The `job` context (`job.services.postgres.id`) is not available in `jobs.<id>.env`, only in step-level `env`, so the line is in the env of the step that runs `npm run test:integration`, beside `OBS_MIGRATION_ADMIN_URL`. Same effect: the job's value wins over the `.env` copied from `.env.example`.
- **Snapshot-consistent manifest.** Not in the plan's step list: the manifest's counts, journal, digest and blob list are read in the repeatable-read transaction whose exported snapshot `pg_dump --snapshot` uses, so a write during the backup cannot make the manifest disagree with the dump (which W7-02's `counts` and `frozen_digest` checks would report as a failed restore). Blobs are still copied after the dump, as the plan requires.
- **`docker-compose:<project>` container lookup** uses the compose labels through `docker ps` rather than `docker compose exec`, so it needs no compose file in the working directory and forwards `PGPASSWORD` exactly like `docker:*`.
- **`resolvePgTools` signature.** The plan writes `resolvePgTools(value)` → `{ dump(args, out), restore(args, in), version() }`; the implementation takes the parsed config (mode and container port) and `dump`/`restore` take the connection first, because the docker-mode target rewrite needs the container port and the URL. `restore(null, ['--list'], file)` lists an archive without connecting (used by the integration test; W7-02 restores with a connection).
- **Default label.** `--label` is optional in the plan's command; without it the ID is `<timestamp>-manual`. Labels are `^[a-z0-9][a-z0-9-]{0,39}$`; anything else exits 64 (`invalid_label`).
- **Exit codes.** 78 for configuration refusals (as other `ConfigError`s), 64 for bad arguments, 1 for a runtime failure.
- **`BUILD_COMMIT`** is optional for the command (`unrecorded` when unset); the server still requires it.
- **Frozen digest in UTC.** `to_jsonb` renders `timestamptz` in the session zone, so the digest refuses a non-UTC session and the backup sets `TimeZone = 'UTC'` on its connection.
- **Frozen digest and the W0-04 migration test.** The plan says the same function serves the W0-04 migration test; no existing migration test computes a frozen digest today, so none was rewired. W7-02 uses it for `frozen_digest`.
- **`BACKUP_DIR` rule is lexical.** A symlink inside `rai-web/.local/` pointing into the repository is not detected; `.local/` is gitignored, so nothing under it can be committed.

## Commands and results

Worktree `/tmp/rai-w7-01-backup-command-ci-rai`, Postgres project `rai-ops` on 55385, `rai-web/.env` from `.env.example` with ports rewritten (8841/8842/8843/5195), `OBS_MIGRATION_ADMIN_URL` for 55385, `RAI_PG_TOOLS=docker-compose:rai-ops`, `BACKUP_DIR=./.local/backups`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-01-backup-command-ci-rai-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/config.test.ts server/src/operator/pg-tools.test.ts server/src/operator/frozen-digest.test.ts server/src/operator/backup.test.ts` | all four files fail: `parseBackupConfig`/`REPO_ROOT` not exported, `pg-tools.js`, `frozen-digest.js`, `backup.js` not found |
| GREEN: same command plus `server/src/observability/log.test.ts` | 44/44 |
| `node … --test --test-concurrency=1 tests/integration/w7-01-backup.test.ts` | 4/4 (the file imports the new modules, so it could not load before them) |
| Mutation check: `--exclude-table-data=public.session` changed to `public.nothing`, first integration test rerun | fails (`session rows are excluded`); restored |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0; first run flagged two `no-unsafe-return` (untyped `client.query` rows) and a generator without `yield`, fixed |
| `npm run typecheck` | exit 0; first run flagged nullable `child.stdout`/`stderr`, fixed |
| `npm run test:unit` | exit 0, 673/673 |
| `npm run test:integration` | exit 0, 378/378, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 699 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 202 passed (8.5 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (31.3 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 373 Markdown files, 1071 relative links, 0 broken |
| `git diff --check` (repo root) | exit 0 |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow); the `.github/workflows/ci.yml` line is lead-reviewed. Ta reviews the W7 exit record.
