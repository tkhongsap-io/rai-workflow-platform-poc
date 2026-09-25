# Decision briefs: W4 gate (D08, D09)

Status: **draft decision material, prepared 2026-09-26 on Ta's instruction. Nothing here is decided.** D08 and D09 are open in the [decision register](../product/decisions.md), which is the only record of a decision. W4 is **not authorized**: D03 covers W0-W3 only, and [BUILD_PLAN](../../BUILD_PLAN.md) W4 needs D08 and D09 resolved before probabilistic QC, plus a W4 gate entry by Ta. Every "recommendation" below is an agent's proposal for the owners to accept, change or refuse. It is not evidence of a decision.

This pack follows the house format of the [G0 decision briefs](g0-decision-briefs.md). The draft ticket list that consumes these decisions is the [W4 work breakdown](w4-work-breakdown.md).

| ID  | Status           | Owners (approve)                                    | Records | Tickets that would consume it            |
| --- | ---------------- | --------------------------------------------------- | ------- | ---------------------------------------- |
| D08 | Open             | DPO (Montri Stapornkul) + IT/Security (to be named) | Ta      | W4-01, W4-05, W4-07, W4-11; later W7     |
| D09 | Open             | AI/COE lead (to be named) + lane experts            | Ta      | W4-01, W4-06, W4-08, W4-09, W4-10, W4-14 |
| D07 | Open, later gate | AI/COE                                              | Ta      | W5 only                                  |
| D10 | Open, later gate | IT/Security + accountable owner                     | Ta      | Networked tests, W8                      |

Two owner seats are empty. [Team and roles](team-and-roles.md) lists the AI/COE lead and IT/Security as "to be named". Neither D08 nor D09 can be approved until Ta names them. That is the first step, before any option below matters.

## Evidence format for every decision

Same as G0. Record the decision ID, the exact answer, the approver's name and role, the date, the channel (meeting note, email, signed message) and the documents that change. An agent's recommendation, a demo default or silence is not evidence. Ta writes the register row; the owners approve its wording.

## Where W4 starts from

Facts from the repository, so the owners do not have to re-derive them:

- **W3.** The [W3 exit record](../../changes/2026-09-23-w3-exit/review.md) and the [W3 hardening review](../../changes/2026-09-23-w3-hardening/review.md) are on main. Ta accepted W3 on 2026-09-26; that record is on branch `codex/w3-acceptance` and was not yet on main when this brief was written.
- **The QC port exists.** [W0-07](../engineering/qc-boundary-and-mail-sink.md) sections 1-3 define the `QcRunner` port, the orchestrator, the three triggers and the validation. The slice-1 runner is `ScriptedQcRunner`, a scripted substitute (3.9). `QC_MODE=substitute` is the only defined value. W4 replaces the runner behind the same port.
- **Runs and findings are append-only.** A run row is inserted once with its final status. Findings carry locators and at most an `excerptHash`, never document text (W0-07 3.1, 3.4).
- **Unavailable is a finding.** Timeout, runner error, not configured and unreadable artifact all produce the `QC-UNAVAILABLE` finding, owned per the D05 refinement (#35) row of 2026-09-25. [That rule](../../changes/2026-09-25-w2-05-owning-lane/spec.md) leaves one gap for W4: who owns an upload-trigger unavailable finding on slot 5 or slot 9.
- **Dispositions exist.** W2-05 implemented fixed, waived and N/A with reasons and D05 authority, fed by synthetic findings. W4 feeds real findings into the same contract.
- **Upload QC does not run yet.** Slice 1 fires QC on submit and approve attempt. The upload trigger is specified (W0-07 3.2) but was deferred to W4.

---

## D08 — model and data handling, as it bears on W4

**Question for DPO and IT/Security.** Under what data-handling rules may W4 run extraction and, if approved, a model behind the QC port? The register row for D08 covers retention, real-data permission, model-provider data handling and upload limits for real data, due "before real data or model processing (W4 probabilistic QC, W7)". This brief covers only what W4 needs. The real-data part can be answered later, at the W7 gate.

**Why it blocks W4.** BUILD_PLAN W4 entry says D08 model/data handling must be resolved before probabilistic QC. The [threat model](../security/threat-model.md) says data use, retention, deletion, model provider, transfer region, telemetry and subprocessors need review before real-case ingestion. [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) leaves "in-process or worker" open for W4. The [ADR index](../../adr/README.md) reserves ADR-0006 (QC boundary and model data handling) for the W4 gate, recording D08 and D09.

**What is already fixed (not open here).**

| Source                                                                                                 | Rule                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D03 register row                                                                                       | Synthetic data only until D08 permits real data                                                                                                                       |
| Source spec, "v1 locked decisions" L7 and L8                                                           | QC is soft; Ready is a server predicate, never a QC output                                                                                                            |
| [W0-07](../engineering/qc-boundary-and-mail-sink.md) 3.1                                               | The runner gets read handles to authorized artifacts only; no database, session or HTTP client; output is typed data; no document text leaves the runner              |
| W0-07 3.4 step 4                                                                                       | Output carrying document text, or an invalid shape, becomes `unavailable:runner_error`, never a finding                                                               |
| [Observability contract](../engineering/observability-contract.md) section 4                           | Log fields are an allow-list; document text, filenames and secrets never reach a log line                                                                             |
| [Upload safety](../engineering/upload-safety-and-fixtures.md) section 3                                | Synthetic-data limits: 25 MiB per file, 150 MiB per pack version, 40 MP images, ZIP caps. Raising them for real data is a D08 change                                  |
| Upload safety section 10                                                                               | D08 revisit list: real-data limits, embedded PDF files, OLE embeddings, malware scanner or parsing worker, rejected-upload retention, blob deletion, library detector |
| [Persistence](../engineering/persistence-and-artifact-store.md#retention-and-deletion-options-for-d08) | Three deletion options (redaction event, key destruction, tombstone); none chosen; ADR-0005 at the D08 gate                                                           |
| Threat model                                                                                           | No secrets in prompts; injection and exfiltration probes; outage never shown as clean evidence                                                                        |

**Unknown to this repository.** Whether True or CP Group has an approved enterprise agreement with any model provider, which hosting regions or tenancies are permitted, what data classification case documents carry, and whether a host malware scanner exists. IT/Security and the DPO would know. Nothing below assumes an answer.

**Open questions, with options.**

1. **Which data may reach a model in W4?**
   - (a) None. W4 is deterministic checks and extraction only; no model is called. Simplest; some rules (contradictions across documents) may stay weak or unimplemented.
   - (b) Synthetic fixtures only. A model may be called in development, CI and the evaluation harness on synthetic documents. Real documents wait for the W7 part of D08. Lets D09 measure a model honestly without exposing anything real.
   - (c) Real case documents after minimisation (for example, only the extracted checklist cells, never whole files). Most realistic evaluation; needs the full real-data part of D08 now, which pulls W7 decisions into W4.

2. **Provider and hosting, if a model is allowed.**
   - (a) No external provider. A model runs on a host True controls, or no model at all. Keeps data in place; capability and operating cost are unknown.
   - (b) An external API provider under an enterprise agreement, with no training on inputs and a stated retention period. Strongest models; depends on an agreement whose existence is unknown here.
   - (c) A cloud-hosted model inside a tenancy and region True controls. Middle ground; depends on what IT/Security already operates, also unknown here.

3. **Retention of QC inputs and outputs.** The desk already stores run rows and findings with locators and hashes only.
   - (a) Keep nothing else. Prompts, extracted text and raw model responses are discarded after the run; the provider must also retain nothing. Smallest footprint; a disputed finding cannot be replayed from stored text, only re-run.
   - (b) Keep raw outputs for synthetic evaluation runs only, as evaluation artefacts outside the desk database. Gives D09 the evidence it needs without widening the desk's data.
   - (c) Keep raw outputs for real runs too, for a fixed window in a restricted store. Best for audit of a disputed finding; adds a retention schedule, a deletion path and a new store to protect.

4. **Logging and redaction for model calls.**
   - (a) Log identities and numbers only: model, prompt revision, rule revision, token counts, latency, cost, outcome. No content. Extends the allow-list; no new risk.
   - (b) As (a), plus content logging in local development on synthetic data only. Easier debugging; one misconfiguration away from logging real text later.
   - (c) Accept provider-side logging or abuse monitoring. Often a provider default; whether it is acceptable is a provider-terms question for IT/Security.

5. **Parsing isolation and upload safety for extraction.** W4 is the first code that parses document bytes. Upload safety section 2.4 states that slice 1 parses nothing.
   - (a) Parse in process with pure-JavaScript parsers, synthetic data only. Fewest moving parts; a parser bug runs inside the server that holds the database connection.
   - (b) Parse in a separate worker process with memory, time and output limits and no database or network access. ADR-0003 already allows this; the W0-07 port permits it.
   - (c) Parse in a separate sandboxed service or container. Strongest isolation; adds deployment weight that D10 would have to approve.

6. **Real-data upload limits, malware scanning and deletion.** These are the W0-08 section 10 items and the W0-04 deletion options.
   - (a) Answer them now with the W4 part.
   - (b) Split D08: answer questions 1-5 for W4 now; answer this question at the W7 gate, before the first real case.
   - (c) Answer them at W7 and keep W4 strictly synthetic, with no D08 row until then. Delays the model question too.

**Recommendation (proposal only; not decided).** Record D08 in two parts. For the W4 part: 1(b), 2 left to ADR-0006 once IT/Security names what is permitted, 3(b), 4(a), 5(b) and 6(b). This keeps W4 fully synthetic, lets D09 measure real behaviour, and adds one isolation boundary before the desk parses bytes. If IT/Security cannot name a permitted provider, 1(a) is the fallback, and W4 proceeds as deterministic checks plus extraction only.

**What recording it changes.** A D08 register row (or a "D08, W4 part" row), with the real-data part kept open. ADR-0006 data-handling section. Upload safety section 10 (items ticked or carried). Threat-model rows for prompt data, provider and parser isolation. The observability catalogue (new model-call fields, all identities or numbers). TESTING.md (what the W4 suites prove). BUILD_PLAN W4 gate entry (below).

**Who records it.** Ta records the row. The DPO and IT/Security approve its wording. Nothing is recorded until IT/Security is named.

**Consumed by.** W4-01, W4-05, W4-07, W4-11; later W7 and ADR-0005.

---

## D09 — QC evaluation

**Question for the AI/COE lead and the lane experts.** Which frozen evaluation set, which per-rule thresholds and whose sign-off decide that W4 QC is good enough to show its findings to reviewers?

**Why it blocks W4.** BUILD_PLAN W4 exit requires "the frozen evaluation suite", below/equal/above cases, template-version isolation, grounded citations and injection and timeout probes. It stops promotion if agreed quality thresholds are unmet. The [evaluation plan](../evaluation/plan.md) says domain reviewers must freeze the dataset and thresholds before AI implementation, and that "other numeric quality, cost and latency thresholds remain D09". Without D09, any threshold in code would be invented.

**What is already fixed (not open here).**

| Source                                                       | Rule                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source spec, "v1 product", section "QC"                      | Completeness and contradictions; a hallucination or accuracy "Yes" cites metric, denominator, threshold and artefact; extraction % is not hallucination rate; v1.0 Sheet-3 SL#2.1 bands H <1%, M <2%, L <3% only for that template version; classic ML uses its matching metric or N/A; append-only log per version; three triggers                                                                |
| [Acceptance](../acceptance.md) A08                           | Below/equal/above tests for the v1.0 bands; v2.0 never inherits them; QC failure is visible, never a clean pass; no soft finding blocks submit or review                                                                                                                                                                                                                                           |
| Acceptance A09                                               | Open findings prevent only the final Ready transition; dispositions are attributable; waiver and N/A need reasons                                                                                                                                                                                                                                                                                  |
| Evaluation plan                                              | The planned fixture list; a held-out set; recorded disagreements; zero successes for unauthorized disclosure, fabricated approval, template leakage and capability-bearing prompt disclosure; every run records code, prompt, model, provider, template, rules, dataset and grader identities; mocked providers prove contracts only; human acceptance, not an aggregate score, controls promotion |
| [W0-07](../engineering/qc-boundary-and-mail-sink.md) 3.5     | Stable rule IDs (`PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH`, `PACK-CONTRADICTION`, `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3`, `ACC-CLASSIC-ML-METRIC`, `QC-UNAVAILABLE`); the severities there are fixture values, not thresholds of record                                                                                                                     |
| [Performance targets](../engineering/performance-targets.md) | QC orchestrator deadline 10,000 ms; expiry is `unavailable:timeout`                                                                                                                                                                                                                                                                                                                                |

Note the difference between two kinds of threshold. The v1.0 bands judge the **submitted use case**. D09 thresholds judge **this desk's QC**. The evaluation plan keeps them apart; so should the register row.

**Unknown to this repository.** Which checklist template versions exist beyond v1.0 and v2.0, how many historic packs exist, and whether any may be used, even anonymised, for evaluation. The AI/COE lead and the DPO would know.

**Open questions, with options.**

1. **Evaluation set: source and freezing.**
   - (a) Fully synthetic. Agents generate documents from the evaluation-plan fixture list; lane experts label them. Available now; may miss real-world document shapes.
   - (b) Synthetic plus anonymised historic packs. More realistic; needs the real-data part of D08 first.
   - (c) Synthetic for the W4 gate, with permitted real cases added as a new frozen version at W7. Honest about what W4 can prove; W7 re-runs the suite.

2. **Per-rule acceptance thresholds.**
   - (a) Owners set numeric precision, recall and grounded-citation thresholds per rule before the first run. No fitting to results; the numbers may be guesses.
   - (b) Run a baseline on a development split first, then set thresholds, then judge on the held-out split. Informed numbers; needs the held-out discipline to stay credible.
   - (c) Split by rule type. Deterministic rules must be exact on every fixture (no tolerance). Probabilistic rules get numeric thresholds by (a) or (b).

3. **Boundary semantics for below/equal/above.** The source states the bands as strict "less than", so a value equal to the band fails. What is open is precision.
   - (a) Compare the value exactly as reported in the document.
   - (b) Compare at the precision the template states, and treat anything finer as reported.
   - (c) Raise a separate finding when the evidence lacks the precision, denominator or unit needed to decide.

4. **Citation grounding.** When is a citation "grounded"?
   - (a) Automatically: the locator resolves inside an artifact of the same version, and the `excerptHash` matches the text at that location.
   - (b) By human graders on a sample.
   - (c) Both: automatic on every finding, human on a stated sample per rule.

5. **Injection, exfiltration and timeout probes.** Zero successes is already fixed. Open: who writes the probes and how far they go.
   - (a) A synthetic hostile set in the repository, generated at test time like the W0-08 hostile set.
   - (b) (a) plus probes supplied by IT/Security.
   - (c) (b) plus an independent red-team pass. Heavier; arguably belongs to the W8 security review under D10.

6. **Cost and latency.**
   - (a) Set budgets now (per run and per month) and gate on them.
   - (b) Record cost and latency per run without a gate in W4; set budgets before W7.
   - (c) Gate only on the existing 10,000 ms deadline; ADR-0006 may propose a different deadline for model calls, which the owners then approve.

7. **Sign-off.**
   - (a) The AI/COE lead signs the whole suite.
   - (b) The AI/COE lead signs the set and method; each lane's expert signs the rules whose findings that lane owns (per D05 and the #35 refinement). Disagreements are recorded, as the evaluation plan requires.
   - (c) (b) plus the operator (Nakhun) confirming that findings are usable in the queue.

**Recommendation (proposal only; not decided).** 1(c), 2(c) with (b) for probabilistic rules, 3(c) on top of (a), 4(c), 5(b), 6(b) with 6(c)'s deadline review inside ADR-0006, and 7(b). This makes deterministic checks provable at once, keeps numbers honest for any model, and puts sign-off with the people who own the findings.

**What recording it changes.** A D09 register row naming the frozen set's identity (name and version), the thresholds table and the signers. The evaluation plan (status moves from "designed, not run" once the set is frozen). A08 test notes. ADR-0006 evaluation section. TESTING.md. BUILD_PLAN W4 gate entry.

**Who records it.** Ta records the row. The AI/COE lead and the lane experts approve. Nothing is recorded until the AI/COE lead is named.

**Consumed by.** W4-01, W4-06, W4-08, W4-09, W4-10, W4-14.

---

## Related questions for Ta outside D08 and D09

These are product or contract questions W4 will hit. None is decided here.

1. **Upload-trigger unavailable finding on slot 5 or slot 9.** The #35 rule defers it to W4.
   - (a) Slot 5: AI/COE, as on submit and for the pack. Slot 9: no upload rules run, so no run and no unavailable finding.
   - (b) Slot 5: one finding per reviewing lane (three findings). Slot 9: as (a).
   - (c) Slot 5 and 9: record the unavailable run only, no finding; submit QC re-covers the pack.

   Recommendation (proposal only): (a). It reuses the existing submit and pack rule and keeps slot 9 informational. Ta records it as a D05 refinement row, acting for the review leads as on 2026-09-25.

2. **QC evidence arriving after a send-back** (W3 hardening review, section 5 item 2). W0-06 and W0-07 3.4 disagree; main refuses the append. Real extraction and model latency make this case more frequent. Ta's choice between a code change and a W0-07 amendment should come before W4-04.

3. **Defect count in the lane-opened mail** (hardening item 11). With real findings, "every finding on the version" versus "this lane's findings" becomes visible to reviewers.

4. **Checklist item anchoring** ([later packages](later-packages-outline.md), candidate backlog 1). Whether W4 findings carry checklist item IDs. Not in scope unless Ta adds it.

5. **Runtime operated elsewhere** (candidate backlog 2). Whether W4 fixtures include the attested-evidence scenario. Not in scope unless Ta adds it.

6. **Deterministic checks as a separable, earlier sub-package.** BUILD_PLAN requires D08 and D09 only "before probabilistic QC". Metadata-only deterministic checks on synthetic data call no model and parse no bytes. Ta could authorize them as W4a ahead of D08 and D09. The [work breakdown](w4-work-breakdown.md#option-for-ta-one-package-or-w4a-then-w4b) sets out both shapes. This is an option for Ta, not a choice made here.

---

## D07 and D10: later gates

**D07 (AI/COE, before W5).** The exact seven-question questionnaire, rubric version and reference labels for the risk proposal. W4 does not consume it. The only link is shared evaluation discipline: the [evaluation plan](../evaluation/plan.md) "Risk proposal" section needs two domain-labelled reference cases plus boundary and PII/unknown cases, and those should be frozen the same way as the D09 set. The rubric summary in the operating model must not be coded as the approved instrument.

**D10 (IT/Security and the accountable owner, before networked tests or W8).** Production AD groups, host, audit and backup, incident channels and engineering risk acceptance. W4 runs on localhost and needs none of it. Two W4 answers touch it: if D08 question 5 picks (c), a sandboxed parsing service needs D10 hosting; if D08 question 2 picks (b) or (c), the credential custody for a provider key is a D10 question. ADR-0004 and ADR-0007 stay reserved for this gate.

---

## Draft W4 gate entry for BUILD_PLAN

**Draft for Ta to record; not recorded, and not an authorization.**

> W4 gate entry (dated when Ta records it). Ta authorizes W4, version-aware soft QC, on synthetic data only, under the same branch, reviewed-PR and merge flow as D03 and its 2026-09-21 amendment, with the tickets of the W4 work breakdown. Preconditions, all recorded before the first W4 code PR: (1) W3 accepted by Ta (2026-09-26); (2) the AI/COE lead and the IT/Security owner named; (3) D08, at least its W4 part, recorded with DPO and IT/Security approval, covering which data may reach a model, provider and hosting, retention of QC inputs and outputs, logging, and parser isolation; (4) D09 recorded with the AI/COE lead's and lane experts' approval, naming the frozen evaluation set, the per-rule thresholds and the signers; (5) the slot-5 and slot-9 upload-unavailable owning lane recorded as a D05 refinement; (6) the W4 file-level plan (W4-00) merged, and ADR-0006 accepted before any extraction or model code merges. Real data, networked access and external mail stay excluded until D08's real-data part, D10 and W7. If Ta splits the package, a W4a entry for metadata-only deterministic checks needs only (1), (5), the lane experts' labels for the deterministic fixtures and its own file-level plan (W4-00a), and W4b keeps every precondition above.
