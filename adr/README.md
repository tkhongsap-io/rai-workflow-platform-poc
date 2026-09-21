# Architecture decisions

Use [TEMPLATE.md](TEMPLATE.md). Agents may draft an ADR; only Ta and the tech lead record acceptance.

| ADR | Status | Decision ID | Drafted at (spec source) |
|---|---|---|---|
| [0001 review-desk documentation foundation](0001-review-desk-documentation-foundation.md) | Accepted | — | Docs |
| [0002 local execution of the authored design](0002-local-design-demo.md) | Accepted (synthetic demo only; not D04) | — | Demo |
| [0003 stack and deployment boundary](0003-stack-and-deployment-boundary.md) | Accepted (D04, 2026-09-21) | D04 | W0-01 |
| 0004 identity and exposure modes | Reserved, not written | D10 (production part) | W7-00 / W8, at the D10 gate (configuration shape from the [W0-03 identity adapter spec](../docs/engineering/identity-adapter.md)) |
| 0005 persistence, version immutability and audit | Reserved, not written | D08 (retention part) | W7 entry, at the D08 gate (options only from the [W0-04 spec](../docs/engineering/persistence-and-artifact-store.md), "Retention and deletion" section) |
| 0006 QC boundary and model data handling | Reserved, not written | D08, D09 | W4 entry |
| 0007 production deployment and operations | Reserved, not written | D10 | W8 entry |

Reserved ADRs have not been written. Their absence is deliberate deferral, not implicit selection. 0003 records D04 as accepted by Ta on 2026-09-21. 0004-0007 are drafted no earlier than the gate of the decision they record; W0-03 and W0-04 produce interface specs in docs/engineering/, not ADRs.
