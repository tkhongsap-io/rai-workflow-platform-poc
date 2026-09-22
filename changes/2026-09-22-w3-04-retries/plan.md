# Plan recorded before code

1. Create isolated worktree/branch from main and record this contract plus a Lane B claim scoped only to W3-04. Do not take W3-03a ownership.
2. Add only `rai-web/server/src/notifications/retry.ts` and `retry.test.ts`: immutable backoff constants, numbered next-attempt eligibility, and a pure result-to-delivery-state reducer. Test the four-failure sequence, success/duplicate on every attempt, time boundaries, serialized restart state and invalid inputs.
3. Run focused tests, lint/type checks relevant to the slice and repo doc checks. Obtain read-only independent review from another agent. Record exact results and limitations here; commit owned files locally only after checks.
4. Wait for the parent-provided W3-03a consumer commit. Then integrate in the notifications module plus minimal wiring, replacing initial-only delivery. No composer duplication, lease or migration. DB 54365 only when needed later.
5. Later prove concurrent workers with real Postgres, persisted restart deadlines, rollback isolation, permanent failure leaving decisions intact and the sink/DB crash ambiguity. Full integration/browser/CI and W3-07 visibility remain separate gates.

Working limit: keep the entire W3-04 change at or below 600 changed lines, one notifications module plus wiring and required records. Measure additions plus deletions against the W3-03a integration base. If projected to exceed 600, propose a cohesive split before expanding; do not invent issues or silently open extra PRs. Initial helper slice does not claim issue #45 complete.

## Integration plan recorded before integration code

Parent supplied committed W3-03a `36dcee9` (locale base `ec25131`). Rebased the preserved pure-helper commit onto that dependency; only the append-only Lane B claim conflicted, and both claims were retained. Final PR must rebase onto merged main so W3-03a publisher commits are excluded. Parent may relay review fixes before final verification.

Extend the existing `notifications/service.ts` runner to use the pure policy under one row lock with SKIP LOCKED, bounded selection and one-time legacy deadline adoption. Reuse `loadCommittedCaseRequest` unchanged. Log attempt outcomes only after transaction commit. Extend `runtime.ts` with a single-flight periodic scan and stop-before-drain behavior. Preserve the existing initial-delivery entry point for W3-03a callers. Add focused real-Postgres proofs for four attempts, deadlines/reconstruction, competing workers, sink-success/DB-rollback replay, and decision immutability. Use Compose project `rai-w3-retries` on 54365, no other database. No lease, migration, digest, composer or Admin-view implementation.

Parent reports W3-03a shutdown and Thai Gregorian-date fixes in progress. Runtime integration is pending that committed follow-up: do not retain the draft polling lifecycle over the known unbounded shutdown. The draft runtime patch is only scratch at `/tmp/rai-w3-retries-runtime-draft.patch`, not shipped. Preserve the row lock while a sink operation is live; do not use timeout-based unlock. Re-run the full notification regression and independent review after applying the final dependency.
