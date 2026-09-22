# Plan recorded before code

1. Create isolated worktree/branch from main and record this contract plus a Lane B claim scoped only to W3-04. Do not take W3-03a ownership.
2. Add only `rai-web/server/src/notifications/retry.ts` and `retry.test.ts`: immutable backoff constants, numbered next-attempt eligibility, and a pure result-to-delivery-state reducer. Test the four-failure sequence, success/duplicate on every attempt, time boundaries, serialized restart state and invalid inputs.
3. Run focused tests, lint/type checks relevant to the slice and repo doc checks. Obtain read-only independent review from another agent. Record exact results and limitations here; commit owned files locally only after checks.
4. Wait for the parent-provided W3-03a consumer commit. Then integrate in the notifications module plus minimal wiring, replacing initial-only delivery. No composer duplication, lease or migration. DB 54365 only when needed later.
5. Later prove concurrent workers with real Postgres, persisted restart deadlines, rollback isolation, permanent failure leaving decisions intact and the sink/DB crash ambiguity. Full integration/browser/CI and W3-07 visibility remain separate gates.

Working limit: keep the entire W3-04 change at or below 600 changed lines, one notifications module plus wiring and required records. Measure additions plus deletions against the W3-03a integration base. If projected to exceed 600, propose a cohesive split before expanding; do not invent issues or silently open extra PRs. Initial helper slice does not claim issue #45 complete.
