# Review: deployment-readiness note (W7-16, #234)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-16 and section 12 (the plan wins over issue #234). Decisions: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)"; W7-D2, W7-D4 and W7-D17 are used as the labelled working assumptions under D10. D10 (host, backup target, custody, incident channels) stays open with its owners. Synthetic data only; no external network call; **nothing deployed**; no product code; no migration.

## Change

- **`docs/engineering/deployment-readiness.md`**: one Node 24 process plus Postgres 16 behind a TLS proxy on a generic host. Sections: shape; build and start (`npm ci --include=dev`, `npm run build`, removal of the `@rai/fixtures` link, `npm run migrate` as a release step with `DATABASE_MIGRATE_URL` and never at start, `npm start`, `SIGTERM` drain; `NODE_ENV=production` refuses `missing:web/dist`); configuration (3.1: one row per key the code reads, 39 keys, with production value as a literal or `host`/`custody`/`release`/`unset`; 3.2: planned `QC_MODEL` and `QC_EXTRACT_*`; 3.3: local-only keys); database (the three roles, the `001-roles.sql` statements, the managed-Postgres blocker rule); blob storage (persistent volume, W7-D17; object store is the W8/D10 follow-up); secrets (`RAI_SECRET_SOURCE=env` or `file`, W7-D4); health (`/healthz`, `/readyz` 503 when not ready, desk health); operations (backup, restore, verify, rollback check, migrate, `db:cleanup`, `store:verify`, `store:cleanup`, with their host needs; logs to stdout as JSON); known limits (one process, `allow-list` only, Google issuer only on a non-True URL, no external mail, no HSTS from the process); a host checklist; Replit as a worked example; "not yet on main" (W4-13b `QC_MODE=content`, W6-17 desk controls).
- **`rai-web/server/src/deployment-readiness.test.ts`** (unit, 6 tests, file reads only): scanner sanity; table keys equal the keys non-test `server/src` code reads (`(env, 'KEY'`, `env.KEY`, `env['KEY']`), both directions; planned keys not read yet; every `.env.example` key in the table or the local-only list, and no key in both; the table's production values, with synthetic `.test`/`rai-desk.example` stand-ins for host, custody and release values, pass `parseConfig` (production, `0.0.0.0`, `trustProxy`, https, `network`, `sink-file`, `deterministic`, pretty off), `parseIdentityConfig` (`network`/`allow-list`) and `parseBackupConfig` (`path`); the note says "Nothing is deployed" and ties host, backup target, custody and incidents to D10.
- **W7 plan section 12**: a dated note (2026-09-28) linking the note and naming the two facts found.
- Board CLAIM (lane C), DEVLOG top entry, CHANGELOG line under "## 2026-09-27".

## Findings while writing

- **The built server does not start from a plain workspace install.** `npm ci` links `@rai/fixtures` into `node_modules`, `npm run build` does not build it, and `start.ts` imports `@rai/fixtures/data/users` at run time; the import finds the package without `dist/` and the server refuses `fixtures_import_failed` (exit 78). Reproduced on loopback in fixture mode (`NODE_ENV=test`, built server, no external call): `{"event":"process.refused","reason":"fixtures_import_failed"}`, exit 78. With the link moved away the import fails with `Cannot find package '@rai/fixtures'`, the case `start.ts` treats as a production install (covered by `start.test.ts` "an absent fixtures package"). The note makes `rm -rf node_modules/@rai/fixtures` a required release step. Tests are unaffected because `npm run typecheck` emits `fixtures/dist` before the browser suites spawn the built server; the note says that a present `fixtures/dist` would load the fixture business units, which the removal also prevents. No product code was changed: whether `start.ts` should treat an unbuilt package as absent is a product decision for a later ticket.
- **Operator commands need devDependencies at run time.** `migrate`, `backup`, `restore`, `restore:verify`, `release:check-rollback`, `db:cleanup` and `store:*` run through `tsx` with `--conditions=rai-source`, so the install keeps devDependencies (`--include=dev`), which also protects the build on a host that sets `NODE_ENV=production` during install.
- **Readiness does not include QC**; `BUILD_COMMIT` other than 7-40 hex shows as `dev`; `DATABASE_OPERATOR_URL` falls back to the owner URL when empty (acceptable only locally). Each is stated in the note.

## Deviations

- **Planned facts described as planned.** Section 12 of the plan lists `QC_MODE=content` with `QC_MODEL=disabled` and the `QC_EXTRACT_*` keys, and the W6 desk controls as incident switches. Neither is on `main` (config.ts accepts only `substitute` and `deterministic`; `desk_controls` exists only as a seed row). "Every key matches `config.ts`" wins: the table's host value is `QC_MODE=deterministic`, the W4b keys are a separate "planned" list the test keeps out of the code's key set, and section 12 of the note says what changes when W4-13b and W6-17 land. The test then fails until the landing ticket moves the keys into the table, which is how the note stays true.
- **"Every key matches `config.ts`" read as every key the server code reads.** `config.ts` hands the identity slice to `identity/config.ts` and `secrets/index.ts`, and the operator commands read `BLOB_DIR` and `BUILD_COMMIT` directly; the test scans all non-test `server/src` code so none is missed. The table therefore has 39 rows, including the `unset` identity keys of other modes, so an operator knows they must stay unset.
- **Test beyond the key list.** Not in the plan: the note's production values are run through the real parse functions, so a value the code would refuse cannot stand in the note; and `.env.example` keys must be accounted for.
- **Additions to the plan's contents list:** a host checklist, the Replit worked example (Ta's note that Replit is a possible host; written as checks, not assertions, and with nothing created there), and the `@rai/fixtures` release step.
- **Record dates.** The change folder carries the plan's date (2026-09-27) as assigned; the board CLAIM, DEVLOG entry and the plan note carry the working date 2026-09-28; the CHANGELOG line sits under "## 2026-09-27" as assigned.

## Commands and results

Worktree `/tmp/rai-w7-16-deployment-readiness-note`, Postgres project `rai-ops` on 55385, `rai-web/.env` from `.env.example` with 54320 → 55385, `PORT=8841`, `PUBLIC_BASE_URL=http://127.0.0.1:8841`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8842`, `SUBSTITUTE_PORT=8843`, `SUBSTITUTE_WEB_PORT=5195`, `OBS_MIGRATION_ADMIN_URL` for 55385, `RAI_PG_TOOLS=docker-compose:rai-ops`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-16-deployment-readiness-note-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| Probe: `npm run build`, then `node server/dist/main.js` with `NODE_ENV=test RAI_IDENTITY_MODE=fixture QC_MODE=deterministic PORT=8844` (loopback) | exit 78, `{"event":"process.refused","reason":"fixtures_import_failed"}` |
| Probe: `import('@rai/fixtures/data/users')` from `server/` with the `node_modules/@rai/fixtures` link moved away (restored after) | `ERR_MODULE_NOT_FOUND Cannot find package '@rai/fixtures'` |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/deployment-readiness.test.ts` | 1/6 (scanner); 5 fail with `ENOENT` on the note |
| GREEN: same command after the note | 6/6 |
| Mutation: `LOG_LEVEL` row removed | key-set, `.env.example` and parse tests fail; restored |
| Mutation: stale `LOG_FORMAT` row added | key-set test fails; restored |
| Mutation: `LOG_PRETTY` production value `true` | parse test fails; restored |
| Mutation: `PUBLIC_BASE_URL` as literal `http://…` | parse test fails; restored |
| Mutation: `env.QC_MODEL` appended to a non-test source file | planned-keys and key-set tests fail; restored |
| Mutation: "Nothing is deployed" removed | statement test fails; restored |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0; first run: Prettier flagged the new test file, formatted with `prettier --write` on that file only |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 1201/1201 |
| `npm run test:integration` | exit 0, 491/491, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 1047 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 232 passed (9.7 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (40.5 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 0 broken (after this file existed; before it, only the DEVLOG link to this file) |
| `git diff --check` (repo root) | exit 0 |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow). Ta reviews the W7 exit record.
