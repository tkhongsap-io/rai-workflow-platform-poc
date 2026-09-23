# Specification

Done when:

1. **Retro-review recorded.** Every merged PR from #90 to #126 without an independent review verdict has one: correctness and tests, contract and security. Findings are adversarially verified; each confirmed finding is fixed in a PR or recorded as deliberately deferred with a reason.
2. **Architecture and simplification.** A review of rai-web/ against ADR-0003 and the W0 specs names duplication, dead code, needless abstraction, over-long modules, ticket-ID noise in source, and the cost of the API substitute. Confirmed simplifications land as behaviour-preserving PRs: same tests green, no test weakened, fewer lines or fewer concepts.
3. **Resilience.** The Postgres pool and process handle errors without crashing a healthy server (pool `error` handler; `unhandledRejection`/`uncaughtException` logged and fatal where correct); every state-changing route has the same-origin/CSRF protection sign-out has. Tests prove both.
4. **Records honest.** BUILD_PLAN status table has one consistent W3/M3 row; stale labels on #53 fixed; stale local branches pruned; DEVLOG/CHANGELOG entries; this change's review.md lists every PR, verdict and command output.
5. **Hand-off.** A one-page synthetic walkthrough script for Nakhun and a #35 options brief for Ta and the review leads.

Every PR: own worktree and Postgres port, full suite green (unit, integration, browser, lint, typecheck, build, substitute-absent), two independent reviewer agents posting verdicts on the PR, CI green, base `main`.

## Schema change

The hardening adds one migration, `0008_w3_hardening_lane_decision_scopes` (H8), recorded in the W0-04 `lane_decision` column notes:

- `lane_decision.actor_scopes` (jsonb NULL): the deciding actor's grants at decision time. The Ready predicate's self-approval recheck (W0-06 section 6, condition 4: "at decision time") reads these instead of the approver's current grants.
- `lane_decision.observed_qc_run_id` references `qc_run(id)`, as W0-04 already documented.

Additive: no frozen row is rewritten, and the append-only trigger and grants are unchanged.
