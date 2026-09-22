# W1-11 promotion plan

Recorded before implementation.

1. Verify PR #68 base and source commit; inspect current contracts and all lane streams. Claim only this dependency promotion in Lane C.
2. Restore only `rai-web/fixtures/src/substitutes/mail-sink/` from the PR merge commit. Add its export to the current fixture index without replacing existing exports. Do not copy historical change records or shared contract files.
3. Resolve current interface or harness differences within the promoted module; add focused regressions only when needed.
4. Install the locked dependencies in this worktree; run focused mail tests, full units, lint, typecheck, build and substitute-absence checks. Run repository checks and integration tests using an isolated local synthetic database where available.
5. Record results, scope and dependencies in review.md; inspect and commit explicit paths locally. Parent arranges independent review and PR; no push or merge.

## Carver review correction

Serialize delivery attempts per dedup key in BaseMailSink, rechecking accepted state inside the queue. Release the queue in finally on success or failure. Add gated concurrent-success and record-failure-then-retry regressions for both concrete sinks, including unrelated-key progress. Run focused, database-free tests only while the parent owns verify:full in this worktree. Update provenance and separate pre-fix broad-suite evidence from post-fix results; local commit only.
