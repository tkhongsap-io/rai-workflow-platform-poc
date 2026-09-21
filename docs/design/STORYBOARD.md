# Card workflow storyboard

Initial card concept, superseded by the interactive Claude Design artifact and [developer handoff](DEVELOPER_HANDOFF.md). The earlier Canva attempt was blocked by authentication; the owner subsequently selected Claude Design. Source: [workflow design brief](WORKFLOW_DESIGN.md). Synthetic case: Service FAQ assistant; external source Unknown.

## Composition

Proposed desktop frame: 1440 × 1024. Shared header contains product name, current role and navigation back to the queue. Case screens repeat case name, version and status before content. Use white surfaces, dark ink and restrained True Red actions; amber finding labels include text. Current brand tokens and provenance are in the developer handoff.

Queue uses a two-column case-card layout. Case detail uses a full-width heading, three equal lane cards in one row, then an open document or finding list. Do not nest cards. Version history uses a chronological list. Narrow screens stack lanes with a label “Parallel review”.

## Frame sequence and exact actions

### A: Find the case

Review queue → case card titled Service FAQ assistant. Card shows version 1, In review, source Unknown, Example owner / Example BU. Lane labels: AI/COE pending; DPO pending; IT/Security approved. Text: 2 open findings. Action: Open case.

Owner draft view instead offers New case and Continue draft. Never place reviewer-only approval actions on a queue card. Filters remain above cards, outside the card surface.

### B: Submit the pack

Owner view shows nine document rows and explicit disposition controls. The synthetic privacy checklist is missing; DPA and SOW are N/A with a non-vendor reason. Other attachments are synthetic document names. Deployment-checklist evidence demonstrates the extraction-versus-hallucination mismatch.

Above Submit pack: “You can submit with these findings. Reviewers will see them.” Submission confirmation explains that the submitted version is read-only and opens three review lanes. Do not display a blocked submission solely because of QC findings.

### C: Review the evidence

AI/COE reviewer view: the three lane cards remain visible as context. AI/COE card identifies the active lane. Findings appear before evidence rows and decision actions. The cross-lane privacy finding is context, not authorization for AI/COE to decide DPO's lane. Approve lane applies only to the active lane. Send back opens artifact selection and written feedback.

Example feedback: “Please attach evidence with the hallucination metric, denominator and threshold; extraction accuracy alone does not answer this check.” D02 was recorded on 2026-09-21 (AI/COE lane = slots 1 and 5, BRD); the mockup's provisional-mapping annotation is now history and the product implements the recorded mapping.

### D: Respond and preserve history

Owner sees Send-back from AI/COE, the artifact and feedback, followed by Edit version 2 draft. History lists version 1 as submitted/read-only and version 2 as draft. Resubmit version 2 returns to review. Full re-review remains a proposed rule under D05, shown as a design annotation.

### E: Distinguish review approval from completion

Show two states side by side in the design board: three lane approvals with 1 open finding, labelled Awaiting disposition; and three approvals with 0 undispositioned findings, labelled Ready for launch. The latter includes “Review desk complete. Council and ITSM authorization remain outside this desk.” Do not show Deploy or automatic Council approval.

## Visual review checklist

- Can the viewer identify the case, version and next action immediately?
- Are the lanes visibly parallel rather than sequential steps?
- Does role-specific action visibility match the source permissions?
- Are soft findings visible without disabling submit or review?
- Is send-back feedback tied to an artifact and an immutable version?
- Is final readiness distinct from three lane approvals alone?
- Are provisional mapping, re-review and disposition rules labelled as pending?
- Are all case data explicitly synthetic and all controls clearly a mockup?

## Current delivery state

Interactive visual production is in Claude Design. See the handoff and TEST_RUNS.md for current verification. No application code, commit or push was performed for this design pass.
