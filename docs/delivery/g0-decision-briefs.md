# Decision briefs: G0 and slice-1 dependencies

Status: **D01, D02, D03, D05, D06, D11 and D12 recorded on 2026-09-21**; the [decision register](../product/decisions.md) holds the answers, approver and date and is the authority. These briefs keep the reasoning and the options that were considered. Where a brief's "proposed default" matches the register, it is now the rule; where the register says more, the register wins.

| ID | Status | Recorded by | Tickets that consume it |
|---|---|---|---|
| D01 | Recorded 2026-09-21 | Nakhun; Ta records | All slice-1 work |
| D02 | Recorded 2026-09-21 | Ta | W0-06 lane mapping, W2-01 |
| D03 | Recorded 2026-09-21 (W0-W3) | Ta | All W0 tickets and all code |
| D05 | Recorded 2026-09-21 | Ta | W0-05, W0-06, W2-02 to W2-07, W2-09 |
| D06 | Recorded 2026-09-21 | Ta | W3-03 to W3-05, W3-07 |
| D11 | Recorded 2026-09-21 | Ta | W1-02, W1-04, W1-05, W3-01 |
| D12 | Recorded 2026-09-21 | Ta | Copy of W1-06, W1-07, W2-07, W2-09, W3-02, W3-03 |

D04 (stack) is decided inside W0-01; see the [W0 technical contract](w0-technical-contract.md). D07-D10 gate later packages and stay open; see [later packages](later-packages-outline.md).

## Evidence format for every decision

Record: decision ID, the exact answer, approver name and role, date, the channel it came through (meeting note, email, signed message), and the documents that change as a result. An agent's recommendation, a demo default or silence is not evidence.

---

## D01 — operator, scope and DPO SLA

**Question for Nakhun.** Confirm three things in writing:

1. The v1 product is a review desk, not the register.
2. You are the gate operator.
3. The DPO lane SLA is 3 working days. (The 5 working days for other lanes is Admin configuration under L12; listed for information, not part of D01.)

**Source evidence.** [Source spec](../product/source-spec.md) "Named people" and "How the old contradictions are resolved". CCXO deck says "3 days"; the working-day reading comes from Ta's v1 spec ([sources](../sources.md)). The operating model §6 proposed ≤10 working days; the v1 spec deliberately does not use it.

**Options.** (a) Confirm all three. (b) Confirm scope and operator, change SLA values; the SLA is Admin configuration (L12), so a different number does not change the build. (c) Name a different operator; the rehearsal owner in W7 changes.

**Recorded answer (2026-09-21).** (a), confirmed by Nakhun to Ta. Source: CCXO deck (3 days) and Ta's v1 spec (working-day reading), as cited above.

**Consumed by.** G0; every slice-1 ticket.

---

## D02 — AI/COE lane's second document

**Question for Ta.** Is the AI/COE lane's second document slot 5 (BRD) or slot 7 (security assessment)?

**Source evidence.** Source spec "Pack and lanes": the whiteboard photograph could read either. DPO (2,3,4,5) and IT/Security (5,6,7,8) match the sketch exactly.

**Options.** (a) BRD: AI/COE reviews risk screening plus the business case; BRD is shared by all three lanes. (b) Security assessment: AI/COE and IT/Security both gate slot 7.

**Recorded answer (2026-09-21).** (a) BRD.

**Consumed by.** A04 expected values; W0-06; W2-01. Lane mapping is versioned so a later decision by Ta can change it without touching history; Admin editing of lane mapping is not in R10 and would need a PRD update.

---

## D03 — application start

**Question for Ta.** Explicitly authorize the product application build (W0 onward).

**Source evidence.** AGENTS.md and BUILD_PLAN G0. The earlier 2026-09-21 authorization (ADR-0002) covered the synthetic demo only; this planning pack did not satisfy D03. D03 was recorded separately the same day (below).

**Recorded answer (2026-09-21).** W0 through W3 authorized; synthetic data only; branches `codex/<ticket-id>-<topic>`, one ticket per PR, reviewed PRs, Ta merges to main; GitHub issues as the tracker of record. Real data needs D08.

**Consumed by.** Every W0 ticket and all code in W1-W3.

---

## D05 — re-review, concurrency, disposition authority, self-approval

**Questions for Ta with Nakhun and the review leads.**

1. **Re-review.** After a send-back and resubmission, do all three lanes re-review, or do unaffected lanes carry their approval forward?
2. **Concurrent send-backs.** If two lanes send back the same version, is one successor draft created that collects both sets of feedback?
3. **Disposition authority.** Who may mark a finding fixed, waived or N/A? Options: the lane reviewer who owns the finding's document, any reviewer, or the owner for "fixed" with reviewer confirmation.
4. **Self-approval and multi-role.** Can one person hold two roles on the same case (for example BU SPOC and a lane reviewer)? Can an owner who is also a reviewer approve their own case?

**Source evidence.** [Workflow contract](../product/workflow.md) "Proposed state and concurrency semantics". PRD "Users and authority". The demo applies full re-review and lets the finding's own lane reviewer disposition it ([handoff](../design/DEVELOPER_HANDOFF.md) step 5).

**Recorded answer (2026-09-21).** Full re-review. Concurrent send-backs merge into one successor draft. The finding's owning lane records waived or N/A; the owner may propose "fixed", which the owning lane confirms. No approval by anyone who is owner or SPOC on the same case. Review leads may refine details inside these rules before W2; anything wider needs a new register row.

**Consumed by.** W0-05, W0-06, W2-02 to W2-07 and W2-09. A07 and A09 expected values follow it.

---

## D06 — working-day calendar, clock and notification policy

**Questions for Nakhun.**

1. Which holiday calendar and timezone apply (proposed: Asia/Bangkok)?
2. When does the SLA clock start (lane opens on submit), pause (while a send-back is with the owner?) and restart (on resubmit: new clock, or continue)?
3. When are SLA-breach reports sent to the operator (daily digest, or on each breach)?
4. How many mail retries, over what window, and how are duplicates suppressed?
5. Who receives the SLA-breach report and who can see recorded delivery failures? The operator is a named person (D01), not one of the six roles.

**Source evidence.** Workflow contract "SLA" and "Failure behavior". PRD "Data, operations and quality". A05.

**Recorded answer (2026-09-21).** Asia/Bangkok with a Thai public-holiday list maintained as Admin configuration. The clock starts when the lane opens and restarts on each new submitted version. The breach report goes out as one daily digest per operator. Retry three times with backoff, deduplicated by (event, version, lane, recipient). Breach digest goes to an Admin-editable configuration value `operator_recipients` (email addresses, L12-style configuration; editable in W6, seeded from configuration in slice 1). Delivery-failure records are shown to Admin in slice 1. No seventh role is added.

**Consumed by.** W3-03 to W3-05, W3-07.

---

## D11 — `use_case_group` and stage-context fields

**Questions for Ta and Nakhun.**

1. What is `use_case_group`, and who owns its value list? The source requires search by group (R6), but the field is missing from the shortened v1 field list.
2. What stage context does a pack declare, so QC can flag a launch checklist filed at idea stage? The source spec says QC may flag a pack-versus-stage mismatch.

**Source evidence.** [Data contract](../product/data-contract.md) "Inherited case fields". Registry schema in Life-OS: `work-work/projects/2026-09-responsible-ai-operating-model/documents/registry-schema.md`. A06.

**What the sources actually say.** The registry schema lists `use_case_group` as a required portfolio-grouping field (see the path above; values not copied here). The schema has **no** stage field. Stage names exist only in the operating model's eight-stage lifecycle (§6), which v1 deliberately does not run (L2).

**Recorded answer (2026-09-21).** Inherit `use_case_group` as required, with its value list held in Admin configuration. One `stage_context` field per pack version with values idea / pre-build / pre-launch, used only as a QC input in W4, never as a lifecycle state machine. W1-02 stores the group; W1-04/W1-05 store and freeze the stage context; W3-01 searches by group.

**Consumed by.** W1-02, W1-04, W1-05, W3-01 group filter; W4 stage QC.

---

## D12 — UI and notification language

**Status.** Recorded 2026-09-21: bilingual with Thai default (option a).

**Question for Ta and Nakhun.** Is the interface and every email Thai only, English only, or both? If both, which is the default and who translates?

**Source evidence.** The whiteboard feedback term is Thai (source spec, "v1 product" step 7); the evaluation plan expects Thai and English documents; the design handoff has English copy only. No source states the UI language.

**Options.** (a) Bilingual with Thai default. (b) English only for slice 1, Thai before W7. (c) Thai only.

**Recorded answer (2026-09-21).** (a). W0-02 requires every user-facing string, email template and finding message to carry a locale key from the first screen.

**Consumed by.** Copy of W1-06, W1-07, W2-07, W2-09, W3-02, W3-03; the W0-02 language rule.
