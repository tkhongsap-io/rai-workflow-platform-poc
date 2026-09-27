# Intent: plan W4b, W5, W6 and W7 under Ta's delegation (W4-00b, W5-00, W6-00, W7-00a)

In the Claude Code session of 2026-09-27 Ta directed the agent team to implement W4b, W5, W6 (with a desk dashboard) and W7 on synthetic data, and to keep going until the build is done. The north star is a working RAI review platform that streamlines the review workflow, tracks version history and shows a dashboard, running end to end on synthetic data. The team will tune the details later. W8 is out of scope; a later host (possibly Replit) is Ta's choice and is not part of this work.

Ta delegated to the agent team every choice that would otherwise stop the build for Ta's input. For each such question the team writes two or three options with trade-offs, recommends the one that best serves the north star, and records it as a **provisional** choice "made by the agent team under Ta's delegation of 2026-09-27", for Ta to confirm or replace. Questions whose recorded owner is not Ta stay open for that owner: D07 (AI/COE), D08 (DPO + IT/Security), D09 (AI/COE lead + lane experts) and D10 (IT/Security + accountable owner). For those, the build uses labelled working assumptions that are configuration, not hard-coding.

This change records that direction and adds the four file-level plans that must merge before any W4b-W7 code:

- [W4b plan](../../docs/engineering/implementation-plan-w4b.md): content QC, extraction in an isolated worker, a disabled-by-default model port, finding dedup, a frozen synthetic evaluation set.
- [W5 plan](../../docs/engineering/implementation-plan-w5.md): the risk proposal on a labelled synthetic placeholder rubric.
- [W6 plan](../../docs/engineering/implementation-plan-w6.md): Admin configuration with drafts, publish and restore; explicit rechecks; desk controls; the operator guide; the desk dashboard.
- [W7 plan](../../docs/engineering/implementation-plan-w7.md): backup, restore and rollback; `network` identity with the allow-list; directories and the mail file drop; the synthetic rehearsal kit.

It also consolidates the four plans against one another, and it records the gate entries, the delegated rulings and the status lines. Hard limits: synthetic data only, no external network call from the product or its tests, no deploy, and no claim that an owner approved anything. W4a's package review is still Ta's and is not recorded as accepted here.
