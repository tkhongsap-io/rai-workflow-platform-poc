# W3-04 review

## Preparation and scope

Base main `5fe59ad`; dedicated `/tmp/rai-w3-retries`, branch `codex/w3-04-retries`. Intent/spec/plan and scoped claim recorded before implementation. Only pure policy in `notifications/retry.ts` and its tests: next eligible attempt, result-to-state update, immutable 1/5/25-second backoff and four-result cap. No composer, sink, worker, schema or wiring changes. No database or port used; no edits in another worktree.

## Verified helper evidence

Node 24.21.0; independently installed dependencies in this worktree (`npm ci --ignore-scripts --no-audit --no-fund`).

- Focused `node --import tsx --conditions=rai-source --test server/src/notifications/retry.test.ts` with test/fixture environment: 6 passed, zero failures/skips. Tests cover 0/1/6/31-second failure sequence, completion-based delay, serialized deadline reconstruction, all success/duplicate positions, all failed receipt codes, missing/invalid deadlines, exhausted attempts and date overflow. Reconstruction is a pure test, not a process/database restart proof.
- `npm run test:unit`: 463 passed, zero failures/skips (19 suites). Log: `/tmp/rai-w3-retries-unit.log`.
- `npm run lint`: passed, including formatting/CSS; log `/tmp/rai-w3-retries-lint.log`.
- `npm run typecheck`: passed.
- `node --test scripts/*.test.mjs tests/*.test.mjs`: 40 passed. Log: `/tmp/rai-w3-retries-repo.log`.
- `node scripts/check-links.mjs`: 157 Markdown files, 701 links, zero broken after the evidence update.
- `node scripts/check-frozen-source.mjs`: source hash unchanged, `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`.
- Whitespace check passed. This preparation is below the 600-line working limit; later integration must measure the entire W3-04 delta against its W3-03a base before expanding.

## Independent review and next gate

Independent read-only GPT-5.5 review returned no findings and independently ran all 6 focused tests successfully. Evidence: `/tmp/rai-w3-retries-independent-review.txt`; detailed log `/tmp/rai-w3-retries-independent-review.log`. Initial CLI launch with the configured model was unsupported; only the successful replacement review is counted. No runtime, concurrency, restart-process, Admin visibility, browser or acceptance result claimed. Issue #45 remains incomplete. Parent-provided W3-03a committed consumer is required before integration. No push, PR or merge.

## Integration preparation on committed W3-03a (not final acceptance)

Parent supplied `36dcee9` atop `ec25131`; rebasing preserved the pure helper as `6a46ae7`. Both append-only lane claims were retained. These are temporary dependencies: final PR must exclude publisher commits by rebasing onto merged main. No other worktree was edited.

Dispatcher preparation in the existing notifications service reuses the committed loader unchanged, locks each row with SKIP LOCKED, persists 1/5/25-second deadlines, adopts a legacy missing deadline once and emits outcome logs after commit. One scan selects at most 25 due case notifications. No lease/migration/digest/Admin surface. The compatibility method `deliverInitial` now dispatches an eligible numbered attempt, not only attempt 1.

Dedicated Compose project `rai-w3-retries`, PostgreSQL 16.15, loopback 54365; independent ignored `.env`. Focused real-Postgres suite: 20 passed, zero failures/skips; `/tmp/rai-w3-retries-focused.log`. Five W3-04 cases prove four-result exhaustion with unchanged Ready/decision rows, deadline adoption across a fresh DB connection, two independent workers skipping a locked row while another row progresses, accepted file delivery followed by injected pre-COMMIT failure and fresh-file-sink duplicate replay, and bounded 25-row scans excluding future retries. A competing-worker test exposed an old Ready assertion's assumption that a scan waits for other workers: it now drains background work before observing the result.

These are connection/runner reconstruction and injected transaction-failure tests, not process-kill/power-loss proofs. The file replay test intentionally observes two sink invocations but only one committed result; it does not establish an absolute physical-invocation cap. Memory-sink restart and stale live file-sink indexes retain the documented ambiguity.

Parent reports Hypatia's shutdown/date review fixes pending. The draft polling runtime was removed from the working patch; its scratch diff is `/tmp/rai-w3-retries-runtime-draft.patch`. Final cancellation-aware runtime integration, retry polling/shutdown tests, complete regression and independent review await the committed follow-up. Existing upstream runtime still has its known shutdown limitation. Do not ship this preparation as complete W3-04 or claim Admin visibility.
