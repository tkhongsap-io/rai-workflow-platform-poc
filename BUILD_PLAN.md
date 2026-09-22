# Build Plan: RAI Workflow Platform PoC

Version: 1.0, 2026-09-21 (draft 1 was 2026-09-20). **Canonical implementation anchor. G0 closed 2026-09-21; W0-W3 authorized on synthetic data (D03). Package text below stays as written. Current status is the dated section at the end: W3 synthetic engineering exit recorded; Ta’s package review remains pending.**

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

## Status against this plan — 2026-09-22 (W3 delivery in progress)

A dated read, not a rewrite. Packages above stay as written. DEVLOG.md is the live record; where they disagree, DEVLOG is newer.

| Gate / package / milestone | Status on 2026-09-22 | Evidence | Next evidence needed |
|---|---|---|---|
| Documentation anchor | Prepared | changes/2026-09-20-build-anchor | — (used to close G0) |
| Delivery pack | Prepared, reviewed by two workflows, A11 accepted | changes/2026-09-21-delivery-planning | Team kickoff |
| G0 | **Closed 2026-09-21** | decisions.md recorded table; changes/2026-09-21-g0-close | — |
| W0 | **Exit recorded 2026-09-21** | changes/2026-09-21-w0-exit/review.md; docs/delivery/w0-technical-contract.md exit checklist | — |
| W1 | **Exit recorded 2026-09-22 (Google loopback sign-in pending Ta)** | changes/2026-09-22-w1-exit/review.md (347 unit, 135 integration, 108 evidence browser tests; exit negatives and restart by hand; fixture set slice1-synthetic@1 7c80ccd43663) | Ta's manual `local-google` sign-in (TESTING.md runbook); not a W2 blocker |
| M1 (W1) | **Reached** (2026-09-22) | changes/2026-09-22-w1-exit/review.md | — |
| W2 | **Exit recorded 2026-09-22** | changes/2026-09-22-w2-exit/review.md (lint, typecheck; 15 W2-INT evidence browser tests; 6 W2-INT negatives; check:substitute-absent 463/0; fixture set slice1-synthetic@1 7c80ccd43663) | — |
| M2 (W2) | **Reached** (2026-09-22) | changes/2026-09-22-w2-exit/review.md | — |
| M3 (W3, slice 1) | Authorized (D03), in progress. W3-05 SLA and W3-01 queue API landed; mail-sink dependency available | PR #104, #109, #107; DEVLOG and ticket review records | Queue UI, notifications/digest/retries, observability, W3-INT and W3-06 exit evidence |
| W4-W8 | **Not authorized** | — | D07-D10 and package gate entries |

### Where the build diverged from the plan

None on authorization: W0–W3 remain the synthetic-data scope of D03; W4–W8 stay unauthorized until their decision gates. The authorized synthetic demo (ADR-0002) is outside W0-W8.

The [delivery pack](docs/delivery/README.md) breaks G0, W0 and W1-W3 into decision briefs and assignable tickets; it does not change these packages.

W2 exit is recorded and Milestone M2 is reached. W3 delivery is in progress: SLA (PR #104), scoped queue API (PR #109), mail-sink dependency (PR #107) and the queue UI contract (PR #110) have merged. The W1-11 dependency is resolved; the remaining UI, notification and observability tickets proceed through separate reviewed PRs before W3-INT and the M3 exit. Issue #35 and epic #53 stay open. W4–W8 are not authorized. Supporting [architecture](docs/architecture/README.md), [threat model](docs/security/threat-model.md) and [evaluation](docs/evaluation/plan.md) remain part of the build contract. DEVLOG.md is the live record.

## Status against this plan — 2026-09-23 (W3 engineering exit)

The preceding 2026-09-22 status is historical. W3 implementation and the synthetic engineering evidence are recorded in the [exit review](changes/2026-09-23-w3-exit/review.md). Ta’s package review is still pending; no production or operator acceptance is inferred.

| Area | Current state | Remaining boundary |
|---|---|---|
| W3 queue, SLA and notifications | Implemented through reviewed prerequisite PRs and real-server integration | File mail sink only; no external delivery or exactly-once promise |
| Operator diagnostics and slice-1 journey | Real-server evidence, fault/restart negatives, keyboard walkthrough and scoped views recorded | Synthetic identity/QC adapters; no real model-quality claim |
| M3 engineering exit | Test, timing and recording evidence recorded in W3-06 | Ta’s package review; Ta/operator confirmation of advisory workload/latency targets |
| W2 finding ownership | Existing issue #35 and epic #53 stay open | Slot5/9, pack and unavailable owning-lane semantics remain unresolved |
| Local identity | Automated fixture boundary verified | Manual Google loopback sign-in remains pending Ta |
| W4–W8 | Not authorized | Separate package gates and D07–D10; operator rehearsal and production release remain future work |

The exit record retains failed/repaired checks, source identities and the PR120 premature-merge exception with subsequent verification. Later merges require all required checks to succeed on the exact independently reviewed head. There is no scope change or authorization to continue into W4 here.
