# Deployment-readiness note (W7-16)

**Status:** written 2026-09-28 for ticket W7-16 (issue [#234](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/234)) from the [W7 plan](implementation-plan-w7.md) section 12. **Nothing is deployed.** No host account exists, no non-loopback bind has been made by any agent, test or CI job (W7-D2), and nothing in this note authorizes one.

**Owners:** D10 (IT/Security and the accountable owner) decides the host, the backup target, secret custody and the incident channels. This note chooses none of them; it states what any host must provide and what the desk refuses without. Where it gives a production value it is the value the code accepts today on synthetic data, not a D10 decision. Production release stays gated (W8, D10); real data stays gated (D08).

**Held to the code:** `rai-web/server/src/deployment-readiness.test.ts` (unit suite) fails when the table in [section 3.1](#31-keys-the-code-reads) and the keys non-test code under `rai-web/server/src` reads drift apart in either direction, when a [planned key](#32-planned-keys-not-read-yet) starts being read, when a `.env.example` key is in neither the table nor the [local-only list](#33-local-only-keys), or when the production values below stop passing the server's own start-up parse.

## Contents

1. [Shape of a deployment](#1-shape-of-a-deployment)
2. [Build and start](#2-build-and-start)
3. [Configuration](#3-configuration)
4. [Database](#4-database)
5. [Blob storage](#5-blob-storage)
6. [Secrets](#6-secrets)
7. [Health](#7-health)
8. [Operations](#8-operations)
9. [Known limits](#9-known-limits)
10. [Host checklist](#10-host-checklist)
11. [Worked example: Replit](#11-worked-example-replit)
12. [Not yet on main](#12-not-yet-on-main)

## 1. Shape of a deployment

- **One Node 24 process** (`engines: >=24 <25`) running `node server/dist/main.js` from `rai-web/`. It serves the API and the built single-page app (`web/dist`) on one port ([ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) B1). Exactly one instance: see [known limits](#9-known-limits).
- **One Postgres 16 database** reached over the network, with three login roles (section 4). Local development and CI use `postgres:16.15-alpine`.
- **One persistent directory tree** for uploaded documents (`BLOB_DIR`) and the mail file drop (`MAIL_SINK_DIR`), plus a separate location for backups (`BACKUP_DIR`).
- **A TLS-terminating proxy** in front of the process (the platform's router or a reverse proxy). The process speaks plain HTTP behind it; `PUBLIC_BASE_URL` is the proxy's `https` address.
- **Identity** `network` mode with the `allow-list` source (W7-D3): people sign in through one configured OIDC issuer and get only the roles the allow-list names. `production` mode (Entra, True AD) is W8.
- **No outbound mail, no model provider, no telemetry.** Notices are written as files (`MAIL_MODE=sink-file`); QC runs in process.

## 2. Build and start

Run from `rai-web/`. The build and the release step happen once per release; the start command is what the platform runs and restarts.

| Step | Command | Notes |
|---|---|---|
| Install | `npm ci --include=dev` | The build needs TypeScript and Vite, and the operator commands (`migrate`, `backup`, `restore`, `db:cleanup` and the rest) run through `tsx`: all are devDependencies. A host that sets `NODE_ENV=production` during install would otherwise omit them and the build fails. |
| Build | `npm run build` | Builds `shared`, `web` (to `web/dist`) and `server` (to `server/dist`). `npm run check:substitute-absent` must print `0 with the marker`. |
| Remove the fixtures package | `rm -rf node_modules/@rai/fixtures` | **Required.** A workspace install links `@rai/fixtures`, but `npm run build` does not build it, so the built server finds the package without its `dist/` and refuses to start with `process.refused` `fixtures_import_failed` (exit 78; reproduced for this note on a loopback test start). With the link removed the server starts as a production install: no fixture identities, no fixture business units, no scripted QC substitute (`start.test.ts`, "an absent fixtures package"). If `fixtures/dist` exists (for example after `npm run typecheck`, which emits it), the server would instead start with the synthetic fixture business units: removing the link covers both cases. Nothing else in the release reads the package. |
| Migrate (release step) | `npm run migrate` | Applies pending forward-only migrations as `rai_owner` through `DATABASE_MIGRATE_URL`, one transaction per file, and records each migration's rollback class. Idempotent. Run it **before** starting the new build and **never at start**: `main.ts` never migrates (W0-04). Take a backup first (section 8). |
| Start | `npm start` (`node server/dist/main.js`) | Reads the environment (and `rai-web/.env` when present, never overriding a variable already set). With `NODE_ENV=production` it refuses `missing:web/dist` when the SPA build is absent. Every misconfiguration is exit 78 with one `process.refused` JSON line naming a reason code, never a value. |
| Stop | `SIGTERM` | Drains in-flight requests for up to 10 s, then exits 0; a hard exit (1) follows 5 s later if the close does not complete. |

The working directory must be `rai-web/`: `.env`, relative `BLOB_DIR`, `MAIL_SINK_DIR` and `BACKUP_DIR` values resolve against it. Use absolute paths on a host.

## 3. Configuration

`rai-web/server/src/config.ts` is the only reader of the process environment. It parses every key at start and refuses a missing or invalid one (`missing:<KEY>`, `invalid:<KEY>`); nothing falls back to a default. The identity keys (`RAI_IDENTITY_*`, `RAI_SECRET_*`, `RAI_SESSION_*`) are handed to the identity adapter, which applies the W0-03 section 5 rows (S1-S18). `rai-web/.env.example` is the local sample and is never the source of a host value.

In the table, **Production value** is either a literal the code accepts for this deployment shape, or where the value comes from: `host` (the platform or the operator chooses it), `custody` (a secret from the host's secret store, section 6; D10 decides the mechanism), `release` (set by the release process) or `unset` (must not be set on this host). **Read by**: `server` is `npm start`; `commands` are the operator commands of section 8.

### 3.1 Keys the code reads

| Key | Read by | Production value | Source | Notes |
|---|---|---|---|---|
| `NODE_ENV` | server, commands | `production` | literal | `production` refuses `LOG_PRETTY=true`, `QC_MODE=substitute`, `RAI_PG_TOOLS=docker-compose:*`, a missing `web/dist` and the test seams. |
| `HOST` | server | `0.0.0.0` | literal | Non-loopback is accepted only in `network` and `production` modes; `fixture` and `local-google` refuse it (`bind_not_loopback`). The first non-loopback bind is an operator act on a closed host after D10 (W7-D2). |
| `PORT` | server | host | platform | The port the platform routes to (1-65535). |
| `PUBLIC_BASE_URL` | server | host | platform | The public `https` origin the proxy serves, for example `https://rai-desk.example.org`. `network` refuses a non-`https` URL (`base_url_not_https`, S17), because the session cookie is then `Secure` with the `__Host-` prefix. Mail links are built from it. |
| `TRUST_PROXY` | server | `true` | literal | Behind the platform's TLS proxy, so the client address and protocol come from the forwarded headers. `local-google` refuses `true` (S5). |
| `DATABASE_URL` | server, `release:check-rollback` | custody | secret store | `postgres://rai_app:…@<host>:5432/<db>`; the runtime role (section 4). Add the TLS parameters the managed service requires (for example `?sslmode=require`). |
| `DATABASE_MIGRATE_URL` | `migrate`, `backup`, `restore`; parsed by the server | custody | secret store | `rai_owner`; the only connection that runs DDL. The server parses it but never connects with it. |
| `DATABASE_OPERATOR_URL` | `db:cleanup`, `store:verify` | custody | secret store | `rai_operator`. When empty it falls back to `DATABASE_MIGRATE_URL`, which is acceptable only locally: set it on a host. |
| `DATABASE_ADMIN_URL` | `restore`, `restore:verify` | custody | secret store | A role with `CREATEDB` that can `SET ROLE` to `rai_app` and `rai_owner`. Only the restore commands read it; give it to the operator's shell, not the server's environment. |
| `BLOB_DIR` | server, `backup`, `store:*`, `db:cleanup` | host | persistent volume | Absolute path on a persistent volume (section 5). Created 0700; `tmp/` is emptied at start. |
| `UPLOAD_MAX_FILE_BYTES` | server | `26214400` | literal | W0-08 section 3 default (25 MiB); raising it is a D08 change. |
| `UPLOAD_MAX_PACK_BYTES` | server | `157286400` | literal | W0-08 default (150 MiB per pack). The proxy's request-body limit must be at least this. |
| `UPLOAD_MAX_IMAGE_PIXELS` | server | `40000000` | literal | W0-08 default. |
| `IDEMPOTENCY_TTL_HOURS` | server, `db:cleanup` | `72` | literal | W0-04 retention; D08 revisits. |
| `BLOB_ORPHAN_MIN_AGE_HOURS` | server | `24` | literal | Orphan blobs are reported only; deletion waits for D08. |
| `BLOB_TMP_MAX_AGE_HOURS` | server, `store:cleanup` | `1` | literal | Never below one hour. |
| `RAI_IDENTITY_MODE` | server | `network` | literal | `fixture` is test-only (S13); `local-google` is loopback-only; `production` is W8. |
| `RAI_IDENTITY_NETWORK_SOURCE` | server | `allow-list` | literal | W7-D3. `ad` parses but is not rehearsed; it needs D10 tenant and group values. |
| `RAI_IDENTITY_OIDC_ISSUER_URL` | server | custody | secret store | The OIDC issuer the allow-list source trusts; discovered at start (`discovery_failed` refuses). A Google issuer is permitted only on a non-True URL (source-spec non-goal), checked by hand (W0-03 section 2). |
| `RAI_IDENTITY_OIDC_CLIENT_ID` | server | custody | secret store | The client registered at that issuer, with redirect URI `<PUBLIC_BASE_URL>/auth/callback` as W0-03 section 7 names it. |
| `RAI_IDENTITY_OIDC_CLIENT_SECRET` | server | custody | secret store | As above. |
| `RAI_IDENTITY_ALLOW_LIST_JSON` | server | custody | secret store | `{ "version": 1, "entries": [{ "email", "roles": [{ "role", "scope" }] }] }` (W0-03 section 4.2); invalid JSON or schema refuses (`allow_list_invalid`, S8). A change takes effect at each person's next sign-in, after a restart that re-reads it. Its business units become the desk's configured units (W7-07). |
| `RAI_IDENTITY_GOOGLE_CLIENT_ID` | server | unset | — | `local-google` only (loopback development login). |
| `RAI_IDENTITY_GOOGLE_CLIENT_SECRET` | server | unset | — | As above. |
| `RAI_IDENTITY_LOCAL_ROLE_MAP` | server | unset | — | `local-google` only. |
| `RAI_IDENTITY_ENTRA_TENANT_ID` | server | unset | — | `network`/`ad` and `production` (W8). |
| `RAI_SECRET_SOURCE` | server | `env` | literal | `env`: secrets arrive as environment variables from the host's secret store. `file` reads one file per secret under `RAI_SECRET_DIR` instead (W7-D4, both implemented). |
| `RAI_SECRET_DIR` | server | unset | — | Only with `RAI_SECRET_SOURCE=file` (default `/run/secrets`). |
| `RAI_SESSION_ABSOLUTE_HOURS` | server | `12` | literal | 1-24. |
| `RAI_SESSION_IDLE_MINUTES` | server | `120` | literal | 5-720. |
| `MAIL_MODE` | server | `sink-file` | literal | In `network` mode binds the in-product file drop at `MAIL_SINK_DIR` (W7-07): nothing is sent. `sink-memory` binds nothing there and readiness answers 503. No transport value exists. |
| `MAIL_SINK_DIR` | server | host | persistent volume | Absolute path on the same persistent volume as `BLOB_DIR`; files 0600 in a 0700 directory. Readiness needs it writable. |
| `QC_MODE` | server | `deterministic` | literal | The W4a metadata runner, in process. `substitute` is refused under `production` or `network`. `content` arrives with W4-13b ([section 12](#12-not-yet-on-main)). |
| `LOG_LEVEL` | server | `info` | literal | `debug`, `info`, `warn`, `error`. |
| `LOG_PRETTY` | server | `false` | literal | Refused as `true` under `production` (`log_pretty_in_production`). Logs are one JSON object per line on stdout (W0-10). |
| `BUILD_COMMIT` | server, `backup` | release | release process | The released Git commit, 7-40 hex characters; readiness shows `dev` for anything else. Recorded in every backup manifest. |
| `RAI_PG_TOOLS` | `backup`, `restore`, `restore:verify` | `path` | literal | `pg_dump` and `pg_restore` of the server's major version on `PATH`. `docker:<container>` is for CI; `docker-compose:<project>` is refused under `production`. |
| `RAI_PG_CONTAINER_PORT` | `backup`, `restore` | unset | — | Docker modes only. |
| `BACKUP_DIR` | `backup`, `restore`, `release:check-rollback` | host | backup target | An absolute path the operator's shell can write, refused inside the Git worktree outside `rai-web/.local/`. D10 decides the backup target; a copy must leave the host (section 8). |

### 3.2 Planned keys (not read yet)

These keys are specified by the [W4b plan](implementation-plan-w4b.md) section 2 for `QC_MODE=content` and arrive with W4-13b. The code does not read them today, so a host must not rely on them; when they land, they move into the table above (the unit test fails until they do).

- `QC_MODEL`: `disabled` on a host (`local-fake` is test-only; no provider value exists, WA-D08).
- `QC_EXTRACT_TIMEOUT_MS`: 500-9000, below the 10 000 ms QC deadline.
- `QC_EXTRACT_MAX_MEMORY_MB`: 64-512, the extraction worker's heap.
- `QC_EXTRACT_MAX_TEXT_CHARS`: 1000-2 000 000.
- `QC_EXTRACT_MAX_CONCURRENCY`: 1-4 worker processes; size it to the host's CPU and memory.

### 3.3 Local-only keys

These appear in `rai-web/.env.example` or the test harness and are never set on a host.

- `POSTGRES_PORT`: the loopback port of the local Compose Postgres.
- `COMPOSE_PROJECT_NAME`: the local Compose project for `db:up` and `db:down`.
- `PLAYWRIGHT_BASE_URL`: the real-server browser suite.
- `SUBSTITUTE_PORT`: the W1-13 API substitute (browser development only).
- `SUBSTITUTE_WEB_PORT`: the Vite server of the substitute suite.
- `OBS_MIGRATION_ADMIN_URL`: an integration-test admin connection.
- `REHEARSAL_OUT_DIR`: rehearsal outputs under `rai-web/.local/` (W7-10).

## 4. Database

The desk needs the three W0-04 roles and the grants of [`docker/postgres/init/001-roles.sql`](../../docker/postgres/init/001-roles.sql), created once by an administrator before the first `npm run migrate`:

| Role | Used by | May |
|---|---|---|
| `rai_owner` | `DATABASE_MIGRATE_URL` | Owns the database and schema; runs migrations; still subject to every immutability trigger. |
| `rai_app` | `DATABASE_URL` (the server) | `SELECT`/`INSERT` everywhere, `UPDATE` only where a migration grants it, no `DELETE` (except `configuration_draft`), no DDL. |
| `rai_operator` | `DATABASE_OPERATOR_URL` (`db:cleanup`, `store:verify`) | Everything `rai_app` may (`GRANT rai_app TO rai_operator`) plus the deletes migrations grant it (expired idempotency keys, expired sessions). |

The per-database statements, run in the desk's database as an administrator: `ALTER DATABASE <db> OWNER TO rai_owner`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, `GRANT USAGE ON SCHEMA public TO rai_app, rai_operator`. Table grants come from the migrations, so a new table never inherits a wider grant. Passwords come from custody, never from the init file's synthetic ones.

**A managed Postgres that cannot create these roles, or cannot make `rai_owner` the database owner, is a blocker to record for D10, not something to work around by running the server as one superuser or owner role.** The A07/A11 immutability proofs (`restore:verify` checks `a07_frozen_slot`, `a11_audit` and `grants`) depend on `rai_app` being unable to update frozen rows or delete audit rows. Check it before anything else: create the three roles, run `npm run migrate`, then `npm run restore:verify` against a restored copy (section 8), whose `grants` check names any table `rai_app` may delete from.

Server version: Postgres 16. `npm run restore` refuses a `pg_restore` of another major version than the server's.

## 5. Blob storage

Uploaded documents are content-addressed files under `BLOB_DIR` (`sha256/…`, write-once), written through the filesystem `BlobStore`, the only implementation (`artifacts/blob-store.ts`). The database holds only their hashes. Therefore:

- `BLOB_DIR` (and `MAIL_SINK_DIR`) must be on a **persistent volume** that survives restarts and redeploys (W7-D17, working assumption under D10). An ephemeral disk loses every uploaded document on redeploy while the database still points at them: `store:verify` would then report every artifact missing, and reviewers could not open submitted versions.
- One process owns the directory; it is not shared between instances.
- An object-store `BlobStore` adapter (S3-compatible or the platform's storage) is the **W8/D10 follow-up**. It would be a product call to an external service and is out of scope now.

## 6. Secrets

- The OIDC issuer URL, client ID and client secret, the allow-list JSON and the four database URLs come from the host's secret store. With `RAI_SECRET_SOURCE=env` the store exposes them as environment variables; with `file` each is a file named after the key under `RAI_SECRET_DIR`, read once at start. D10 decides custody and may add a vault implementation behind the same interface (W0-03 section 8).
- Never in a committed file: `rai-web/.env` is gitignored and holds only local synthetic values; `.env.example` holds placeholders (`set-in-custody`, `set-locally`), and a placeholder or empty value counts as absent, so a forgotten one refuses to start (S15).
- No log line, readiness report, reason code or backup manifest carries a secret value (W0-10 redaction).
- Allow-lists for the synthetic stage hold only `@rai-desk.example` addresses (W7-D4); real people's addresses need D08.

## 7. Health

| Endpoint | Auth | Use |
|---|---|---|
| `GET /healthz` | public | **Liveness.** `200 { status: 'alive', processId }` while the process runs. Restart the process only when this fails. |
| `GET /readyz` | public | **Readiness and routing.** `200` with `status: 'ready'` only when identity, database, migrations (`current` or `ahead`), blob store and mail sink are all `ok`; otherwise `503` with the same report and `not_ready`. QC is reported but does not gate readiness (an outage is recorded as findings, never a clean pass). Point the platform's health check here; do not restart on a 503 alone. |
| `GET /api/operator/desk-health` | Admin (`operator.view`) | The operator's view: the readiness report plus counters, in the Operator screen. |

A process that refuses its configuration never listens, so a misconfiguration shows as a failed start with one `process.refused` line, not as a running process answering 503.

## 8. Operations

Operator commands run from `rai-web/` on a machine that has the release's `node_modules` (with devDependencies, section 2), the same environment as the server, and network access to the database. None is an HTTP route. Each prints one JSON line (W0-10), never a URL, password or path.

| Command | When | Needs |
|---|---|---|
| `npm run backup [-- --label <text>]` | Before every migration or release, and on a D10 schedule | `RAI_PG_TOOLS=path` with `pg_dump` of the server's major version on `PATH`; `BACKUP_DIR`; read access to `BLOB_DIR`. Writes `db.dump`, `blobs/` and `manifest.json` (last). Session rows are excluded. |
| `npm run restore -- --from <backupDir> --target-db <name> --blob-dir <dir>` | Recovery | `pg_restore` of the same major version; `DATABASE_ADMIN_URL`. Restores into a **new** database and a **new** blob directory, never the live ones; the operator repoints `DATABASE_*` and `BLOB_DIR` afterwards. |
| `npm run restore:verify -- --from <backupDir> --target-db <name> --blob-dir <dir>` | After every restore, and as a periodic backup test | `DATABASE_ADMIN_URL`. Checks journal, counts, frozen digest, manifest hashes, blobs, A07, A11 and grants; exit 0 only when all pass. |
| `npm run release:check-rollback -- --target-migrations <path>` | Before rolling back to an earlier release | `DATABASE_URL`; optional `BACKUP_DIR`. `binary_only` (exit 0): start the earlier build; `restore_required` (exit 3): restore the named backup; `incompatible` (exit 4). |
| `npm run migrate` | Release step (section 2) | `DATABASE_MIGRATE_URL`. |
| `npm run db:cleanup` | Daily (schedule is D10's; nothing deletes documents) | `DATABASE_OPERATOR_URL`, `IDEMPOTENCY_TTL_HOURS`. Removes expired idempotency keys and expired or revoked sessions; `--report` lists stale drafts and orphan blobs without deleting them (D08). |
| `npm run store:verify` | Weekly and after any storage incident | `DATABASE_OPERATOR_URL`, `BLOB_DIR`. Re-hashes every referenced blob. |
| `npm run store:cleanup` | Daily | `BLOB_DIR`, `BLOB_TMP_MAX_AGE_HOURS`. Removes stale temporary uploads only. |

**Backups must leave the host.** `BACKUP_DIR` on the same volume as the data is not a backup; D10 names the target and its retention (retention of real data is D08's).

**Logs** are one JSON object per line on stdout (errors on stderr) with no secrets and no document text; the platform's log collector keeps them. Retention and the incident channel that watches `error.captured` and `health.readiness` lines are D10's.

**Incident switches.** Today: stop the process, or set `QC_MODE=deterministic` (already the host value). The W6-17 desk controls (freeze writes, pause mail, pause QC) are the planned incident switches and are not on `main` yet ([section 12](#12-not-yet-on-main)).

## 9. Known limits

- **One process.** No horizontal scaling and no scale-to-zero: the QC in-flight map and the notification timer (SLA digests) live in process, and `BLOB_DIR` is a local directory. Run exactly one always-on instance.
- **Identity.** `network` with the `allow-list` source only (W7-D3). Any OIDC issuer can be configured; a Google issuer is permitted only on a non-True URL, which is checked by hand (W0-03 section 2). `production` (True AD, Entra) is W8.
- **No external mail.** Notices are files in `MAIL_SINK_DIR`; nobody receives an email. Recipients are people who have signed in at least once (W7-07). A transport needs its own ticket and D10.
- **No HSTS or other host headers** from the process (`static.ts`): the proxy adds HSTS under D10.
- **Synthetic data only** until D08. The upload limits and retention values are local defaults.
- **The operator commands run from source through `tsx`**, so the release keeps its devDependencies installed.

## 10. Host checklist

A host is ready to receive this desk when each line is true. Record the answers in the D10 decision, not here.

- [ ] Node 24 runtime; build and start commands configurable; working directory `rai-web/`.
- [ ] Exactly one always-on instance; no autoscaling, no scale-to-zero.
- [ ] TLS-terminating proxy with an `https` public URL; request body limit at least `UPLOAD_MAX_PACK_BYTES`; the process bound to `0.0.0.0` on the platform port.
- [ ] Postgres 16 where an administrator can create `rai_owner`, `rai_app`, `rai_operator` and make `rai_owner` the database owner.
- [ ] A persistent volume for `BLOB_DIR` and `MAIL_SINK_DIR` that survives restarts and redeploys.
- [ ] A secret store exposing environment variables (or mounted files) for the custody keys.
- [ ] `pg_dump` and `pg_restore` of the server's major version available to the operator, and a backup target off the host.
- [ ] Health check on `/readyz`, liveness on `/healthz`, stdout log collection.
- [ ] An OIDC client at the chosen issuer with the desk's redirect URI, and an allow-list of synthetic-stage users.
- [ ] D10 has named the host, backup target, custody and incident channel.

## 11. Worked example: Replit

Ta may later host the synthetic desk on Replit. This maps the checklist onto that kind of platform; it is not a deployment plan and nothing was created there. Platform features change, so each item says what to check at the time rather than asserting it.

- **Runtime and commands.** A Node 24 environment; build command `cd rai-web && npm ci --include=dev && npm run build && rm -rf node_modules/@rai/fixtures`; run command `cd rai-web && npm start`. Run `npm run migrate` from the shell (or a release step if the platform offers one) against the deployment's database before promoting a build.
- **Deployment type.** Use a single always-on instance (a reserved-VM style deployment). An autoscaling deployment that can run several instances or scale to zero breaks the one-process limit.
- **Network.** Bind `HOST=0.0.0.0` on the port the platform maps (`PORT`), `TRUST_PROXY=true` behind its TLS proxy, `PUBLIC_BASE_URL` the deployment's `https://…` address. Register `<PUBLIC_BASE_URL>/auth/callback` at the OIDC client.
- **Secrets.** Put the custody keys in the platform's secrets store, which exposes them as environment variables (`RAI_SECRET_SOURCE=env`). Put the non-secret literals of section 3.1 in its environment settings. Never commit `rai-web/.env`.
- **Database.** A managed Postgres often supplies its own `DATABASE_URL` for the database owner. Do not run the desk with it: create the three roles in that database with the owner connection (section 4), then set `DATABASE_URL`, `DATABASE_MIGRATE_URL` and `DATABASE_OPERATOR_URL` to the role-specific URLs. If the service refuses `CREATE ROLE` or the ownership change, record the blocker. Check the server's major version is 16 and that a matching `pg_dump` is available in the shell.
- **Files.** Check whether files written by the running deployment survive a redeploy. If they do not (common for deployed apps on such platforms), uploaded documents would be lost on the next release: the host is **not ready** for `BLOB_DIR` until the object-store `BlobStore` adapter exists (W8/D10) or a persistent volume is available.
- **Identity.** The allow-list source with a Google OIDC issuer is permitted on a non-True URL such as a Replit address (checked by hand); the allow-list holds only synthetic-stage users (`@rai-desk.example` for agent runs; real people need D08).
- **Backups.** Replit's own database snapshots are not the desk's backup: `npm run backup` also copies the blobs and writes the manifest `restore:verify` checks. Copy `BACKUP_DIR` off the platform.

On current `main`, the likely blockers on such a host are the persistent `BLOB_DIR` and the role creation; both are D10 items.

## 12. Not yet on main

The W7 plan section 12 describes two facilities that other packages build. They are **not** available on `main` at the time of writing, and this note does not describe them as available:

- **`QC_MODE=content`** with `QC_MODEL=disabled` and the `QC_EXTRACT_*` keys (W4-13b, [W4b plan](implementation-plan-w4b.md) section 2). Once merged it is the intended host value, and `QC_MODE=deterministic` becomes the documented fallback that takes extraction out of service at restart. The keys are in [section 3.2](#32-planned-keys-not-read-yet).
- **The W6 desk controls** (W6-17, [W6 plan](implementation-plan-w6.md) section 7): `writesFrozen`, `mailPaused` and `qcPaused`, published by Admin as a `desk_controls` configuration revision. Once merged they are the incident switches: freeze writes during an incident or before a restore, pause mail, pause QC (runs answer `unavailable: desk_paused` with outage findings).

When either lands, its owning ticket updates this note (the unit test enforces the keys).
