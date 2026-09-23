# Specification

Done when:

1. **Retro-review recorded.** Every merged PR from #90 to #126 without an independent review verdict has one: correctness and tests, contract and security. Findings are adversarially verified; each confirmed finding is fixed in a PR or recorded as deliberately deferred with a reason.
2. **Architecture and simplification.** A review of rai-web/ against ADR-0003 and the W0 specs names duplication, dead code, needless abstraction, over-long modules, ticket-ID noise in source, and the cost of the API substitute. Confirmed simplifications land as behaviour-preserving PRs: same tests green, no test weakened, fewer lines or fewer concepts.
3. **Resilience.** The Postgres pool and process handle errors without crashing a healthy server (pool `error` handler; `unhandledRejection`/`uncaughtException` logged and fatal where correct); every state-changing route has the same-origin/CSRF protection sign-out has. Tests prove both.
4. **Records honest.** BUILD_PLAN status table has one consistent W3/M3 row; stale labels on #53 fixed; stale local branches pruned; DEVLOG/CHANGELOG entries; this change's review.md lists every PR, verdict and command output.
5. **Hand-off.** A one-page synthetic walkthrough script for Nakhun and a #35 options brief for Ta and the review leads.

Every PR: own worktree and Postgres port, full suite green (unit, integration, browser, lint, typecheck, build, substitute-absent), two independent reviewer agents posting verdicts on the PR, CI green, base `main`.
