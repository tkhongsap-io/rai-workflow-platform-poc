# W0: technical contract and reproducible development plan

Status: **Ready. G0 closed 2026-09-21; W0 is authorized (D03).** Entry, work and exit come from [BUILD_PLAN](../../BUILD_PLAN.md) W0. This file breaks that into tickets. W0 produces documents and decisions, not application code. The frontend and backend engineering documents are written here.

Accountable: Ta. Responsible: tech lead. Output location: `adr/` for decisions, `docs/engineering/` for interface specs and the file-level plan. The W0 file-level plan defines the exact paths.

## Tickets

| ID | Outcome | Depends on | Owner type | Proves / feeds |
|---|---|---|---|---|
| W0-01 | Stack and deployment-boundary ADR (D04) | G0 | Human (lead + Ta decide) | All later packages |
| W0-02 | File-level implementation plan: repo layout, commands, pinned dependencies, local config, CI checks | W0-01 | Human; agent may draft | TESTING.md update |
| W0-03 | Identity adapter spec | W0-01 | Human review required | A01, R1 |
| W0-04 | Persistence and artifact-store spec | W0-01 | Human review required | A07, R7 |
| W0-05 | Authorization policy matrix | W0-01; D05 recorded | Human review required | A01, A09 |
| W0-06 | Workflow transition and error contract | W0-01; D02 and D05 recorded | Human review required | A04, A07, A09 |
| W0-07 | QC boundary and mail sink specs with test substitutes | W0-01 | Agent-eligible draft, human review | A05, A08 (later) |
| W0-08 | Upload safety policy and synthetic fixture strategy | G0; IT/Security consulted if named, otherwise Ta accepts for synthetic data | Human review required | A01, threat model |
| W0-09 | Verification commands, performance budgets and W0 exit review | W0-02 to W0-08, W0-10 | Human | W0 exit |
| W0-10 | Observability contract for the desk runtime | W0-01, W0-06 | Agent-eligible draft, human review | W3-07, W7, W8 |

---

## W0-01 — stack ADR (D04)

Write `adr/0003-stack-and-deployment-boundary.md`. It compares candidate shapes and records a decision only when Ta and the lead approve it. This pack does not pick one.

**Candidate shapes to compare** (examples; the lead may add others):

| Shape | Description | Watch for |
|---|---|---|
| A. Small cohesive server-rendered app | One web process renders pages and enforces rules; one relational database; local blob directory behind an interface | Richness of the reviewer UI; whether it matches team skills |
| B. SPA + API | Separate browser app and API service, one repo | Two deployables; authorization must still live entirely in the API |
| C. Full-stack framework | One framework handles both UI and server routes | Framework coupling of auth and data access; upgrade burden on the True host |

The BUILD_PLAN preference is the simplest shape that keeps the [architecture boundaries](../architecture/README.md), not microservices.

**Scoring criteria** (each scored with evidence, not preference):

1. **Server-side authorization.** Every read, download, search and deep link is checked on the server (A01).
2. **Auth portability.** Google on localhost only, allow-list or AD when networked, True AD/Entra in production, all behind one adapter (L4, L11).
3. **Transactional integrity.** Version freeze, lane decisions, successor creation and the Ready transition are atomic and idempotent (A07, A09).
4. **Document handling.** Private blob storage, hashing, size and type limits, safe download.
5. **Operational burden on the True host.** Runtime availability, patching, backup and restore (W8, D10).
6. **Team skills and maintainability** for 2-3 engineers plus agents.
7. **Testability.** Unit, integration and browser tests runnable locally without external services.

**Stop condition** (from BUILD_PLAN). Reject any option that assumes unrestricted network login or writes to TPM, VRO or the AI Reporting Tool.

## W0-02 — file-level implementation plan

A `docs/engineering/implementation-plan-w1-w3.md` that an engineer can follow without asking. It must contain:

- the repository layout: app, tests, fixtures and config paths, and where the legacy `demo/` stays (reference only);
- exact commands to install, run, test, lint and reset local data;
- pinned dependency versions with a short reason for each;
- local configuration and secret handling (no secrets in Git; the variable list and placeholder values for the sample env file, which W1-00 creates with the repo skeleton, not W0-02);
- the CI checks that run on every PR (tests, lint, link check, frozen-source hash);
- the PR size and branch rules from [team and roles](team-and-roles.md), and the resulting sub-ticket list for slice 1;
- a **W1 interface shapes** section: the request/response shape for sign-in (W0-03), case create/edit/read/list (W1-02), artifact upload/download (W1-03), pack draft (W1-04) and version navigation (W1-05), each naming its W0-06 error cases; W1-13 serves these and Lane B builds against them. W2 and W3 shapes are added to this section by that server ticket's contract PR before the ticket starts. The same PR fills the "Path in repo" column of the [architecture boundary table](../architecture/README.md);
- a **test-layer map**: unit, integration against the real store plus substitutes, and browser journey, stating which acceptance ID is proven at which layer, plus the fixture identity convention;
- a **UI quality bar**, proposed for Ta to confirm: WCAG 2.2 AA as the conformance target; status is never colour-only; dialog focus containment; visible focus; a named automated accessibility audit available for the chosen stack runs inside the browser suite;
- a **language rule**: all user-facing strings, email templates and finding messages are externalised with a locale key from the first screen; dates and times render in the D06 timezone; Thai text is handled correctly in filenames (W1-03), search (W3-01) and email subjects (W3-03). D12: bilingual, Thai default.

## W0-03 — identity adapter spec

- **Interface.** Takes the verified login, returns subject ID, display name, email and a list of (role, scope) pairs; scope is the BU for SPOC and owned cases for owner.
- **Modes.** `local-google` is loopback only and refuses to start on a non-loopback bind. `network` uses an allow-list or AD. `production` uses True AD only; Google is off. The mode is configuration, and misconfiguration fails closed.
- **Test substitute.** A fixture identity provider with the six synthetic single-role users plus one dual-role identity (a lane reviewer who is also BU SPOC of one fixture BU, so the W0-05 no-self-approval row can be exercised; a fixture user, not a seventh role), usable only in the test environment.
- **Secrets.** Networked or production identity, mail and store credentials are held in a custody mechanism approved under D10, never in configuration files; the adapter refuses to start in `network` or `production` mode if they are absent.
- **Open.** The AD group-to-role mapping belongs to W6 and W8 (A10). W0 defines only the configuration shape.

## W0-04 — persistence and artifact store spec

Based on the [data contract](../product/data-contract.md) entities.

- **Entities.** Case, pack version, artifact slot, lane decision, QC run/finding, disposition event, notification, configuration revision, audit event.
- **Desk-local Case fields Ta confirms here, before W1-02 starts.** `vendor_involved` (drives the slot 3/4 non-vendor N/A default, W1-04) and `model_type` (LLM / classic-ML / other; drives the classic-ML metric-or-N/A QC rule): desk-local, never exported as registry fields. And the writer and meaning of the four inherited status fields `privacy_status`, `security_status`, `rai_status`, `ai_readiness_status`: either (a) read-only projections written only by the workflow (DPO lane → privacy, IT/Security lane → security, AI/COE lane → rai, Ready predicate → ai_readiness, in the same transaction as the W2-02/W2-06 event) or (b) non-authoritative reference values copied from the external register (L3, L6). Under either answer they are never a second record of a lane decision or of Ready (L8), and no owner or BU SPOC write may make one read as an approval.
- **Immutability.** A submitted version and its artifact references are never updated. Corrections create a new version. Findings are never overwritten; dispositions append.
- **Artifacts.** Store bytes privately, keyed by content hash. Metadata records filename, media type, size, uploader and time. Downloads always go through authorization.
- **Transactions.** Say which operations are atomic (submit, decide, send back, resubmit, Ready) and how idempotency keys are stored.
- **Restart proof.** Data survives a process restart (W1 exit evidence).
- **Audit log.** Audit events are append-only with no update or delete path in the application's data-access layer; each is written in the same transaction as the state change it describes; each carries the request correlation ID; fields are references, never document bytes; readable only by Admin and the D06 operator audience under the same server-side check as everything else.
- **Schema evolution.** Migrations are versioned and forward-only, run as an explicit operator step rather than implicitly at start, and are tested against the synthetic fixture store and against a restored backup. No migration rewrites a submitted version, artifact reference, finding, disposition or audit row; any reshaping copies forward and keeps the original. Each migration states its rollback expectation.
- **Retention and deletion design (decision pending D08).** Specify, stack-neutrally and as options for D08 rather than a choice: how an approved deletion of personal data can be executed without rewriting an immutable submitted version (for example a recorded redaction or tombstone event referencing the version, or key destruction for the blob); how audit retention differs from business-data retention; how unsubmitted drafts and failed uploads are cleaned up. Encryption key custody stays open until D08/D10.

## W0-05 — authorization policy matrix

A table of role × action × scope, derived from the PRD, the source spec and the recorded D05 rules.

| Action | Owner | BU SPOC | AI/COE | DPO | IT/Sec | Admin |
|---|---|---|---|---|---|---|
| View case, files, history | Own | BU | All | All | All | All |
| Create, edit draft, submit | Own | BU | — | — | — | — |
| Approve or send back a lane | — | — | Own lane | Own lane | Own lane | — (never implicit) |
| Disposition a finding | Propose "fixed" only | Propose "fixed" only | Own lane's findings | Own lane's findings | Own lane's findings | — |
| Approve a lane on a case where the actor is owner or BU SPOC | — | — | Never (D05) | Never (D05) | Never (D05) | — |
| Edit configuration | — | — | — | — | — | Yes (W6) |

Rows to add: search results, counts, deep links and file download, all following case-view scope; and notification recipients, where lane-open, send-back and Ready recipients follow case-view scope while SLA-breach digest recipients come from the operator-recipient configuration (D06 q5) and are not a role.

## W0-06 — workflow transition and error contract

Based on the [workflow contract](../product/workflow.md).

- **States and events:** create, save draft, submit, approve, send back, resubmit, disposition, Ready. Each has its preconditions, its postconditions and the audit event it writes.
- **Lane mapping** is a versioned constant held in code or fixture, recorded on each submitted version: AI/COE slots 1 and 5 (D02), DPO 2-5, IT/Security 5-8. It is not an Admin-editable configuration revision (source spec Admin row; R10).
- Transition rules follow D05: resubmission reopens all lanes; concurrent send-backs merge into one successor draft; disposition authority and the no-self-approval rule as in W0-05.
- **Owning-lane assignment (D05 refinement, review leads before W2-05).** A finding on a single-lane slot (1, 2, 3, 4, 6, 7, 8) is owned by that slot's lane under the recorded mapping. The rule for slot 5 (BRD, shared by all three lanes), slot 9 (no lane gate), pack-level findings (completeness, cross-document contradiction, pack-versus-stage mismatch) and QC-unavailable findings is a D05 refinement the review leads record here before W2-05 starts; until recorded it is an open item on this ticket, not a silent default. Admin never dispositions; no seventh role.
- **Expected-version checks.** A stale action returns a stale-version error with refresh guidance and changes nothing.
- **Error types** (from the [architecture](../architecture/README.md)): unauthenticated, forbidden, stale version, invalid input, unsafe upload, QC unavailable, mail delivery failed. Each has a user message and an HTTP or equivalent code chosen in W0-01.

## W0-07 — QC boundary and mail sink

- **QC.** Inputs are a version reference and authorized artifact references. Outputs are typed findings (rule ID, rule revision, evidence location, metric/denominator/threshold where relevant, severity, `owning_lane` = AI/COE | DPO | IT/Security assigned by the W0-06 rule) or an explicit `unavailable` result, recorded as a finding with an `owning_lane` under the same rule. QC has no approval, mail or write access to workflow state. The slice-1 substitute returns scripted synthetic findings and can simulate a timeout. No model is chosen here (D08, D09).
- **Mail.** Accepts a committed business event, authorized recipients, a safe deep link and a dedup key. Returns delivery status. The local substitute writes to a file or in-memory sink; no external mail is sent.

## W0-08 — upload safety policy and fixtures

- **Initial allowed types**, proposed: PDF, DOCX, XLSX, PNG and JPEG. Set a per-file size limit and a per-pack total. Reject archives and executables. For synthetic data Ta accepts the final list and limits at the W0 exit review (W0-09), with IT/Security consulted if named by then; D08 revisits the limits before any real data.
- Unsafe bytes are rejected with a safe error. Say what the check is (type sniffing, not the extension alone).
- **Fixtures.** Synthetic cases and documents only, generated inside the repo. Include one non-vendor case, one vendor case, one case with a missing slot and one with N/A reasons. No content copied from real cases or Life-OS evidence. Include one Thai-named file and one synthetic operator recipient address used only by the local mail sink.

## W0-09 — verification commands, budgets and exit review

- Confirm the W0-02 commands are present in the TESTING.md "Product build (W0-W3)" section; W0-02 owns that edit, W0-09 only verifies it and does not run the commands (no claim of runtime success).
- **Performance budgets.** Agree the expected local workload with Ta and the operator, such as cases per month and pack size. Record the numbers as targets, not measurements.
- **Exit review.** Record it in `changes/<date>-w0-technical-contract/review.md`.

## W0-10 — observability contract for the desk runtime

This is health of the review-desk process itself. It is not monitoring of any AI use case, so it does not touch the L2/L3 non-goals or the source spec's "no monitoring/health fields in v1". Stack-neutral.

- **Structured event logging** with a correlation ID that is the same value written to the audit event, the notification record and the QC run for one request.
- **Redaction rule.** No document contents, personal data, tokens or deep-link secrets in logs (threat model).
- **Liveness and readiness** check reporting identity mode, store reachability and mail-sink status; fails closed when the identity mode is misconfigured.
- **Error capture** categorised by the seven contract error types.
- **Operator view**, minimal: failed mail, unavailable QC runs and SLA-breach report generation.
- True-side monitoring integration stays in W8.

## W0 exit checklist (from BUILD_PLAN)

- [ ] Stack ADR reviewed and accepted by Ta (W0-01).
- [ ] File-level plan with paths, commands, pinned deps, fixtures and CI checks (W0-02).
- [ ] Identity, persistence/artifacts, QC and mail interfaces with error contracts and test substitutes (W0-03, W0-04, W0-07).
- [ ] Recorded D05, D06 and D11 rules carried as written into the interface specs (W0-02, W0-04, W0-05, W0-06); D04 recorded by W0-01; D07-D10 left open and assigned to the gates named in the [register](../product/decisions.md).
- [ ] `vendor_involved`, `model_type` and the meaning of the four inherited status fields confirmed by Ta and recorded (W0-04).
- [ ] Upload types and safety limits defined (W0-08).
- [ ] Repeatable verification commands specified. No claim of runtime success (W0-09).
- [ ] Observability contract, audit-log rules, schema-evolution rules, UI quality bar and language rule written (W0-02, W0-04, W0-10).
- [ ] Stop condition checked: no unrestricted network login, no external-register writes.
