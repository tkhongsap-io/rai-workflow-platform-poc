# W3-01 server review

## Scope and implementation

Prepared locally on `codex/w3-01-scoped-queue`, base `ae8e25d`, isolated worktree `/tmp/rai-w3-queue-server`. Issue #42 / A06, synthetic W0-W3 scope only. No shared-contract, UI, mail, migration or root-log edits. The parent checkout was not modified. No push, PR or merge.

- `rai-web/server/src/queue/repository.ts`: one actor-scoped SQL subquery reused by all filters, aggregates, distinct options and page reads. Status derives from current/draft versions, lane projections and the latest disposition event for each current-version finding. `fixed_proposed` stays unresolved.
- `rai-web/server/src/queue/routes.ts`: existing `case.list` action and shared TypeBox query; `app.ts` registers it beside the unchanged case routes using their database dependency.
- Search applies NFC on both input and stored columns, trims input and uses parameterized ILIKE with explicit literal wildcard escaping. Owner names are descriptive; exact owner filters and access use subject IDs.
- Repeatable-read, read-only transaction includes the facets, filtered count, page and W3-05 frozen calendar/SLA reads. Latest version prefers the draft, while lanes/dates remain those of the current submitted version. `nextAction` is only a case-level cue.

## Evidence

Node 24.21.0; dedicated Compose project `rai-w3-queue-server`, PostgreSQL 16.15, loopback **54362**, independent volume and worktree `.env`. Never used parent port 54351. Fixture set `slice1-synthetic@1 7c80ccd43663`.

- Focused integration suite: 7 passed in the final regression, including authenticated validation/deep links, all fixture role scopes and empty/no-grant scope, hidden-case metadata equivalence, every search key, Thai display name distinct from subject ID, NFC/case folding, literal `%`, `_`, backslash and escape marker, combined filters, deterministic pages, five statuses, latest-event tie breaking, successor draft lanes, frozen SLA after config publication and restart on resubmit.
- Deterministic snapshot test intercepts only a test-owned PostgreSQL connection after the first real aggregate read, commits an ownership/group/lane change through a second connection, and proves the original response remains identical while a subsequent request sees the change. No production test hook.
- `npm run verify`: passed: lint, typecheck, **409 unit + 205 integration tests**, zero failures/skips; integration duration 109.3 seconds.
- `npm run build` and `npm run check:substitute-absent`: passed; 483 built files scanned, zero substitute markers.
- `node --test scripts/*.test.mjs tests/*.test.mjs`: 40 passed.
- `node scripts/check-links.mjs`: 153 Markdown files / 695 links / zero broken after final review text.
- `node scripts/check-frozen-source.mjs`: source SHA-256 unchanged (`92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`).
- `git diff --check`: passed after final review text.

Local command logs: `/tmp/rai-w3-queue-verify.log`, `/tmp/rai-w3-queue-focused.log`, `/tmp/rai-w3-queue-build.log`, `/tmp/rai-w3-queue-repo-tests.log`.

## Parent review and delivery gates

**Raised documentation discrepancy:** implementation-plan-w1-w3 Thai-text verification rule names `th_TH.UTF-8` or `C.UTF-8`. The existing pinned Postgres image/database instead supplies `en_US.utf8` (UTF8); a forced `C.utf8` collation does not exist. The implementation uses the configured database collation with NFC/ILIKE; real Thai and Unicode case-insensitive searches pass. No shared contract or database setup was changed. Parent should reconcile that older named-locale requirement before delivery, or request a separate authorized configuration change. The reviewed shared queue contract's search semantics are implemented.

PR #106 must merge before any consumer PR. Parent independently reviews this local implementation and runs merge gates (including full browser verification); no browser run, independent acceptance or production readiness is claimed here. Existing GET /api/cases remains compatible. The dedicated database is retained for parent verification; stop only this project when finished with `POSTGRES_PORT=54362 docker compose -p rai-w3-queue-server down -v` from this worktree.

## Parent review

Independent reviewer Parfit reported no high-confidence findings on the server diff; independently ran four focused unit/schema checks, all passed. The older locale-name requirement is reconciled to the pinned image’s observed UTF-8 collation without changing search semantics; real Thai/NFC search tests pass. Queue latency at 1,000 cases remains a W3-06 measurement, not yet proved. PR106 merged as a30c304; this branch rebased onto it. Full browser and final CI remain pending.
