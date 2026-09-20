# Workflow and card design brief

2026-09-20. Proposed design for review, not an implemented application. Authority: [PRD](../../PRD.md), [workflow](../product/workflow.md), [decisions](../product/decisions.md). All sample cases are synthetic.

## Outcome and plan

Make it easy to answer: which case needs me, what evidence is missing, and what happens next? First map the journey; then sketch four screens using case cards and lane cards; walk through submission, send-back and revision; review with Ta before implementation. No code, stack selection or product-gate approval is implied.

Design done when the four screens describe their actors, information, actions and resulting state; parallel lanes and version history remain clear; soft QC and final readiness conditions are visible; unresolved policy decisions are annotated rather than guessed; a reviewable visual concept is available.

## Card model

A case card is one review case, not a document or a lane. Show case name, source ID or Unknown, current version, owner/BU, review status, three small lane-status labels, open finding count and next action. Show due dates only from configured policy; no invented overdue claims. Entire card has an explicit Open case link. Status must have text, not color alone.

Inside the case, three equal lane cards show AI/COE, DPO and IT/Security in parallel. Each shows status, relevant documents, review feedback and due information. Only the authorized lane has decision actions. A document list and QC findings use rows, not nested cards. No drag-and-drop approvals or sequential lane columns: neither represents the approval rules correctly.

## Screen 1: Review queue

Actor: owner/SPOC or reviewer, scoped by role. Header: Review queue. Filters: source ID, status, owner and group (group field D11 pending). Primary owner action: New case. Reviewer action: Open case. Use a compact grid of case cards with text filters. Proposed dense-list alternative can follow later if case volume makes cards slow.

Synthetic card: Service FAQ assistant / source Unknown / version 1 / owner Example owner / Example BU / In review / AI/COE pending, DPO pending, IT/Security approved / 2 open findings. Do not show a fabricated official tracker ID. Card counts describe this example only, not real operational metrics.

## Screen 2: Case and pack editor

Actor: owner/SPOC. Stable header: name, source reference, version, status. Nine document rows: risk screening, privacy checklist, DPA, SOW, BRD, architecture, security assessment, deployment checklist, supporting documents. Dispositions: attached, not yet, missing, N/A with reason. Non-vendor DPA/SOW default to N/A with visible reason.

Actions: edit draft, attach document, set disposition/reason, submit pack. Upload QC appears alongside the row; pack findings appear before submission. Copy: “You can submit with these findings. Reviewers will see them.” Submission opens three lanes together and freezes the version. Submitted files are read-only; revision uses a successor draft.

## Screen 3: Reviewer workspace (first visual target)

Actor: AI/COE reviewer on synthetic version 1. Header includes current version and review state. Three lane cards give context; below, findings precede evidence rows and actions. No summary dashboard competing with the review task.

Example finding 1: “Hallucination evidence missing” / deployment checklist / extraction accuracy alone does not establish hallucination rate. Example finding 2: “Privacy checklist missing” / pack completeness. Mark as synthetic findings, not actual QC results. Provide View evidence. Reviewer can Approve lane or Send back; send-back requires artifact and specific feedback. Approve attempt refreshes QC and surfaces findings, without making soft defects an approval blocker.

AI/COE's second document remains BRD provisionally; annotate D02 in design notes. Review and defect-disposition permissions remain D05, so do not imply every reviewer can waive any finding. Full approval does not mean Ready for launch while an open finding lacks disposition.

## Screen 4: Send-back, revision and history

Actor: owner/SPOC responding to feedback. Show the sending lane, affected artifact, requested correction and version 1 feedback. Primary action: Edit version 2 draft. History exposes version 1 as read-only. Resubmit version 2 returns to parallel review; full re-review is a proposal pending D05, not a finalized policy.

Final state example: three current-version approvals and every finding fixed, waived with reason or N/A with reason. Copy: “Ready for launch — review desk complete. Council and ITSM authorization remain outside this desk.” Avoid a Deploy button.

## Interaction and accessibility notes

Use plain labels, visible version context and one dominant task per screen. Keyboard focus order follows heading, filters, cards and actions. Each action has a text label; status is not conveyed by color alone. Error messages preserve draft work and name the corrective action. Mobile stacks lane cards without implying chronological order. Network authorization remains a backend obligation, not something this visual design proves.

## Walkthrough to review

1. Owner finds a synthetic draft and distinguishes missing from N/A.
2. Owner submits with findings and sees all three lanes open.
3. Reviewer finds defects before the decision and sends back artifact-specific feedback.
4. Owner edits version 2 while version 1 stays readable.
5. Reviewer understands which version a decision applies to.
6. Three approvals with an unresolved finding do not display final readiness.
7. Once dispositions are recorded by authorized actors, readiness explains its limited meaning.

Pass means Ta can follow each transition without an explanation of hidden mechanics, and unresolved rules remain explicit. This is a design-review criterion, not evidence of usability testing already performed.

## Handoff

After visual direction and D01-D03 are confirmed, use W0 in [BUILD_PLAN](../../BUILD_PLAN.md) to choose the stack and create the implementation plan. Design review may proceed while those implementation gates are pending. Do not treat the design tool's generated text as a new product requirement.

Visual production handoff: [card workflow storyboard](STORYBOARD.md).
