# True RAI Review Desk design handoff

Status: ready for team design review. Three iterations completed; core journey and targeted responsive/copy regressions browser-tested. No production implementation or operational readiness claimed.

Design workspace: https://claude.ai/cowork/cse_01NS3VpYm1i4rasdCkSxmHXh?artifact=08b0fc22-a4d5-4490-b992-2e90e4e5f1d1 . Access remains Only you; team sharing has not been changed.

## Contract to carry into development

[PRD](../../PRD.md) controls product scope; [BUILD_PLAN](../../BUILD_PLAN.md) controls implementation gates. Design is a proposal that visualizes those rules. Generated prototype code is disposable reference, not an architecture decision or verified security implementation.

Use [design prompt](CLAUDE_DESIGN_PROMPT.md), [workflow brief](WORKFLOW_DESIGN.md) and [test runs](TEST_RUNS.md). The prompt document is the detailed source brief; a condensed equivalent was submitted in the Claude session and its exact text is visible there.

## Brand provenance

True website-derived working reference from Life-OS truecorp-brand-guidelines skill: red #E00000, ink #303C46, blue #007AD0, white/light-neutral surfaces; Segoe UI/Arial/Helvetica Neue fallback. BetterTogether and an authentic logo are not supplied. Do not turn a text identity into a claim of official logo approval. Brand team verification remains appropriate before production.

## Tomorrow's walkthrough

1. Explain review desk versus official register.
2. Owner creates or opens a case and submits a nine-slot pack with visible findings.
3. Show three parallel reviewers and artifact-specific send-back.
4. Owner revises v2; inspect immutable v1.
5. Demonstrate approvals without readiness, then disposition and qualified completion.
6. Show configuration and explain what is simulated.
7. Resolve AI/COE mapping, disposition authority, re-review, SLA calendar and group/stage fields with stakeholders.

## Implementation boundaries

Demo role switching is not AD. Sample evidence is not secure upload/storage. Notification previews do not send mail. Synthetic risk/QC output is not an approved rubric or evaluated AI service. Frontend state cannot establish server-side authorization, transaction integrity, retention, audit tamper resistance or recovery.

No team message sent and no public artifact publishing performed. Developers should start W0 only when its existing entry criteria are satisfied.

Direct artifact: https://claude.ai/artifact/25FPuPyj6aczLrXca3P9Mz . Observed defects were corrected and retested; exact coverage and remaining verification limits are in TEST_RUNS.md.

## Screens and developer contract

| Surface | Primary behavior | Required invariant |
|---|---|---|
| Review queue | Scoped cards, filters, next action, new case | Scope counts, options and notifications as well as cards |
| New case | Name, BU, model/checklist versions, source known/Unknown, vendor/model type | External register is never written; versions are distinct |
| Case / Documents | Nine slots, sample change, draft save, submit with QC | Submit freezes documents/config; soft QC never blocks submission |
| Review lanes | Three equal parallel lanes, evidence, approve/send back | Actor acts only own lane; decision bound to current submission |
| Findings | Evidence, fixed/waived/N/A disposition and rationale | Readiness requires every finding dispositioned; authority provisional |
| History | Frozen version snapshot plus appended decisions | Never rewrite prior documents, decisions or config |
| Administration | Template/threshold/SLA draft and publish | New config applies to subsequent submissions; Admin cannot approve |
| Notifications | Synthetic event preview and case link | No email sent; scope follows role |

UI state switches are for demonstration only. Implement server-side role and state validation independently. Reuse the conceptual states and copy, not the prototype's client-side permissions as security controls.

## Components and visual implementation notes

Case cards for queue; three equal lane cards for review. Documents, findings and history are rows, avoiding nested cards. Status always combines text and color. Keep case identity, submission version and next action prominent. Put design notes and six-role scenario switcher outside product navigation.

Use red #E00000 for primary action; ink #303C46 for headings, white/#F9F9FC/#F3F3F6 surfaces, #E2E8F0 boundaries. Generator adjusted muted text to #5B6878 and link text to #00639F for contrast; #007AD0 remains the source reference blue. These are proposed accessible adaptations, not a certified brand kit. Verify contrast in implemented components and use genuine licensed brand assets when supplied.

Desktop target 1440, tablet 834, phone 390 CSS pixels. Live width controls must reflow the same interaction state. Static Tablet/Phone artboards are reference compositions, not functional tests. Focus order, keyboard operation, dialog containment, overflow and readable text must be verified in the production UI after a stack is selected.

## Decisions to take into the team discussion

Use [the decision register](../product/decisions.md) as authority. Prioritize D01 operator/scope/SLA, D02 AI/COE slot 5 versus 7, D05 re-review/disposition/self-approval, D06 calendar/notification behavior, D07 questionnaire, and D11 group/stage fields. D03 application start and D04 stack ADR remain separate. Character minima, synthetic names/timestamps and sample document content are demonstration choices, not product requirements.

## Export and access

Artifact remains private to the owner. Present it from the owner's account tomorrow. No team permissions were granted. Claude Design contains the interactive Main artboard and reference/handoff boards; HTML ZIP export completed with a Saved confirmation in the UI; its local path and offline execution have not been verified. The repository contains prompt, contract and test evidence so the design is traceable even where a developer lacks artifact access.

## Suggested 10-minute demonstration

Open the Main interactive artboard. Demo controls are outside the application; start scenario 1 / Owner / 1440 and Reset.

1. Open Churn Propensity Scoring, inspect nine slots, then Run checks & submit / Submit anyway.
2. Switch AI/COE, Send back, select BRD and enter specific corrective feedback. Inspect History and v1 snapshot.
3. Switch Owner, change BRD to clean v1.1 sample and resubmit v2.
4. Approve each lane using the demo role switcher. Explain why open privacy/security findings still prevent Ready.
5. Each finding's own reviewer records a reasoned demo disposition. Show qualified Ready and version history.
6. Switch Admin, change pack template and publish revision; show that submitted version retains original configuration.
7. Use scenario 3 for checklist-version isolation, scenario 4 for unavailable QC, and width controls for actual responsive behavior.

Allow another five minutes for D01/D02/D05 decisions. Reviewers should challenge the workflow and content before developers choose implementation details. Keep demonstrations explicitly synthetic; a sample waiver is not a real privacy/security approval.
