# Plan — recorded before implementation

1. Reconcile W0-10/W0-07 engineering contracts: safe category fields, HTTP versus job error capture, nullable historical QC reason, durable late-QC refusal, digest run-to-notification linkage. Preserve unresolved owning-lane and W4+ product gates.
2. Add shared readiness/operator schemas and typed safe error-field schemas; amend section 7.8 of the implementation plan. Do not modify server consumers.
3. Add Drizzle definitions and the next additive migration after 0006: reserve 0007_w3_07a_observability, subject to parent coordination. Add operator_job_run, append-only operator_job_notification linkage, append-only qc_late_result and nullable qc_run.unavailable_reason. Old rows stay null; API maps null to unknown. No fabricated history.
4. Coordinate digest writer semantics with Hypatia through the parent: record start before work, link enqueued notifications transactionally, finish once, keep one correlation ID, no business audit event for a scheduled digest.
5. Test schema rejects unsafe/invalid values; test migration from 0006, role grants, constraints, immutability, old QC nulls and durable linkage using only an isolated database on port 54364. Run lint/typecheck/unit and repository checks. Record exact results and unimplemented OBS acceptance separately.
6. Inspect diff and commit locally with explicit files. Parent reviews; do not push, open PR, merge or implement consumers.

Done when: shared shapes and persistence are coherent and mechanically checked; engineering reconciliation names owners and observable future OBS tests; no scope decision is invented. Submit-trigger QC is W3-INT acceptance against the synthetic runner, not real QC. Durable lateQc remains required.
