# Implementation plan

Plan updated before new implementation to satisfy exact-design requirement. See [PRD](PRD.md).

1. Inspect existing uncommitted draft and source design. Capture original HTML/component/style/runtime via supported export, record hashes and provenance. Preserve earlier draft if replacing it.
2. Prefer original exported design in demo/ with minimal local runtime adapter. Update ADR with actual export findings before choosing a reconstruction. Keep app free of cloud services and serve only demo assets on loopback.
3. Separate testable state/transition functions or test original component handlers through a deterministic harness. Unit tests must target source actually used by the app, including negative role/version/Ready/config cases.
4. Implement repeatable end-to-end browser tests using observed selectors: create/submit, send-back/resubmit/history, three lane approvals/dispositions, Admin revision, QC versions/unavailable, reset and responsive interactions. Execute browser work with the supported computer-use API.
5. Capture matched reference/local states and dimensions, compare geometry/styles and rendered screenshots; repair discrepancies. Record precise comparison coverage and limitations.
6. Add runbook and commands, local smoke proof, unit/end-to-end results, visual evidence and requirement-by-requirement audit. Update root navigation/control/testing to describe the authorized demo exception. Preserve frozen source/product gates.

Do not mark complete while runnable code, required tests or visual evidence remain missing. No publication requested for this build turn.
