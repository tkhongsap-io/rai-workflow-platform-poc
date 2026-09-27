# ADR-0006: QC engine and extraction

**Status:** Provisional. Made by the agent team under Ta's delegation of 2026-09-27; **not accepted**. Ta's and the tech lead's acceptance moves to the W4b exit review (W4-14), where they confirm or replace it. Under the register row "W4b delegated rulings (provisional)", W4-05 and W4-07 may merge on this provisional ADR.
**Date:** 2026-09-27
**Deciders:** None yet. Drafted by the agent team (ticket W4-01, #200) from the [W4b plan](../docs/engineering/implementation-plan-w4b.md), whose provisional rulings were made under Ta's delegation of 2026-09-27 (register row "Ta's delegation (2026-09-27)"). Acceptance is Ta's and the tech lead's, at W4-14. Parts that answer D08 or D09 questions are **working assumptions**, not decisions: the DPO and IT/Security (D08) and the AI/COE lead with the lane experts (D09) still own them.
**Decision register:** "W4b delegated rulings (provisional)" (decisions 5, 7, 8, 12-16, 14b and 27 of the W4b plan). D08 and D09 stay in the Open table.
**Build plan reference:** W4b (ticket W4-01); governs W4-05a-d, W4-06a-d, W4-07a-b, W4-08a-b, W4-09a-b, W4-10a-b and W4-18

## Context

W4a (PRs #192-#197) runs deterministic **metadata** rules in-process: pack slot states, stage and vendor flags. It reads no document bytes and needed no ADR-0006 ([W4a plan](../docs/engineering/implementation-plan-w4a.md)). W4b makes QC read document **contents**, so a runner must parse untrusted DOCX, XLSX and PDF bytes, find claims in them, judge those claims against the checklist template's rules, and be measured. This ADR records which engine does that, how documents are parsed and isolated, how one trigger is split into run parts, and how the result is evaluated.

Constraints that bind the choice:

- **Source-spec locks and the agent contract.** L7/L8: AI flags, humans decide. Uploaded documents and model output are untrusted data, never instructions or approval authority ([AGENTS](../AGENTS.md)). The QC boundary ([W0-07](../docs/engineering/qc-boundary-and-mail-sink.md) 3.1) is read-only: a runner returns typed data, has no write access to workflow state, and no document text leaves it (a locator plus at most an `excerptHash`).
- **Unavailable is never clean.** A run is `completed` or `unavailable`; an outage is a run status plus an orchestrator-built QC-UNAVAILABLE finding, and never a shorter clean result (W0-07 3.4, 3.6; A08).
- **Hard limits of the delegation.** Synthetic data only; no external network call from the product or its tests; nothing deploys; W8 out of scope.
- **Open owner decisions.** D08 (which data may reach a model, provider, retention, logging, parser isolation, key custody) and D09 (evaluation set, thresholds, grounding, probes, cost, signers) are open. The [W4 decision briefs](../docs/delivery/w4-decision-briefs.md) say ADR-0006 records the engine choice **within** what D08 permits and cannot widen it. So every D08 or D09 answer here is a labelled working assumption held as configuration, and this ADR names no provider and no hosting.
- **Stack and dependencies.** D04 ([ADR-0003](0003-stack-and-deployment-boundary.md)): TypeScript on Node 24, one process, Postgres. Agents may not add a dependency ([team and roles](../docs/delivery/team-and-roles.md)); a new one would amend [W0-02](../docs/engineering/implementation-plan-w1-w3.md) section 4. ADR-0003 left "in-process or worker QC" to this ADR.
- **Deadline.** The orchestrator deadline `QC_TIMEOUT_MS` is 10 000 ms per trigger, and submit must keep working when QC is slow or down (QC is soft).

## Options considered

Each row gives the options the [W4b plan](../docs/engineering/implementation-plan-w4b.md) section 1 weighed, with the trade-off and why the option was or was not adopted. "PR" is a provisional ruling (a question Ta owns); "WA" is a working assumption (a question another owner holds).

### 1. Engine (plan decision 7; PR)

| Option | Trade-off | Outcome |
|---|---|---|
| (a) Deterministic content rules only | Simplest and fully reproducible; but claims written in shapes the grammar does not parse are never read, and there is no seam to add model help later without redesigning the runner | Not chosen: it leaves no place for a model when D08 permits one, so the adapter work would be missing then |
| **(b) Deterministic content rules, plus a model port that may only _propose_ claim candidates**, which the same deterministic rules then judge; the port is disabled by default | A finding never depends on model judgement: the model can at most supply a candidate claim, which must pass output validation (every field value a substring of the segment it cites) and then the same rule logic as a grammar claim. Costs a port, a prompt identity and a local fake | **Adopted** |
| (c) Model-first rules | Widest reading of free text; but needs a provider (D08, open), and a finding would depend on a model's judgement, which L7/L8 and the agent contract forbid as authority | Not chosen: needs a provider and makes the model a judge |

### 2. Parsers (plan decision 8; PR)

| Option | Trade-off | Outcome |
|---|---|---|
| **(a) Hand-written on Node built-ins**: `node:zlib` `inflateRawSync` with `maxOutputLength`, an XML tokenizer that refuses a DOCTYPE and expands only predefined and numeric entities, and a PDF text-layer reader | Follows the pattern of `server/src/artifacts/sniff.ts` (W0-08 section 2.5); adds no dependency, so W0-02 section 4 is unchanged; every limit is ours to set. Coverage is narrower: no OCR, no CID-font Thai in PDFs, no object-stream-only PDFs | **Adopted** |
| (b) Pinned `pdfjs-dist` plus an OOXML library | Wider coverage; but it amends W0-02 section 4, needs a lead PR to add dependencies, and brings a large parsing attack surface into the product | Not chosen: dependency rule and attack surface |
| (c) An external binary such as `pdftotext` | Mature parser; but a host dependency, not reproducible in CI, and a new supply-chain item for the True host (D10) | Not chosen: not reproducible, host dependency |

### 3. Parser isolation (plan decision 5; WA-D08)

| Option | Trade-off | Outcome |
|---|---|---|
| (a) In-process with limits | Fewest parts; but a parser bug or a heap blow-up shares the heap with the database pool and the session store, and a hang stalls the event loop that serves every reviewer | Not chosen: no containment |
| **(b) A fresh child process per artifact**: `child_process.fork` with an empty environment, bytes over IPC, a heap cap (`--max-old-space-size`), a wall-clock SIGKILL, no stdio, and no database, filesystem or network module in the worker's module graph (enforced by a test) | Contains crashes, hangs and memory exhaustion; one process per extraction rules out state shared across cases. Costs a fork per artifact (latency measured in CI by W4-05b against the deadline) and a small IPC protocol | **Adopted** as the working assumption |
| (c) A container or sandbox service | Strongest isolation; but needs hosting that D10 has not decided, and a network hop | Not chosen now: needs D10; D08 may require it for real data |

### 4. Run parts per trigger (plan decision 27; PR)

| Option | Trade-off | Outcome |
|---|---|---|
| (a) One run per trigger | Nothing passes silently; but any extraction failure makes the whole run `unavailable`, and an unavailable run carries no findings, so the W4a metadata findings (`PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH`, `PACK-NA-VENDOR-DOC`) vanish whenever a slot holds an image or a scan: a regression against W4a | Not chosen: real defects disappear |
| **(b) Two run parts per trigger**: the W4a `deterministic` runner runs the `metadata` rules and the content runner the `content` rules, as two `qc_run` rows with their own `engine_id`, status, run key and replay | An extraction outage makes only the content part unavailable, and the metadata findings are recorded beside a visible outage. Stays within W0-07: each run is completed or unavailable. Costs one orchestrator ticket (W4-18) and a second run row per trigger; the combined outcome names the latest-stamped part (decision 29) | **Adopted** |
| (c) One completed run carrying findings plus an artifact-scoped unavailable finding | One row; but it amends the W0-07 rule that an outage is a run status with an orchestrator-built finding, and blurs "completed" | Not chosen: weakens the unavailable-is-never-clean contract |

### 5. Evaluation method (plan decisions 12-16 and 14b; WA-D09)

| Question | Options | Adopted working assumption | Not chosen, and why |
|---|---|---|---|
| Thresholds (D09 Q2, decision 12) | (a) owners set numbers before any run; (b) baseline on dev, judge on held-out; (c) exact for deterministic rules, (b) for probabilistic ones | **(c)**. Every W4b rule is deterministic, so precision and recall are 1.00 on each split, written in `tests/evaluation/thresholds.json` before any run | (a) needs D09 owners who are not named; (b) alone would tolerate misses a deterministic rule should never make |
| Grounded citation (D09 Q4, decision 13) | (a) automatic; (b) human sample; (c) both | **(c)**: automatic on every finding (the locator resolves on the same artifact and re-extraction yields the same `excerptHash`), plus an agent-team sample labelled provisional | (a) alone cannot tell a grounded but wrong citation; (b) alone does not scale to every run |
| Evaluation set (D09 Q1, decision 14) | (a) synthetic only, forever; (b) wait for approved anonymized real-shaped samples; (c) synthetic now, a new frozen version from approved samples at W7 | **(c)**: `qc-eval-synthetic@1` with dev and held-out splits, frozen by W4-09b; the W7 successor is a new version, never an edit of `@1`, and is not built in W4b | (a) never meets a real document shape; (b) needs D08 data permission and stops W4b now |
| Signers (D09 Q7, decision 14b) | (a) the agent team signs; (b) deferred: agent-made labels marked provisional, signed when D09 names signers; (c) Ta signs for the lane experts | **(b)**: the exit record says "unsigned" | (a) would make an agent the approval authority, which the agent contract forbids; (c) Ta is not the recorded D09 owner |
| Probes (D09 Q5, decision 15) | (a) a synthetic hostile set in the repository; (b) plus IT/Security probes; (c) plus a red team | **(a)** now; (b) when IT/Security is named | (b) and (c) need owners who are not named |
| Cost and latency (D09 Q6, decision 16) | (a) budgets now; (b) record them; (c) gate on the 10 000 ms deadline | **(b) + (c)**; cost is 0 with no provider | (a) has nothing to budget until D08 permits a provider |

### 6. Model data handling (plan decisions 2-4 and 6; WA-D08; recorded here because the engine depends on them)

| Question | Adopted working assumption | Not chosen, and why |
|---|---|---|
| Which data may reach a model, which provider (decision 2) | **None; no provider.** A `ModelPort` with a local, deterministic fake (`fixtures/src/substitutes/model/`, with the substitute marker, excluded from the build), disabled by default | An external API needs an agreement and a key, both unknown here; a model on a True host needs D10 hosting |
| What is kept (decision 3) | Nothing beyond run rows and findings (locators, hashes, counts). Extracted text lives only in memory during a run; no extraction cache (decision 23) | Keeping raw evaluation or run outputs creates new data to protect with no D08 permission |
| Logging (decision 4) | Identities and numbers only | Content in logs, or accepting provider logging, needs D08 |
| Key custody (decision 6) | Moot: no key exists. `QC_MODEL` accepts only `disabled` and `local-fake` (`local-fake` only under `NODE_ENV=test` with fixture identity) | No choice is made; adding a provider value needs a D08 row and a new ticket |

## Decision

**Provisional, not accepted.** Stays provisional until Ta and the tech lead record acceptance, with date and channel, at the W4b exit review (W4-14). The adopted options are those in bold above:

- **Engine.** A new content runner (`server/src/qc/content/`, selected by `QC_MODE=content`) executes deterministic `content` rules over claims found by a documented synthetic claim grammar (plan section 3.2; its bilingual label lists are catalogue `params`, WA-D09). A `ModelPort` (`shared/src/qc/model.ts`) may propose claim candidates for segments the grammar could not parse, only for a rule whose `claimSource` is `grammar+model`; the seed uses `grammar`. Candidates pass output validation (schema, known segment and item, every field value a substring of its segment, numbers by the grammar's rule) and then the same deterministic rule logic. The model never emits a finding, lane, severity, disposition or transition. With `QC_MODEL=disabled` a rule that asks for the model makes the content part `unavailable:not_configured` (`model_disabled`), never a quiet grammar-only pass.
- **Parsers.** DOCX, XLSX and text-layer PDF are parsed by hand-written extractors on `node:zlib` and `node:buffer` (plan section 4.3). PNG, JPEG, scanned PDFs, encrypted PDFs, object-stream-only PDFs and Thai CID-font PDFs end as `artifact_unreadable`. **No dependency is added** (W0-02 section 4 unchanged).
- **Isolation.** One fresh worker process per artifact, forked with `env: {}`, IPC only, `stdio` ignored, `--max-old-space-size=QC_EXTRACT_MAX_MEMORY_MB`, a wall-clock SIGKILL at `QC_EXTRACT_TIMEOUT_MS` (500-9000, below the 10 000 ms deadline), an output cap `QC_EXTRACT_MAX_TEXT_CHARS`, and a concurrency cap `QC_EXTRACT_MAX_CONCURRENCY` (plan sections 2 and 4.2). The worker imports only `node:zlib`, `node:buffer` and its own files, enforced by a module-graph test. Every limit fails closed (plan section 4.4): `limit_*` and `unreadable` → `unavailable:artifact_unreadable`; timeout → `unavailable:timeout`; crash → `unavailable:runner_error`.
- **Run parts.** Under `QC_MODE=content` every trigger writes two run parts, metadata (the W4a `deterministic` runner) and content, each its own `qc_run` row, run key and replay; they are stamped metadata then content, and the combined outcome's `runId` is the latest-stamped part (plan section 3.4, decisions 27 and 29). `deterministic` and `substitute` keep one run per trigger, unchanged.
- **Evaluation.** A frozen synthetic set `qc-eval-synthetic@1` (dev and held-out), agent-made labels marked provisional and unsigned, exact thresholds written before any run, automatic plus sampled grounding, a synthetic probe set with zero critical successes, and recorded latency and cost gated on the 10 000 ms deadline (plan sections 11 and 12). A failed threshold is a failed exit, never a re-tuned threshold.
- **Model data handling.** No provider, no key, nothing kept beyond run rows and findings, identities and numbers only in logs. This ADR names **no model provider and no hosting**.

## Consequences

### Positive

- Content findings are reproducible: the same bytes, rules and grammar give the same findings, so exact thresholds are meaningful and a regression is visible.
- The model, when D08 permits one, can only widen what is read, never decide: a hostile document can at most cause a candidate that fails validation (`runner_error`) or a finding that the same deterministic rule would raise.
- A parser crash, hang or heap blow-up kills one short-lived process, not the server, and no state survives between cases.
- An image or scanned document no longer hides the metadata findings of the same trigger; the outage is visible beside them.
- No dependency, no network call, no key: the product and CI stay reproducible and offline.

### Negative

- Narrow coverage: no OCR, no CID-font Thai in PDFs, no object-stream-only PDFs; real document shapes may not match the synthetic claim grammar (a D09/W7 question). These end as visible outages or missed claims, not false passes.
- A fork per artifact costs start-up latency; W4-05b measures it under the source and built layouts and may switch the source layout to a precompiled worker entry.
- Two run rows per trigger under `content`, and a combined outcome rule that approvals and the UI must follow (decision 29).
- Hand-written parsers are ours to maintain and to harden.

### Risks

- **Held-out thresholds are 1.00** on renderings the dev split never shows, so one grammar miss fails the W4b exit. The remedy is a follow-up that widens the grammar and a new held-out version (`qc-eval-synthetic@2`), never a lowered threshold or a re-run on the seen `@1` held-out split (plan section 11.3).
- **Working assumptions may be replaced.** D08 may require stronger isolation (option 3c) or permit a provider; D09 may change thresholds, grounding or the set. Each is configuration or a new ticket, and a replacement supersedes this ADR's affected section rather than editing history.
- **Hand-written parser bugs.** Contained by the worker, the limits and the W0-08 hostile set fed to the extractor (every item must end as a clean `ok: false`), but not eliminated.

## Open items

- [ ] Acceptance of this ADR — Ta and the tech lead, at the W4b exit review (W4-14).
- [ ] D08: which data may reach a model, provider and hosting, retention, logging, parser isolation for real data (including a container or sandbox, option 3c), key custody — DPO and IT/Security, before any real data or provider (W7).
- [ ] D09: evaluation set from approved samples (a new frozen version at W7), thresholds, grounding, probes, cost and latency budgets, and the signers of the labels — AI/COE lead and lane experts.
- [ ] Node `--permission` flags on the worker fork — W4-05b records whether they work under both layouts; the module-graph test is the network guard either way.
- [ ] OCR and CID-font Thai PDFs — out of scope for W4b; a later ticket if D09 finds real packs need them.

## Stop conditions

- No external network call from the product or its tests, no model provider value in `QC_MODEL`, and no API key in any configuration, until a D08 row permits it.
- No real case documents; synthetic data only.
- No model output as a finding, disposition, approval or transition; the model proposes candidates only.
- No new runtime dependency without a lead PR amending W0-02 section 4.
- No extracted text stored, logged, cached or returned by any endpoint.
- From BUILD_PLAN W0 exit: no unrestricted network login; no external-register writes.

## References

- [W4b file-level plan](../docs/engineering/implementation-plan-w4b.md): section 1 (decisions 2-8, 12-16, 14b, 23, 27, 29), section 2 (configuration), 3.4 (run parts), 4 (extraction), 5 (model port), 11 (evaluation), 12 (probes)
- [Decision register](../docs/product/decisions.md): "Ta's delegation (2026-09-27)", "W4b delegated rulings (provisional)"; D08 and D09 open
- [W0-07 QC boundary](../docs/engineering/qc-boundary-and-mail-sink.md): 3.1 authority limits, 3.4 orchestrator, 3.6 QC-UNAVAILABLE
- [Upload safety and fixtures](../docs/engineering/upload-safety-and-fixtures.md): section 2.5 (hand-written sniff), 8.6 (hostile set), section 10 (D08 revisit list)
- [W0-02 file-level plan](../docs/engineering/implementation-plan-w1-w3.md): section 4 (pinned dependencies)
- [W4 decision briefs](../docs/delivery/w4-decision-briefs.md): D08 and D09 questions and options
- [Evaluation plan](../docs/evaluation/plan.md)
- [Threat model](../docs/security/threat-model.md): parser isolation, model input and no-provider rows (2026-09-27)
- [ADR-0003](0003-stack-and-deployment-boundary.md): D04 stack; in-process or worker QC left to this ADR
