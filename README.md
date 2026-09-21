# RAI Workflow Platform PoC

**Working product name: RAI web. Status: documentation, interactive design and runnable synthetic local demo. Production application implementation is not authorized.**

A review desk for one submitted AI-use-case pack, with parallel AI/COE, DPO and IT/Security review, versioned send-back and soft document QC. This is not True's official AI register and does not operate the eight-stage AI lifecycle.

## Product and build anchors

- **[PRD.md](PRD.md)** — problem, users, scope, requirements and success criteria.
- **[BUILD_PLAN.md](BUILD_PLAN.md)** — ordered work packages, dependencies, deliverables and evidence required to finish each one.

These are the starting points for the future app build. The plan under changes/2026-09-20-documentation-foundation covers repository setup only.

## Workflow design

Start with the [interactive design handoff](docs/design/DEVELOPER_HANDOFF.md), [browser test evidence](docs/design/TEST_RUNS.md), and [Claude Design artifact](https://claude.ai/artifact/25FPuPyj6aczLrXca3P9Mz) (owner-private). The [workflow and card brief](docs/design/WORKFLOW_DESIGN.md) anchors the journeys. The matching local demonstrator is available in [demo/](demo/README.md); production implementation remains gated.

## User journey

One document pack goes through three parallel reviews. Corrections create a new version; completion requires all three current-version approvals and a recorded disposition for every finding.

```mermaid
flowchart TD
    A["Owner / BU SPOC: open review queue"] --> B["Create or open case<br/>External record ID, or Unknown"]
    B --> C["Prepare nine document slots<br/>Attached / Not yet / Missing / N/A with reason"]
    C --> D["Submit version N<br/>QC records findings; risk tier is proposed"]
    D --> E["Open all three review lanes together<br/>Reviewers inspect evidence and findings"]
    E --> F["AI / COE"]
    E --> G["DPO"]
    E --> H["IT / Security"]
    F --> I{"Any lane sends back?"}
    G --> I
    H --> I
    I -- Yes --> J["Owner receives artifact-specific feedback"]
    J --> K["Correct and resubmit version N+1<br/>Previous submission remains readable"]
    K --> D
    I -- No --> L{"Three approvals for<br/>the current version?"}
    L -- No --> M["Await remaining lane decisions"]
    M --> I
    L -- Yes --> N{"Every finding dispositioned?"}
    N -- No --> O["Record outstanding dispositions<br/>Fixed with evidence / Waived with reason / N/A with reason"]
    O --> N
    N -- Yes --> P["Review desk complete<br/>Current label: Ready for launch"]
    P -. Separate authorization .-> Q["Council / ITSM governance<br/>Outside this platform"]
    classDef step fill:#F3F4F6,stroke:#CBD5E1,color:#303C46;
    classDef gate fill:#FFF4E5,stroke:#D69E36,color:#303C46;
    classDef done fill:#E00000,stroke:#E00000,color:#FFFFFF;
    class A,B,C,D,E,F,G,H,J,K,M,O,Q step;
    class I,L,N gate;
    class P done;
```

The decision diamonds summarize the combined case state; each lane can decide independently without waiting for the others. Finding dispositions may be recorded during review, not only after the third approval.

- **Parallel review:** all three lanes open, including for High-risk cases. High-risk Council confirmation remains external; it is not automatically granted by this flow.
- **Soft QC:** checks run on artifact attachment, submission and approval attempts. Findings do not prevent submission or lane approval, but must be dispositioned before desk completion.
- **Correction loop:** the demo resets approvals on resubmission and requires all three lanes to review the new version. Production re-review, concurrency, disposition authority and self-approval rules remain pending under D05.
- **Notifications:** the intended product sends links back to the case. The demo only previews notifications; email is not the approval record.
- **Completion:** the current label is “Ready for launch,” meaning review-desk completion only. “Review complete” is a suggested future label, not an approved change.

The local demo uses synthetic attachments, simulated QC/risk and a role switcher. It does not implement authentication, real uploads, email delivery or persistence. Admin configuration supports the journey but does not grant lane-approval authority.

Sources: [product requirements](PRD.md), [authoritative v1 rules](docs/product/source-spec.md), [verified demo journeys](changes/2026-09-21-local-design-demo/functional-gate.md), and [open production decisions](docs/product/decisions.md).

## Supporting contracts

1. Read the [v1 source specification](docs/product/source-spec.md) and [open decisions](docs/product/decisions.md).
2. Follow the [workflow](docs/product/workflow.md), [data contract](docs/product/data-contract.md) and [planned architecture](docs/architecture/README.md).
3. Review [acceptance criteria](docs/acceptance.md), [QC evaluation](docs/evaluation/plan.md) and [threat model](docs/security/threat-model.md).
4. Use the [implementation plan](docs/implementation-plan.md) only after its start gate is satisfied.

## Repository map

| Path | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent authority and context |
| [DEVLOG.md](DEVLOG.md), [CHANGELOG.md](CHANGELOG.md) | Current state and change history |
| [TESTING.md](TESTING.md) | Documentation checks now; runtime gates later |
| [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) | Change and security handling |
| [docs/sources.md](docs/sources.md) | Source identity, hashes and precedence |
| [docs/engineering/adoption.md](docs/engineering/adoption.md) | Pinned playbook and adoption gaps |
| [adr/README.md](adr/README.md) | Architecture decisions |
| [changes/2026-09-20-documentation-foundation/intent.md](changes/2026-09-20-documentation-foundation/intent.md) | Intent, spec, plan and verification trail |

Run the local design with `python3 demo/serve.py`, then open http://127.0.0.1:5173/. See the [demo PRD](changes/2026-09-21-local-design-demo/PRD.md), [demo plan](changes/2026-09-21-local-design-demo/plan.md) and [verification report](changes/2026-09-21-local-design-demo/review.md). Production stack, model provider, database and hosting decisions remain open.

## Before building

Ta must explicitly authorize application implementation. Nakhun's written confirmation of the review-desk scope, operator role and proposed SLA is pending. The AI/COE lane's second document needs confirmation. See the [decision register](docs/product/decisions.md). Repository creation is not that authorization.

Production identity is True AD/Entra on True's network; any Google account is allowed only on localhost. A networked test deployment needs an allow-list or AD. Ready for launch means review-desk completion only; it is not Council approval or an ITSM deployment authorization.
