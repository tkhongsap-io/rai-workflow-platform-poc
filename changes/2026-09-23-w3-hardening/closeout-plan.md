# Close-out plan: W3 hardening, final records

Written 2026-09-25 before any change, on Ta's instruction to plan the hardening close-out, claim the lane and proceed. Documentation and local housekeeping only. No code, no decision, no new scope.

## Starting point

PR #157 (`aa9e8ab`) merged the [review record](review.md), the [walkthrough script](walkthrough-script.md), the [#35 brief](issue-35-decision-brief.md) and the DEVLOG, CHANGELOG, README and BUILD_PLAN updates. Spec Done-when 1-5 are met except for these gaps (the fourth was found by the contract reviewer on #158):

1. **Final-head evidence.** Section 3 of the review records the clean-checkout full run at `4522074`, which is before H24-H29. Each of H24-H29 then passed its own full suite and CI, and `main` at `aa9e8ab` passed CI run [36041409928](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36041409928) (12 of 12 jobs). The review does not cite that run.
2. **Build board.** `docs/board/lane-lead-integration.md` has no claim and no entry for the hardening, although AGENTS.md and the board README require both.
3. **Local branches.** Spec Done-when 4 says stale local branches are pruned. 29 local branches remain: `codex/harden-h1` to `h29` (no h24) and `codex/w3-hardening-handoff`. Each one maps to a merged PR, #128-#157, and GitHub keeps each head as `refs/pull/<n>/head`.
4. **#157 row.** Done-when 4 asks the review to list every PR and its verdicts. Section 2 had no row for #157, which took six review rounds.

## Tasks

- [x] **1. Claim.** Append a `CLAIM lead-integration: W3 hardening close-out` entry to `docs/board/lane-lead-integration.md`.
- [x] **2. Final-head evidence.** Add a short "Final main" paragraph to review.md section 3. It cites run 36041409928 on `aa9e8ab`, lists its job names and states that no local full suite was rerun on `aa9e8ab`. Do not restate or change any earlier count.
- [x] **3. Board entry.** Append a W3 hardening entry (What, Why, Next, Author, Evidence) that links the review and #128-#157. It must say that W3 acceptance and the section 5 items stay with Ta.
- [x] **4. Local branches.** Before deleting each branch, check that its PR is `MERGED` and record its tip SHA below. Then run `git branch -D` on each. Do not touch the other session's worktree at `/private/tmp/rai-w3-mail-compat` or any remote branch.
- [x] **5. Record.** Add a line to review.md section 6 that points at this plan and states what it changed.
- [x] **6. Checks.** From the repository root: `node scripts/check-links.mjs`, `node scripts/check-frozen-source.mjs`, `git diff --check`, and prettier on `closeout-plan.md` only. Earlier board entries and review tables are not reformatted: the board is append-only and the records keep their existing layout.
- [ ] **7. PR.** Open a docs PR from `codex/w3-hardening-closeout`, have two independent reviewer agents post verdicts, then wait for CI. Merging to `main` waits for Ta's go-ahead, because this is a documentation branch rather than a D03 ticket.

## Review correction

Round 1 of #158: running prettier on the board stream and the review had re-padded 15 earlier board entries and all five review tables. The contract reviewer blocked it under the board's append-only rule. Both files were restored from `main`, and only the additions were re-applied. The same round added the #157 row and made the board Evidence field the PR link.

## Branch tips before deletion (task 4)

Each tip below matches the local branch tips listed before deletion and is the merged PR's head (`refs/pull/<n>/head`), so `git fetch origin pull/<n>/head` restores it.

| Branch                                           | Tip            | PR   |
| ------------------------------------------------ | -------------- | ---- |
| `codex/harden-h1-retire-substitute-twins`        | `70c8eecb51f6` | #128 |
| `codex/harden-h2-approve-latest-qc`              | `c69d77c86fee` | #134 |
| `codex/harden-h3-derived-status`                 | `ed228ed37e8e` | #137 |
| `codex/harden-h4-pool-process-resilience`        | `ec9a1720fdb9` | #131 |
| `codex/harden-h5-reviewer-workspace`             | `e2019dc962ff` | #139 |
| `codex/harden-h6-csrf-guard`                     | `695130c3f37f` | #132 |
| `codex/harden-h7-qc-fail-closed`                 | `6647b8929b18` | #141 |
| `codex/harden-h8-ready-scopes-disposition-stamp` | `f14e3cc68820` | #143 |
| `codex/harden-h9-disposition-authz`              | `6a8b67957008` | #140 |
| `codex/harden-h10-observability-contract`        | `7833fd6f1957` | #129 |
| `codex/harden-h11-fail-closed-config`            | `2df299a35ead` | #133 |
| `codex/harden-h12-new-case-upload-reason`        | `8d8abe5ce536` | #142 |
| `codex/harden-h13-notifications`                 | `c2ce87c6b90f` | #145 |
| `codex/harden-h14-browser-harness`               | `413ecfea5e67` | #136 |
| `codex/harden-h15-perf-harness`                  | `adccba1a21d0` | #135 |
| `codex/harden-h16-evidence-records`              | `436d1a4e9c55` | #138 |
| `codex/harden-h17-idempotency-race`              | `012b385fa67a` | #130 |
| `codex/harden-h18-latest-disposition`            | `60f2df4c4701` | #146 |
| `codex/harden-h19-composition-root`              | `9e79dc01ace6` | #148 |
| `codex/harden-h20-workflow-refs`                 | `cc8fcc41f97e` | #147 |
| `codex/harden-h21-unauthenticated-handler`       | `012928501bed` | #144 |
| `codex/harden-h22-fixture-app`                   | `f52369df976f` | #149 |
| `codex/harden-h23-fixture-app-part2`             | `3358a19e6843` | #150 |
| `codex/harden-h25-no-false-action-failed`        | `637a17b9082b` | #153 |
| `codex/harden-h26-version-decisions`             | `bfe090813b0d` | #152 |
| `codex/harden-h27-send-back-feedback`            | `c54c739cdfd3` | #154 |
| `codex/harden-h28-lane-qc-once`                  | `3981736c3610` | #156 |
| `codex/harden-h29-draft-editor-scope`            | `fd6e7363cf26` | #155 |
| `codex/w3-hardening-handoff`                     | `06fb043e6781` | #157 |
