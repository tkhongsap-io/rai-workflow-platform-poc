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
| Runtime tests, evals, observability and rollback | Acceptance/evaluation plans | Authorized (D03); arrive with the W0-W3 tickets, nothing built yet |
| Toolchain, dependencies, CI and deployment | Stack selected and recorded in [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04, 2026-09-21): TypeScript on Node 24, Fastify serving a React + Vite SPA, Postgres 16 with Drizzle, openid-client, node:test and Playwright. Nothing installed yet | Selected (D04); pinned versions in W0-02, installation under W1-00/W1-12 |
| Independent review and formal acceptance | Owner/operator and specialist gates | Pending |

Only relevant document structures were adapted; no application starter was generated. There is no blanket baseline-compliance claim. The engineering risk posture is provisional and separate from each use case's business risk tier. Qualified security review is required before live data or deployment.

## s42-ci-platform planning conventions (2026-09-21)

Compared against the sibling repository `~/github/s42/s42-ci-platform` at the owner's request. Adoption is structural only; s42 is a running product and this repository has no code.

| s42 element | Decision | Where |
|---|---|---|
| Build principles section | Adopted | BUILD_PLAN "Build principles" |
| Risks and mitigations table | Adopted | BUILD_PLAN "Delivery risks and mitigations" |
| "Decisions to lock" list | Adopted, without calendar phrasing; converted to a recorded list at G0 close | BUILD_PLAN "Decisions recorded before W0" |
| Dated "Status against this plan" with divergence section | Adopted | BUILD_PLAN |
| Per-phase task tables with Done when and a milestone | Adopted; Size column and time estimates rejected until after D04 | docs/delivery/slice-1-work-breakdown.md |
| Per-phase PRDs with numbered user stories and loops | Rejected; ticket IDs, lanes and changes/ records cover it | — |
| ADR template and numbered index | Adopted with reserved, unwritten ADRs tied to D-items | adr/TEMPLATE.md, adr/README.md |
| Architecture README mapping layers to repo paths | Adopted with paths deferred to W0-02 | docs/architecture/README.md |
| Append-only board with lane streams and CLAIM rule | Adopted | docs/board/ |
| AGENTS.md carrying live runtime state | Rejected; there is no runtime | — |
| Assemble-from-sibling-repos principle | Rejected; no sibling repos and it would pre-empt D04 | — |

D03 (2026-09-21, [register](../product/decisions.md)) authorizes W0-W3 on synthetic data; the stack was selected in W0-01 (ADR-0003, D04); W0-02 pins dependencies and CI checks, and W1-00/W1-12 install them, so the "Toolchain" row above stays at "Selected" until those tickets merge. Changes to the playbook pin require a reviewed adoption diff. Feature work records intent/spec/plan first, then implements and proves a bounded slice inside its ticket.
