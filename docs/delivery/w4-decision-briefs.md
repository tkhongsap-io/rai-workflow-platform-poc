# Decision briefs: W4 gate (D08, D09)

Status: **draft decision material, prepared 2026-09-26 on Ta's instruction. Nothing here is decided.** D08 and D09 are open in the [decision register](../product/decisions.md), which is the only record of a decision. W4 is **not authorized**: D03 covers W0-W3 only, and [BUILD_PLAN](../../BUILD_PLAN.md) W4 needs D08 and D09 resolved before probabilistic QC, plus a W4 gate entry by Ta. Every "recommendation" below is an agent's proposal for the owners to accept, change or refuse. It is not evidence of a decision.

This pack follows the house format of the [G0 decision briefs](g0-decision-briefs.md). The draft ticket list that consumes these decisions is the [W4 work breakdown](w4-work-breakdown.md). The "already fixed" rules each brief relies on are in the [appendix](#appendix-what-is-already-fixed), so the briefs can start with what each owner has to answer.

| ID  | Status           | Owners (approve)                                    | Records | Tickets that would consume it                          |
| --- | ---------------- | --------------------------------------------------- | ------- | ------------------------------------------------------ |
| D08 | Open             | DPO (Montri Stapornkul) + IT/Security (to be named) | Ta      | W4-00, W4-01, W4-05, W4-07, W4-11b, W4-14; later W7    |
| D09 | Open             | AI/COE lead (to be named) + lane experts            | Ta      | W4-00, W4-01, W4-06, W4-07, W4-08, W4-09, W4-10, W4-14 |
| D07 | Open, later gate | AI/COE                                              | Ta      | W5 only                                                |
| D10 | Open, later gate | IT/Security + accountable owner                     | Ta      | Networked tests, W8                                    |

Two owner seats are empty. [Team and roles](team-and-roles.md) lists the AI/COE lead and IT/Security as "to be named". Neither D08 nor D09 can be approved until Ta names them. That is the first step, before any option below matters.

## Evidence format for every decision

Same as G0. Record the decision ID, the exact answer, the approver's name and role, the date, the channel (meeting note, email, signed message) and the documents that change. An agent's recommendation, a demo default or silence is not evidence. Ta writes the register row; the owners approve its wording.

## Where W4 starts from

Facts from the repository, so the owners do not have to re-derive them:

- **W3.** The [W3 exit record](../../changes/2026-09-23-w3-exit/review.md) and the [W3 hardening review](../../changes/2026-09-23-w3-hardening/review.md) are on main. Ta accepted W3 on 2026-09-26 ([BUILD_PLAN 2026-09-26 status](../../BUILD_PLAN.md), [walkthrough notes](../../changes/2026-09-26-nakhun-walkthrough/notes.md), PR #161).
- **The QC port exists.** [W0-07](../engineering/qc-boundary-and-mail-sink.md) sections 1-3 define the `QcRunner` port, the orchestrator, the three triggers and the validation. The slice-1 runner is `ScriptedQcRunner`, a scripted substitute (3.9). `QC_MODE=substitute` is the only defined value. W4 replaces the runner behind the same port.
- **Runs and findings are append-only.** A run row is inserted once with its final status. Findings carry locators and at most an `excerptHash`, never document text (W0-07 3.1, 3.4).
- **Unavailable is a finding.** Timeout, runner error, not configured and unreadable artifact all produce the `QC-UNAVAILABLE` finding, owned per the D05 refinement (#35) row of 2026-09-25. [That rule](../../changes/2026-09-25-w2-05-owning-lane/spec.md) leaves one gap for W4: who owns an upload-trigger unavailable finding on slot 5 or slot 9.
- **Dispositions exist.** W2-05 implemented fixed, waived and N/A with reasons and D05 authority, fed by synthetic findings. W4 feeds real findings into the same contract.
- **Upload QC does not run yet.** Slice 1 fires QC on submit and approve attempt. The upload trigger is specified (W0-07 3.2) but was deferred to W4.

---

## D08 — model and data handling, as it bears on W4

### What we need from you

| Who                           | Questions to answer                                                                              | By when                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **DPO** (Montri Stapornkul)   | 1 (which data may reach a model), 3 (what is kept)                                               | Before Ta's W4 gate entry (before W4b under the split option) |
| **IT/Security** (to be named) | 2 (provider and hosting), 4 (logging), 5 (parser isolation), 6 (who holds the API key during W4) | Same gate                                                     |
| **Both**                      | Approve the wording of the D08 row Ta writes                                                     | Same gate                                                     |

In plain terms: may W4 send anything to an AI model, which model service may it use, what may be kept or logged, how the desk opens documents safely, and who holds the key to the model service while W4 runs on a developer's machine.

**Scope of this brief.** D08 in the register covers retention, real-data permission, model-provider data handling and upload limits for real data. This brief asks only for the **W4 part**. The real-data part (real upload limits, malware scanning, rejected-upload retention and blob deletion; [upload safety](../engineering/upload-safety-and-fixtures.md) section 10 and the [W0-04 deletion options](../engineering/persistence-and-artifact-store.md#retention-and-deletion-options-for-d08)) stays open for the W7 gate, before the first real case. Splitting D08 this way is itself a proposal for Ta and the owners.

**Why it blocks W4.** BUILD_PLAN W4 entry says D08 model/data handling must be resolved before probabilistic QC. D08 sets what is permitted. (The [threat model](../security/threat-model.md) also requires a review of data use, model provider, transfer region, telemetry and subprocessors before real-case ingestion; that review applies at W7, not to W4's synthetic data.) ADR-0006 ([ADR index](../../adr/README.md)) then records the engine choice **within** what D08 permits; it cannot widen it.

**Unknown to this repository.** Whether True or CP Group has an approved enterprise agreement with any model provider, which hosting regions or tenancies are permitted, what data classification case documents carry, and whether True has a secret store engineers can use before D10. IT/Security and the DPO would know. Nothing below assumes an answer.

### Open questions

1. **Which data may reach a model in W4?**
   - (a) None; W4 is deterministic checks and extraction only. _Trade-off:_ nothing leaves the machine, but cross-document rules may stay weak.
   - (b) Synthetic fixtures only, in development and the evaluation harness. _Trade-off:_ D09 can measure a model honestly; real documents wait for W7.
   - (c) Minimised real content, such as extracted checklist cells. _Trade-off:_ most realistic evaluation, but pulls the W7 real-data decision into W4.

2. **Provider and hosting, if a model is allowed.**
   - (a) No external provider: a model on a True-controlled host, or no model. _Trade-off:_ data stays in place; capability and running cost unknown.
   - (b) An external API provider under enterprise terms (no training on inputs, stated retention). _Trade-off:_ strongest models; depends on an agreement whose existence is unknown here.
   - (c) A cloud-hosted model in a True-controlled tenancy and region. _Trade-off:_ middle ground; depends on what IT/Security already runs, also unknown.

3. **What is kept from QC runs.** The desk already stores run rows and findings with locators and hashes only.
   - (a) Nothing more; prompts, extracted text and raw responses are discarded, and the provider keeps nothing. _Trade-off:_ smallest footprint; a disputed finding can only be re-run, not replayed.
   - (b) Raw outputs of synthetic evaluation runs, kept as evaluation artefacts outside the desk database. _Trade-off:_ gives D09 its evidence without widening the desk's data.
   - (c) Raw outputs of every run, for a fixed window in a restricted store. _Trade-off:_ best for disputes; adds a retention schedule, deletion path and store to protect.

4. **Logging for model calls.**
   - (a) Identities and numbers only: model, prompt and rule revision, tokens, latency, cost, outcome. _Trade-off:_ extends the existing allow-list; no content risk.
   - (b) As (a), plus content logging on synthetic data in local development. _Trade-off:_ easier debugging; one misconfiguration from logging real text later.
   - (c) As (a), and accept the provider's own logging or abuse monitoring. _Trade-off:_ often a provider default; acceptable only if IT/Security accepts the provider's terms.

5. **How the desk opens documents.** W4 is the first code that parses document contents; slice 1 does not parse them, and its upload check only sniffs bytes (it scans PDF bytes for active-content tokens and reads the ZIP central directory; upload safety section 2.4).
   - (a) Parse in the server process with pure-JavaScript parsers. _Trade-off:_ fewest parts; a parser bug runs next to the database connection.
   - (b) Parse in a separate worker process with memory, time and output limits and no database or network. _Trade-off:_ ADR-0003 and the W0-07 port already allow it; one more process to run.
   - (c) Parse in a separate sandboxed service or container. _Trade-off:_ strongest isolation; hosting weight that D10 would have to approve.

6. **Who holds the model-service API key during W4?** Options 2(b) and 2(c) mean **outbound HTTPS calls from a localhost machine and an API key during W4**, before D10 settles production custody.
   - (a) One named engineer, on their own machine, in a local environment file outside the repository; CI uses a mocked provider only. _Trade-off:_ simplest and keeps CI offline; one person runs every recorded evaluation.
   - (b) The same key also in the CI secret store, so CI runs the evaluation. _Trade-off:_ repeatable runs; CI becomes an outbound path and a secret holder, a CI change agents may not make.
   - (c) IT/Security holds the key and runs the recorded evaluations. _Trade-off:_ strongest custody; slows every iteration.

   Proposed conditions for IT/Security to approve, in every option: the key is issued by IT/Security for synthetic use only, spend-capped and revoked at W4 exit. It is never committed (AGENTS.md).

### Recommendation (proposal only; not decided)

1(b), 2(b) **only if** IT/Security can confirm a provider whose terms exclude training and state retention (otherwise 1(a) and no model), 3(b), 4(a), 5(b) and 6(a). This keeps W4 fully synthetic, lets D09 measure real behaviour, and adds one isolation boundary before the desk parses documents. Be clear about what 2(b) means: during W4, a developer machine on localhost makes outbound calls to the provider with a key held under question 6.

**What recording it changes.** A "D08, W4 part" register row, with the real-data part kept open. ADR-0006 data-handling section, written inside that row. Upload safety section 10 (items carried to W7). Threat-model rows for prompt data, provider, key custody and parser isolation. The observability catalogue (model-call fields, identities and numbers only). TESTING.md. BUILD_PLAN W4 gate entry.

**Who records it.** Ta records the row; the DPO and IT/Security approve its wording. Nothing is recorded until IT/Security is named.

**Consumed by.** W4-00, W4-01, W4-05, W4-07, W4-11b, W4-14; later W7 and ADR-0005.

---

## D09 — QC evaluation

### What we need from you

| Who                                                      | Questions to answer                                                                                                                           | By when                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **AI/COE lead** (to be named)                            | 1 (evaluation set), 2 (how thresholds are set), 6 (cost and latency), 7 (who signs)                                                           | Before Ta's W4 gate entry (before W4b under the split option); thresholds before the first held-out run |
| **Lane experts** (DPO, IT/Security and AI/COE reviewers) | 3 (band boundaries), 4 (grounded citations); label the fixtures and sign only the rules your own lane owns (D09 is not co-owned by the lanes) | Labels before the set is frozen; rule sign-off at W4 exit                                               |
| **IT/Security**                                          | 5 (probes)                                                                                                                                    | Before the set is frozen                                                                                |

In plain terms: which test documents prove QC works, how good each rule must be, how to judge a borderline number or a citation, which attacks to try, and who signs that the results are good enough.

**Why it blocks W4.** BUILD_PLAN W4 exit requires "the frozen evaluation suite", below/equal/above cases, template-version isolation, grounded citations, and injection and timeout probes. It stops promotion if agreed quality thresholds are unmet. The [evaluation plan](../evaluation/plan.md) says domain reviewers freeze the dataset and thresholds before AI implementation, and that "other numeric quality, cost and latency thresholds remain D09". Without D09, any threshold in code would be invented.

Two kinds of threshold must stay apart. The v1.0 bands judge the **submitted use case**. D09 thresholds judge **this desk's QC**.

**Unknown to this repository.** Which checklist template versions exist beyond v1.0 and v2.0, whether v1.0 states a precision for its percentages, how many historic packs exist, and whether any may be used for evaluation. The AI/COE lead and the DPO would know.

### Open questions

1. **Evaluation set: source and freezing.**
   - (a) Fully synthetic; agents generate documents, lane experts label them. _Trade-off:_ available now; may miss real document shapes.
   - (b) Synthetic plus anonymised historic packs. _Trade-off:_ more realistic; needs D08's real-data part first.
   - (c) Synthetic for W4, with permitted real cases added as a new frozen version at W7. _Trade-off:_ honest about what W4 proves; W7 re-runs the suite.

2. **How per-rule thresholds are set.**
   - (a) Owners set precision, recall and grounded-citation numbers per rule before any run. _Trade-off:_ no fitting to results; the numbers may be guesses.
   - (b) Baseline on a development split, set numbers, judge on the held-out split. _Trade-off:_ informed numbers; credible only with held-out discipline.
   - (c) Deterministic rules exact on every fixture; probabilistic rules numbered by (a) or (b). _Trade-off:_ no tolerance where none is needed; two regimes to explain.

3. **Band boundaries.** The source states the bands as strict "less than", so a value equal to a band fails. Open is precision. Either way, evidence missing the metric, denominator, threshold or evidence reference is already a finding under A08.
   - (a) Compare the value exactly as reported. _Trade-off:_ simple; an author's rounding can flip the result.
   - (b) Compare at the precision the template states. _Trade-off:_ matches the template's intent; works only if the template states one (unknown).

4. **When is a citation grounded?**
   - (a) Automatically: the locator resolves in the same version and the `excerptHash` matches. _Trade-off:_ cheap and complete; proves location, not meaning.
   - (b) Human graders on a sample. _Trade-off:_ judges meaning; costs expert time and covers a sample only.
   - (c) Both: automatic on every finding, human on a stated sample per rule. _Trade-off:_ best coverage; the cost of both.

5. **Injection, exfiltration and timeout probes.** Zero successes is already fixed. Open: who writes them and how far they go.
   - (a) A synthetic hostile set in the repository, generated at test time. _Trade-off:_ repeatable; limited to what the team imagines.
   - (b) (a) plus probes supplied by IT/Security. _Trade-off:_ wider coverage; depends on IT/Security's time.
   - (c) (b) plus an independent red-team pass. _Trade-off:_ strongest; arguably the W8 security review under D10.

6. **Cost and latency.**
   - (a) Set per-run and monthly budgets now and gate on them. _Trade-off:_ no surprises; budgets without data may be arbitrary.
   - (b) Record cost and latency per run; set budgets before W7. _Trade-off:_ real data for the budget; W4 could pass while too slow or costly.
   - (c) Gate only on the existing 10,000 ms deadline, with any different model deadline approved here. _Trade-off:_ one clear limit; says nothing about cost.

7. **Who signs.**
   - (a) The AI/COE lead signs the whole suite. _Trade-off:_ one signature; one person judges other lanes' rules.
   - (b) The AI/COE lead signs the set and method; each lane's expert signs the rules that lane owns (D05 and the #35 refinement). _Trade-off:_ the owners of findings judge them; three signatures to collect.
   - (c) (b) plus the operator (Nakhun) confirming the findings are usable in the queue. _Trade-off:_ checks usability; the operator is not a domain expert, and sign-off slows.

### Recommendation (proposal only; not decided)

1(c), 2(c) with (b) for probabilistic rules, 3(b) falling back to (a) where the template states no precision, 4(c), 5(b), 6(b) plus 6(c)'s deadline review, and 7(b). This makes deterministic checks provable at once, keeps numbers honest for any model, and puts sign-off with the people who own the findings.

**What recording it changes.** A D09 register row naming the frozen set (name and version), the thresholds table and the signers. The evaluation plan (status moves from "designed, not run" once the set is frozen). A08 test notes. ADR-0006 evaluation section. TESTING.md. BUILD_PLAN W4 gate entry.

**Who records it.** Ta records the row; the AI/COE lead and the lane experts approve. Nothing is recorded until the AI/COE lead is named.

**Consumed by.** W4-00, W4-01, W4-06, W4-07, W4-08, W4-09, W4-10, W4-14.

---

## Related questions for Ta outside D08 and D09

These are product or contract questions W4 will hit. Items 2, 3 and 4 were ruled by Ta on 2026-09-26 (register row "W3 deferred rulings"); the rest are not decided here.

1. **Upload-trigger unavailable finding on slot 5 or slot 9.** The #35 rule defers it to W4.
   - (a) Slot 5: AI/COE, as on submit and for the pack. Slot 9: no upload rules run, so no run and no finding. _Trade-off:_ reuses a recorded rule; AI/COE carries BRD upload outages.
   - (b) Slot 5: one finding per reviewing lane. Slot 9: as (a). _Trade-off:_ every lane sees the outage; three findings to disposition for one event.
   - (c) Slots 5 and 9: record the unavailable run only, no finding. _Trade-off:_ least noise; an outage no one must disposition, which the #35 rule avoided elsewhere.

   Recommendation (proposal only): (a). Ta records it as a D05 refinement row, acting for the review leads as on 2026-09-25.

2. **QC evidence arriving after a send-back** (W3 hardening review, section 5 item 2). **Ruled by Ta on 2026-09-26:** a version closed by a send-back takes no new QC evidence; the successor gets its own, and W0-07 3.4 was amended to match. Real extraction and model latency make the refused case more frequent, so W4-04 should expect it and test it.

3. **In-memory API substitute** (hardening item 3). **Ruled by Ta on 2026-09-26:** kept; revisit at W4 kickoff. The W4-00 file-level plan carries that revisit.

4. **Defect count in the lane-opened mail** (hardening item 11). **Ruled by Ta on 2026-09-26:** that lane's findings stored at send time, labelled as recorded so far (ticket #165, before W4). W4 changes when findings exist, not the rule.

5. **Checklist item anchoring** ([later packages](later-packages-outline.md), candidate backlog 1). Whether W4 findings carry checklist item IDs. Not in scope unless Ta adds it.

6. **Runtime operated elsewhere** (candidate backlog 2). Whether W4 fixtures include the attested-evidence scenario. Not in scope unless Ta adds it.

7. **Deterministic checks as a separable, earlier sub-package.** BUILD_PLAN requires D08 and D09 only "before probabilistic QC". Metadata-only deterministic checks on synthetic data call no model and parse no document contents. Ta could authorize them as W4a ahead of D08 and D09. The [work breakdown](w4-work-breakdown.md#option-for-ta-one-package-or-w4a-then-w4b) sets out both shapes. This is an option for Ta, not a choice made here.

---

## D07 and D10: later gates

**D07 (AI/COE, before W5).** The exact seven-question questionnaire, rubric version and reference labels for the risk proposal. W4 does not consume it. The only link is shared evaluation discipline: the [evaluation plan](../evaluation/plan.md) "Risk proposal" section needs two domain-labelled reference cases plus boundary and PII/unknown cases, and those should be frozen the same way as the D09 set. The rubric summary in the operating model must not be coded as the approved instrument.

**D10 (IT/Security and the accountable owner, before networked tests or W8).** Production AD groups, host, audit and backup, incident channels and engineering risk acceptance. W4 runs on localhost and needs none of it. Two W4 answers touch it: a sandboxed parsing service (D08 question 5(c)) would need D10 hosting, and the W4 key custody of D08 question 6 is a stopgap that D10 replaces for anything beyond localhost. ADR-0004 and ADR-0007 stay reserved for this gate.

---

## Draft W4 gate entry for BUILD_PLAN

**Draft for Ta to record; not recorded, and not an authorization.**

> W4 gate entry (dated when Ta records it). Ta authorizes W4, version-aware soft QC, on synthetic data only, under the same branch, reviewed-PR and merge flow as D03 and its 2026-09-21 amendment, with the tickets of the W4 work breakdown. Preconditions, all recorded before the first W4 code PR: (1) W3 accepted by Ta (2026-09-26); (2) the AI/COE lead and the IT/Security owner named; (3) D08's W4 part recorded with DPO and IT/Security approval, covering which data may reach a model, provider and hosting, what is kept, logging, parser isolation and who holds any API key during W4; (4) D09 recorded with the AI/COE lead's and lane experts' approval, naming the frozen evaluation set, the per-rule thresholds and the signers; (5) the slot-5 and slot-9 upload-unavailable owning lane recorded as a D05 refinement; (6) the W4 file-level plan (W4-00) merged, and ADR-0006, within what D08 permits, accepted before any extraction or model code merges. Real data, networked access and external mail stay excluded until D08's real-data part, D10 and W7. If Ta splits the package, a W4a entry for metadata-only deterministic checks needs only (1), (5) and its own file-level plan (W4-00a); its fixture labels are provisional until D09 is recorded, and W4b keeps every precondition above.

---

## Appendix: what is already fixed

These rules are recorded or specified already. They are not open in D08 or D09.

### For D08

| Source                                                                                                 | Rule                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D03 register row                                                                                       | Synthetic data only until D08 permits real data                                                                                                                                                                                   |
| Source spec, "v1 locked decisions" L7 and its "Soft everywhere" paragraph                              | QC is soft: it never blocks submit or a reviewer                                                                                                                                                                                  |
| [W0-07](../engineering/qc-boundary-and-mail-sink.md) 3.1                                               | QC never decides: Ready reads finding dispositions, never runner output. The runner gets read handles to authorized artifacts only; no database, session or HTTP client; output is typed data; no document text leaves the runner |
| W0-07 3.4 step 4                                                                                       | Output carrying document text, or an invalid shape, becomes `unavailable:runner_error`, never a finding                                                                                                                           |
| [Observability contract](../engineering/observability-contract.md) section 4                           | Log fields are an allow-list; document text, filenames and secrets never reach a log line                                                                                                                                         |
| [Upload safety](../engineering/upload-safety-and-fixtures.md) section 3                                | Synthetic-data limits: 25 MiB per file, 150 MiB per pack version, 40 MP images, ZIP caps. Raising them for real data is a D08 change                                                                                              |
| Upload safety section 10                                                                               | The real-data revisit list: limits, embedded PDF files, OLE embeddings, malware scanner or parsing worker, rejected-upload retention, blob deletion, library detector                                                             |
| [Persistence](../engineering/persistence-and-artifact-store.md#retention-and-deletion-options-for-d08) | Three deletion options (redaction event, key destruction, tombstone); none chosen; ADR-0005 at the D08 gate                                                                                                                       |
| [Threat model](../security/threat-model.md)                                                            | No secrets in prompts; injection and exfiltration probes; an outage is never shown as clean evidence                                                                                                                              |
| [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md)                                            | In-process or worker QC is decided at W4 entry in ADR-0006                                                                                                                                                                        |

### For D09

| Source                                                       | Rule                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source spec, "v1 product", section "QC"                      | Completeness and contradictions; a hallucination or accuracy "Yes" cites metric, denominator, threshold and artefact; extraction % is not hallucination rate; v1.0 Sheet-3 SL#2.1 bands H <1%, M <2%, L <3% only for that template version; classic ML uses its matching metric or N/A; append-only log per version; three triggers                                                                |
| [Acceptance](../acceptance.md) A08                           | Below/equal/above tests for the v1.0 bands; v2.0 never inherits them; classic ML uses its matching metric or a justified N/A; QC failure is visible, never a clean pass; no soft finding blocks submit or review                                                                                                                                                                                   |
| Acceptance A09                                               | Open findings prevent only the final Ready transition; dispositions are attributable; waiver and N/A need reasons                                                                                                                                                                                                                                                                                  |
| [Evaluation plan](../evaluation/plan.md)                     | The planned fixture list; a held-out set; recorded disagreements; zero successes for unauthorized disclosure, fabricated approval, template leakage and capability-bearing prompt disclosure; every run records code, prompt, model, provider, template, rules, dataset and grader identities; mocked providers prove contracts only; human acceptance, not an aggregate score, controls promotion |
| [W0-07](../engineering/qc-boundary-and-mail-sink.md) 3.5     | Stable rule IDs (`PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH`, `PACK-CONTRADICTION`, `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3`, `ACC-CLASSIC-ML-METRIC`, `QC-UNAVAILABLE`); the severities there are fixture values, not thresholds of record                                                                                                                     |
| [Performance targets](../engineering/performance-targets.md) | QC orchestrator deadline 10,000 ms; expiry is `unavailable:timeout`                                                                                                                                                                                                                                                                                                                                |
