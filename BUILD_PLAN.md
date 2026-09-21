# Build Plan: RAI Workflow Platform PoC

Version: draft 1, 2026-09-20. **Canonical implementation anchor. All work packages below are not started.** Documentation preparation does not authorize code.

Read [PRD](PRD.md) for product scope, [acceptance](docs/acceptance.md) for expected behavior and [decisions](docs/product/decisions.md) for pending approvals. The older repository-foundation plan describes documentation setup only. This document governs the future product build.

## Authorized design demonstrator

Ta authorized a local synthetic implementation on 2026-09-21. Its [PRD](changes/2026-09-21-local-design-demo/PRD.md), [plan](changes/2026-09-21-local-design-demo/plan.md) and [ADR](adr/0002-local-design-demo.md) govern demo/ and tests/. This exception does not start or approve production packages W0–W8 below.

## Delivery strategy and dependencies

Prove one synthetic case through a complete review cycle before expanding AI features or exposing real data. Preserve the source's six slices: W1-W3 deliver slice 1, W4 slice 2, W5 slice 3, W6 slice 4, W7 slice 5 and W8 slice 6. W0 prepares authorized implementation.

Sequence: **G0 → W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8**. This is a dependency order, not an elapsed-time estimate. Estimate each package with the assigned engineer after stack and policy decisions; no staffing or delivery date is committed here.

## G0: authorization gate, before any code

Record Nakhun's confirmation of scope/operator/proposed SLA (D01), Ta's AI/COE document mapping (D02), and explicit application-start instruction (D03). The present instruction to finish plans does not satisfy D03. Requirements may be clarified while waiting; do not scaffold a runtime.

## Ordered work packages

### W0 — technical contract and reproducible development plan

Entry: G0. Accountable decision maker: Ta; implementer to be assigned.

- Resolve stack and deployment-boundary ADR (D04), comparing a small cohesive app against alternatives by maintainability, auth portability, document handling and operational burden.
- Define exact source/test paths, commands, pinned dependencies, local configuration, synthetic-fixture strategy and CI checks. Record the file-level implementation plan before creating code.
- Confirm D05 workflow/disposition/concurrency rules; D06 calendar/email behavior; D11 group/stage fields before dependent work. Define initial supported file types and safety limits before upload implementation.
- Specify interfaces for identity, persistence/artifacts, QC and mail, including error contracts and test substitutes. Define expected local workload and measurable performance budgets with Ta/operator.

Exit: reviewed ADR and file-level plan, unresolved decisions assigned to explicit gates, repeatable verification commands specified. No claim of runtime success. Stop if chosen stack assumes unrestricted network login or external-register writes.

### W1 — scoped case and versioned pack

Entry: W0; approved upload policy. Requirements: R1, R2, R7.

- Implement localhost login and six-role server authorization, case metadata, external ID/Unknown and nine-slot pack editing.
- Persist artifact references safely, slot reasons, template identity and immutable submitted snapshots. Keep new drafts distinct from submitted versions.
- Provide case overview, pack editor and version navigation as one usable flow, not disconnected demonstration screens.

Exit evidence: A01 local-role access and direct-file negative tests; A02 all slot dispositions/non-vendor defaults; A07 submitted bytes cannot be overwritten. Create, attach, submit and reopen the same synthetic case after restart. Unsafe uploads and unauthorized requests fail safely. Record test command/output and fixture identity.

### W2 — parallel reviews, send-back and completion

Entry: W1, D02 and D05 resolved. Requirements: R4, R7, R9.

- Open three lanes together; enforce lane-specific decision permissions and artifact-specific feedback.
- Create one successor draft on send-back; preserve old decisions; implement approved re-review policy and stale-version/replay handling.
- Implement the final completion predicate using current-version approvals and a finding/disposition contract. Before W4, synthetic findings exercise this predicate; do not label QC as implemented.

Exit evidence: A04/A07/A09; submit v1, review all lanes with one send-back, edit v2 and complete three reviews. Concurrent send-backs do not fork successors, stale approvals fail, undispositioned synthetic findings prevent final readiness, and Admin cannot approve without lane authority.

### W3 — queue, notification links and SLA reporting

Entry: W2, D06/D11 resolved. Requirements: R5, R6; completes source slice 1.

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

Exit evidence: A10 local configuration tests, unauthorized edit rejection, rule activation and rollback tests. Repeat affected QC/risk/SLA tests after a configuration change. All local A01-A10 coverage now has recorded evidence; production-only identity checks remain pending.

### W7 — operator rehearsal and PoC acceptance

Entry: W6, D08 real-case permission/retention approved; closed environment access controls if networked. Operator: Nakhun subject to confirmation.

- Rehearse 3-5 permitted cases with actual operator/reviewer participation and controlled notification recipients. Real external mail requires explicit authorization.
- Capture unaided workflow completion, deficiencies, findings reviewers disagree with, manual workarounds and timings. Record data-handling limits; do not commit case contents to Git.
- Resolve blocking defects and rerun affected acceptance/evaluation tests. Produce an acceptance report with explicit operator decision and remaining limitations.

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

## Build status and immediate next step

| Stage | Status | Next evidence needed |
|---|---|---|
| Documentation anchor | Prepared; see change review | Owner review of PRD and this plan |
| G0 | Pending | D01-D03 evidence |
| W0-W8 | Not started | Start gate, then package entry criteria |

Next action is to review the PRD and resolve G0, not generate a starter. This plan is usable as a stable backlog now; exact code paths and commands are intentionally deferred until authorized stack selection. Supporting [architecture](docs/architecture/README.md), [threat model](docs/security/threat-model.md) and [evaluation](docs/evaluation/plan.md) remain part of the build contract.
