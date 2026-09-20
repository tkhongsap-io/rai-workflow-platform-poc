# Implementation plan: idle until authorized

Repository/docs setup is complete only when the [foundation review](../changes/2026-09-20-documentation-foundation/review.md) passes. It is not slice 1.

## Start gate

Record D01 operator confirmation, D02 document mapping and D03 explicit Ta start instruction. Then choose a stack in an ADR and write a file-level slice plan before code. This new standalone repository is the engineering home requested by Ta; the Life-OS idea is retained as source, not moved or relabeled as implementation started.

| Slice | Deliverable after authorization | Evidence and failure path |
|---|---|---|
| 1 | One synthetic case, nine slots, immutable versions, three lanes, queue, test mail, localhost login | Create/upload/submit/send-back/v2/three approvals; reject cross-user access and stale approvals; mail failure visible |
| 2 | Soft QC at all three triggers | Extraction≠hallucination defect; v2.0 isolation; model failure surfaced; submit remains available |
| 3 | Versioned risk proposal | Two approved reference cases plus boundary/PII/Unknown tests; Council qualification visible |
| 4 | Admin config | Threshold/SLA revision affects next run without redeploy; old evidence keeps original revision |
| 5 | Operator rehearsal on 3-5 approved cases | Operator completes workflow unaided; record defects/feedback, no assumed sign-off |
| 6 | True-hosted, AD-only production | Approved identity/data/retention/runbook, live integration tests, evaluation, restore and rollback exercise |

Slice-1 scope should prove one vertical path before broader UI polish. Testing starts with synthetic cases; real-case rehearsal requires data permission. Local model calls, credentials, stack starters and CI are not part of this documentation phase.

## Release and rollback design obligations

Use staged exposure: localhost → closed sandbox → production after human gates. Before each expansion, reclassify risk and review changes in data/users/authority. Name a release identity and last-known-good state; prove backup restoration and config rollback without erasing audit history. Stop conditions include cross-case disclosure, unauthorized approval, lost versions and incorrect readiness. Operator must be able to stop access/notifications/model calls outside the model. Actual commands belong in a stack-specific runbook written and tested later.
