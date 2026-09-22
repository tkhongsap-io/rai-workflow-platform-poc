# W3-07b operator UI intent

Prepare the Lane B operator-page slice of parent [issue #48](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/48), under the owner's explicit W3-07a/API and W3-07b/UI split. Outcome: an implementation-ready plan for Admin-only `/operator/desk-health`, with an honest OBS-17 proof boundary.

Authority: [W0-10](../../docs/engineering/observability-contract.md) sections 7–8 and OBS-17, [implementation plan](../../docs/engineering/implementation-plan-w1-w3.md), D06/D12 and ADR-0003. Initial planning base was `89f7de9`; the proposed W3-07a contract is read-only input from `/tmp/rai-w3-observability-contract`, HEAD `44dc9c4` plus uncommitted schema/spec fixes observed on 2026-09-22. That initial snapshot was provisional. Parent subsequently supplied committed contract `d931cea`; reconciliation is recorded in review.md. Its pending re-review and merge are not acceptance evidence.

Parent accepted the plan and authorized a separate local UI prerequisite commit followed by a separate consumer commit, with the first commit reported before consumer work. Supplied base `9980c7e` includes validated W3-07a schemas and main `a2392c9`; the planning work has been rebased onto that base. No runtime server, auth policy, fixtures endpoint, database, migration, new dependency, CI, retry/send controls or production work. Local commits are authorized; no push, PR or merge. Parent owns issue updates, prerequisite sequencing and delivery.

Done for this pass: accepted file-level plan and a verified additive locale/routes/client prerequisite, reported as its own local commit. The UI consumer and its privacy/accessibility rehearsal remain a separate commit; real-server acceptance remains W3-INT.
