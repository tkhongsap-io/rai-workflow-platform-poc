# Open decisions and implementation gate

No confirmation below is implied by repository creation. All are open on 2026-09-20.

| ID | Decision | Proposed owner | Due gate |
|---|---|---|---|
| D01 | Confirm review desk, operator role and proposed DPO SLA | Nakhun; Ta records evidence | Before slice 1 |
| D02 | AI/COE second document: BRD (5) or security assessment (7) | Ta against sketch | Before slice 1 |
| D03 | Explicit application-start authorization | Ta | Before any application code |
| D04 | Stack selection and deployable boundaries ADR | Ta + implementation lead | Slice 1 design, after D03 |
| D05 | Re-review all lanes after send-back, concurrent decisions, disposition authority and self-approval rules | Ta + Nakhun/review leads | Before workflow implementation |
| D06 | Working-day calendar, clock behavior and notification retry/dedup policy | Nakhun | Before SLA/email implementation |
| D07 | Exact seven-question questionnaire, rubric version and reference labels | AI/COE | Before risk implementation |
| D08 | Retention, real-data permission, model-provider data handling, upload safety limits | DPO + IT/Security | Before real data/model processing |
| D09 | QC evaluation fixture set, acceptance thresholds and review sign-off | AI/COE + lane experts | Before probabilistic QC implementation |
| D10 | Production AD groups, host, audit/backup, incident channels, engineering risk acceptance | IT/Security + accountable owner | Before networked/production release |
| D11 | use_case_group and stage-context data fields | Ta + Nakhun | Before search and stage-QC implementation |

The frozen [source spec](source-spec.md) contains the locked L1-L12 product choices. This register tracks genuinely pending details only, not previously resolved alternatives. Record decisions with approver, date, source evidence and affected contract/ADR; never mark approval based only on an agent's recommendation.
