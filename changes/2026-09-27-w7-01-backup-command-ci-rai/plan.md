# Plan

1. Board CLAIM (lane C stream). Change frame (this folder).
2. RED:
   - `server/src/config.test.ts`: `parseBackupConfig` table (missing/invalid/production refusal of `docker-compose`, container port, `BACKUP_DIR` inside the repo refused, `rai-web/.local/` and outside the repo accepted); `parseConfig` ignores the keys.
   - `server/src/operator/pg-tools.test.ts`: argv and env per mode through an injected runner; connection-target rewrite; no password or URL in argv; compose container lookup; `version()` parse.
   - `server/src/operator/frozen-digest.test.ts`: canonical JSON; digest independent of key order, dependent on row order and content; the table list and filters; UTC guard.
   - `server/src/operator/backup.test.ts`: version refusal (pure check), backup id and label rule, the command's JSON line for a configuration refusal.
   - `tests/integration/w7-01-backup.test.ts`: journey → backup → manifest, dump, blobs; mismatched tool version writes nothing; the command's completed line.
3. GREEN: `config.ts`, `operator/pg-tools.ts`, `operator/frozen-digest.ts`, `operator/backup.ts`, `observability/log.ts` events, `package.json` script, `.env.example`, `.github/workflows/ci.yml` (one line), `tests/support/fixture-app.ts` (read-only accessor for the suite's blob directory).
4. Docs: W0-10, W0-02, W0-04, TESTING.
5. Full plan section 10 gate one suite at a time, logs under `/tmp/rai-w7-01-backup-command-ci-rai-logs/`; `rai-web/.env` with `RAI_PG_TOOLS=docker-compose:rai-ops`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #207").
