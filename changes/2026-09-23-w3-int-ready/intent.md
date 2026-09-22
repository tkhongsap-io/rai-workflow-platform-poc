# Ready workspace regression

Parent initially authorized planning in codex/w3-int-ready from a055ccd8df6cd77ffea57d6a75d8ed6fe71884b8. Hypatia confirmed the final-approval refresh remounts ReviewerWorkspaceBody, whose reviewer path posts lane QC even after Ready; the server correctly rejects that mutation with 409 and the UI presents a false error. The five-path plan was subsequently approved for implementation, local verification and a local commit; no push.

Restore read-only viewing of persisted findings after completed Ready, including disposition-triggered Ready. Preserve genuine errors, server authorization and the existing in-review policy. Parent owns main INT, shared journey integration, publication and final evidence.
