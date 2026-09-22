# Local verification and handoff

Base: reviewed API c98ad3ee195367542f133ad12b4f79b2979add40. Only the new integration test, new test-owned database helper and this packet changed. No application/global helper, startup, QC, root log or other worktree edits. No push or PR.

## Evidence

- Real server/src/main.ts child processes via existing startTestServer, real HTTP and Postgres 16 on reserved localhost54371 / Compose rai-w3-int-observability. Existing synthetic fixtures loaded only into generated databases. No fake readiness/operator response or new production flag.
- OBS-03: app-role SELECT 1 succeeds and migration journal is absent; HTTP /readyz returns 503, db=ok, migrations=pending, blob=ok, identity=ok, mailSink=ok. Migrated fixture DB returns 200/current. A second real process uses a kernel-selected closed loopback DB port: readyz returns 503/unreachable/unknown while healthz returns 200 with and without the real previously issued session cookie.
- OBS-15 bounded scenarios: successful sign-in handles the fixture person's display name; owner-name queue search returns the owned case; Thai-named PDF containing the document-body sentinel uploads with 201. Every scenario has exactly one request.completed with its response correlation, route template and status; sign-in/upload domain events have matching correlation. Existing assertNoLeak checks all process-captured stdout/stderr lines through graceful shutdown, with fixture canaries plus cookie/token and encoded query/filename variants. No logger-only call is used as proof.
- Pure safety regression rejects remote app/owner/operator/admin URLs, matching all-remote URLs, mismatched ports/database names, connection routing overrides, wrong runtime modes and a missing explicit operator URL. Preflight completes before a database client is constructed. CREATE/DROP targets only a locally generated w3_obs_<32 hex> name. Temporary fixture/blob/mail files are removed after each scenario.

## Checks

From rai-web with Node v24.21.0 and own npm ci:

```sh
NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test tests/integration/w3-int-observability.test.ts
npm run typecheck
npm run lint
```

Focused integration: **3 passed, 0 failed, 0 skipped**. Typecheck and lint pass. The final small query-row typing correction was checked again with typecheck, targeted ESLint/Prettier and the focused integration command. Earlier checks exposed a malformed test mutation and query-result typing errors; corrected locally, no product changes needed.

Repository checks: links **204 Markdown files / 725 relative links / 0 broken**, frozen-source SHA matches provenance, script tests **18 passed**, diff whitespace clean. Generated databases absent after test cleanup. Source database was never migrated, reset or truncated; its migration journal remains absent. The dedicated Compose service was stopped after verification; its local volume is retained.

## Remaining evidence boundary

This captures all lines from these three spawned processes, not every W1-W3 test process or in-process app logger. **Suite-wide OBS-15 remains open** until parent runs the combined INT suite with its shared capture assertions and records that coverage. Full integration/browser/build/CI and final independent review remain parent-owned after dependency integration; these focused results do not close W3-INT, M3, A09, OBS-17 or production acceptance. Existing scriptable QC substitute availability is observed, not promoted to real QC acceptance.

Integration needs explicit loopback DATABASE_URL, DATABASE_MIGRATE_URL and DATABASE_OPERATOR_URL and create/drop-database rights through the existing optional OBS_MIGRATION_ADMIN_URL (otherwise the existing synthetic Compose administrator on the same endpoint). No skip path silently converts missing configuration into green.
