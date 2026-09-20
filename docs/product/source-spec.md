---
type: idea
stage: idea
created: 2026-09-20
updated: 2026-09-20
summary: RAI web v1 is the review desk only. Conflicts with True RAI artefacts are resolved in the spec text, not left open. No application code until Ta says start.
next_action: Confirm with Nakhun. Do not write application code.
tags: [work/true, project/agent, action/research]
---

# RAI web — v1 review desk

> **This is the v1 spec.** Whiteboard name: **RAI web**. “AI Console” is Ta’s informal name only; it is not a True product name.
>
> v1 is the **review desk**, not the register, and not the eight-stage operating model. No application code until Ta says start.

Contract: [`goals/2026-09-20-ai-console-review-desk.md`](../goals/2026-09-20-ai-console-review-desk.md).

## Named people

| Role | Name |
|---|---|
| Gate operator | **Nakhun Wongkontoot** (Friday operator unless Ta names someone else) |
| DPO | Montri Stapornkul |
| AI Transformation Lead | Anan Sanongchitcharorn |
| Register / VRO / TPM owner | **Joao** (CDAO). v1 does not take that job. If Joao later wants this app to become the register, that is a new spec. |

## v1 locked decisions (one answer each)

| # | Decision | v1 spec |
|---|---|---|
| L1 | Job | Inbox, email, send-back, versions, **review queue**, accuracy/hallucination QC |
| L2 | Process | One submitted pack; three lanes in parallel (whiteboard). **Not** operating-model stages 1–8 |
| L3 | Register | **No.** Official record stays in AI Reporting Tool / VRO / TPM. This app stores `source_record_id` or `Unknown` |
| L4 | Production identity | True AD on True’s network |
| L5 | Shape | **Option A — review desk.** Option B (staged lifecycle) is later. Option C field names are inherited, not a second product |
| L6 | Other systems | **Link only.** No dual-write, no “we recorded it in TPM” checkbox |
| L7 | QC fail | Soft flag. Submit always works. Reviewers see defects first |
| L8 | Done | Three lane approvals **plus every open defect dispositioned** (fixed, waived with reason, or N/A with reason) → `Ready for launch`. Dispositioning records a decision; it does not block. Council and ITSM stay outside |
| L9 | Code | Only when Ta says start |
| L10 | Official IDs | Field `source_record_id` (`TPM-…` / `VRO-…` / `Unknown`). Missing ID is `Unknown`, not a claim that we own TPM |
| L11 | Dev login | Any Google, **localhost only**. Networked URL = allow-list or AD. Production = AD |
| L12 | QC rules and SLA | Configuration keyed to `checklist_template_version`, editable by Admin. Not hardcoded, so a v2.0 swap is config, not a rebuild |

## How the old contradictions are resolved

These were contradictions. They are not open questions in this file. v1 uses the **Resolved** line.

| Conflict | What the artefacts say | v1 rule |
|---|---|---|
| Register | `registry-schema.md`: source of truth stays outside; link `source_record_id` | This app is the review desk. It is not the register. |
| One pack vs eight stages | §6: DPO checklist before design; Deployment Checklist after build | v1 is the pre-deploy **review event** on the whiteboard. It does not run the lifecycle. QC may flag a pack that claims launch-ready without a privacy checklist, or that files a launch checklist at idea stage. |
| DPO SLA | CCXO: 3 days. Operating model §6: ≤ 10 working days *(proposed)* | **3 working days**, labelled proposed, source = CCXO deck. Not the operating model. Nakhun may change it. |
| Checklist version | Live QC lesson is v1.0 Sheet-3 SL#2.1. Operating model names v2.0 | Each pack records `checklist_template_version`. Thresholds apply only to that version. Do not mix v1.0 numbers onto a v2.0 sheet. |
| Missing L5 | Grill table jumped L4 → L6 | L5 = Option A, in the table above. |

## v1 product

1. Owner / BU SPOC logs in (Google on localhost; True AD in production).
2. Opens or creates a **review case** with `source_record_id` (required if known, else `Unknown`).
3. Attaches the nine artefacts. Each slot is attached, not yet, N/A with reason, or missing (see Pack and lanes). QC checks each upload as it lands.
4. Submits. Pack QC runs (soft), the risk tier is proposed, defects go on the version. Submit still succeeds.
5. Three queues open together.
6. Email to each lane: case ready, defect count, SLA due date, and a link that opens the case.
7. Approve, or send back with written feedback on document adequacy (whiteboard: ความเหมาะสมเอกสาร), naming the artefact and what is wrong. Send-back → version N+1; N stays and remains readable.
8. All three approve and every open defect is dispositioned → `Ready for launch` (L8).

The on-screen list is the **review queue**. It is not True’s AI portfolio of record. Within what the role is allowed to see, anyone can search and filter it by `source_record_id`, status, owner, group, or all, as drawn on the whiteboard.

### Roles and access

Six roles, per the whiteboard.

| Role | Sees | Can do |
|---|---|---|
| Use-case owner | Own cases | Create, attach, submit, resubmit after send-back |
| BU SPOC | The BU's cases | Same as owner, or confirms on the owner's behalf |
| AI / COE | All cases; lane (1)(5) | Approve or send back that lane |
| DPO | All cases; lane (2)(3)(4)(5) | Approve or send back that lane |
| IT / Security | All cases; lane (5)(6)(7)(8) | Approve or send back that lane |
| Admin | All cases | Manage document templates, QC rules and thresholds, SLA values, and in production the AD group to role mapping |

Admin changes QC rules and SLA values as configuration (L12). No code change, no redeploy.

### Risk tier

The app **proposes** a tier from the existing 7-question Risk Screening Questionnaire when the pack is submitted, and writes it to `risk_tier`. Per operating-model §6 stage 2, a **High** tier is confirmed by the RAI Council, not by this app. High never skips a lane. The proposed tier is visible to all three lanes and is a QC input, not a routing switch in v1.

### Pack and lanes

| # | Artefact | Lane |
|---|---|---|
| 1 | Risk screening | AI / COE |
| 2 | Privacy checklist | DPO |
| 3 | DPA | DPO |
| 4 | SOW | DPO |
| 5 | BRD | All three |
| 6 | AI architecture | IT / Security |
| 7 | Security assessment | IT / Security |
| 8 | RAI Deployment checklist | IT / Security |
| 9 | Other supporting docs | Attached; not a lane gate |

**One item for Ta to confirm against his own sketch:** the AI / COE lane's second document is written here as (5) BRD; the whiteboard photograph could also read (7) security assessment. The DPO and IT / Security lanes match the sketch exactly.

Each slot carries one of four dispositions: **attached**, **not yet** (exists in the process but is not produced at this stage), **N/A with reason** (genuinely does not apply, for example a DPA on an internal build with no vendor), or **missing**. "Not yet" and "N/A" are different facts and QC treats them differently: this is what lets QC flag a pack that files a launch checklist at idea stage, or claims launch-ready with the privacy checklist still outstanding. Items 3 and 4 default to N/A on non-vendor cases.

### QC

- Completeness and contradictions.
- Hallucination / accuracy Yes must cite metric, denominator, threshold, artefact.
- Extraction % is not hallucination rate (v1.0 item 3.5, credit-limit case).
- If `checklist_template_version` is v1.0 Sheet-3 SL#2.1, go-live bands are H <1%, M <2%, L <3%. Other versions: do not apply those numbers until the matching sheet is on the case.
- Classic-ML uses that sheet’s matching metric or N/A.
- Append-only QC log on each version.

**When it runs.** Ta's requirement is QC at each step, before moving to the next, so there are three triggers rather than one:

| Trigger | What runs |
|---|---|
| On each upload | That artefact's own completeness rules |
| On submit | Pack completeness, cross-document contradictions, pack-versus-stage mismatch |
| On each approve attempt | That lane's document rules, so a reviewer cannot approve past an unseen defect |

**Soft everywhere.** QC never blocks submit and never blocks a reviewer; it annotates the version and reviewers see defects first (L7). The single exception is the last transition: moving to `Ready for launch` requires every open defect to be dispositioned as fixed, waived with a reason, or N/A with a reason. That forces a decision to be recorded without blocking the process.

### Fields (inherit, do not invent)

From `registry-schema.md`: desk-local `registry_id`, `source_record_id`, `use_case_name`, `business_unit`, `business_owner`, `technical_owner`, `risk_tier`, `privacy_status`, `security_status`, `rai_status`, `ai_readiness_status`. No monitoring/health fields in v1.

### Notifications

Email only in v1. **Every email carries a direct link to the case**, so the recipient clicks through and does the work on the platform rather than in the mail thread. That link is the whole point: mail is the notification, never the record.

| To | When | Contains |
|---|---|---|
| Reviewer | His lane opens | Case name, lane, defect count, SLA due date, link to the case |
| Owner | Send-back | Which lane, the reviewer's feedback, link to the case |
| Owner | Case reaches `Ready for launch` (L8 condition met) | Ready for launch, link to the case |
| Operator | SLA breach | The list of cases past SLA, links to each |

**DPO SLA default = 3 working days (CCXO, proposed). Other lanes = 5 working days (proposed).** SLA is displayed and reported in v1; it does not auto-escalate.

## Requirements coverage

Everything Ta asked for on the voice note (2026-09-19) and drew on the whiteboard (2026-09-20), and where v1 meets it. If a row has no section, v1 does not do it.

| # | Requirement, as stated | Where |
|---|---|---|
| R1 | Log in, six roles, AD authentication | Roles and access; L4; L11 |
| R2 | Owner or BU SPOC submits the use case and the nine-document pack | v1 product 1 to 3; Pack and lanes |
| R3 | "The system should be able to somehow calculate risk" | Risk tier |
| R4 | Approval workflow routes each document set to the right role | v1 product 5; Pack and lanes |
| R5 | Email the next approver that the task is ready, and he clicks back into the platform to work on it | Notifications |
| R6 | Manage all ongoing cases, searchable by status, owner and group | Review queue line; Roles and access |
| R7 | Version control: keep every submission, always have the latest | v1 product 7; L1 |
| R8 | "For each step, some sort of auto QC before we move to the next step" | QC, When it runs |
| R9 | Approve or send back with feedback on document adequacy | v1 product 7 |
| R10 | Admin manages templates, QC rules, SLA, AD groups | Roles and access; L12 |

**Deliberately not v1, though Ta mentioned them:** acting as True's portfolio of record (that is the register question, closed as No in L3), and the eight-stage lifecycle case file (Option B, later).

## Non-goals (v1)

- Being TPM, VRO, or the AI Reporting Tool
- Dual-write or a live TPM/VRO API
- Eight-stage case file
- Post-deploy Control Tower
- Council e-vote
- Replacing ITSM Architecture Forum
- Google/social login on a True URL
- Application code before Ta says start

## Success (v1)

Checkable in the goal file, section “v1 product”.

## Build plan (idle until Ta says start)

| Slice | What | Proof that it is done |
|---|---|---|
| **0b** | Nakhun confirms: review desk not register, the 3-day DPO SLA, and that he is the operator | His written yes, filed with this plan |
| **1. Local app** | Cases, nine slots with four dispositions, immutable versions, three lanes gated by their documents, review queue with search, test email with case links, Google login on localhost | One case end to end on Ta's machine: create, attach, submit, three reviews, one send-back, v2, three approvals |
| **2. Soft QC** | Per-upload, per-submit and per-approve rules from the QC section, `checklist_template_version` on the case | The credit-limit false Yes on item 3.5 shows as a defect; submit still works; a v2.0 case gets no v1.0 thresholds |
| **3. Risk proposal** | 7-question rubric proposes `risk_tier` on submit | Matches two known cases; High shows "Council confirms" |
| **4. Admin** | QC thresholds and SLA values editable in the app | Admin changes a threshold, next submit uses it, no redeploy |
| **5. Operator rehearsal** | 3 to 5 real cases on localhost or a closed sandbox | Nakhun runs them here without asking Ta how |
| **6. Production** | True host, True AD, Google login off | Operator logs in with a True account; the local proof from slice 1 repeats there |

Constraints that hold across all slices: the stack is chosen when slice 1 starts, not before; auth is a swappable module (Google on localhost, Entra ID in production); files live in the app in v1, not SharePoint; the project home is created under `work-work/projects/` when slice 1 starts, and this idea file becomes its README.

## Next

1. Nakhun confirms this spec.  
2. Ta says start. Not before.

## Team-assessment record (closed)

Findings 1–8 were confirmed (finding 6 with the precision that the July email is monitoring, not L3). QC extraction≠hallucination, soft flag, versions, and swappable auth were already right and are kept.

## Sources

- Friday whiteboard (2026-09-20)
- Grill rounds 1–3 (2026-09-20); L3/L6/L10 and “pack = lifecycle” from those rounds are **superseded** by this file
- Team assessment (2026-09-20)
- `work-work/projects/2026-09-responsible-ai-operating-model/documents/registry-schema.md`
- `work-work/projects/2026-09-responsible-ai-operating-model/documents/rai-operating-model-proposal.md` §6
- `work-work/projects/2026-09-responsible-ai-operating-model/documents/2026-07-08-nakhun-tools-for-tracking-ai-use-cases-email.md`
- `work-work/docs/CCXO_Meeting_3_090726.md`
- `work-work/projects/extracted/RAI Deployment Checklist v1.0 - CR_WFA_Topic21and22 - AI Architect Review.md`
- `kb/people/nakhun-wongkontoot.md`
- Shenandoah / SciCode++ QC pattern (method only)
