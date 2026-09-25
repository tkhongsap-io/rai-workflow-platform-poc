# Plan

1. **Read.** AGENTS.md; BUILD_PLAN W4 and the 2026-09-25 status; the decision register; the delivery README, G0 briefs, later-packages outline, team and roles and slice-1 breakdown; the evaluation plan; the threat model; W0-07 sections 1-3; the W0-08 limits and D08 revisit list; acceptance A08 and A09; the source spec "QC" section (cited, not quoted at length); W3 hardening review section 5; the #35 owning-lane spec.
2. **Board.** Append a CLAIM and an entry to the decisions-and-docs stream (append-only).
3. **Write** the two delivery documents on branch `codex/w4-gate-briefs`, created from `origin/main`.
4. **Link** them from the delivery README and the later-packages outline without changing any other text.
5. **Check** from the repository root: `node scripts/check-links.mjs`, `node scripts/check-frozen-source.mjs`, `git diff --check`, and prettier `--check` on the new files only.
6. **Commit** on the branch. No push, PR or merge; the branch goes back to Ta.
