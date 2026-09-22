# W3-04 review

## Scope and dependency

Isolated `/tmp/rai-w3-retries`, branch `codex/w3-04-retries`, original main `5fe59ad`. Intent/spec/plan and scoped Lane B claim preceded code. Pure policy was independently reviewed clean (GPT-5.5; six focused tests). Initial evidence: 463 unit and 40 repo tests, lint/typecheck, links and frozen source passed. These are historical preparation results, not final integration evidence.

Parent supplied W3-03a `36dcee9`, then mandatory shutdown/Gregorian fix `4aa19a3` (and its predecessor `21d914c`). Rebases preserved both claims, W3-04 helpers/dispatch, all upstream shutdown semantics and regression tests. Composer loader and date formatting remain upstream-owned. Final PR must rebase onto merged main and exclude publisher commits. No other worktree edits, push, PR or merge.

## Implementation and guarantees

One notifications module: pure 1/5/25-second backoff and four committed-result cap; existing dispatcher uses one notification row lock with SKIP LOCKED, bounded 25-row due selection, persisted deadlines and one-time legacy deadline adoption. No lease, migration, digest, Admin surface or external transport. The historical `deliverInitial` entry point now dispatches one eligible numbered attempt. Polling is single-flight every 250ms; existing request/startup wakeups remain. Background tasks retain inherited drain tracking/cancellation; onClose stops polling and awaits active work. A deadline rejection leaves an active sink locked until it settles or the process terminates. Cancellation is checked after settlement before delivery-state commit. Outcome logs follow commit; logs are not crash-atomic with the DB.

Four committed results do not bound physical sink invocations across crashes. Acceptance before rollback may repeat; fresh file-sink dedup depends on a completed JSON record, memory restarts lose keys and live file-sink instances may have stale indexes. No exactly-once or external-delivery claim.

## Verification

Dedicated Compose project `rai-w3-retries`, PostgreSQL 16.15, loopback 54365; independent ignored `.env`; fixture set `slice1-synthetic@1 7c80ccd43663`. Other reserved ports untouched.

- Focused notification suite before the final dependency: 20 passed (five W3-04 tests); `/tmp/rai-w3-retries-focused.log`. Covers four-result exhaustion without changed Ready/decision rows, deadline adoption across a fresh connection, competing workers, accepted file followed by injected pre-COMMIT failure/replay, and 25-row batches excluding future retries. Ready assertions drain other workers because SKIP LOCKED is not a completion barrier.
- Fixed shutdown/composer/retry unit suite: 24 passed, including polled and request-triggered settled/stalled shutdown; `/tmp/rai-w3-retries-shutdown.log`. The inherited DB test verifies cancellation keeps the lock while the sink remains pending, then rolls back after settlement.
- Build and substitute-absence passed (499 files scanned, zero markers); 40 repository tests passed. Links: 162 files / 708 links / zero broken; frozen source unchanged. `npm run verify` passed: lint, typecheck, 477 unit and 219 integration tests, zero failures/skips (`/tmp/rai-w3-retries-verify.log`). All 90 substitute browser tests passed on ports 8816/5215; all 126 real-server browser tests passed on 8815 using DB 54365 (`/tmp/rai-w3-retries-browser-server.log`). Independent GPT-5.5 integration review against `4aa19a3` is clean; six focused tests passed independently, while its read-only sandbox blocked runtime loopback binds. Review: `/tmp/rai-w3-retries-integration-review.txt`.

Connection/runner reconstruction and injected transaction failure are not process-kill/power-loss proofs. Integrated Admin visibility is W3-07; digest identity is W3-03b; integrated M3 acceptance remains separate. Issue #45 is not closed by this local preparation. The diff is 592 changed lines against `4aa19a3`, below the 600-line working limit. After the type-only health handoff, typecheck, focused lint/format and 46 retry/runtime/mail-sink tests passed (`/tmp/rai-w3-retries-health-handoff.log`); full-suite counts above precede that type-only change. The W3-07a handoff preserves concrete mail `health()` in the server-local loader type; parent owns configured-instance startup injection, using QC `probe()` rather than its health setter. No shared port or dispatcher added. Independent GPT-5.5 follow-up review of the health type is clean (`/tmp/rai-w3-retries-health-review.txt`).
