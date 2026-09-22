# Plan recorded before code

## QC prerequisite correction before execution

Parent/INT confirmed that the default substitute maps only canonical fixture IDs; newly created IDs return unavailable. Correct spec, runbook and review to require INT's separately implemented, approved and guarded test-only single qcRunner override, with an explicit completed/no-findings scenario for new synthetic IDs and the same instance for run/probe. Require startup identity and actual server DB-boundary evidence before seeding. Preserve all QC/approval assertions. This correction is documentation-only: the current harness has no override configuration to validate, so a pure test cannot prove runtime injection or its guard. No DB actions or benchmark; execution waits for merged final W3-INT and parent authorization.

1. Append a scoped lead-lane claim; preserve every other worktree.
2. Add one harness module under rai-web/tests/performance/: core.ts (pure guard/percentile/queue validation and typed HTTP client), queue-seed.ts (real API workflow and manifest), queue-measure.ts (sampling and optional duration join), core.test.ts and local tsconfig.json. Exports only: no import-time network or database work; manual existing tsx invocation, no command registration.
3. Use canonical loader only as an external prerequisite; require its five exact draft IDs before adding 995 cases. Real create/save/submit/send-back/QC/approve endpoints create all states. A partial seed fails and requires a separately authorized isolated reset; no destructive recovery hidden in the harness.
4. Pure tests cover wrong DB/role/port refusal, percentile and response/log validation, and deterministic recipe/scope/search expectations. Install dependencies independently; run only focused pure tests, lint/typecheck and repo documentation checks. No server, Docker, DB helper, seed or benchmark execution.
5. Record exact preparation evidence, limitations, runnable manual invocation and parent/final-head gate. Obtain independent read-only review. Keep the 600-line working rule; if the cohesive module cannot fit, propose a split before expanding.

## Cohesive split proposal before expansion

The fully formatted module exceeds 600 lines. Keep two local review slices: (1) pure guard/client/oracle/manifest validation, measurement, pure core tests and preparation record; (2) real-API seed, deterministic recipe test and execution/feasibility record. Each commit remains below 600 changed lines. These are proposed future review/PR boundaries, not permission to publish a combined oversized PR. Both stay on the held branch for the parent; no new issue or PR.
