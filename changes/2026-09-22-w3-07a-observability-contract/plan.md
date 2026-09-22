# Plan — recorded before implementation

1. Reconcile W0-10/W0-07 engineering contracts: safe category fields, HTTP versus job error capture, nullable historical QC reason, durable late-QC refusal, digest run-to-notification linkage. Preserve unresolved owning-lane and W4+ product gates.
2. Add shared readiness/operator schemas and typed safe error-field schemas; amend section 7.8 of the implementation plan. Do not modify server consumers.
3. Add Drizzle definitions and the next additive migration after 0006: reserve 0007_w3_07a_observability, subject to parent coordination. Add operator_job_run, append-only operator_job_notification linkage, append-only qc_late_result and nullable qc_run.unavailable_reason. Old rows stay null; API maps null to unknown. No fabricated history.
4. Coordinate digest writer semantics with Hypatia through the parent: record start before work, link enqueued notifications transactionally, finish once, keep one correlation ID, no business audit event for a scheduled digest.
5. Test schema rejects unsafe/invalid values; test migration from 0006, role grants, constraints, immutability, old QC nulls and durable linkage using only an isolated database on port 54364. Run lint/typecheck/unit and repository checks. Record exact results and unimplemented OBS acceptance separately.
6. Inspect diff and commit locally with explicit files. Parent reviews; do not push, open PR, merge or implement consumers.

Done when: shared shapes and persistence are coherent and mechanically checked; engineering reconciliation names owners and observable future OBS tests; no scope decision is invented. Submit-trigger QC is W3-INT acceptance against the synthetic runner, not real QC. Durable lateQc remains required.

## Combined-main verification and bounded size exception — 2026-09-22

Owner requested merging main a26edc0 and full verification before parent review. Merge 44dc9c4 preserves both Lane A claims; root logs and implementation amendments merged automatically. No queue behavior changes: the only branch delta in shared queue.ts remains the W0-10 observability re-export.

Declared contract exception to the working-agreement size/module rule: the approximately 880 non-generated lines at initial review (plus generated Drizzle snapshot) are one prerequisite unit: operator/readiness/error types, the migration enforcing those records, and schema/migration regression tests. The migration and shared types must describe the same historical-unknown, daily-dedup, provenance and late-result semantics. Splitting them into independently mergeable PRs would leave consumers able to adopt an incomplete contract. This exception covers only this prerequisite and its proof; no runtime consumer, UI, composer, retry job or QC execution is included. Parent/Carver review must accept this bounded exception before PR publication; if rejected, split into two explicitly dependent PRs (shared shapes/spec first, persistence and its integration test second), with consumers blocked until both merge.

Run verify:full on the combined tree using isolated Postgres 54364, real browser 38788, substitute API 38789 and substitute web 35175. Include the opt-in migration smoke test in that run. Record actual results and any compatibility fix without claiming new observability consumers.
