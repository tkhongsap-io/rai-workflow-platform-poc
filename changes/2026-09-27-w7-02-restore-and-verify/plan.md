# Plan

1. Board CLAIM (lane C stream). Change frame (this folder).
2. RED:
   - `server/src/config.test.ts`: `parseRestoreConfig` table; `parseConfig` ignores `DATABASE_ADMIN_URL`.
   - `server/src/operator/restore.test.ts`: argument parsing, target-name rule, live-target refusal, the command's JSON line for configuration and argument refusals.
   - `server/src/operator/restore-verify.test.ts`: argument parsing, `CHECK_IDS` order, the command's JSON line for configuration refusal.
   - `tests/integration/w7-02-backup-restore.test.ts`: section 7 of the spec.
3. GREEN: `config.ts`, `operator/restore.ts`, `operator/restore-verify.ts`, `observability/log.ts` events, `package.json` scripts, `.env.example`, `.github/workflows/ci.yml` (one line). `tests/support/observability-database.ts` is reused as is for the admin URL fallback check; no change needed.
4. Docs: W0-10, W0-02, W0-04, TESTING.
5. Full plan section 10 gate one suite at a time, logs under `/tmp/rai-w7-02-restore-and-verify-logs/`; `rai-web/.env` with `RAI_PG_TOOLS=docker-compose:rai-ops` and `DATABASE_ADMIN_URL` on 55385.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #216").
