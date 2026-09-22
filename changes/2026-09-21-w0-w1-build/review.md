# Review: W0 and W1 build

2026-09-21 to 2026-09-22. Author self-review of the orchestration; every ticket carries its own two independent reviews on its PR and its own `changes/<date>-<ticket>/review.md`.

## Outcome

- **W0 exit recorded** (`changes/2026-09-21-w0-exit/review.md`): ADR-0003 and eight engineering specs in `docs/engineering/`, cross-spec reconciled to one owner per topic.
- **Milestone M1 reached** (`changes/2026-09-22-w1-exit/review.md`): one synthetic case goes create → attach → submit → restart → reopen on the real server with byte-identical bodies; scoped access and fail-closed identity proven by explicit negatives. Google-on-loopback sign-in is a human step, runbook in TESTING.md, **pending Ta**.
- 32 PRs merged (#57-#88): 10 W0 tickets, 15 W1 tickets, 4 W1-00 contract amendments, 3 corrective PRs (#75 browser job, #79 lint, #85 re-target).
- `main` at exit: 347 unit, 135 integration (real Postgres), 108 browser journeys against the real server + 78 on the substitute, CI 12 jobs green. W2 issues #31-#41 are `status:ready`.

## The loop, as run

Per ticket: implement (fresh agent, own worktree, own Postgres port) → two independent reviewers with fresh context (correctness+tests; contract+constraints+security), each running the suite and posting a PR comment → fix rounds until both pass → CI → squash-merge by the session (sub-agents cannot merge under the permission classifier) → board, DEVLOG and CHANGELOG logged on main. Three workflow runs of the planning pack preceded the build; 14 build stages followed.

## What the gate caught (and would have shipped otherwise)

- W0: ~30 cross-spec mismatches between specs written in parallel (two error envelopes, two `expectedVersion` shapes, three route styles, a QC run key that collapsed same-bytes-in-two-slots, an unimplementable OOXML macro check, "audit every denial" vs "log, never audit"). W0-05 needed 9 rounds; the authorization matrix collides with everything.
- W1: a migration-number collision (W1-01/W1-09 both `0001`); the Playwright web server refusing to start on a clean checkout (`fixture_outside_test`, my own fix looked green only through a build side-effect; caught by the independent reviewer); an eslint/tsc disagreement traced to a TypeBox mapped union degrading to `never` in emitted declarations; a keyboard-journey race between a `useEffect` focus move and a one-shot read; a **graceful-shutdown hang on idle sockets** found by the restart journey and confirmed on Linux.

## Process defects and how they were handled

- Two Lane B PRs (#83, #82) were opened against their own contract branches instead of `main`; #83's squash landed on the contract branch and was re-targeted by cherry-pick (#85); #82 was re-based before merge. Rule for W2: a contract PR merges first, and the ticket PR's base is `main` (checked at merge).
- W1-06 built a placeholder shell in parallel with W1-07 instead of rebasing onto it; resolved by an integration round (W1-07 shell as base). Rule for W2: UI tickets that share the shell run sequentially or against a merged contract.
- Squash merges do not carry `Closes #N`; three issues closed by hand.
- One agent died on a transient API 500 mid-run; relaunched clean, no residue.

## Checks at close

`git diff --check` clean; frozen source SHA-256 `92c4f712…` unchanged; 685 relative links, 0 broken; demo suite 22/22; product `npm run verify` green on main; every W0 and W1 issue closed with a merged PR; epics #51 and #52 closed.

## Not done in this change

W2 (lanes, send-back, Ready) is authorized and ready but not started. The Google-on-loopback pass is Ta's to record. D07-D10 remain open.
