# Playbook adoption

Pinned source: [tkhongsap-ai-engineering-playbook](https://github.com/tkhongsap-io/tkhongsap-ai-engineering-playbook/tree/b0ee7f088e0367d4690bfc30ea926da57913805b), commit `b0ee7f088e0367d4690bfc30ea926da57913805b`.

Guidance inspected: README; handbook/philosophy.md and risk-tiers.md; playbooks/adopt-in-a-project.md; agents/agent-contract.md; standards/README.md, documentation.md, architecture.md, security-and-governance.md and testing-and-evaluation.md (relevant excerpts); templates/README.md, plan.md and review.md. This is scoped adoption, not a claim that every playbook control was audited.

| Practice | Evidence here | Status |
|---|---|---|
| Context, control, verification separated | README/AGENTS, DEVLOG, TESTING | Documented |
| Intent → spec → committed plan → review | changes/2026-09-20-documentation-foundation | Established for this change |
| Explicit authority and non-goals | Source snapshot, decision register, ADR-0001 | Documented |
| Smallest meaningful vertical slice | One synthetic pack with send-back and three approvals | Planned, not implemented |
| Source identity and evidence | sources.md hashes; acceptance mapping | Documented |
| Review by correctness/security/compliance lens | Change review, with limits | Self-review only |
| Risk-appropriate controls | Threat model; production release gates | Proposed, untested |
| Runtime tests, evals, observability and rollback | Acceptance/evaluation plans | Deferred until authorized implementation |
| Toolchain, dependencies, CI and deployment | None selected or installed | Intentionally deferred |
| Independent review and formal acceptance | Owner/operator and specialist gates | Pending |

Only relevant document structures were adapted; no application starter was generated. There is no blanket baseline-compliance claim. The engineering risk posture is provisional and separate from each use case's business risk tier. Qualified security review is required before live data or deployment.

The current setup request authorizes the private documentation repository, not application implementation. Changes to the playbook pin require a reviewed adoption diff. Future feature work records intent/spec/plan first, then implements and proves a bounded slice after Ta's start authorization.
