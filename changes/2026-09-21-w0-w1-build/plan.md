# Plan

Recorded before code. The tickets and their Done when are in docs/delivery; this plan is the execution order and the per-ticket loop.

## Per-ticket loop (one workflow stage each)

1. **Implement** — a fresh agent in its own git worktree on `codex/<ticket-id>-<topic>` from `origin/main`: reads the issue, the ticket row, the W0 specs and the recorded decisions; implements; updates the documents the ticket names; runs the full suite; commits; pushes; opens the PR with ticket ID, A-IDs, commands and output.
2. **Review** — two independent agents with fresh context read the PR diff, the ticket's Done when and the constraints, run the suite themselves in the worktree, and each returns pass/fail with blocking findings.
3. **Fix** — if any blocking finding, an agent fixes on the branch, reruns the suite, pushes; back to 2. At most three rounds; a fourth failure stops the ticket and is reported.
4. **Merge** — squash-merge, delete the branch, pull main, run the suite on main, append the board and DEVLOG entries on main, remove the worktree.

## Order

- **W0-01** ADR-0003 (D04 recorded) → merge.
- **W0-02, W0-03, W0-04, W0-05, W0-06, W0-07, W0-08, W0-10** in parallel (distinct files under docs/engineering) → sequential merges.
- **W0-09** exit review: verifies commands in TESTING.md, records budgets as targets, writes `changes/<date>-w0-exit/review.md`, flips W1 issues to ready.
- **W1-00** substrate (first code: repo skeleton, docker compose, Drizzle base, error types, policy module, fixture identity provider, configuration revision seed) → merge.
- **W1-01, W1-09, W1-10, W1-11, W1-12** in parallel → merges.
- **W1-13, W1-02, W1-03** in parallel → merges.
- **W1-04** → **W1-05**; **W1-06, W1-07** in parallel after W1-13.
- **W1-INT** → **W1-08** exit (M1) with the Google-on-loopback manual sign-in recorded as a human step for Ta.
- W2 follows the same loop if reached; its order is in slice-1-work-breakdown.md.

## Verification at the end

`git diff --check`; frozen source SHA-256; relative-link audit; the product suite on main; every W0/W1 issue closed with a merged PR; review.md per package. Recorded in this change's review.md.
