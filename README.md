# RAI Workflow Platform PoC

**Working product name: RAI web. Status: documentation only. Application implementation is not authorized.**

A review desk for one submitted AI-use-case pack, with parallel AI/COE, DPO and IT/Security review, versioned send-back and soft document QC. This is not True's official AI register and does not operate the eight-stage AI lifecycle.

## Product and build anchors

- **[PRD.md](PRD.md)** — problem, users, scope, requirements and success criteria.
- **[BUILD_PLAN.md](BUILD_PLAN.md)** — ordered work packages, dependencies, deliverables and evidence required to finish each one.

These are the starting points for the future app build. The plan under changes/2026-09-20-documentation-foundation covers repository setup only.

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

There is no install, build or run command yet. No stack, model provider, database, hosting or dependencies have been selected. The first success today is to review the contract; the first implementation success will be one synthetic case through a send-back and three approvals.

## Before building

Ta must explicitly authorize application implementation. Nakhun's written confirmation of the review-desk scope, operator role and proposed SLA is pending. The AI/COE lane's second document needs confirmation. See the [decision register](docs/product/decisions.md). Repository creation is not that authorization.

Production identity is True AD/Entra on True's network; any Google account is allowed only on localhost. A networked test deployment needs an allow-list or AD. Ready for launch means review-desk completion only; it is not Council approval or an ITSM deployment authorization.
