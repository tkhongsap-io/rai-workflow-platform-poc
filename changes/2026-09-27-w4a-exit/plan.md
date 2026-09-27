# Plan

1. Worktree `/tmp/rai-w4a-exit` on `codex/w4a-exit-record` from `origin/main` `da3d815`; Postgres project `rai-w4a` on port 55380, recreated empty; `.env` with ports 55380/8797/8798/8799/5185; `npm ci`.
2. CLAIM on `docs/board/lane-lead-integration.md` (append-only).
3. Run the plan section 8 gate one suite at a time, logs under `/tmp/rai-w4a-exit-logs/`, never in the repo.
4. Run the section 10 exit evidence separately: the two fixture test files, the real-server test alone, the W4-12 browser spec on the real server, readiness from a server started from source with `QC_MODE=deterministic`, `check:substitute-absent`.
5. Read the identities from the outputs and the database: the `qc_rules` configuration revision (ID, label), `qc_run.runner` and `runner_version`, and the fixture set line printed by the describes.
6. Read the six ticket reviews for deviations, review rounds and deferred notes; read GitHub for the PR list.
7. Write `review.md`; update BUILD_PLAN, the W4 work breakdown, delivery README, README, board, DEVLOG and CHANGELOG as current-status text. No formatter on board, DEVLOG, CHANGELOG or existing tables.
8. `check-links` and `git diff --check` on the final tree; commit, push, verify the remote head, open the PR with "Refs #190" and "Ta's package review is pending". Do not merge.

If any check fails, stop and return the evidence; this ticket fixes no code.
