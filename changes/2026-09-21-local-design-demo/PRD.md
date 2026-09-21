# Local Claude-design demo PRD

2026-09-21. Authorized by Ta: implement the reviewed Claude design in this repository, run locally for the team, and implement and execute unit and end-to-end tests. This is a frontend demonstration, not production rollout or approval of D01-D11.

## Authority and scope

Visual and interaction reference: https://claude.ai/artifact/25FPuPyj6aczLrXca3P9Mz (Main interactive artboard, final third iteration). Product semantics remain governed by the root PRD and frozen source. Preserve exact authored design source where export permits; do not substitute a merely similar reconstruction. Source and reference versions must be recorded.

## Revised acceptance, 2026-09-21

Ta explicitly accepts small visual differences. Functional journeys and passing unit/localhost end-to-end tests are the hard gate. The [functional gate](functional-gate.md) records the plan, additional coverage, defects, fixes and rerun results. Literal zero-pixel certification is no longer required.

## Requirements

| ID | Requirement | Proof |
|---|---|---|
| LD01 | One documented command starts on loopback and works without Claude login | Local HTTP and browser smoke test |
| LD02 | Same True styling, spacing, text, geometry and assets as the authored Main design | Matched-state, matched-size reference/local visual comparison at 1440/834/390 |
| LD03 | Owner/SPOC queue, filters/new case, nine slots and simulated evidence/QC | End-to-end creation/submission tests |
| LD04 | Parallel reviewer decisions, send-back/v2, frozen history | Unit and browser transition checks |
| LD05 | Current-version approvals plus dispositions before Ready, reason validation | Positive/negative unit and end-to-end cases |
| LD06 | Six demo roles, scoped views and own-lane controls | Permission matrix unit and browser checks, no real-auth claim |
| LD07 | Version-specific QC, unavailable state, risk scenario, notifications and Admin revision | Unit and browser checks |
| LD08 | Reproducible reset and documented synthetic demonstration limits | Reset test and runbook |
| LD09 | Implement repeatable unit and end-to-end suites; execute and record results | Checked-in tests and actual output |
| LD10 | Inspect/fix visual discrepancies and runtime failures | Review evidence, no unsupported zero-bug or pixel-identical claim |

Pixel fidelity refers to the app artboard, excluding Claude editor/sidebar chrome. Browser/font/device differences must be controlled or disclosed. No visual acceptance based solely on matching color tokens. A screenshot of one state cannot prove all screens. If source/runtime export is unavailable, record the specific fidelity gap rather than claiming equivalence.

No real AD, document storage, AI evaluation, email or production authorization. No deployment or commit/push is implied by this request. Existing draft files are preserved until their provenance and reuse decision is recorded.
