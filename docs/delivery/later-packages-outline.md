# Later packages: W4-W8 outline

Status: outline only; **not authorized** (D03 covers W0-W3). Detail these packages when their entry gates approach, not now. [BUILD_PLAN](../../BUILD_PLAN.md) holds the full entry, work and exit criteria.

| Package | Delivers | Blocking decisions and entry | Main risk to plan for |
|---|---|---|---|
| W4 Soft QC | Deterministic checks first, then extraction and any approved model behind the QC boundary. Upload, submit and approve triggers. Version-scoped metrics. | W3; D11 stage fields; **D08** model/data handling and **D09** evaluation criteria before any probabilistic QC | Invented thresholds or fabricated citations. Evaluation set must be frozen first ([evaluation plan](../evaluation/plan.md)). |
| W5 Risk proposal | Versioned seven-question scoring with explanation. Missing answers stay Unknown. High shows that Council confirmation is required. | W4; **D07** exact questionnaire and rubric | Coding the rubric from the summary in operating model §7 instead of the approved instrument |
| W6 Admin configuration | Versioned templates, thresholds, SLA and production group mapping, with audit and activation rules (R10, A10). Lane-to-slot mapping is not Admin-editable; it is fixed by D02 and frozen per submitted version. Identity-mapping configuration contract. **Operator guide** for the desk: sign-in mode per environment, queue and SLA report, failed-mail and unavailable-QC views, fixture reset in non-production, incident shutdown path (disable mail, disable QC, freeze transitions) and escalation contacts; reviewed by Nakhun before W7. | W5; activation and authorization rules agreed | Configuration changing historical evidence |
| W7 Operator rehearsal | 3-5 permitted cases run unaided by the operator; acceptance report. **W7-00 (entry, tech lead, HRR):** a recorded backup/restore rehearsal on synthetic data (full case history, artifact bytes and audit trail restored and re-verified against A07) and an operator-run rollback of one deployment, before any real case is loaded. If the rehearsal is networked rather than on localhost: `network` identity mode (allow-list or AD, per W0-03) implemented, non-loopback bind allowed only in that mode, and the A01 network clause tested and recorded before the first non-loopback bind (Eng A; not needed on localhost). | W6; W7-00; operator guide reviewed; **D08** real-data permission and retention; closed environment if networked | Treating a developer demo as operator acceptance; loading real cases before restore is proven |
| W8 Production | True host, True AD, Google off. True-side monitoring integration for the desk (W0-10 contract), production backup and restore, release and rollback runbooks | W7; **D10** and applicable D08; True release authorization | Access-matrix gaps on direct links and files |

## Candidate backlog from the source review (not scope)

The 2026-09-21 review compared the demo with the operating-model documents and the Topic 21/22 deployment checklist. It found two gaps that Ta should decide on. Neither is in v1 scope until the PRD or decisions are updated.

1. **Item-level checklist review.** The Topic 21/22 AI Architect review marks individual checklist items (Sheet 2, items 1.1-5.4) with comments such as "extraction accuracy is not hallucination rate" and "N/A needs a reason". The desk catches that class of finding through QC (W4). Reviewers can't mark individual checklist items, though. Decide whether W4 findings should anchor to checklist item IDs.
   Source: `work-work/projects/RAI Deployment Checklist v1.0 - CR_WFA_Topic21and22 - AI Architect Review.xlsx` in Life-OS; the extracted copy is listed in [sources](../sources.md).

2. **Runtime operated elsewhere.** This covers content or network systems the COE does not run. The pack has to accept attested vendor or BU evidence, with telemetry recorded as `Unknown`, not a pass. A missing monitoring plan is marked Missing, or N/A with a reason. Ready still means desk complete, not "we are watching it". A synthetic scenario for this case could be added to W4 fixtures and the design.
   Source: operating model §6-§9, `work-work/projects/2026-09-responsible-ai-operating-model/documents/rai-operating-model-proposal.md`.

**Explicitly not added**, because each would contradict L2, L3, L6 or the non-goals: monitoring dashboards, network telemetry, a control tower, a Deploy button, lifecycle stages, and register writes.
