# Build Plan: RAI Workflow Platform PoC

Version: 1.0, 2026-09-21 (draft 1 was 2026-09-20). **Canonical implementation anchor. G0 closed 2026-09-21; W0-W3 authorized on synthetic data (D03). Package text below stays as written. Current status is the dated section at the end: W3 accepted by Ta on 2026-09-26; W4-W8 remain gated.**

Read [PRD](PRD.md) for product scope, [acceptance](docs/acceptance.md) for expected behavior and [decisions](docs/product/decisions.md) for the recorded rules (D01-D06, D11, D12, including the D03 merge-authority amendment) and the open items (D07-D10). The older repository-foundation plan describes documentation setup only. This document governs the staged product build.

## Authorized design demonstrator

Ta authorized a local synthetic implementation on 2026-09-21. Its [PRD](changes/2026-09-21-local-design-demo/PRD.md), [plan](changes/2026-09-21-local-design-demo/plan.md) and [ADR](adr/0002-local-design-demo.md) govern demo/ and tests/. This exception does not start or approve production packages W0–W8 below; W0-W3 are authorized separately under D03.

## Delivery strategy and dependencies

Prove one synthetic case through a complete review cycle before expanding AI features or exposing real data. Preserve the source's six slices: W1-W3 deliver slice 1, W4 slice 2, W5 slice 3, W6 slice 4, W7 slice 5 and W8 slice 6. W0 prepares authorized implementation.

Sequence: **G0 → W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8**. This is a dependency order, not an elapsed-time estimate. Estimate each package with the assigned engineer after stack and policy decisions; no staffing or delivery date is committed here.

## Build principles

Drawn from existing rules; each cites its source. Nothing here is new scope.

1. **Review desk, not register.** Link only to TPM/VRO/AI Reporting Tool; no dual-write, no lifecycle engine (L2, L3, L6).
2. **Synthetic data first.** Every package proves on synthetic fixtures; real data only after D08.
3. **Server-side authority.** Every read, search, download and deep link is checked on the server; the demo's client permissions are never ported (A01, design-to-build map).
4. **Immutable versions, append-only evidence.** Corrections create N+1; findings, QC runs and audit rows are never overwritten (R7, A07).
5. **AI flags, humans decide.** QC and risk are proposals; no model output approves, waives or transitions (L7, L8, threat model).
6. **Configuration, not code, for what Admin owns.** Templates, thresholds, SLA and group mapping are versioned configuration (L12, R10); lane mapping is a versioned constant fixed by D02.
7. **Simplest shape that keeps the boundaries.** Identity, workflow, storage, QC and mail are seams with test substitutes; no microservices by default (architecture README).
8. **Decisions are recorded, never defaulted.** A pending D-item is used as a marked provisional value with an entry in the register, never silently chosen in code.
9. **Contract first, then parallel lanes, then integration.** Per package: contract PR → lane PRs → integration ticket → recorded exit evidence ([delivery pack](docs/delivery/slice-1-work-breakdown.md)).

## Delivery risks and mitigations

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Recorded decisions are re-litigated in code | Medium | Register rows are the rule; a change needs a new row with approver and date | Ta |
| D04 stack ADR takes long | High | W0-01 scoring criteria fixed in advance; stop condition explicit | Lead + Ta |
| Review leads disagree with the D05 detail during W2 | Medium | Refinement inside the recorded rules is allowed before W2; anything wider is a new register row | Ta + review leads |
| 2-3 engineers plus agents, no committed capacity | Medium | Lane A/B/C split; agent-eligible tickets; no dates | Lead |
| Demo code ported as product | Medium | Design-to-build map "simulation only" table; W1-01 replaces the role switcher | Lead review |
| Agents pick a default for a pending decision | Medium | Task-brief "Pending decisions" section; human review required on authorization, immutability and readiness tickets | Reviewer |
| True AD/host access unknown until W8 | Medium | Identity adapter modes in W0-03; AD mapping deferred to W6/W8 | IT/Security |
| Real-case permission absent for W7 | Medium | D08 gate; synthetic only until then; W7-00 restore rehearsal first | DPO |

Security threats are in the [threat model](docs/security/threat-model.md); per-package risks are in [later packages](docs/delivery/later-packages-outline.md).

## G0: authorization gate, before any code

Closed 2026-09-21. Nakhun confirmed scope, operator and DPO SLA (D01); Ta set the AI/COE mapping (D02) and authorized W0-W3 on synthetic data (D03). Ta also recorded D05, D06, D11 and D12 the same day, so W2 and W3 have no open product decision; see the [register](docs/product/decisions.md).

## Ordered work packages

### W0 — technical contract and reproducible development plan

Entry: G0. Accountable decision maker: Ta; implementer to be assigned.

- Resolve stack and deployment-boundary ADR (D04), comparing a small cohesive app against alternatives by maintainability, auth portability, document handling and operational burden.
- Define exact source/test paths, commands, pinned dependencies, local configuration, synthetic-fixture strategy and CI checks. Record the file-level implementation plan before creating code.
- Carry the recorded D05 workflow/disposition/concurrency rules, D06 calendar/email behavior and D11 group/stage fields into the interface specs. Define initial supported file types and safety limits before upload implementation.
- Specify interfaces for identity, persistence/artifacts, QC and mail, including error contracts and test substitutes. Define expected local workload and measurable performance budgets with Ta/operator.

Exit: reviewed ADR and file-level plan, unresolved decisions assigned to explicit gates, repeatable verification commands specified. No claim of runtime success. Stop if chosen stack assumes unrestricted network login or external-register writes.

### W1 — scoped case and versioned pack

Entry: W0; approved upload policy. Requirements: R1, R2, R7.

- Implement localhost login and six-role server authorization, case metadata, external ID/Unknown and nine-slot pack editing.
- Persist artifact references safely, slot reasons, template identity and immutable submitted snapshots. Keep new drafts distinct from submitted versions.
- Provide case overview, pack editor and version navigation as one usable flow, not disconnected demonstration screens.

Exit evidence: A01 local-role access and direct-file negative tests; A02 all slot dispositions/non-vendor defaults; A07 submitted bytes cannot be overwritten. Create, attach, submit and reopen the same synthetic case after restart. Unsafe uploads and unauthorized requests fail safely. Record test command/output and fixture identity.

### W2 — parallel reviews, send-back and completion

Entry: W1 exit. D02 and D05 are recorded. Requirements: R4, R7, R9.

- Open three lanes together; enforce lane-specific decision permissions and artifact-specific feedback.
- Create one successor draft on send-back; preserve old decisions; implement approved re-review policy and stale-version/replay handling.
- Implement the final completion predicate using current-version approvals and a finding/disposition contract. Before W4, synthetic findings exercise this predicate; do not label QC as implemented.

Exit evidence: A04/A07/A09 and A11 (accepted 2026-09-21: the journey is reconstructable from the audit trail alone and audit rows cannot be updated or deleted through the application); submit v1, review all lanes with one send-back, edit v2 and complete three reviews. Concurrent send-backs do not fork successors, stale approvals fail, undispositioned synthetic findings prevent final readiness, Admin cannot approve without lane authority, and a reviewer who is owner or BU SPOC on the case cannot approve its lane (D05).

### W3 — queue, notification links and SLA reporting

Entry: W2 exit. D06 and D11 are recorded. Requirements: R5, R6; completes source slice 1.

- Deliver role-scoped queue/filtering and visible latest version, lane state and due dates.
- Produce committed-event notifications for readiness, send-back, completion and SLA breach using a local mail sink. Include authorized case links, feedback or defect counts as appropriate.
- Implement agreed working-day rules, observable delivery failure and deduplication/retries. No automatic escalation or real-recipient email in the local demonstration.

Exit evidence: A05/A06, mail failure/retry tests and working-day boundary cases. Repeat W1-W2 as a single UI journey including queue discovery and notification links. Record an end-to-end walkthrough and test outputs. This is the first full synthetic workflow milestone, not full PoC acceptance.

### W4 — version-aware soft QC

Entry: W3, stage fields settled. Before probabilistic QC: D08 model/data handling and D09 evaluation criteria resolved. Requirement: R8; strengthens R9.

- Start with deterministic slot/version/evidence checks; integrate extraction and any subsequently approved model behind the QC boundary.
- Run artifact checks on upload, pack contradictions/stage checks on submit and lane checks before approve. Present evidence locations and append-only runs.
- Implement exact version-scoped metrics, extraction-versus-hallucination checks, classic-ML/N/A handling and explicit unavailable results. Implement authorized fixed/waived/N/A dispositions with reasons.

Exit evidence: A08/A09 plus the frozen evaluation suite; below/equal/above threshold cases, template-version isolation, grounded citations, injection/timeout probes. Submission and reviewer actions remain available with defects; final readiness remains gated. Stop promotion if critical security cases fail or agreed quality thresholds are unmet. Record model/prompt/rule/dataset identities, even when the chosen implementation is deterministic only.

### W5 — risk proposal

Entry: W4 and D07 approved questionnaire/rubric. Requirement: R3.

- Implement versioned seven-question scoring with attributable inputs and explanation.
- Make missing evidence Unknown, display High as requiring Council confirmation, and keep all lanes active.

Exit evidence: A03, at least two approved reference cases and exact boundary/PII/missing-answer tests. No risk tier silently grants approval. Record rubric revision and reviewer acceptance; do not infer questionnaire details from an incomplete source summary.

### W6 — Admin configuration

Entry: W5; configuration activation and authorization rules agreed. Requirement: R10.

- Provide versioned template, threshold and SLA editing with role checks and audit history. Prepare identity-mapping configuration contract; verify actual AD behavior in W8.
- New submissions use published configuration without redeploy; historical evidence retains its original revisions. Explicit rechecks create new records.
- Produce the operator guide for the desk (sign-in mode per environment, queue and SLA report, failed-mail and unavailable-QC views, fixture reset outside production, incident shutdown path, escalation contacts), reviewed by the operator; it is a W7 entry criterion.

Exit evidence: A10 local configuration tests, unauthorized edit rejection, rule activation and rollback tests. Repeat affected QC/risk/SLA tests after a configuration change. All local A01-A10 coverage now has recorded evidence; production-only identity checks remain pending.

### W7 — operator rehearsal and PoC acceptance

Entry: W6, D08 real-case permission/retention approved; closed environment access controls if networked. Operator: Nakhun (D01).

- Rehearse 3-5 permitted cases with actual operator/reviewer participation and controlled notification recipients. Real external mail requires explicit authorization.
- Capture unaided workflow completion, deficiencies, findings reviewers disagree with, manual workarounds and timings. Record data-handling limits; do not commit case contents to Git.
- Resolve blocking defects and rerun affected acceptance/evaluation tests. Produce an acceptance report with explicit operator decision and remaining limitations.
- Entry additionally requires a recorded backup/restore rehearsal on synthetic data and an operator-run rollback (W7-00), and the operator guide from W6 reviewed by the operator. If the rehearsal is networked rather than on localhost: implement the `network` identity mode (allow-list or AD, per W0-03), allow a non-loopback bind only in that mode, and test and record the A01 network clause before the first non-loopback bind. Not needed if the rehearsal stays on localhost.

Exit: recorded acceptance against agreed criteria, or an honest failed/pending rehearsal. A developer demonstration cannot substitute for operator acceptance. Do not promote solely because an aggregate QC score passes.

### W8 — production integration and release

Entry: W7, D10 and applicable D08 decisions approved. Requires accountable True release authorization; not automatic PoC follow-on.

- Configure True host/network and AD roles; disable Google in production. Verify full identity and access matrix, including direct links and files.
- Implement and rehearse operational monitoring, restricted audit logs, mail delivery controls, backup/restore, data retention and incident shutdown.
- Produce stack-specific release and rollback runbooks and repeat the agreed acceptance/evaluation suite on the release candidate.

Exit: A01/A10 production integration evidence, independent security review, restore/rollback evidence, operator release acceptance and approved deployment record. Stop on disclosure, unauthorized decisions, lost versions or incorrect readiness. Preserve audit history during containment and rollback.

## Definition of done for every package

Each package records its requirement/test IDs, changed files, decisions, fixture/config/release identities, actual commands and results, known limitations and review outcome under a dated changes directory. Update DEVLOG with implemented versus verified status. Run relevant regression tests and the complete agreed suite at milestone/release gates. No package closes on screenshots alone or an unexecuted test plan.

When implementation begins, add exact commands to TESTING.md and a package-specific plan before code. Keep PRs bounded to a reviewable outcome; human review remains authoritative. Resolve product scope changes in PRD and decisions before silently expanding implementation.

## Decisions recorded before W0

All recorded on 2026-09-21 in the [register](docs/product/decisions.md); the [briefs](docs/delivery/g0-decision-briefs.md) hold the reasoning.

1. D01 — Nakhun: review desk, operator, DPO 3 working days.
2. D02 — Ta: AI/COE second document is BRD (slot 5).
3. D03 — Ta: W0-W3 authorized, synthetic only, `codex/<ticket-id>-<topic>` branches, reviewed PRs, Ta merges, GitHub issues as tracker.
4. D05, D06, D11, D12 — Ta: brief defaults.

At G0 close, D04 and D07-D10 were open. D04 was subsequently recorded in ADR-0003; D07-D10 remain gates for W4-W8.

## Status against this plan — 2026-09-25 (W3 engineering exit and hardening)

A dated read, not a rewrite. Packages above stay as written. DEVLOG.md is the live record; where they disagree, DEVLOG is newer.

| Gate / package / milestone | Status on 2026-09-25 | Evidence | Next evidence needed |
|---|---|---|---|
| Documentation anchor | Prepared | changes/2026-09-20-build-anchor | — (used to close G0) |
| Delivery pack | Prepared, reviewed by two workflows, A11 accepted | changes/2026-09-21-delivery-planning | Team kickoff |
| G0 | **Closed 2026-09-21** | decisions.md recorded table; changes/2026-09-21-g0-close | — |
| W0 | **Exit recorded 2026-09-21** | changes/2026-09-21-w0-exit/review.md; docs/delivery/w0-technical-contract.md exit checklist | — |
| W1 | **Exit recorded 2026-09-22 (Google loopback sign-in pending Ta)** | changes/2026-09-22-w1-exit/review.md (347 unit, 135 integration, 108 evidence browser tests; exit negatives and restart by hand; fixture set slice1-synthetic@1 7c80ccd43663) | Ta's manual `local-google` sign-in (TESTING.md runbook); not a W2 blocker |
| M1 (W1) | **Reached** (2026-09-22) | changes/2026-09-22-w1-exit/review.md | — |
| W2 | **Exit recorded 2026-09-22** | changes/2026-09-22-w2-exit/review.md (lint, typecheck; 15 W2-INT evidence browser tests; 6 W2-INT negatives; check:substitute-absent 463/0; fixture set slice1-synthetic@1 7c80ccd43663) | — |
| M2 (W2) | **Reached** (2026-09-22) | changes/2026-09-22-w2-exit/review.md | — |
| M3 (W3, slice 1) | **Synthetic engineering exit recorded 2026-09-23; hardening H1-H29 merged** | changes/2026-09-23-w3-exit/review.md; changes/2026-09-23-w3-hardening/review.md (PRs #127-#156) | Ta's package review; Ta/operator confirmation of advisory workload/latency targets |
| W4-W8 | **Not authorized** | — | D07-D10 and package gate entries |

### Where the build diverged from the plan

None on authorization: W0–W3 remain the synthetic-data scope of D03; W4–W8 stay unauthorized until their decision gates. The authorized synthetic demo (ADR-0002) is outside W0-W8.

The [delivery pack](docs/delivery/README.md) breaks G0, W0 and W1-W3 into decision briefs and assignable tickets; it does not change these packages.

After the W3 engineering exit, most W2/W3 PRs (#90-#126) turned out to have merged without an independent review verdict. On Ta's instruction the [W3 hardening change](changes/2026-09-23-w3-hardening/review.md) reviewed them retroactively, fixed, deferred or (in one case, removing the performance harness guard) withdrawn every confirmed finding, and simplified the code in reviewed batches. It changed no scope and no recorded decision.

### W3 detail

| Area | Current state | Remaining boundary |
|---|---|---|
| W3 queue, SLA and notifications | Implemented through reviewed PRs and real-server integration; hardened (derived status, notification shutdown, outbox) | File mail sink only; no external delivery or exactly-once promise |
| Operator diagnostics and slice-1 journey | Real-server evidence, fault/restart negatives, keyboard walkthrough and scoped views recorded; readiness now gates on pending migrations | Synthetic identity/QC adapters; no real model-quality claim |
| Resilience and request safety | Pool idle-error handler, connect timeout, fatal process handlers; `Sec-Fetch-Site` guard on every signed-in write | Secure-cookie enforcement for network mode is a W7-00 precondition |
| W2 finding ownership | Decided 2026-09-25 (register row "D05 refinement (#35)"): slot 5 the raising lane, slot 9 informational, pack AI/COE, QC-unavailable follows the run, nothing carried to N+1; implemented by W2-05 | [Decision brief](changes/2026-09-23-w3-hardening/issue-35-decision-brief.md) for Ta and the review leads |
| Local identity | Automated fixture boundary verified | Manual Google loopback sign-in remains pending Ta |
| W4–W8 | Not authorized | Separate package gates and D07–D10; operator rehearsal and production release remain future work |

The W3 exit record retains failed/repaired checks, source identities and the PR120 premature-merge exception with subsequent verification. Every hardening batch PR (H1-H29, #128-#156) merged only after two independent reviewer verdicts and green CI on the reviewed head, except #136, which got its second verdict after merge. The docs-only frame PR #127 merged with no reviewer verdict and before its CI finished (CI passed afterwards). Both exceptions are recorded in the hardening review. There is no scope change or authorization to continue into W4 here.

## Status against this plan — 2026-09-26 (W3 accepted)

A dated read; the 2026-09-25 section above stays as written.

| Gate / package / milestone | Status on 2026-09-26 | Evidence | Next evidence needed |
|---|---|---|---|
| M3 (W3, slice 1) | **Accepted by Ta, 2026-09-26** (package review after the synthetic walkthrough with Nakhun; no change requested) | changes/2026-09-23-w3-exit/review.md; changes/2026-09-23-w3-hardening/review.md; changes/2026-09-26-nakhun-walkthrough/notes.md | Not blocking: Ta/operator confirmation of the advisory workload and latency targets; Ta's manual `local-google` sign-in (W1) |
| W4-W8 | **Not authorized** | — | D08 and D09 before W4 probabilistic QC, a W4 gate entry by Ta; D07 before W5; D10 before networked tests or W8 |

W3 follow-ups W3-F1 to W3-F7 (#163-#169), which implement Ta's rulings of 2026-09-26, merged the same day through reviewed PRs #172-#179; each had two independent reviewer verdicts and green CI on the merged head (records under `changes/2026-09-26-w3-f*`). W3-F8 (#180, a guard test that every case-table read is scoped; PR #181) is in review in a separate session.

Slice 1 (W1-W3) is complete on synthetic data. This is desk-completion acceptance of a synthetic build, not operator acceptance (W7) or release (W8), and it authorizes nothing beyond D03.

## Status against this plan — 2026-09-26 (W4a gate entry)

A dated read; earlier sections stay as written.

**W4a gate entry (Ta, 2026-09-26; register row "W4a gate entry").** Ta authorizes W4a, the metadata-only deterministic part of W4 (version-aware soft QC), on synthetic data only, under the same branch, reviewed-PR and merge flow as D03 and its 2026-09-21 amendment, with tickets W4-00a, W4-02, W4-03, W4-04, W4-11a, W4-12, W4-13 and the W4a exit of the [W4 work breakdown](docs/delivery/w4-work-breakdown.md). Preconditions: (1) W3 accepted by Ta, 2026-09-26; (5) the slot-5 and slot-9 upload-unavailable owning lane recorded (register row "D05 refinement (upload slot 5 and 9)"); the [W4-00a file-level plan](docs/engineering/implementation-plan-w4a.md) merged before any W4a code. Its fixture labels are provisional until D09 is recorded. W4b keeps every precondition of the draft W4 gate entry in the [W4 decision briefs](docs/delivery/w4-decision-briefs.md#draft-w4-gate-entry-for-build_plan). Real data, networked access and external mail stay excluded.

| Gate / package | Status on 2026-09-26 | Next evidence needed |
|---|---|---|
| W4a (deterministic metadata QC) | **Authorized**; W4-00a plan in review | W4-00a merged; W4a tickets through reviewed PRs; W4a exit record reviewed by Ta |
| W4b (extraction, model rules, evaluation) | **Not authorized** | AI/COE lead and IT/Security owner named; D08 and D09 recorded; W4b gate entry; then W4-00b and ADR-0006 before extraction or model code |
| W5-W8 | **Not authorized** | D07 before W5; D10 before networked tests or W8 |

## Status against this plan — 2026-09-27 (W4a engineering exit)

A dated read; earlier sections stay as written.

| Gate / package | Status on 2026-09-27 | Evidence | Next evidence needed |
|---|---|---|---|
| W4a (deterministic metadata QC) | **Engineering exit recorded; awaiting Ta's package review.** W4-11a, W4-02, W4-03, W4-13, W4-04 and W4-12 merged through reviewed PRs #192-#197 on the W4-00a plan (#183) | [changes/2026-09-27-w4a-exit/review.md](changes/2026-09-27-w4a-exit/review.md): from a clean checkout of `da3d815`, the W4-03 (6/6) and W4-04 (10/10) fixture tests, the real-server test (6/6), the W4-12 journeys on the real server (6 passed), readiness `qc.kind` `deterministic`, `check:substitute-absent`, and the full section 8 gate (648 unit, 374 integration, 202 real-server browser, 48 substitute browser); rule revision `w4a.1`, runner `deterministic` `0.0.0`, fixture set `slice1-synthetic@1 7c80ccd43663` | Ta's review of the W4a exit record. Rule outcomes stay provisional until D09 |
| W4b (extraction, model rules, evaluation) | **Not authorized** (unchanged) | — | AI/COE lead and IT/Security owner named; D08 and D09 recorded; W4b gate entry; then W4-00b and ADR-0006 before extraction or model code |
| W5-W8 | **Not authorized** (unchanged) | — | D07 before W5; D10 before networked tests or W8 |

W4a is not accepted until Ta reviews the exit record. It reads only structured pack data; content rules, extraction, the model, the evaluation harness and dedup remain W4b's.

## Status against this plan — 2026-09-27 (W4b-W7 under Ta's delegation)

A dated read; earlier sections, and the package entry conditions above, stay as written.

**Gate entries (Ta, 2026-09-27; register row "Ta's delegation (2026-09-27)").** In the Claude Code session of 2026-09-27 Ta directed the agent team to implement W4b, W5, W6 (with a desk dashboard) and W7 on synthetic data without stopping, under the D03 reviewed-ticket flow and its 2026-09-21 merge amendment (one ticket per branch and PR; two independent reviewer verdicts and green CI on the exact head before merge; Ta reviews package exit records). The north star is a working RAI review platform that streamlines the review workflow, tracks version history and shows a dashboard, running end to end on synthetic data; details are tuned with the team later. Ta delegated every choice that would otherwise need Ta to the agent team, made by options and a recommendation against that north star and recorded as **provisional** in the register rows "W4b/W5/W6/W7 delegated rulings (provisional)" for Ta to confirm or replace. Each package's file-level plan must merge before its code: [W4b](docs/engineering/implementation-plan-w4b.md), [W5](docs/engineering/implementation-plan-w5.md), [W6](docs/engineering/implementation-plan-w6.md), [W7](docs/engineering/implementation-plan-w7.md); the consolidated planning change is [changes/2026-09-27-w4b-w7-plans](changes/2026-09-27-w4b-w7-plans/intent.md).

Entry conditions the delegation replaces or relaxes, **for synthetic-data work only**, stated so that nobody reads them as met:

- **W4b.** "AI/COE lead and IT/Security owner named; D08 and D09 recorded" is replaced by the labelled D08 and D09 working assumptions of the W4b plan (no model provider, a port with a local fake disabled by default, a fresh child process per extraction, a synthetic evaluation set with provisional, unsigned labels and thresholds). D08 and D09 stay open, and real-data or provider use still needs them. ADR-0006 is provisional; Ta's and the tech lead's acceptance moves to the W4b exit review (W4-14).
- **W5.** "W4 and D07 approved" is not met: D07 is open and not satisfied (a labelled synthetic placeholder rubric stands in), and W4 is only partly met (W4a merged, its exit record awaiting Ta's review; W4b runs in parallel). A03 stays partial until AI/COE records D07.
- **W6.** "W5" is relaxed: W6 tickets that do not need W5 run in parallel with it. The desk dashboard is a delegated addition, not a PRD requirement. The W6 exit statement cites "all local A01-A10 coverage" only with the owner-dependent exceptions listed (A03 pending D07; A08/A09 thresholds pending D09; production group mapping pending D10/W8; production identity checks).
- **W7.** The synthetic parts only: restore and rollback (W7-00) rehearsed by an agent as operator stand-in, `network` identity with the `allow-list` source proven on loopback, the rehearsal kit and a synthetic dress rehearsal. The real rehearsal (3-5 permitted cases with Nakhun), the operator-run rollback, the operator's review of the operator guide and PoC acceptance stay **pending D08 and the operator**. No non-loopback bind is performed (D10).

| Gate / package | Status on 2026-09-27 | Next evidence needed |
|---|---|---|
| W4a (deterministic metadata QC) | Engineering exit recorded; **Ta's package review not recorded** (unchanged) | Ta's review of the W4a exit record |
| W4b (content QC, extraction, evaluation) | **Authorized provisionally on synthetic data** (Ta's delegation of 2026-09-27); W4-00b plan in the consolidated planning change | Plan merged; W4b tickets through reviewed PRs; W4-14 exit record, which may honestly record a failed held-out threshold; Ta reviews it |
| W5 (risk proposal) | **Authorized provisionally on synthetic data**, D07 open and not satisfied | Plan merged; W5 tickets; W5 exit record with A03 marked partial pending D07 |
| W6 (Admin configuration, desk dashboard, operator guide) | **Authorized provisionally on synthetic data** | Plan merged; W6 tickets; W6 exit record with the qualified coverage statement |
| W7 (synthetic rehearsal kit, restore and rollback, network identity) | **Authorized provisionally for its synthetic parts**; real rehearsal pending D08 and the operator | Plan merged; W7 tickets; W7 synthetic engineering exit record (not PoC acceptance) |
| W8 (production integration and release) | **Not authorized**; out of scope of the delegation | D10, applicable D08 decisions and accountable True release authorization |

Hard limits for all four packages: synthetic data only; no external network call from the product or its tests (no model provider; the model port's only implementation besides "disabled" is a local deterministic fake used in tests); no deploy (a later host such as Replit is Ta's choice and is not part of this entry); no claim that an owner approved anything. D07, D08, D09 and D10 remain open for their owners.
