# Product Requirements Document: RAI Workflow Platform PoC

Version: 1.0, 2026-09-21 (draft 1 was 2026-09-20). Product owner: Ta. Operator: Nakhun (confirmed under D01, 2026-09-21). Status: G0 closed; W0-W3 authorized on synthetic data under D03. Stack (D04) is decided inside W0.

This is the product anchor: **what we are building and why**. The [build plan](BUILD_PLAN.md) defines delivery order. The frozen [v1 specification](docs/product/source-spec.md) remains authoritative for product rules; this PRD consolidates it without changing scope. Proposed technical semantics are explicitly separated in the supporting contracts.

## Problem and desired outcome

Owners and reviewers need one place to submit an AI-use-case document pack, see deficiencies, conduct three parallel reviews, and preserve decisions across send-backs. Email should bring people back to that case rather than become the review record.

Build a review desk that lets an owner answer: what was submitted, who must review it, what must be corrected, and whether the current version has completed review. The desk references the official AI Reporting Tool/VRO/TPM record. It does not become that register.

## Users and authority

| Role | Scope and job |
|---|---|
| Use-case owner | Own cases; create, attach, submit and resubmit |
| BU SPOC | BU cases; same submission actions or acts on owner's behalf |
| AI/COE reviewer | All cases; decide own review lane |
| DPO reviewer | All cases; decide own review lane |
| IT/Security reviewer | All cases; decide own review lane |
| Admin | All cases; manage templates, QC rules, SLAs and production role mapping |

Admin is not implicitly a lane approver. Under D05: waived and N/A dispositions are recorded by the finding's owning lane; the owner may propose "fixed", which the owning lane confirms; no one who is owner or BU SPOC on a case may approve a lane on that case. All search, file access and deep links must enforce the same scope as case access.

## Primary journey

1. Owner/SPOC signs in, creates a case and records the external ID if known, otherwise Unknown.
2. Completes nine artifact slots; uploads trigger artifact QC.
3. Submits one version. Pack QC runs, a risk tier is proposed when that capability is available, and three lanes open together. Defects do not prevent submission.
4. Reviewers follow notification links, see current evidence and QC findings, then approve or send back with artifact-specific feedback. Approval attempts run lane QC.
5. Send-back retains the old submission and creates the next version. Under D05, resubmission reopens all three lanes; no approval is carried forward, and concurrent send-backs merge into one successor draft.
6. Three current-version approvals plus disposition of every open defect produces Ready for launch. This means desk completion, not Council or ITSM deployment authorization.

## Document pack

| Slot | Artifact | Review lane |
|---|---|---|
| 1 | Risk screening | AI/COE |
| 2 | Privacy checklist | DPO |
| 3 | DPA | DPO |
| 4 | SOW | DPO |
| 5 | BRD | All three |
| 6 | AI architecture | IT/Security |
| 7 | Security assessment | IT/Security |
| 8 | RAI deployment checklist | IT/Security |
| 9 | Supporting documents | No lane gate |

AI/COE's second document is BRD (5), decided under D02 on 2026-09-21; the lane mapping is a versioned constant recorded on each submitted version. Each slot is attached, not yet, missing, or N/A with reason. DPA/SOW default to N/A for non-vendor cases. Not yet and N/A must remain distinct.

## Requirements and acceptance

All requirements are planned, not implemented. Detailed observable tests A01-A10 are in [acceptance.md](docs/acceptance.md).

| ID | Required product behavior | Acceptance | Build package |
|---|---|---|---|
| R1 | Six scoped roles; localhost Google, network allow-list/AD, production True AD | A01 | W1, W7 (network mode, only if the rehearsal is networked), W8 |
| R2 | Owner/SPOC submits nine-slot pack with meaningful dispositions | A02 | W1 |
| R3 | Versioned seven-question risk proposal; High requires Council confirmation and never skips lanes | A03 | W5 |
| R4 | Three parallel lanes with correct document mappings | A04 | W2 |
| R5 | Emails for lane readiness, send-back, completion and SLA breach, with case links | A05 | W3 |
| R6 | Authorized queue search by external ID, status, owner, group or all | A06 | W3 |
| R7 | Immutable submitted versions, preserved history, unambiguous latest version | A07 | W1, W2 |
| R8 | Evidence-grounded QC at upload, submit and approve attempt, with soft findings | A08 | W4 |
| R9 | Approve/send back with adequacy feedback; final completion predicate enforced | A09 | W2, W4 |
| R10 | Admin edits versioned templates, thresholds, SLA and AD mappings without redeploy | A10 | W6, W8 |

## QC and risk constraints

A Yes for hallucination/accuracy requires a metric, denominator, threshold and evidence artifact. Extraction accuracy is not hallucination rate. Only checklist v1.0 Sheet-3 SL#2.1 receives strict H<1%, M<2%, L<3% hallucination bands. Other versions need their own rules; classic ML uses its matching metric or justified N/A. Keep append-only QC evidence by version.

QC never blocks submit or a lane reviewer. The final Ready for launch transition requires all findings fixed, waived with reason, or N/A with reason. QC-unavailable handling is a proposed explicit finding, not a silent pass. File safety and authorization rejection are separate from document-quality QC.

Risk is a proposal using the approved questionnaire revision, not a governance decision. D07 must settle the instrument and reference labels before implementation. The desk's QC-model evaluation criteria are separate from the submitted use case's hallucination bands; see [evaluation plan](docs/evaluation/plan.md).

## Product surfaces (proposed organization)

Queue with filters and due dates; case overview with external reference and version selector; nine-slot pack editor; reviewer workspace with defects before actions; version history and feedback; Admin configuration. This organizes existing requirements, not additional product scope. Layout and interaction design remain to be reviewed.

## Data, operations and quality

Use the inherited fields and proposed entities in [data contract](docs/product/data-contract.md). Store files inside controlled application storage, not SharePoint or Git. Retention, model handling and live-data permission are pending (D08). UI and notifications are bilingual with Thai default (D12).

SLAs: DPO 3 working days (D01), other lanes 5 as Admin configuration. Display and report only, no automatic escalation. Calendar, clock and retry policy are set by D06 (Asia/Bangkok, clock restarts on resubmit, daily breach digest, three retries). Notifications are not approval records.

Required quality properties: server-side authorization; immutable evidence; attributable actions (tested by A11, accepted 2026-09-21); consistent concurrent transitions; observable extraction/mail failures; reproducible config versions. Quantitative latency, volume, storage and QC-quality budgets must be agreed before their release gates; none are measured or committed today.

## Success and release boundaries

Local slice succeeds when one synthetic case goes through submission, three review lanes, a send-back, a second version and three approvals, with version history and scoped access proved. Full PoC success additionally requires all A01-A10 criteria relevant to the local environment, evaluated QC/risk, editable configuration, and an approved operator rehearsal on 3-5 permitted cases. Nakhun must complete the rehearsal unaided and explicitly record acceptance or outstanding defects.

Production additionally requires True hosting/AD, approved operational controls and repeatable release/restore proof. A local demonstration is not that acceptance. No savings, adoption or review-time improvement is claimed before measurement; baseline those with the operator during rehearsal.

## Non-goals and open decisions

No official register, tracker dual-write, eight-stage lifecycle, post-deploy control tower, Council e-vote, ITSM replacement or SharePoint file integration. Application build is authorized for W0-W3 on synthetic data (D03, 2026-09-21); no stack is selected in this PRD (D04, inside W0).

[The decision register](docs/product/decisions.md) records D01-D03, D05, D06, D11 and D12 as decided on 2026-09-21 and keeps D04, D07-D10 open. The [source provenance](docs/sources.md) identifies supporting evidence. Changes to locked scope require explicit owner decision and a versioned PRD/source update; do not quietly resolve a conflict in implementation.
