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
