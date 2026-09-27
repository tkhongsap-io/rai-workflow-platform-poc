# Architecture decisions

Use [TEMPLATE.md](TEMPLATE.md). Agents may draft an ADR; only Ta and the tech lead record acceptance.

| ADR | Status | Decision ID | Drafted at (spec source) |
|---|---|---|---|
| [0001 review-desk documentation foundation](0001-review-desk-documentation-foundation.md) | Accepted | — | Docs |
| [0002 local execution of the authored design](0002-local-design-demo.md) | Accepted (synthetic demo only; not D04) | — | Demo |
| [0003 stack and deployment boundary](0003-stack-and-deployment-boundary.md) | Accepted (D04, 2026-09-21) | D04 | W0-01 |
| 0004 identity and exposure modes | Reserved, not written | D10 (production part) | W7-00 / W8, at the D10 gate (configuration shape from the [W0-03 identity adapter spec](../docs/engineering/identity-adapter.md)) |
| 0005 persistence, version immutability and audit | Reserved, not written | D08 (retention part) | W7 entry, at the D08 gate (options only from the [W0-04 spec](../docs/engineering/persistence-and-artifact-store.md), "Retention and deletion" section) |
| [0006 QC engine and extraction](0006-qc-engine-and-extraction.md) | Provisional (W4-01, 2026-09-27; made by the agent team under Ta's delegation of 2026-09-27); acceptance by Ta and the tech lead moves to the W4b exit review (W4-14) | D08, D09 (working assumptions only; both stay open) | W4b entry (runner port and substitute from the [W0-07 spec](../docs/engineering/qc-boundary-and-mail-sink.md)); scope and options in the [W4b plan](../docs/engineering/implementation-plan-w4b.md) decisions 5, 7, 8, 12-16 and 27. W4a runs deterministic metadata rules in-process under the [W4-00a plan](../docs/engineering/implementation-plan-w4a.md) and needs no ADR-0006 |
| 0007 production deployment and operations | Reserved, not written | D10 | W8 entry |

Reserved ADRs have not been written. Their absence is deliberate deferral, not implicit selection. 0003 records D04 as accepted by Ta on 2026-09-21. 0006 is written but provisional: it records the W4b plan's provisional rulings and the D08/D09 working assumptions, names no model provider or hosting, and is not accepted until Ta and the tech lead record acceptance at the W4b exit review. 0004, 0005 and 0007 are drafted no earlier than the gate of the decision they record; W0-03 and W0-04 produce interface specs in docs/engineering/, not ADRs.
