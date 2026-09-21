# Decision register

The frozen [source spec](source-spec.md) contains the locked L1-L12 product choices. This register tracks the details that were genuinely pending after it. A decision is recorded only with approver, date, channel and the documents it changes; an agent's recommendation, a demo default or silence is never evidence.

## Recorded decisions

G0 closed on 2026-09-21. Channel for every row below: Ta's instruction in the planning session of 2026-09-21, after Ta's conversation with Nakhun the same day. Ta records the evidence.

| ID | Decision | Answer | Approver | Date | Affected documents |
|---|---|---|---|---|---|
| D01 | Review desk scope, operator role, DPO SLA | Confirmed: v1 is the review desk, not the register; Nakhun is the gate operator; DPO lane SLA is 3 working days (other lanes 5, as Admin configuration under L12) | Nakhun, confirmed to Ta; Ta records | 2026-09-21 | PRD, workflow, BUILD_PLAN G0, delivery pack |
| D02 | AI/COE lane's second document | Slot 5, BRD. AI/COE lane = slots 1 and 5. Lane mapping is a versioned constant recorded on each submitted version, not Admin configuration | Ta | 2026-09-21 | PRD document pack, workflow, acceptance A04, W0-06, W2-01 |
| D03 | Application start | Authorized: W0 through W3 (technical contract and slice 1), synthetic data only. Branches `codex/<ticket-id>-<topic>`, one ticket per PR, reviewed PRs, Ta merges to main. Tracker of record for ticket status: GitHub issues, one per ticket ID. W4-W8 need their own gate entries; real data needs D08 | Ta | 2026-09-21 | AGENTS, BUILD_PLAN, README, TESTING, delivery pack |
| D05 | Re-review, concurrency, disposition authority, self-approval | Full re-review of all three lanes after resubmission; no approval carried forward. Concurrent send-backs merge into one successor draft. Waived and N/A are recorded by the finding's owning lane; the owner may propose "fixed", which the owning lane confirms. No one who is owner or BU SPOC on a case may approve a lane on that case | Ta, with Nakhun's D01 confirmation; review leads may refine within these rules before W2 | 2026-09-21 | PRD, workflow, data contract, acceptance A07/A09, W0-05, W0-06, W2-02 to W2-06 |
| D06 | Working-day calendar, clock, notification policy | Asia/Bangkok; Thai public-holiday list as Admin configuration. SLA clock starts when the lane opens and restarts on each new submitted version. Breach report is one daily digest to `operator_recipients`, an Admin-editable configuration value seeded from configuration in slice 1; delivery-failure records visible to Admin. Mail retried three times with backoff, deduplicated by (event, version, lane, recipient). No seventh role | Ta | 2026-09-21 | workflow, acceptance A05, W0-05, W3-03 to W3-05 |
| D11 | `use_case_group` and stage context | `use_case_group` inherited as required, value list held in Admin configuration. One `stage_context` field per pack version with values idea / pre-build / pre-launch; used only for QC stage checks in W4, never as a lifecycle state machine | Ta | 2026-09-21 | data contract, acceptance A06, W1-02, W1-04, W1-05, W3-01 |
| D12 | UI and notification language | Bilingual, Thai default. Every user-facing string, email template and finding message carries a locale key; dates render in the D06 timezone | Ta | 2026-09-21 | W0-02 language rule, UI tickets, W3-03 |

## Open decisions

| ID | Decision | Owner | Due gate |
|---|---|---|---|
| D04 | Stack selection and deployable boundaries ADR | Ta + tech lead | Inside W0-01; before W1 |
| D07 | Exact seven-question questionnaire, rubric version and reference labels | AI/COE | Before W5 risk implementation |
| D08 | Retention, real-data permission, model-provider data handling, upload safety limits for real data | DPO + IT/Security | Before real data or model processing (W4 probabilistic QC, W7) |
| D09 | QC evaluation fixture set, acceptance thresholds and review sign-off | AI/COE + lane experts | Before W4 probabilistic QC |
| D10 | Production AD groups, host, audit/backup, incident channels, engineering risk acceptance | IT/Security + accountable owner | Before networked test or W8 |

Changing a recorded decision requires a new row with the new approver and date; the old row stays for history.
