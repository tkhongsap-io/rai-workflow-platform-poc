# Plan

1. **Review workflow (read-only).** Parallel reviewers over main: retro-review of #90-#95 (lanes, decisions, send-back, resubmit, dispositions); retro-review of unreviewed W3 PRs (queue, SLA, notifications, retries, digest, operator); architecture and simplification; resilience and security. A skeptic per finding. Output: confirmed findings grouped into non-overlapping fix batches by module.
2. **Fix workflow.** One PR per batch through implement → full suite → two independent reviewers (verdicts posted as PR comments) → fix loop → CI. Batches touching the same module run sequentially. Merged by the session after both reviewers pass and CI is green.
3. **Records.** Status table, labels, branches, DEVLOG, CHANGELOG, walkthrough script, #35 options brief.
4. **Final verification workflow.** Clean checkout of main: full suite, a fresh reviewer confirming each confirmed finding is closed, docs consistency. Record in review.md.
