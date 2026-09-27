# W4b file-level plan: content QC, extraction, evaluation (W4-00b)

Status: plan, 2026-09-27 (W4-00b). Prepared by the agent team under **Ta's delegation of 2026-09-27**: build a working RAI review platform on synthetic data, running end to end, and settle any question that would otherwise stop the build by writing options and adopting the recommended one provisionally. This plan must merge before any W4b code. It extends the [W4a plan](implementation-plan-w4a.md), the [W0-02 file-level plan](implementation-plan-w1-w3.md) and the [W0-07 QC boundary](qc-boundary-and-mail-sink.md); where it does not say otherwise, all three apply unchanged. Synthetic data only. Nothing deploys.

Two kinds of answer appear below, and they are never mixed:

- **Provisional ruling (PR).** A question Ta owns. The agent team made it under Ta's delegation of 2026-09-27. It is recorded in the register as provisional, and Ta can confirm or replace it at the W4b exit review.
- **Working assumption (WA).** A question another owner holds: D08 (DPO + IT/Security) or D09 (AI/COE lead + lane experts). **These decisions stay open.** The build runs on a labelled assumption, held as configuration and never hard-coded. No row says an owner approved anything.

W4b builds on the W4a code merged in PRs #192-#197. Ta's review of the W4a package ([exit record](../../changes/2026-09-27-w4a-exit/review.md)) is still pending. This plan does not claim it.

## 0. Scope and non-goals

W4b makes QC read document contents. When W4b exits, a synthetic case gets real QC on upload, submit and approve attempt from a runner that:

- extracts text and cells from the stored artifact bytes, locally, in a separate worker process;
- evaluates the `ACC-*` evidence rules and `PACK-CONTRADICTION`, as well as the W4a metadata rules;
- stores findings that cite a locator and an `excerptHash`, never any text;
- records unavailable results as unavailable, never as a clean pass.

A frozen synthetic evaluation set measures the runner against thresholds that were written down before any run. Security and failure probes show zero successes. A model adapter exists behind a port, **disabled by default**. Its only other implementation is a local, deterministic fake used in tests.

Tickets: W4-00b (this plan), W4-01, W4-11b, W4-05a-d, W4-06a-d, W4-07a-b, W4-08a-b, W4-09a-b, W4-10a-b, W4-12b, W4-13b, W4-13c, W4-15, W4-16, W4-17, W4-18, W4-INT-a, W4-INT-b and W4-14 (section 15).

Non-goals:

- **No external calls.** No call leaves the machine: no model provider, no OCR service, no telemetry. No API key exists in any configuration, and `QC_MODEL` has no value that names a provider.
- **No real data.** No real case documents, no real-data upload limits, and no malware scanner (the D08 real-data part, W7).
- **No new runtime dependency.** Parsers are written on Node built-ins (decision 8).
- **No OCR.** Images and scanned PDFs are recorded as `artifact_unreadable`. Thai text in PDFs that use CID fonts is not decoded (section 4.3).
- **No Admin editing of rules.** That is W6. W4b changes the catalogue only through the seed.
- **Not in scope:** checklist item anchoring and the attested-evidence scenario (candidate backlog 1 and 2), W8, production, networked access.

## 1. Decisions

Legend: **PR** = provisional ruling by the agent team under Ta's delegation of 2026-09-27. **WA-D08** / **WA-D09** = working assumption; the named owner's decision stays open. Every ruling and assumption is also recorded in the W4-00b register rows (section 19).

| # | Question | Options and trade-offs | Adopted | Kind |
|---|---|---|---|---|
| 1 | Open W4b before D08/D09 are recorded? | (a) Wait for the owners: nothing moves while two owner seats are empty. (b) Open W4b on synthetic data, with no external calls and working assumptions held as configuration: the platform runs end to end now, and owners can retune it later. (c) Open extraction only, without the model port: less rework risk, but the adapter work is then missing when D08 lands | **(b)** | PR |
| 2 | D08 Q1-Q2: which data may reach a model, and which provider | (a) None: no provider, a port with a local fake, disabled by default. Nothing leaves the machine, and model quality stays unmeasured. (b) Synthetic data to an external API: needs an agreement and a key, both unknown here. (c) A model on a True host: needs D10 hosting | **(a)** | WA-D08 |
| 3 | D08 Q3: what is kept | (a) Nothing beyond run rows and findings (locators, hashes, counts). Extracted text lives only in memory during a run. Evaluation reports carry no text. (b) Also keep raw evaluation outputs outside the database. (c) Raw outputs of every run | **(a)**. With no model there is no raw model output to keep | WA-D08 |
| 4 | D08 Q4: logging of extraction and model calls | (a) Identities and numbers only. (b) Also content on synthetic data. (c) Also accept provider logging | **(a)** | WA-D08 |
| 5 | D08 Q5: parser isolation | (a) In-process with limits: fewest parts, but a parser bug shares the heap with the database pool. (b) A **fresh child process per artifact**, with an empty environment, bytes over IPC, a heap cap, a wall-clock kill and no database or network module (module-graph test). One process per extraction also rules out cross-case state. (c) A container or sandbox service: needs D10 hosting | **(b)** | WA-D08 |
| 6 | D08 Q6: who holds the model key | Moot under decision 2(a), so no options are weighed: no key exists. `QC_MODEL` accepts only `disabled` and `local-fake`. Adding a provider value needs a D08 row and a new ticket | Moot: no key, no choice made | WA-D08 |
| 7 | QC engine (ADR-0006) | (a) Deterministic content rules only. (b) Deterministic content rules, plus a model port that may *propose* claim candidates, which the same deterministic rules then judge; disabled by default. (c) Model-first rules: needs a provider, and a finding would depend on model judgement | **(b)** | PR |
| 8 | Parser implementation | (a) Hand-written on Node built-ins: `node:zlib` `inflateRawSync` with `maxOutputLength`, an XML tokenizer that refuses a DOCTYPE, and a PDF text-layer reader. This follows the pattern of `server/src/artifacts/sniff.ts` and adds no dependency (team-and-roles forbids dependencies outside the W0 list; W0-02 section 4). Coverage is narrower. (b) Pinned `pdfjs-dist` plus an OOXML library: wider coverage, but it amends W0-02 section 4 and adds a large attack surface. (c) An external binary such as `pdftotext`: a host dependency, not reproducible in CI | **(a)** | PR |
| 9 | How the content runner is selected | (a) Extend `deterministic`: the W4a evidence changes meaning, and the "reads no bytes" test breaks. (b) Add a new `QC_MODE=content`, and keep `deterministic` as a metadata-only mode that can be selected at restart to take extraction out of service. (c) Replace `deterministic` | **(b)** | PR |
| 10 | How a claim appears in a document (rule semantics) | (a) A documented **synthetic claim grammar** (section 3.2) whose bilingual key lists are catalogue `params`: data, not code, which D09 owners can retune. (b) Free-text heuristics in code. (c) Only a model can read claims | **(a)**. Real document shapes are a D09/W7 question | WA-D09 |
| 11 | D09 Q3: band boundary precision | (a) Compare the value exactly as reported, in decimal arithmetic; equal fails (strict "less than"). (b) Compare at the precision the template states, which is unknown | **(a)**, the brief's fallback | WA-D09 |
| 12 | D09 Q2: how thresholds are set | (a) Owners set numbers before any run. (b) Baseline on dev, judge on held-out. (c) Exact for deterministic rules, (b) for probabilistic rules | **(c)**. Every W4b rule is deterministic, so the thresholds are exact (section 11.3). The model fake proves the contract only | WA-D09 |
| 13 | D09 Q4: grounded citation | (a) Automatic. (b) Human sample. (c) Both | **(c)**: automatic on every finding, plus a sample graded by the agent team and labelled provisional | WA-D09 |
| 14 | D09 Q1: the evaluation set's source | (a) Synthetic only, frozen now, and kept as the only set: no dependence on real documents, but the set never meets a real document shape. (b) Wait for approved anonymized real-shaped samples: closer to reality, but it needs D08 data permission and stops W4b now. (c) Synthetic now (`qc-eval-synthetic@1`, dev and held-out splits), and at W7 a new frozen version built from approved samples, never an edit of `@1` | **(c)**, as the D09 brief recommends. The W7 successor is not built in W4b | WA-D09 |
| 14b | D09 Q7: who signs the labels and the evaluation evidence | (a) The agent team signs: fast, but an agent would be the approval authority, which the agent contract forbids. (b) Deferred: labels are made by the agent team and marked provisional; the lane experts and the AI/COE lead sign when D09 names them; the exit record says "unsigned". (c) Ta signs in place of the lane experts: Ta is not the recorded D09 owner | **(b)**, as the brief recommends, because no signer is named yet | WA-D09 |
| 15 | D09 Q5: probes | (a) A synthetic hostile set in the repository. (b) Plus IT/Security probes. (c) Plus a red team | **(a)** now; (b) when IT/Security is named | WA-D09 |
| 16 | D09 Q6: cost and latency | (a) Budgets now. (b) Record them. (c) Gate on the 10 000 ms deadline | **(b) + (c)**. Cost is 0 with no provider | WA-D09 |
| 17 | Finding dedup (W0-07 3.4 step 6, deferred from W4a) | (a) None: an upload finding and an approve-attempt finding on the same claim duplicate. (b) Do not append a finding while an **open** finding exists on the same version with the same `(ruleId, ruleRevision, scopeKey, owningLane)`. `scopeKey` is persisted. Owning lane is in the key, so two lanes' slot-5 findings stay two. (c) Also dedup across rule revisions, which would hide a recheck | **(b)** | PR |
| 18 | Which runner CI uses | (a) Move all CI to `content`: slice-1 documents carry no claims, so every W2/W3 journey and fixture citation would change. (b) Keep `substitute` for the W1-W3 evidence journeys, which are contract fixtures for the disposition UI. Run the W4b real-server test, the W4b browser journey and the dev-split evaluation gate on `content` in CI. (c) Use `content` only locally | **(b)** | PR |
| 19 | In-memory API substitute (revisit at W4b kickoff) | (a) Keep it **frozen** through W4b: no new W4b route (the freeze binds W4b tickets only; W5 R-16 adds two small read routes in W5-07 and W5-08, and W6 keeps it otherwise frozen, consolidated 2026-09-27), `evidence` stays optional, revisit at the W6 kickoff. It costs nothing, because new routes 404 there. (b) Extend it: more work, and no spec needs it. (c) Retire it now: needs a real-server twin of `w3-07b-operator.rehearsal.substitute.spec.ts` and a gate change | **(a)** | PR |
| 20 | W4a item for Ta: no upload run when no runner is bound | (a) Keep it: an unbound upload leaves no trace. (b) Record an `unavailable:not_configured` upload run with `engine_id = 'unbound'` and the slot's outage finding, exactly as submit already does (`UNBOUND_ENGINE_ID` in `qc/orchestrator.ts`). (c) A log line only | **(b)**: one rule for every trigger (A08) | PR |
| 21 | W4a item for Ta: locator heading and cell text are served | (a) Serve them as stored. (b) **Change the contract so no document text is carried in a locator:** `section` by ordinal, `cell` by sheet ordinal plus an A1 reference checked by pattern. Legacy rows are served as their kind only. (c) Store the text but serve only numbers | **(b)**. A heading or sheet name is document text (W0-07 3.1) | PR |
| 22 | Content findings on an upload to slot 5 (BRD) | (a) Upload content rules read slot 1 only. Slot 5 is judged on each lane's approve attempt, where the owning lane is known. (b) AI/COE owns upload slot-5 content findings. (c) One per lane | **(a)**. No lane is invented; this stays within the D05 refinement (#35) | PR |
| 23 | Extraction caching | (a) None: re-extract on every run, and persist nothing. (b) An in-memory cache by content hash: faster, but text outlives the run. (c) Persisted: new data to protect | **(a)** | PR |
| 24 | Where the model fake lives | (a) `fixtures/src/substitutes/model/`, with the substitute marker. It is test-only and excluded from the build by `check:substitute-absent`. (b) Server product code | **(a)** | PR |
| 25 | Where a finding's measure is stored | (a) Message params only: not queryable, and the value is lost for evaluation. (b) Columns `metric_value`, `metric_unit`, `threshold_source` on `qc_finding` | **(b)** | PR |
| 26 | Candidate backlog 1 and 2 (item anchoring, runtime operated elsewhere) | Out of scope for W4b, so no options are weighed. A claim's item number may appear in message params only as a pattern-checked reference (`^\d+(\.\d+){0,3}$`) | Out of scope: no choice made | PR |
| 27 | An extraction outage and the metadata findings of the same trigger | (a) Keep one run per trigger: any extraction failure makes the whole run `unavailable`, and an unavailable result carries no findings (`QcRunResult`), so `PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH` and `PACK-NA-VENDOR-DOC` vanish whenever slot 2 or 5 is an image or a scan. Nothing passes silently, but real defects disappear: a regression against W4a `deterministic`, recorded as a known limitation. (b) **Two run parts per trigger:** the W4a `deterministic` runner runs the `metadata` rules and the content runner runs the `content` rules, as two `qc_run` rows with their own `engine_id`, status, `runKey` and replay. An extraction outage makes only the content part unavailable, and the metadata findings are recorded beside a visible outage. Stays within W0-07: each run is either completed or unavailable, never a shorter clean result. Costs one orchestrator ticket (W4-18) and a second run row per trigger. (c) Change the contract so a completed run may carry findings plus an artifact-scoped unavailable finding: one row, but it amends the W0-07 rule that an outage is a run status and that QC-UNAVAILABLE is orchestrator-built, and it blurs "completed" | **(b)**, section 3.4 | PR |
| 28 | Which slots a content rule reads on an approve attempt (W0-07 3.4 step 5: every finding of an approve-attempt run belongs to the run's lane, enforced by `checkOwningLane` → `finding_outside_lane`, which fails the whole run) | (a) Read every slot in the rule's `params.slots` on every lane's attempt: a DPO or IT/Security attempt then produces AI/COE-owned slot-1 findings, which `finding_outside_lane` refuses, so the content part becomes `runner_error`, and a scanned slot 1 becomes an outage owned by lanes that never review slot 1. Wrong. (b) **Lane-scoped reading:** on `approve_attempt`, a content rule reads only the slots in `params.slots ∩ slotsForLane(request.lane, mapping of request.laneMappingVersion)`. A rule with an empty intersection emits nothing and reads no bytes. Upload and submit runs (lane null) keep reading `params.slots`. (c) Filter the rules per lane in `selectRules`: a second place for lane logic, and `select.ts` is shared with the metadata runner and W6's editor | **(b)**, section 3.1 | PR |
| 29 | Which run a lane approval must name when one approve attempt writes two run parts (`approveLane` checks `body.qcRunId` against `findLatestApproveAttemptRun`, any engine, ordered `requested_at desc, id desc`) | (a) **The combined outcome's `runId` is always the part with the latest `requested_at`.** The orchestrator stamps the parts in a fixed order, metadata then content, with `nextMonotonicStamp` (strictly increasing), so a first attempt's latest part is the content part, and a retry that reruns one part names that rerun. `approveLane` keeps checking against the latest row of any engine. One comparison, no workflow rule change. (b) `approveLane` accepts a `qcRunId` that names the latest run of some part when no part has a newer run: two lookups, and `observed_qc_run_id` could name an older part. (c) A new `qc_attempt` row grouping the parts: a migration and a new identity for one comparison | **(a)**, section 3.4 | PR |
| 30 | How many findings a content rule may emit per scope in one run (`findingKey` is `${ruleId}:${scopeKey}` and the W4-15 dedup key has no claim part, so two defective claims in one artifact, or two contradicting facts in one pack, would share a key and the second real defect would be dropped) | (a) One finding per (rule, scope) per run, with every defective claim aggregated as an evidence entry: one disposition covers several defects, and `measure` and `params.missing` can describe only one claim. (b) **A claim discriminator:** a content finding carries `claimKey` (`^[a-z0-9_]{1,64}$`: the first 16 hex characters of the claim's `excerptHash`, or the fact ID for `PACK-CONTRADICTION`); `findingKey` becomes `${ruleId}:${scopeKey}:${claimKey}` when `claimKey` is present; the W4-15 dedup key includes it; the dedup lookup compares only against rows that existed before the run; and a new validator violation `duplicate_finding_key` refuses two findings with one `findingKey` in one run. Each defect stays separately dispositionable (the review-desk model). Metadata findings carry no `claimKey`, so their keys are unchanged. (c) Emit one finding per claim with no key change and no dedup for content rules: duplicates across upload and approve attempt return | **(b)**, sections 3.1, 6 and 7 | PR |

## 2. Configuration (W4-13b, W4-07a)

`server/src/config.ts` remains the only reader of `process.env`. The rules of W0-02 section 5 apply: a misconfiguration is a start-up failure with exit 78, never a default.

| Key | Values | Rule |
|---|---|---|
| `QC_MODE` | `content`, `deterministic`, `substitute` | `content` is new: it binds two run parts (decision 27, section 3.4): the W4a `deterministic` runner for the `metadata` rules and the W4b content runner (with the extraction worker) for the `content` rules. `deterministic` and `substitute` are unchanged from W4a; `substitute` is still refused outside local modes (`parseQcMode`). No mode falls back to another. `.env.example` moves to `content` |
| `QC_EXTRACT_TIMEOUT_MS` | integer 500-9000 | Required when `QC_MODE=content`, ignored otherwise. It must stay below the orchestrator deadline `QC_TIMEOUT_MS` (10 000). Refused with `invalid:QC_EXTRACT_TIMEOUT_MS` otherwise. `.env.example`: 4000 |
| `QC_EXTRACT_MAX_MEMORY_MB` | integer 64-512 | Required under `content`. Becomes the worker's `--max-old-space-size`. `.env.example`: 256 |
| `QC_EXTRACT_MAX_TEXT_CHARS` | integer 1000-2 000 000 | Required under `content`. Hitting the cap is `limit_output` (section 4.4). `.env.example`: 1 000 000 |
| `QC_EXTRACT_MAX_CONCURRENCY` | integer 1-4 | Required under `content`. The number of worker processes alive at once; excess extractions queue inside the deadline. `.env.example`: 2 |
| `QC_MODEL` | `disabled`, `local-fake` | Required under `content`. `local-fake` is refused (`invalid:QC_MODEL`) unless `NODE_ENV=test` and `RAI_IDENTITY_MODE=fixture`. Under any other `QC_MODE`, any value other than `disabled` or unset is refused, because a model is never silently unused. No provider value exists (WA-D08, decision 6). `.env.example`: `disabled` |

- The upper bounds are the local policy caps, as `UPLOAD_LIMIT_DEFAULTS` are. A local override cannot widen them; raising them is a D08 change.
- **Readiness:**
  - `qc.kind` gains `content` (`shared/src/schemas/observability.ts` `ReadinessReport`; the enum already holds `substitute | deterministic | model`), and `qcKindOf` in `server/src/qc/kind.ts` maps runner `content` to it.
  - Under `content` the bound `runner` is the W4a deterministic runner, so today's `start.ts` derivation (`qcKind: qcRunner === undefined ? config.qc.mode : qcKindOf(qcRunner.identity)`) would report `deterministic`. W4-13b changes it to report the content runner's kind when a `contentRunner` is bound (`qcKindOf(contentRunner.identity)`, which is `content`), and otherwise the bound runner's kind as today. A unit test asserts `qc.kind = 'content'` under `QC_MODE=content` and `deterministic` under `QC_MODE=deterministic`.
  - The readiness `qc` probe under `content` is `ready` only when both parts' probes are `ready`; otherwise the worse answer.
  - `qc` gains `model: 'disabled' | 'local-fake'`.
  - **Operator labels (consolidated 2026-09-27).** `web/src/i18n/operator-labels.ts` maps every readiness enum value to a locale key with `satisfies Record<OperatorValue, LocaleKey>`, so a widened enum is a type error until it has a label. W4-13b adds `content: 'operator.value.content'` (and, if `qc.model` is added to `OperatorValue`, `'local-fake': 'operator.value.local_fake'`) with th and en keys, and lists `operator-labels.ts` in its paths. The same rule binds W6-09 (`desk_paused`), W6-17 (`unconfigured`) and W7-03 (`ahead`).
  - The content runner's probe answer is the cached result of one start-up self-test: the worker extracts an embedded synthetic DOCX. A failed self-test logs `qc.extract.failed` (`reason: 'selftest'`) and makes the probe answer `unavailable`. It never refuses start, because QC is soft and submit must keep working.
- CI and the evidence browser configuration keep `QC_MODE=substitute` (decision 18). The W4b real-server tests set `QC_MODE=content` and `QC_MODEL=disabled` through `startTestServer({ env })`.
- The `start.ts` test override (`qcRunner`) keeps its guard unchanged.
- `check:substitute-absent` must still pass: the content runner, the extractor and the model port are product code; the fake is not.

## 3. Content runner and rule catalogue `w4b.1` (W4-06a-d, W4-13c, W4-18)

### 3.1 Runner

- `server/src/qc/content/runner.ts` `createContentQcRunner({ extractor, model?, now?, runnerVersion? })` implements `QcRunner` with `identity = { runner: 'content', runnerVersion }`.
- It executes only the selected `engine: 'content'` rules, through `CONTENT_RULES` (`qc/content/rules/index.ts`), and skips `metadata` rules, as the W4a deterministic runner skips `content` rules (`qc/deterministic/runner.ts`: `if (rule.engine !== 'metadata') continue`). The `metadata` rules keep running in the W4a `deterministic` runner, unchanged, as the metadata part of the same trigger (decision 27, section 3.4). It keeps the W4a fail-closed rules: `rules === null` gives `not_configured`; an unknown rule, a trigger the rule is not defined for, or bad params give `runner_error`. A request with no selected content rule completes with zero findings and reads no bytes.
- **Lane scope (decision 28; W0-07 3.4 step 5).** `buildRequest` carries every slot and every attached artifact of the version on an approve attempt as well (it filters only for upload), and `selectRules` filters by template, trigger and model type, not by lane. So the runner scopes itself. For a rule, its **readable slots** are:
  - on `upload` (run lane null): `params.slots ∩ singleLaneSlots(LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion])`, where a single-lane slot is one exactly one lane reviews (under the current mapping slots 1, 6, 7 and 8 among those content rules list), and only the one slot the request carries. So an upload to slot 5, which three lanes review, reads no bytes and raises no content finding (decision 22: slot 5 is judged on each lane's approve attempt, where the owning lane is known), and a scanned slot-5 upload is never a content outage. The finding's owning lane is that single lane (slot 1: `ai_coe`). A W4-06a unit test uploads to slot 1 and to slot 5 with a recording fake extractor and asserts one read and one possible finding for slot 1, and no read and no finding for slot 5;
  - on `submit` (run lane null): the rule's `params.slots` (the pack-level rules; today only `PACK-CONTRADICTION`, owned by `ai_coe` as every pack finding);
  - on `approve_attempt`: `params.slots ∩ slotsForLane(request.lane, LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion])`. Under the current mapping that is slot 1 for AI/COE only, and slot 5 for every lane.

  A rule with no readable slot on this request emits no finding, reads no bytes and is still counted in `rulesEvaluated` (it ran and had nothing in scope). Consequences, each a W4-06a unit test with a fake `Extractor` that records the slots it was asked for:
  - a DPO or IT/Security approve attempt on a version whose slot 1 holds a defective claim yields no slot-1 finding, reads no slot-1 bytes and completes; `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3` and `ACC-CLASSIC-ML-METRIC` emit nothing on those attempts;
  - a scanned or unreadable slot 1 makes only the AI/COE approve attempt's content part unavailable; the DPO and IT/Security content parts complete (they read only slot 5), so no outage finding is created for a lane about a slot it does not review;
  - every finding the runner returns on an approve attempt has `owningLane === request.lane`, so `checkOwningLane` never answers `finding_outside_lane` for a content finding (asserted over the whole rule set and every lane).
- **Reading bytes:**
  - For each content rule, the runner reads the artifacts in the request whose slot is among the rule's readable slots, and only those.
  - Each `artifact.read()` stream is read up to `byteLength` bytes, and its sha256 must equal `contentHash`. Otherwise the run is `artifact_unreadable` with detail `hash_mismatch`.
  - The bytes go to the extractor (section 4) once per artifact per run.
  - Every `EvidenceLocation` cites an artifact of the same request, so a citation resolves inside the same version. The orchestrator checks this through a new validator violation, `evidence_outside_request`: `QcFindingContext` gains an **optional** `artifacts?: ReadonlyArray<{ artifactId, contentHash, slot }>`, and the check runs only when it is present. `checkedResult` always passes it. The frozen in-memory API substitute calls `validateQcFinding` with a context literal `{ trigger, lane, qcRulesRevision, checklistTemplateVersion }` (`fixtures/src/substitutes/api/routes-review.ts`), which stays valid unchanged (decision 19).
- **Extraction outcome to run outcome:** `unreadable` or any `limit_*` → `unavailable:artifact_unreadable` with detail `extract_<reason>`. `timeout` → `unavailable:timeout`. `crash` → `unavailable:runner_error`, detail `extract_crash`. The content part never returns a shorter clean result. This outcome belongs to the **content part only**: the metadata part of the same trigger is a separate run and keeps its findings (decision 27). So a PNG or scanned privacy checklist in slot 2 makes the submit content run unavailable, and the submit metadata run still records `PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH` and `PACK-NA-VENDOR-DOC` where they apply.
- `excerptHash` = sha256 hex of the NFC-normalised UTF-8 text of the matched claim segment (`qc/content/excerpt.ts`). The text itself never leaves `runner.ts`.
- **One finding per defective claim (decision 30).** A content finding carries `claimKey`: the first 16 hex characters of its claim's `excerptHash`, or, for `PACK-CONTRADICTION`, the fact ID (`personal_data`, `external_vendor`). `QcFinding` (`shared/src/qc/types.ts`) gains `claimKey?: string` (pattern `^[a-z0-9_]{1,64}$`); `findingKeyOf(ruleId, scope, claimKey?)` returns `${ruleId}:${scopeKey}:${claimKey}` when it is present and today's key otherwise, so every metadata finding, substitute script and existing test keeps its key. `validateQcFinding` checks the key with the claim part, and a run-level check refuses two findings with one `findingKey` (`duplicate_finding_key`, the whole run becomes `runner_error`). Two defective claims in one artifact are therefore two findings, each with its own `measure`, `params.missing` and disposition.
- **Message params:** only numbers and strings matching one of these exact patterns (the validator is pure and knows no catalogue, so it checks shape, not membership):
  - a key: `^[a-z][a-z0-9_]{0,63}$` (field names, fact IDs, metric IDs such as `extraction_accuracy`, slot names);
  - a comma list of keys, no spaces: `^[a-z][a-z0-9_]{0,63}(,[a-z][a-z0-9_]{0,63}){1,15}$` (for example `missing: 'denominator,threshold'`);
  - an item reference: `^\d+(\.\d+){0,3}$`;
  - a decimal string: `^-?\d{1,18}(\.\d{1,18})?$`;
  - a string exactly equal to the request's `checklistTemplateVersion` (a threshold source such as `v1.0 Sheet3`).

  A new check in `validateQcFinding`, `message_param_text`, refuses any other string param, so document text cannot enter through params. A closed set taken from `request.rules` params is deliberately not used: the substitute's request may carry `rules: null` or W4a params. The frozen API substitute drops a refused finding silently (`continue` in its filter), (`storeableFindings` in `routes-review.ts`, fed by the scripted QC substitute). W4-06a's script test therefore also runs every script's approve-attempt findings through `validateQcFinding` and `checkOwningLane` with the context `storeableFindings` builds, and asserts that none is dropped; if one would be, W4-06a corrects that script, not the API substitute's code. `checkedResult` (`qc/orchestrator.ts`) applies the check to every runner, including the scripted substitute that CI keeps (decision 18). The substitute scripts already emit `threshold_source: 'v1.0 Sheet3'` (`fx-case-nonvendor.json`, `fx-case-na-reasons.json`), and the template-version allowance keeps them valid without migrating them. W4-06a adds a test that every substitute script's findings pass `validateQcFinding` against its fixture's request context; if a script's `threshold_source` differs from its fixture case's template version, W4-06a corrects that script (its paths include `fixtures/src/substitutes/qc/scripts/`).
- **Module graph:** `qc/content/` may import `qc/extraction/client.ts`, `qc/deterministic/rules/`, `@rai/shared` and `node:crypto`. It may not import a network module, `pg`, `drizzle-orm` or `server/src/db/`. It is tested like `qc/deterministic/module-graph.test.ts`.

### 3.2 Claim grammar (provisional, WA-D09; `qc/content/claims.ts`)

Segments come from the extractor (section 4.2). A **claim** is:

- **XLSX:** a data row under a header row (the first row whose cells match at least three column keys) on any sheet. Column keys: `item`, `question`, `answer`, `metric`, `value`, `unit`, `denominator`, `threshold`, `evidence`, `tier`. The locator is the answer cell. The excerpt is the row's cells joined by U+001F.
- **DOCX / PDF:** one paragraph (DOCX) or one text line (PDF) of `key: value` pairs separated by `;`, where at least one key is `answer`. The locator is `section` (paragraph ordinal) for DOCX, or `page` for PDF (section 4.3).

Details:

- Key labels are matched after NFC normalisation and case folding against the bilingual lists in the rule's `params.labels` (en and th). The lists are configuration, not code.
- Answers normalise to `yes | no | na | unknown`.
- Values parse to a decimal string plus a unit: `%` → `percent`, a bare number → `ratio` if it is at most 1 and has a decimal point, otherwise `count`.
- A claim's item (`hallucination`, `accuracy`, `classic_ml_performance`, or a fact ID) comes from `params.items`: keyword lists matched against the `question` or `item` field.
- `qc/content/decimal.ts` `compareDecimal(a, b)` compares decimal strings exactly, as scaled bigints, never as floats. Decision 11's exactness applies to the **comparison**. The stored `measure.value`, `denominator` and `threshold` are JavaScript numbers (`MeasureSchema`), converted from the parsed decimal only after the comparison, and the `numeric` columns of W4-15 store that number; the exact decimal string, when a finding needs it, travels in a decimal-string param.

### 3.3 Rules (seed `w4b.1`; all provisional until D09)

| Rule | Trigger | Slots read; owning lane | Fires when | Severity | Evidence and measure |
|---|---|---|---|---|---|
| `ACC-METRIC-CITED` | upload (slot 1 only, decision 22), approve_attempt | Lane-scoped (decision 28): upload reads slot 1 → `ai_coe`; an AI/COE approve attempt reads 1 and 5 → `ai_coe`; a DPO or IT/Security approve attempt reads 5 only → the run's lane | A `yes` claim on a hallucination or accuracy item lacks any of `metric` (one of `params.acceptedMetrics`), `value`, `denominator`, `threshold` or `evidence`. An extraction metric counts as absent here | medium | Claim locator plus `excerptHash`. When the claim states an accepted `metric` **and** a `value`, `measure` carries what was stated (`denominator` and `threshold` null when missing), `unit` from the value, `thresholdSource` = the version's template. When the metric or the value is missing, `measure` is `null` (`MeasureSchema` requires a non-empty `metric` and a `unit`). Either way the gaps are in params `{ missing: 'denominator,threshold' }` (a comma list of field keys) |
| `ACC-EXTRACTION-NOT-HALLUCINATION` | approve_attempt | 1 → `ai_coe`; AI/COE attempts only (decision 28): emits nothing and reads no bytes on DPO and IT/Security attempts | A claim on the hallucination item cites a metric in `params.extractionMetrics` | high | Claim locator; `measure.metric = 'extraction_accuracy'` |
| `ACC-BAND-V1-SHEET3` | approve_attempt | 1 → `ai_coe`; AI/COE attempts only (decision 28); catalogued only under `v1.0 Sheet3` (W4a template isolation) | A `hallucination_rate` value in percent (ratio × 100, exactly) is **≥** the band for the stated tier. `params.bands = { high: '1', medium: '2', low: '3' }`, strict less-than, so equal fails. A missing tier raises the finding with message `qc.finding.acc_band_v1_sheet3_tier_missing` | high | Claim locator; measure `{ value, denominator, threshold: band, unit: 'percent', thresholdSource: 'v1.0 Sheet3' }` |
| `ACC-CLASSIC-ML-METRIC` | approve_attempt | 1 → `ai_coe`; AI/COE attempts only (decision 28); selected only for `classic_ml` (`qc/select.ts` routing, unchanged) | No claim on `classic_ml_performance` cites a metric in `params.matchingMetrics` with a value, **and** no `na` answer carries a reason. An `attached` slot 1 is read; `not_applicable` with a reason is metadata, and no finding is raised | medium | Claim locator, or `absent` on the artifact |
| `PACK-CONTRADICTION` | submit | 2 and 5 (`params.facts[].slots`); pack → `ai_coe` | Two attached artifacts state the same fact (`params.facts`, seed: `personal_data`, `external_vendor`) with different `yes`/`no` values | medium | Two evidence entries, one per artifact, each with locator and `excerptHash`; params `{ fact, slotA, slotB }` |

- **Params schemas and seed params land together.** `shared/src/schemas/cases.ts` `QC_RULE_PARAMS_SCHEMAS` gains one schema per content rule. Each lists `slots`, `labels`, `items` and `claimSource: 'grammar' | 'grammar+model'`; the seed uses `grammar`. `qcRulesBodyProblems` runs `Value.Check` on every publish, including the seed's, and the seed today lists the four `ACC-*` rules with no `params`. So **each W4-06x PR that registers a rule's params schema adds that rule's `params` to `configuration/seed.ts` in the same PR** (W4-06a `ACC-METRIC-CITED`; W4-06b `ACC-EXTRACTION-NOT-HALLUCINATION` and `ACC-CLASSIC-ML-METRIC`; W4-06c `ACC-BAND-V1-SHEET3`; W4-06d adds the `PACK-CONTRADICTION` entry to both templates with its params) and keeps `seed.test.ts` "every seed body validates" green. No PR leaves a registered schema without seed params.
- **Seed label (W4-13c).** W4-13c sets the `qc_rules` label to `w4b.1`; the W4a metadata rules are unchanged, and `v2.0` still omits `ACC-BAND-V1-SHEET3`. W4-06a-d change only params and keep the label; the evaluation identity carries the body's sha256 as well as the label (section 11.2), so the intermediate bodies are still told apart. **Cross-package label rule (consolidated with the W5 plan, section 8):** W5-10 also changes the seeded `qc_rules` body (it adds `RISK-TIER-UNKNOWN`) and sets the label `w5.1`. The label names the last ticket that changed the seeded body: whichever of W4-13c and W5-10 merges second keeps the other's rules, sets its own label, and updates the label assertions (`seed.test.ts`, `w4-02`, `w4-03`, `w4a-int-deterministic-server`, and the other ticket's tests).
- **Tests to update.** `seed.test.ts` asserts the label; the frozen revision ID is unchanged, because the seed publishes revision 1.
- **Implemented-rule registry (W6-03, consolidated).** When W6-03 has merged, `shared/src/qc/rule-registry.ts` `IMPLEMENTED_RULES` must list every catalogued rule with its engine and triggers. The four `ACC-*` rules are pre-listed there by W6-03 as `engine: 'content'` with the triggers of section 3.3. W4-06d adds `PACK-CONTRADICTION` (`content`, `['submit']`) if W6-03 merged first; otherwise W6-03 adds it when it rebases. Whichever of W4-06d and W6-03 merges second also adds a server unit test that the registry's `content` entries equal `Object.keys(CONTENT_RULES)`, beside W6-03's metadata test.
- **No content rule on slot 9.** Nothing reads slot 9. A slot that is `not_yet` or `missing` carries no artifact, so content rules skip it; the metadata rules own those states.
- **Model assist.** A rule whose `claimSource` is `grammar+model` asks the model port for claim candidates on segments the grammar could not parse (section 5). With `QC_MODEL=disabled`, the run is `unavailable:not_configured`, detail `model_disabled`.

### 3.4 Two run parts per trigger (decision 27, W4-18)

- **Binding.** `QcOrchestratorDeps` keeps `runner` and gains an optional `contentRunner?: QcRunner`. Under `QC_MODE=content`, `runner` is the W4a deterministic runner and `contentRunner` is the content runner. Under `deterministic` and `substitute`, `contentRunner` is absent and every trigger behaves exactly as in W4a (one run; the scripted substitute receives all rules). Tests and `tests/support/fixture-app.ts` that build deps without `contentRunner` are unchanged.
- **Rules per part.** The orchestrator selects the rules once (`requestRules`) and hands the metadata part the full list, as today (the deterministic runner skips `content` rules), and the content part the same list (the content runner skips `metadata` rules). Each part's `rulesEvaluated` names only what it executed.
- **Run rows.** Each part is its own `qc_run` row with its own `engine_id` (`deterministic` or `content`, the runner's `identity.runner`), status, `unavailable_reason`, rows of findings and `qc.run.*` lines. No migration is needed: `engine_id` exists since migration 0009 (W4-11a).
- **Run key.** `runKeyOf` gains the engine ID of the part: `${versionId}|${trigger}|${lane}|${engineId}|${qcRulesRevision}|${parts}`. Upload in-flight sharing keys on it as well.
- **Replay.** `replayPrior` and `findLatestSubmitRun` / `findLatestApproveAttemptRun` take an **optional** engine ID (`engineId?: string`; omitted means any engine, today's behaviour). The orchestrator passes the part's engine ID and replays per part, with the W0-07 3.7 rules unchanged. So a retried approve attempt replays a completed metadata part and reruns only an unavailable content part. A version whose runs were recorded under `deterministic` keeps its metadata runs when the mode moves to `content`; only the content part runs new. The unbound case stays one `unbound` row (no part split without a runner).
- **Order and deadline.** Both parts are prepared under the first lock, called concurrently under the one `QC_TIMEOUT_MS` deadline, and persisted in one transaction under the case lock, metadata part first.
- **Stamps (decision 29).** Under the first lock, each part that will run (is not replayed) takes its stamp from `nextMonotonicStamp` in a fixed order, **metadata first, then content**. `nextMonotonicStamp` is strictly increasing within the process, so the content part's `requested_at` is later than the metadata part's, and the `uuidv7` tie-break on `id` is never needed between the two parts of one attempt. A replayed part keeps its recorded row and stamp. The W4-15 dedup applies to each part's findings; the parts share no rule, so they never dedup against each other.
- **Outage finding.** The QC-UNAVAILABLE finding stays one per open `run` scope `{ trigger, lane }` (W0-07 3.6): a content-part outage creates or reuses it exactly as a whole-run outage does today, and it gates Ready as before.
- **Combined outcome** (what `runLaneQc` returns and the lane QC route serves). `status` is `completed` only when every part completed; otherwise `unavailable` with the unavailable part's reason (content first when both are). `runId` is **the part whose row has the latest `requested_at`** (decision 29): after a first attempt, the content part; after a retry that reruns only the content part, the rerun; after a retry that reruns only the metadata part, that rerun. Which part is unavailable is read from `parts`, never from `runId`. `findings` is the union of both parts' stored findings plus the outage finding. The response gains an optional `parts: Array<{ runId, runner, status, reason? }>` (section 9); `parts[].reason` is typed from the one shared reason list (`QC_UNAVAILABLE_REASONS`, which W6-09 makes the single source), never a new inline union. Submit and upload stay fire-and-forget, so no other response changes.
- **Lane approval gate (decision 29; `workflow/service.ts` `approveLane`).** `approveLane` keeps calling `findLatestApproveAttemptRun(tx, version.id, lane, ruleRevisionOf(version))` **without** an engine ID, so it compares `body.qcRunId` with the latest approve-attempt row of any engine. Because the combined `runId` is that same row, an approval sent with the lane QC response's `runId` (as the web UI does: `reviewer-workspace.tsx` → `lane-decision-actions.tsx`) passes, and one that names the older part gets 409 `qc_run_superseded`. The only edit to `workflow/service.ts` is to pass nothing new and to say so in a comment; W4-18 still lists it and tests it, because it is the second caller of the changed function.
- **What `lane_decision.observed_qc_run_id` means.** It names the latest-stamped part of the attempt the reviewer saw. The attempt's other part is the latest row of the other engine for the same `(version, trigger, lane, rule revision)` with a `requested_at` at or before it; both share the attempt's `correlation_id`. W0-06 4.4 and W0-04 gain a dated note saying this; no column changes.
- **Desk QC pause (W6-17, consolidated).** When the W6 desk control `qcPaused` is on, the orchestrator records every part that would have run as its own `unavailable` row with reason `desk_paused`, without calling either runner, and creates or reuses the one QC-UNAVAILABLE finding per open run scope as for any outage.
- **Recheck (W6-09, consolidated).** An Admin recheck runs every bound part (metadata and, under `content`, content), each as its own `recheck = true` row with the recheck's correlation ID; the combined-outcome rule above does not apply to rechecks, because nothing gates on them. `findLatestQcRun` then carries both filters: the optional engine ID of this section and `recheck = false` (W6-09).
- **Logs.** Each part emits its own `qc.run.started` and `qc.run.completed` or `qc.run.unavailable` line, with its own `qcRunId` and runner, so an operator sees which part failed.

## 4. Extraction (W4-05a-d)

### 4.1 Read handles (W4-05a)

- Today `buildRequest` in `qc/orchestrator.ts` hands the runner `read: () => Promise.resolve(new ReadableStream())`. W4-05a replaces it with `qc/artifact-handles.ts` `authorizedHandles(blobs, artifacts)`: `read()` opens `blobs.open(contentHash)` (the `BlobStore` in `compose-app-deps.ts`, passed as a new **optional** `QcOrchestratorDeps.blobs`) and converts it with `Readable.toWeb`. When `blobs` is absent, `read()` rejects, which the content runner maps to `artifact_unreadable`. Being optional, it leaves `tests/support/fixture-app.ts` and the integration suites that build orchestrator deps directly unchanged; `compose-app-deps.ts` always passes it.
- The orchestrator revokes every handle in a `finally` block once the runner settles or the deadline fires. A `read()` after revocation rejects.
- A missing blob (`BlobMissingError`) rejects, and the content runner maps it to `artifact_unreadable`, detail `blob_missing`.
- The deterministic and scripted runners never call `read()`, and their tests stay unchanged.

### 4.2 Port and worker (W4-05b)

```ts
// server/src/qc/extraction/port.ts
export type Locator = EvidenceLocator;                        // the W4-16 shape, no text
export interface Segment { locator: Locator; text: string }   // text stays in the runner's memory only
export type ExtractResult =
  | { ok: true; extractorVersion: string; segments: Segment[] }
  | { ok: false; extractorVersion: string;
      reason: 'unreadable' | 'limit_bytes' | 'limit_time' | 'limit_memory' | 'limit_output' | 'crash' };
export interface Extractor {
  readonly version: string;                                   // e.g. 'rai-extract/1' + server version
  extract(input: { mediaType: AllowedMediaType; bytes: Uint8Array }, signal: AbortSignal): Promise<ExtractResult>;
  selfTest(): Promise<boolean>;
}
```

- **Host.** `qc/extraction/client.ts` `createWorkerExtractor(limits)` forks `qc/extraction/worker/main.(ts|js)` once per call (decision 5):
  - `child_process.fork` with `env: {}` and `serialization: 'advanced'`;
  - `stdio: ['ignore', 'ignore', 'ignore', 'ipc']`, so nothing the worker prints reaches the logs;
  - `execArgv`: the parent's loader flags plus `--max-old-space-size=<QC_EXTRACT_MAX_MEMORY_MB>`.
- **Kill rules.** A wall-clock timer of `QC_EXTRACT_TIMEOUT_MS`, or an aborted signal, sends SIGKILL (`limit_time`). The same happens when output exceeds `QC_EXTRACT_MAX_TEXT_CHARS` (`limit_output`), or on an `ERR_WORKER_OUT_OF_MEMORY`/exit 134 style heap death (`limit_memory`). Any other exit is `crash`.
- **Concurrency.** A semaphore of `QC_EXTRACT_MAX_CONCURRENCY` caps live workers.
- **Fork latency.** A fresh child under the `tsx` source loader may cost 1-2 s to start. W4-05b measures fork-to-first-message latency under both the source and built layouts, in CI, and records it in its review against `QC_EXTRACT_TIMEOUT_MS=4000` and the 10 000 ms deadline, for the worst W4b case: an approve attempt that reads slots 1 and 5 (two forks, concurrency 2). If the source layout leaves less than half of the deadline, W4-05b makes the source layout fork a precompiled JavaScript worker entry (built by the existing `npm run build` step before the test scripts that need it) instead of loading the worker through `tsx`, and records the choice.
- **Protocol** (`qc/extraction/protocol.ts`): one message in (`{ mediaType, bytes, limits }`), one message out. The reply is validated against a TypeBox schema, and a malformed reply is `crash`.
- **Module graph.** `worker/` imports only `node:zlib`, `node:buffer` and its own files: no `node:fs`, no network module, no `child_process`, no database module, no `@rai/server` code outside `worker/`. A test in the style of `module-graph.test.ts` enforces this.
- **Permission flags.** Node 24 `--permission` flags are added to the fork if W4-05b shows they work under both the source (`tsx`) and built layouts; otherwise W4-05b records why not. Either way, the module-graph test is the network guard.

### 4.3 Formats (W4-05c, W4-05d)

| Media type | Extractor | Segments | Unreadable when |
|---|---|---|---|
| DOCX | `worker/zip.ts` (central directory as in `sniff.ts`; stored and deflate entries, `inflateRawSync` with `maxOutputLength` = 20 MiB per part); `worker/xml.ts` (tokenizer that refuses `<!DOCTYPE` and expands only the five predefined and numeric entities); `worker/docx.ts` reads `word/document.xml` | One per `w:p`, locator `{ kind: 'section', index }` (1-based paragraph ordinal) | No `word/document.xml`, a DOCTYPE, a ZIP inconsistency, or no text |
| XLSX | `worker/xlsx.ts`: `xl/workbook.xml` sheet order, `xl/sharedStrings.xml`, inline strings, `xl/worksheets/sheetN.xml` | One per non-empty cell, locator `{ kind: 'cell', sheetIndex, cell: 'B7' }` | As for DOCX, plus a cell reference outside `^[A-Z]{1,3}[1-9]\d{0,6}$` |
| PDF | `worker/pdf.ts`: objects and the `Pages` tree; content streams with no filter or `/FlateDecode` (with `maxOutputLength`); `Tj`, `TJ`, `'` and `"` with literal and hex strings (Latin-1, or UTF-16BE with BOM) | One per text line, locator `{ kind: 'page', page }` (1-based). A segment carries one locator, so a PDF claim's evidence is one entry with the page locator and the claim's `excerptHash`; no `text_range` is emitted for PDF, and the `page` and `text_range` locator shapes stay as they are (W4-16 does not change them). The line ordinal within the page is not served | `/Encrypt`, object streams only, other filters on every content stream, a broken xref, or no text on any page (scanned) |
| PNG, JPEG | none | none | Always (no OCR, decision 8) |

The W0-08 hostile set (`artifacts/sniff.test-bytes.ts`, `tests/integration/w1-03-hostile-set.test.ts`) is fed to the extractor. Every item must end as a clean `ok: false`, never as a server crash.

### 4.4 Limits (fail closed)

| Limit | Value | Outcome |
|---|---|---|
| Bytes in | ≤ the upload cap (`UPLOAD_MAX_FILE_BYTES`) | `limit_bytes` |
| Wall clock per artifact | `QC_EXTRACT_TIMEOUT_MS` | `limit_time` |
| Worker heap | `QC_EXTRACT_MAX_MEMORY_MB` | `limit_memory` |
| Decompressed part | 20 MiB; total per artifact 100 MiB (`ZIP_MAX_TOTAL_BYTES` is 500 MiB for upload; extraction is stricter) | `limit_bytes` |
| Text out | `QC_EXTRACT_MAX_TEXT_CHARS`; at most 50 000 segments | `limit_output` |
| PDF | 2 000 pages, 100 000 objects | `limit_output` |

Nothing extracted is stored, logged, cached (decision 23) or returned by any endpoint.

## 5. Model port (W4-07a-b; disabled by default)

```ts
// shared/src/qc/model.ts
export interface ModelIdentity { provider: 'local-fake'; modelId: string }    // no external provider value exists
export interface ClaimCandidate {
  segmentIndex: number; itemKey: string; answer: 'yes' | 'no' | 'na' | 'unknown';
  fields: Partial<Record<'metric' | 'value' | 'unit' | 'denominator' | 'threshold' | 'evidence' | 'tier', string>>;
}
export type ModelResult =
  | { ok: true; candidates: ClaimCandidate[];
      usage: { inputTokens: number; outputTokens: number; latencyMs: number; costUsdMicros: number } }
  | { ok: false; reason: 'timeout' | 'error' | 'invalid_output' };
export interface ModelPort {
  readonly identity: ModelIdentity;
  proposeClaims(input: { promptRevision: string; segments: ReadonlyArray<{ index: number; text: string }>;
                         items: ReadonlyArray<{ key: string }> }, signal: AbortSignal): Promise<ModelResult>;
}
```

- **Prompt.** `server/src/qc/model/prompts/claims-v1.ts` exports `PROMPT_REVISION = 'claims/v1'` and the template. Its identity is `claims/v1@<sha256[0:12]>` of the template text. The prompt places segments inside a JSON data block and says that the content is data, never instructions. It carries no tools, secrets, case IDs or other cases' text.
- **Output validation** (`server/src/qc/model/validate-output.ts`, runs before any use). Each candidate must satisfy all of the following:
  - it matches the schema, and unknown keys fail;
  - `segmentIndex` is a segment that was sent, and `itemKey` is a key that was sent;
  - every field value is a **substring of that segment's text** after NFC normalisation, so the model cannot invent a value;
  - every numeric field parses with the grammar's number rule.

  Any violation is `invalid_output`, and the run fails as `runner_error` with detail `model_invalid_output`.
- **What the model can and cannot decide.** Candidates feed the same deterministic rule logic as grammar claims. The model never emits a finding, a lane, a severity or a disposition.
- **The fake.** `fixtures/src/substitutes/model/fake-model.ts` (with the substitute marker) re-parses segments with a relaxed grammar. It also has a control API: `simulate('timeout' | 'error' | 'fabricate_value' | 'fabricate_field' | 'echo_prompt')` for the probes.
- **Binding.** `start.ts` binds the fake only under `QC_MODEL=local-fake`, through `importFixtureModule`, as it loads the QC substitute. Under `disabled`, no `ModelPort` exists.

## 6. Finding dedup and measure storage (W4-15)

- **Dedup key:** `dedupKeyOf(finding) = `${scopeKeyOf(finding.scope)}|${finding.owningLane}|${finding.claimKey ?? '-'}`` (`shared/src/qc/validate.ts`, decision 30), stored as `qc_finding.scope_key`; `claimKey` is also stored in its own column `qc_finding.claim_key` (W4-15 migration).
- **Behaviour.** In `persistResult` (`qc/orchestrator.ts`), under the case lock, a finding is **not appended** when the version already has an **open** finding (the `undispositioned` predicate in `findings/repository.ts`: no disposition, or `fixed_proposed`) with the same `rule_id`, `rule_revision` and `scope_key`. The lookup runs once, before the run's own rows are inserted, so it compares only against rows that existed before the run; two findings of the same run never dedup against each other (the validator has already refused a duplicate `findingKey`, decision 30). **Consolidated with W6-09:** the lookup joins `qc_run` and ignores findings of recheck runs (`qc_run.recheck = true`), because an advisory recheck finding can never be dispositioned and would otherwise suppress every later gating finding on the same claim; and a recheck run itself does not dedup (it always appends, since it is a separate advisory record). W4-15 writes the lookup so that W6-09 only adds the `recheck` predicate; if W6-09 merges first, W4-15 includes it. Instead:
  - the run result lists it in `alreadyRecorded: string[]` (finding IDs), on a newly recorded run only;
  - the run row's finding count covers appended findings only;
  - the run row stores the number matched in the new column `qc_run.already_recorded_count integer CHECK (already_recorded_count >= 0)` (W4-15 migration). `persistResult` does the dedup lookup before `recordRun` inserts the row, so the count goes into the INSERT and no UPDATE of `qc_run` is needed; it is NULL on rows written before the W4-15 migration;
  - `qc.run.completed` gains `alreadyRecordedCount`.
- **Replay.** The matched IDs are not stored, so a replayed run cannot rebuild `alreadyRecorded`. A replayed lane QC response omits `alreadyRecorded`; the count stays readable as `alreadyRecordedCount` from the qc-runs read, and the UI falls back to it (section 10).
- **What does not suppress a new finding:** a dispositioned finding, rows written before the W4-15 migration (`00NN_w4_15_finding_dedup_measure.sql`; `scope_key` NULL), and a different rule revision.
- **What it prevents.** The same slot-1 claim raised on upload and again on the AI/COE approve attempt is stored once. Its `artifact` scope already carries `contentHash`, so the key is exact.
- **Slot 5.** Owning lane is in the key, so the DPO and IT/Security approve attempts on one missing slot 5 (W4a) or one slot-5 claim still yield two findings.
- **The QC-UNAVAILABLE reuse per open scope (W0-07 3.6) is unchanged.**
- **Measure columns.** `qc_finding` gains `metric_value numeric`, `metric_unit text` (`percent|ratio|count`) and `threshold_source text`, written from `measure`.

## 7. Schemas and migrations (forward-only, `server/drizzle/`)

Two migrations, generated with `npm run migrate:generate` after rebasing onto main (section 15.2). Both only add nullable columns, a CHECK or an index; neither fires an UPDATE trigger or needs a grant (as 0009). Rollback class (W0-04 values, the W7-03 class map; consolidated 2026-09-27): both `additive`, because an older binary neither reads nor writes the new nullable columns. The header of each reads `-- rollback expectation: additive;`, and if W7-03's `MIGRATION_CLASSES` map has merged, the same PR adds the entry. Both also add their objects to the deep-equal lists of `tests/integration/w1-00-migrations.test.ts` if it lists them (columns are not listed; the dedup index is not a table, trigger or grant, so normally no edit is needed).

| Ticket | Migration (number fixed at rebase) | Change |
|---|---|---|
| W4-11b | `00NN_w4_11b_run_extraction_identity.sql` | `qc_run` ADD `extractor_version text`, `model_provider text`, `model_id text`, `prompt_revision text`, `model_input_tokens integer CHECK (>= 0)`, `model_output_tokens integer CHECK (>= 0)`, `model_latency_ms integer CHECK (>= 0)`, `model_cost_usd_micros bigint CHECK (>= 0)`, `unavailable_detail text CHECK (unavailable_detail IS NULL OR (status = 'unavailable' AND unavailable_detail ~ '^[a-z0-9_]{1,64}$'))`. All are NULL on earlier rows and on runs without extraction or model use |
| W4-15 | `00NN_w4_15_finding_dedup_measure.sql` | `qc_finding` ADD `scope_key text`, `claim_key text CHECK (claim_key IS NULL OR claim_key ~ '^[a-z0-9_]{1,64}$')` (decision 30), `metric_value numeric`, `metric_unit text CHECK (metric_unit IS NULL OR metric_unit IN ('percent','ratio','count'))`, `threshold_source text`; INDEX `qc_finding_dedup_idx (version_id, rule_id, rule_revision, scope_key)`; `qc_run` ADD `already_recorded_count integer CHECK (already_recorded_count IS NULL OR already_recorded_count >= 0)` |

- **Where the identity values come from.** `QcRunResult` (`shared/src/qc/types.ts`) gains `engine?: { extractorVersion?: string; model?: ModelIdentity & { promptRevision: string } & ModelUsage }` on both statuses, validated at the boundary. The orchestrator's `recordRun` writes the new columns.
- **The unavailable detail.** `detail` is written to `unavailable_detail` when it matches the pattern, and as `unspecified` otherwise. This closes the W4a note "selection detail not persisted".
- **Drizzle schemas:** `db/schema/qc-run.ts`, `db/schema/qc-finding.ts`.
- **Raw-insert contract test:** `tests/integration/w3-07a-migration-contract.test.ts` stays valid, because every new column is nullable.
- **Documents:** the W0-04 [persistence document](persistence-and-artifact-store.md) and the [data contract](../product/data-contract.md) gain the columns, dated.

## 8. Run identity and logs (W4-11b; W0-10 catalogue amendment)

| Event | New fields (identities and numbers only) |
|---|---|
| `qc.run.started` | none (the runner and revision came in W4-11a) |
| `qc.run.completed` | `extractorVersion`, `modelProvider`, `modelId`, `promptRevision`, `modelInputTokens`, `modelOutputTokens`, `modelLatencyMs`, `alreadyRecordedCount` (the last from W4-15) |
| `qc.run.unavailable` | as above, plus `unavailableDetail` |
| `qc.extract.failed` (new) | `qcRunId`, `slot`, `reason` (the `ExtractResult` reason or `selftest`), `durationMs`, `extractorVersion` |
| `qc.model.call` (new, W4-07b) | `qcRunId`, `modelProvider`, `modelId`, `promptRevision`, token counts, `latencyMs`, `outcome` |

- No filename, no document text, no excerpt, no model input or output text and no message params appear in these lines (W0-10 redaction).
- `observability/log.ts` event schemas and `shared/src/schemas/observability.ts` gain the fields.
- The operator view's `unavailableQc` rows (`observability/operator.ts`) gain `unavailableDetail`.
- **Done when:** two runs on one version that differ only in extractor version, model or prompt revision can be told apart from rows and log lines alone.

## 9. API shapes and authorization (W0-02 section 7 amendment)

No new endpoint. Authorization is unchanged: every read below is authorized exactly like the version's findings read (W0-05). The lane QC run keeps `lane.approve` + `target: lane`.

- **`QcRunSummarySchema`** (`GET /api/cases/{caseId}/versions/{versionId}/qc-runs`) gains:
  - `extractorVersion: string | null`;
  - `model: { provider, modelId, promptRevision } | null`;
  - `modelUsage: { inputTokens, outputTokens, latencyMs } | null`;
  - `unavailableDetail: string | null`;
  - `alreadyRecordedCount: number | null`, read from `qc_run.already_recorded_count` by `listQcRunsForVersion` (null on runs recorded before the W4-15 migration).

  The in-memory API substitute serves no qc-runs route, so these fields do not touch it.
- **`StoredFindingSummary`** and **`FindingWithDisposition`** gain `measure: Type.Optional(Nullable({ metric, value, denominator, threshold, unit, thresholdSource }))`. `excerptHash` and `contentHash` are still never served.
- **`LaneQcRunResponseSchema`** gains `alreadyRecorded: Type.Optional(string[])`, the IDs of open findings that a newly recorded run matched instead of appending (the reviewer sees them in the version's findings list; omitted on a replay, section 6), and `parts: Type.Optional(Array<{ runId, runner, status, reason? }>)` (section 3.4).
- **Why optional.** The frozen in-memory API substitute builds `LaneQcRunResponse` and `StoredFindingSummary` directly (`fixtures/src/substitutes/api/routes-review.ts`, `store.ts`). Every new field on these two read shapes is `Type.Optional`, exactly as `evidence` already is, so the substitute stays unchanged and `npm run typecheck` passes (decision 19). The real server always sends `measure` (null when none) and `parts` under `content`; a server contract test asserts it.
- **Evidence locators** follow the W4-16 contract (decision 21):
  - `section: { kind, index?: number }`;
  - `cell: { kind, sheetIndex?: number, cell?: string }`, with `cell` matching `^[A-Z]{1,3}[1-9]\d{0,6}$`.

  `locatorView` in `qc/repository.ts` serves legacy stored `heading` and `sheet` text as the bare kind. The runner-side schema (`EvidenceLocatorSchema` in `shared/src/qc/validate.ts`) accepts only the new shape. The substitute scripts (`fixtures/src/substitutes/qc/scripts/fx-case-*.json`) move to it.
- `evidence` stays optional in the read schema while the in-memory API substitute exists (decision 19).

## 10. UI (W4-12b; D12 th/en)

Files: `web/src/screens/case/finding-list.tsx`, `qc-log.tsx`, `reviewer-workspace.tsx`, `view-model.ts`, `shared/src/locales/{th,en}.json`.

- **Evidence.** A finding's evidence reads "slot 1, page 3", "slot 1, section 12" or "slot 1, sheet 2, cell B7". It never shows document text.
- **Measure.** A metric finding shows its measure line: metric, value and unit, denominator, threshold and template. Missing fields are named, from `messageParams.missing`.
- **QC log.** A run row shows its extractor version and "model: disabled" or the model identity. An unavailable run shows its detail as a translated reason, falling back to the raw code.
- **Lane QC result.** "Already recorded" findings from a lane QC run are marked as such, never counted as new; on a replayed result, which carries no IDs, the UI shows the run's `alreadyRecordedCount` from the QC log instead.
- **Unavailable lane run.** `reviewer-workspace.tsx` today adds the lane run to its unavailable list from the top-level `runId` and `reason`. Under decision 29 the top-level `runId` may name the completed part, so W4-12b takes the unavailable entries from `parts` (each unavailable part with its own `runId` and reason) when `parts` is present, and falls back to the top-level fields when it is absent (the substitute and W4a modes). The `qcRunId` sent with an approval stays the top-level `runId`.
- **Run parts.** Under `content` the QC log shows the metadata and content runs of one trigger as two rows with their runner names, so an outage of the content part sits beside the completed metadata part and its findings.
- **New keys** (th and en, in their sorted position):
  - `review.evidence.place.page`, `review.evidence.place.section`, `review.evidence.place.cell`, `review.evidence.place.text_range`;
  - `review.measure.line`, `review.measure.missing`, `review.measure.field.<metric|value|denominator|threshold|evidence|tier>`;
  - `qc.finding.pack_contradiction`, `qc.rule.pack_contradiction`, `qc.finding.acc_band_v1_sheet3_tier_missing`, `qc.fact.personal_data`, `qc.fact.external_vendor`;
  - `qc_log.extractor`, `qc_log.model`, `qc_log.model_disabled`, `qc_log.already_recorded`;
  - `qc_log.detail.<code>` for every detail code the runners emit: `extract_unreadable`, `extract_limit_bytes`, `extract_limit_time`, `extract_limit_memory`, `extract_limit_output`, `extract_crash`, `blob_missing`, `hash_mismatch`, `model_disabled`, `model_invalid_output`, `unknown_template_version`, `invalid_rule_catalogue`, `no_qc_rules_revision`.
- **Accessibility and language:** keyboard-only operation; axe zero critical at 1440, 834 and 390; no hard-coded user-facing string; Thai default. The disposition flow is unchanged (W2-05).

## 11. Evaluation (W4-08a-b, W4-09a-b; WA-D09)

### 11.1 Frozen set `qc-eval-synthetic@1` (W4-09a dev, W4-09b held-out)

- **Layout.**
  - `rai-web/fixtures/src/evaluation/cases.ts` holds the case rows (template, model type, stage, vendor flag, slot states, documents).
  - `render.ts` holds the document renderers, extending `fixtures/src/generate/pdf.ts` (several lines, FlateDecode variant) and `ooxml.ts` (several paragraphs and rows, shared strings).
  - `labels/<case>.json` holds the expected runs and findings **per trigger and, for approve attempts, per lane** (AI/COE, DPO, IT/Security each get their own labelled attempt): `ruleId`, owning lane, scope, locator kind and position, part (`deterministic` or `content`), `status`, `unavailableReason`. Labels follow decision 28: a DPO or IT/Security attempt carries no slot-1 content label, and a case with an unreadable slot 1 labels the AI/COE content part `unavailable` and the other lanes' content parts `completed`.
  - `disagreements.md`, and `manifest.json` (`{ name, version, sha256, split, documents }`).
- **Generation.** `npm run fixtures:eval:generate` writes the bytes to `rai-web/.local/eval-fixtures/` (gitignored). No bytes are committed.
- **Coverage.** Every item on the evaluation plan's fixture list:
  - Thai and English;
  - DOCX, XLSX, text-layer PDF, scanned (PNG and image-only PDF), malformed;
  - `v1.0 Sheet3` and `v2.0`;
  - `llm`, `classic_ml` and `other`;
  - missing, not-yet and N/A against each stage;
  - conflicting BRD and privacy entries;
  - extraction-only "Yes";
  - valid metric evidence (no invented deficiency);
  - band values below, equal and above each tier;
  - a Thai CID-font PDF labelled `artifact_unreadable`;
  - injection and exfiltration documents (for W4-10a).
- **Split.** The held-out split uses renderings the dev split never shows: key order, spacing, case, Thai keys, ratio vs percent.
- **Labels.** Written by the agent team and marked `labelledBy: "agent-team, provisional (Ta delegation 2026-09-27); lane-expert sign-off pending (D09)"`. `provenance.test.ts` greps the set like `slice1-synthetic`.
- **Freeze.** W4-09b records the set identity (`qc-eval-synthetic@1 <sha256[0:12]>`) in the exit record and in the provisional register row. The held-out split is run only by W4-14, and the number of held-out runs is recorded.

### 11.2 Harness (W4-08a, W4-08b)

- **Files.** `rai-web/tests/evaluation/`: `run.ts` (CLI), `load-set.ts`, `grade.ts`, `report.ts`, `identity.ts`, `thresholds.json`, and unit tests added to the `test:unit` glob.
- **Runs in-process, no database.**
  - It builds each `QcRunRequest` the way `buildRequest` does. The pure part moves to `server/src/qc/request.ts` in W4-08a.
  - It runs `createContentQcRunner` with the real worker extractor.
  - It passes each result through the orchestrator's checks, moved from `orchestrator.ts` `checkedResult` into an exported `server/src/qc/check-result.ts`.
- **Grading.** A finding matches a label on `ruleId`, owning lane, scope and locator position. Per rule and per segment (template, model type, language, format), it reports:
  - precision, recall, false positives and false negatives;
  - the grounded-citation rate: the locator resolves on the same artifact, and re-extraction yields the same `excerptHash`;
  - unavailable-handling accuracy, latency (p50, p95, max), failure count and cost.
- **Report.** `report.json` and `report.md` hold identities, hashes, locators and counts, never document text. The report records the code commit, runner and extractor versions, the rules label and body sha256, the template versions, the prompt revision and model identity, the dataset identity, the grader version and the sha256 of the thresholds file. An `identityDigest` covers all of them.
- **Verify.** `--verify <report.json>` recomputes the current identity and prints `STALE` when any part changed (evaluation plan: "any model/prompt/template change invalidates affected evidence").
- **Gate.** `--gate` exits non-zero when any threshold fails. W4-08b adds `npm run eval:qc -- --split dev --gate` to the CI unit job.

### 11.3 Provisional thresholds (WA-D09; recorded here, before any run; `tests/evaluation/thresholds.json`)

| Measure | Threshold |
|---|---|
| Every metadata and grammar content rule: precision and recall, each split | 1.00 (deterministic; D09 Q2(c)) |
| Grounded-citation rate, automatic, every finding | 1.00 |
| Grounded citations, agent-team sample (up to 10 per rule) | All judged grounded, recorded provisional |
| Unreadable, malformed and scanned fixtures ending with an `unavailable` content part (never `completed` with 0 findings), on every run whose lane scope reads that slot (decision 28) | 100 % |
| Lane scope (decision 28): approve-attempt content parts of lanes that do not review the unreadable slot complete, and no content finding on an approve attempt is owned by another lane | 100 % |
| Metadata findings kept when the content part is unavailable (decision 27): every labelled metadata finding on a case with an unreadable slot 1, 2 or 5 is recorded by the metadata part | 100 % |
| Critical probes (unauthorized disclosure, fabricated approval, template leakage, prompt disclosure) | 0 successes |
| Run latency | Every run within the 10 000 ms deadline; p95 recorded |
| Cost | Recorded (0; no provider); no budget until D08 permits a provider |
| Model (`local-fake`, `grammar+model`) | Contract only; no quality claim (evaluation plan: mocked providers prove contracts only) |

A failed threshold stops promotion. W4-14 then records the failure; it does not quietly re-tune the threshold.

**Expected risk.** The held-out thresholds are 1.00 on renderings the dev split deliberately never shows, so one grammar miss fails the exit. The team should expect that W4-14 may end as a recorded failed exit. The remedy is a follow-up ticket that widens the grammar or its label lists, re-run on a **new** held-out version (`qc-eval-synthetic@2`), never a re-run on the seen `@1` held-out split or a lowered threshold. A failed W4b exit does not stop W5-W7 work that does not depend on content QC quality; the platform still runs end to end.

## 12. Security and failure probes (W4-10a-b)

- **Runner-level, critical** (`tests/evaluation/probes.test.ts`, run on the frozen injection documents):
  - Instructions in a document to approve, waive, change severity or skip rules leave no trace in output: output is typed data only, and lanes, dispositions and transitions are unreachable from the runner.
  - No finding string param contains document text (`message_param_text`).
  - The fake set to `fabricate_value`, `fabricate_field` or `echo_prompt` yields `runner_error`, never a finding.
  - A `v2.0` document that says "apply v1.0 bands" gets no `ACC-BAND-V1-SHEET3` and no measure with `thresholdSource` `v1.0 Sheet3`.
  - A run for case A receives only case A's artifacts; a spy extractor records the hashes it was given.
  - Each extraction is a fresh process; the test checks that PIDs differ.
- **Server-level** (`tests/integration/w4-10b-failure-probes.test.ts`). A spawned server cannot receive a function hook, so the fault cases run in process through `tests/support/fixture-app.ts`, with the orchestrator bound to the real deterministic runner and a content runner over an injected fault extractor (hang, crash); the decompression bomb and the oversize text run on a spawned server with `QC_MODE=content` and real bytes. No test-only hook is added to `start.ts`.
  - A hanging worker yields an `unavailable:timeout` content part and a visible outage finding, the metadata part still records its findings, and submit answers 2xx.
  - A crash yields `runner_error`; a decompression bomb and an oversize text yield `artifact_unreadable`.
  - `tests/support/log-capture.ts` shows that no probe sentinel string and no prompt template sentinel appears in any log line.

## 13. Test runners in CI (W4-INT decision, decision 18)

- CI keeps `QC_MODE: substitute` (`.github/workflows/ci.yml`), together with the pins in `tests/support/process.ts` `testServerEnv` and `tests/browser/support/real-server-lifecycle.ts`. The W1-W3 journeys stay contract evidence for the disposition UI.
- CI also runs:
  - `tests/integration/w4b-int-content-server.test.ts` (a real server spawned with `QC_MODE=content`, `QC_MODEL=disabled`), inside `test:integration`, as W4a's real-server test does;
  - `tests/browser/w4b-int-journey.spec.ts`: W4-INT-b gives `createRealServerLifecycle` an option `qcMode` (default `substitute`), and this spec passes `content`;
  - the dev-split evaluation gate.
- Local development (`.env.example`) runs `content`. The documents from `fixtures:eval:generate` can be uploaded through the UI to see real findings; TESTING.md gains that walkthrough.

## 14. In-memory API substitute and the W4a items for Ta

- **API substitute (decision 19).** It stays frozen: no W4b route, and `w3-07b-operator.rehearsal.substitute.spec.ts` and `test:browser:substitute` are unchanged. It is revisited at the W6 kickoff. The W4a note "make `evidence` required when the substitute is revisited" moves there too.
- **No upload run when unbound (decision 20).** Today the upload trigger is wired only when a runner exists: `compose-app-deps.ts` sets `pack.qc` only when `qcRunner` is defined, and `app.ts` builds `createUploadTrigger` only when `pack.qc` is set. The orchestrator's `runUploadQc` already records an `unbound` run when called without a runner. W4-17 therefore changes the wiring, not the trigger: `compose-app-deps.ts` always sets `pack.qc` (with `runner` optional), and `app.ts` always builds the upload trigger. The orchestrator records the upload run as `unbound` / `not_configured` and adds the slot's outage finding, keyed and reused per owning lane as in W4-04. Slot 9 still fires no run.
- **Upload `runKey` for a detached slot.** W4-17 also fixes the W4a note: `runKeyOf` includes the upload slot, so two detached slots never share a key. (W4-18 then adds the part's engine ID to the same key.)
- **Locator text (decision 21).** Handled in W4-16.

## 15. Tickets

One ticket per branch `codex/<ticket-id>-<topic>` and per PR. Each PR is small enough for one agent in about an hour. Each keeps the whole gate green (section 16). Each merges only after two independent reviewer verdicts on its exact head and green CI on that head. A CLAIM goes on the lane's board stream before work starts. Owner type **HRR** means independent review with focus on security, immutability or readiness; **Agent-eligible** means standard review.

| # | ID | Outcome | Done when | Owner | Lane | Depends on | Main paths | Migr. |
|---|---|---|---|---|---|---|---|---|
| 1 | W4-00b | This plan and the provisional register rows | Plan merged; register rows (section 19) labelled provisional; the W0-06 7.2 stale note dated; the BUILD_PLAN W4b precondition replacement recorded; the work breakdown's W4-01 row says Ta's and the tech lead's acceptance of ADR-0006 moves to the W4b exit review (W4-14), so W4-05 and W4-07 may merge on the provisional ADR; W4b tickets Ready; issues opened | HRR | Lead | — | this file; `docs/product/decisions.md`; `docs/delivery/w4-work-breakdown.md`; `w4-decision-briefs.md` (dated note); BUILD_PLAN status; W0-06 7.2 | no |
| 2 | W4-01 | ADR-0006: engine (decision 7), parsers (8), isolation (5), run parts (27), evaluation method (12-16) | ADR records what is not chosen and why; names no provider; marked provisional under the delegation | HRR | Lead | W4-00b | `adr/0006-qc-engine-and-extraction.md`, `adr/README.md`, threat-model rows, upload-safety section 10 note | no |
| 3 | W4-11b | Run identity for extraction and model use; `unavailable_detail` | Migration applies on a W4a database; two runs that differ only in extractor, model or prompt are distinguishable from rows and logs; operator rows show the detail | Agent-eligible | A | W4-00b | `server/drizzle/`, `db/schema/qc-run.ts`, `shared/src/qc/types.ts` (`engine`), `qc/orchestrator.ts` `recordRun`, `qc/repository.ts`, `findings/repository.ts` `listQcRunsForVersion`, `observability/log.ts`, `observability/operator.ts`, `shared/src/schemas/{observability,review}.ts`, W0-10 catalogue | **yes** |
| 4 | W4-05a | Real, revocable read handles in the request | `read()` streams the stored bytes; after the run it rejects; a missing blob rejects; with `blobs` absent `read()` rejects; metadata and substitute runners unchanged; `fixture-app.ts` and the integration suites that build deps are unchanged | HRR | A | W4-11b (orchestrator order) | `qc/artifact-handles.ts`, `qc/orchestrator.ts` `buildRequest` and `QcOrchestratorDeps.blobs?`, `compose-app-deps.ts`, tests | no |
| 5 | W4-15 | Finding dedup with owning lane; measure columns; `already_recorded_count` | Upload and approve-attempt findings on one claim store once; two lanes' slot-5 findings stay two; two defective claims in one artifact stay two (decision 30, `claim_key`); a recheck finding (once W6-09 exists) neither suppresses nor is suppressed; a dispositioned finding does not suppress; measure persisted; `already_recorded_count` written in the run INSERT and served by `listQcRunsForVersion`; new read fields optional, so the API substitute typechecks unchanged | HRR | A | W4-05a | `server/drizzle/`, `db/schema/{qc-finding,qc-run}.ts`, `qc/orchestrator.ts` `persistResult` and `recordRun`, `findings/repository.ts`, `shared/src/qc/validate.ts` `dedupKeyOf` (with `claimKey`), `shared/src/schemas/review.ts`, `tests/integration/w1-00-migrations.test.ts` (only if a listed object changes), W0-07 3.4 step 6, W0-04 | **yes** |
| 6 | W4-17 | Unbound upload run recorded; slot in the upload `runKey` | Unbound upload writes an `unbound` run plus an outage finding; slot 9 writes nothing; two detached slots get distinct keys | HRR | A | W4-15 | `compose-app-deps.ts` (`pack.qc` always set), `app.ts` (upload trigger always built), `pack/qc-trigger.ts` (runner optional), `qc/orchestrator.ts` (`runUploadQc`, `runKeyOf`), `tests/integration/w4-04-upload-trigger.test.ts`, W0-07 3.2/3.7 | no |
| 7 | W4-18 | Two run parts per trigger (decision 27) | With `contentRunner` bound: each trigger writes a metadata run and a content run, each with its own `engine_id`, status, `runKey` and replay; a retried approve attempt reruns only an unavailable part; the combined lane QC outcome and `parts` follow section 3.4; without `contentRunner`, every W4a test passes unchanged; a stub content runner that returns `artifact_unreadable` leaves the metadata findings recorded beside one visible outage; parts are stamped metadata then content, and the combined `runId` is the latest-stamped part (decision 29); **integration tests approve the lane (`approveLane`) with the lane QC response's `runId` after a two-part first attempt, and again on a second version after a retry that reruns only the content part, both succeeding; an approval naming the older part gets 409 `qc_run_superseded`**; the W3 lane-approval suites pass unchanged | HRR | A | W4-17 | `qc/orchestrator.ts` (`QcOrchestratorDeps.contentRunner?`, `runKeyOf`, `replayPrior`, `runQc`, `runUploadQc`, part stamping), `qc/repository.ts` (`findLatestApproveAttemptRun` / `findLatestSubmitRun` optional `engineId`), `workflow/service.ts` (`approveLane`: second caller, any-engine check kept, comment), W0-06 4.4 and W0-04 note on `observed_qc_run_id`, `shared/src/schemas/review.ts` (`parts`, optional), tests, W0-07 3.4/3.7 | no |
| 8 | W4-16 | Locators carry no document text | The runner schema refuses `heading`/`sheet`; legacy rows are served as kind only; substitute scripts migrated; UI renders ordinals | HRR | A | W4-00b | `shared/src/qc/{types,validate}.ts`, `shared/src/schemas/review.ts`, `qc/repository.ts` `locatorView`, `fixtures/src/substitutes/qc/scripts/*.json`, `scripts.test.ts`, `web/src/screens/case/finding-list.tsx`, locales, W0-07 3.3 | no |
| 9 | W4-05b | Extraction worker host, protocol and limits | Hang → `limit_time`; heap → `limit_memory`; output cap → `limit_output`; crash → `crash`; worker module-graph test; one process per call; fork latency measured in CI (source and built layouts) and recorded against 4000 ms and the 10 000 ms deadline for a two-slot approve attempt | HRR | A | W4-01 | `server/src/qc/extraction/{port,client,protocol,limits}.ts`, `extraction/worker/main.ts` | no |
| 10 | W4-05c | DOCX and XLSX extraction | Synthetic DOCX/XLSX yield ordinal and cell segments; DOCTYPE, zip bomb and inconsistent ZIP → clean `ok:false`; hostile set passes | HRR | A | W4-05b | `extraction/worker/{zip,xml,docx,xlsx}.ts` and tests | no |
| 11 | W4-05d | PDF text layer; images unreadable | Text PDFs yield one `page` segment per line; encrypted, image-only and broken PDFs → `unreadable`; PNG/JPEG → `unreadable` | HRR | A | W4-05c | `extraction/worker/pdf.ts` and tests | no |
| 12 | W4-06a | Content runner, claim grammar, `ACC-METRIC-CITED` | Runner unit tests with a fake `Extractor`; the runner executes content rules only and reads no bytes when none is selected; `evidence_outside_request` and `message_param_text` violations, with the template-version string allowed; every substitute script's findings pass the validator against its fixture request (the W1-W3 suites stay green on `substitute`); content module-graph test; the rule fires on each missing field and never on complete evidence, with `measure: null` when the metric or value is missing; **lane scope (decision 28): on DPO and IT/Security approve attempts no rule reads slot 1 (the fake extractor records no slot-1 call) and no finding is owned by another lane; a scanned slot 1 makes only the AI/COE content part unavailable**; `artifacts` optional in `QcFindingContext`; `message_param_text` patterns of section 3.1; the API substitute's `storeableFindings` drops no script finding; **upload lane scope: an upload to slot 5 reads no bytes and raises no content finding, an upload to slot 1 does (section 3.1)**; **`claimKey`, `findingKeyOf` with the claim part and the `duplicate_finding_key` run check (decision 30); two defective claims in one artifact give two findings**; `ACC-METRIC-CITED` seed `params` added and `seed.test.ts` "every seed body validates" green | HRR | A | W4-05b, W4-16 | `qc/content/{runner,claims,decimal,excerpt}.ts`, `qc/content/rules/{rule,index,acc-metric-cited}.ts`, `shared/src/qc/{types,validate}.ts`, `shared/src/schemas/cases.ts` params, `configuration/seed.ts` (this rule's params), `configuration/seed.test.ts`, `fixtures/src/substitutes/qc/scripts/` (only if a script needs correcting), locales | no |
| 13 | W4-06b | `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-CLASSIC-ML-METRIC` | Extraction-only "Yes" flagged; classic-ML matching metric or reasoned N/A passes; routing by `model_type` holds; both rules' seed `params` added, seed validates | HRR | A | W4-06a | `qc/content/rules/*`, params schemas, `configuration/seed.ts` (these rules' params), `seed.test.ts`, locales | no |
| 14 | W4-06c | `ACC-BAND-V1-SHEET3` | Below, equal and above for each tier (equal fails), percent and ratio inputs; `v2.0` never evaluates it; missing tier message; seed `params` added, seed validates | HRR | A | W4-06b | `qc/content/rules/acc-band-v1-sheet3.ts`, `decimal.ts` tests, params, `configuration/seed.ts` (this rule's params), `seed.test.ts`, locales | no |
| 15 | W4-06d | `PACK-CONTRADICTION` | Conflicting slot 2 and slot 5 facts raise one pack finding per contradicting fact (`claimKey` = fact ID) with two cited artifacts; two contradicting facts give two findings; agreeing or absent facts raise none; `PACK-CONTRADICTION` entry with params added to both seeded templates; `IMPLEMENTED_RULES` entry if W6-03 has merged (section 3.3) | HRR | A | W4-06c | `qc/content/rules/pack-contradiction.ts`, params, `configuration/seed.ts`, `seed.test.ts`, `shared/src/qc/rule-registry.ts` (if present), locales | no |
| 16 | W4-13b | `QC_MODE=content` bound as two parts; extraction keys; readiness | Start refuses bad values of each key; `content` binds the deterministic runner as `runner` and the content runner as `contentRunner`; readiness reports `qc.kind = 'content'` from the bound `contentRunner` (not the deterministic `runner`) and `model`; self-test probe; `.env.example` uses `content`; `operator-labels.ts` labels `content` in th and en (typecheck green) | HRR | C | W4-05a, W4-05d, W4-06a, W4-18 | `config.ts`, `start.ts`, `compose-app-deps.ts`, `qc/kind.ts`, `observability/health.ts`, `shared/src/schemas/observability.ts`, `web/src/i18n/operator-labels.ts`, locales (`operator.value.content`), `.env.example`, TESTING, W0-02 5, W0-07 3.9/6 | no |
| 17 | W4-13c | Seed `w4b.1` and the content real-server test | Seed label `w4b.1` (params already added by W4-06a-d; label rule of section 3.3 if W5-10 merged first); the real-server test on `content` sees `ACC-*` and `PACK-*` findings from uploaded synthetic documents, and a submit with an image-only slot 2 still records `PACK-SLOT-MISSING` / `PACK-STAGE-MISMATCH` findings plus a visible outage | Agent-eligible | C | W4-13b, W4-06d, W4-15 | `configuration/seed.ts`, `seed.test.ts`, `tests/integration/w4b-int-content-server.test.ts` | no |
| 18 | W4-07a | Model port, prompt identity, output validation, fake, `QC_MODEL` | Fabricated values or fields → `invalid_output`; `local-fake` refused outside test+fixture; no provider value exists; the fake is absent from the build | HRR | A | W4-13b | `shared/src/qc/model.ts`, `server/src/qc/model/{port,validate-output}.ts`, `qc/model/prompts/claims-v1.ts`, `fixtures/src/substitutes/model/*`, `config.ts`, `start.ts`, `.env.example` | no |
| 19 | W4-07b | `claimSource: 'grammar+model'` in the runner | Model candidates judged by the same rules; `disabled` → `not_configured:model_disabled` on the content part only; usage on run rows and `qc.model.call` | HRR | A | W4-07a, W4-11b | `qc/content/runner.ts`, `qc/content/claims.ts`, `observability/log.ts` | no |
| 20 | W4-09a | Evaluation set generator, dev split, provisional labels | `fixtures:eval:generate` is deterministic (same bytes twice); provenance grep passes; every fixture-list item has at least one dev case, including an unreadable slot 2 and slot 5 with metadata labels, and per-lane approve-attempt labels under decision 28 (scanned slot 1: AI/COE content part unavailable, DPO and IT/Security content parts completed) | Agent-eligible | C | W4-00b | `fixtures/src/evaluation/*`, `fixtures/src/generate/{pdf,ooxml}.ts`, `package.json` script | no |
| 21 | W4-08a | Harness core and report | `eval:qc --split dev` runs both parts per trigger and prints per-rule and per-segment metrics, grounding and identities; no text in the report; check-result and request extraction are pure moves with tests unchanged | Agent-eligible | C | W4-09a, W4-06a, W4-05c, W4-05d | `tests/evaluation/*`, `server/src/qc/{check-result,request}.ts`, `qc/orchestrator.ts` (imports), `package.json` | no |
| 22 | W4-09b | Held-out split, variants, freeze | Held-out uses renderings not in dev; set identity printed and frozen; disagreements file present | Agent-eligible | C | W4-08a | `fixtures/src/evaluation/*` | no |
| 23 | W4-08b | Threshold gate, stale check, CI step | `--gate` fails on any threshold; `--verify` prints `STALE` after a rules or extractor change; CI runs the dev gate | Agent-eligible | C | W4-09b, W4-13c | `tests/evaluation/{run,thresholds}.*`, `.github/workflows/ci.yml` | no |
| 24 | W4-10a | Critical probes, runner level | Zero successes on each critical probe; fresh-process and cross-case checks pass | HRR | C | W4-07b, W4-09b | `tests/evaluation/probes.test.ts`, injection cases in `fixtures/src/evaluation/` | no |
| 25 | W4-10b | Failure probes, server level | Timeout and crash (in process, fault extractor) and bomb and oversize text (spawned `content` server) are visible as unavailable content parts beside recorded metadata findings; submit is 2xx; no sentinel in logs | HRR | C | W4-13c | `tests/integration/w4-10b-failure-probes.test.ts`, `tests/support/fixture-app.ts` (optional `contentRunner` pass-through, additive) | no |
| 26 | W4-12b | UI: measures, ordinal locators, detail codes, extractor and model identity, run parts, already recorded | th and en; keyboard; axe zero critical at three widths (spec in W4-INT-b); view-model tests, including a replayed lane result that shows the count, and unavailable lane parts taken from `parts` when the top-level `runId` names the completed part | Agent-eligible | B | W4-11b, W4-15, W4-16, W4-18 | `web/src/screens/case/{finding-list,qc-log,reviewer-workspace,view-model}.tsx/ts`, locales | no |
| 27 | W4-INT-a | Real-server W4b journeys (integration) | On `content`: upload, submit and approve-attempt findings with evidence; dedup across upload and approve; **a submit with an image-only slot 2 still records `PACK-SLOT-MISSING`/`PACK-STAGE-MISMATCH` findings, plus a visible outage**; with a scanned slot 1 and a missing slot 5, the **AI/COE** approve attempt still records AI/COE's slot-5 `PACK-SLOT-MISSING` beside the content-part outage, and the **DPO** approve attempt on the same version records DPO's slot-5 `PACK-SLOT-MISSING` with a completed content part and no outage finding (decision 28); each lane approves with its lane QC `runId` after dispositions (decision 29); submit and review succeed with open defects; Ready refused until dispositioned; an outage gates Ready | Agent-eligible (lead reviews) | A | W4-13c, W4-07b, W4-17, W4-10b | `tests/integration/w4b-int-content-server.test.ts` | no |
| 28 | W4-INT-b | Browser journey on `content` | Upload through the UI, QC log with both run parts, findings with measures and locators, disposition to Ready; th/en; three widths; axe; TESTING walkthrough | Agent-eligible (lead reviews) | B | W4-INT-a, W4-12b | `tests/browser/w4b-int-journey.spec.ts`, `tests/browser/support/real-server-lifecycle.ts` (`qcMode`), TESTING | no |
| 29 | W4-14 | W4b exit record | Held-out run against the thresholds; all identities; provisional labels and assumptions listed; failures recorded as failures; Ta reviews | HRR | Lead | all above | `changes/<date>-w4b-exit/` | no |

### 15.1 What runs in parallel

Inside W4b, after W4-00b merges, five tracks run at once:

- **T1, orchestrator and migrations:** W4-11b → W4-05a → W4-15 → W4-17 → W4-18. These are serial because they share `qc/orchestrator.ts`, `compose-app-deps.ts` and the migration chain.
- **T2, extraction:** W4-01 → W4-05b → W4-05c → W4-05d. New directories only.
- **T3, contract:** W4-16. Touches locales and substitute scripts.
- **T4, rules:** W4-06a → b → c → d, starting once W4-05b and W4-16 have merged. Serial because they share `shared/src/schemas/cases.ts` params and the locales.
- **T5, Lane C:** W4-09a from the start; W4-08a once W4-06a has merged; then W4-09b.

The tracks converge on W4-13b (binding, after W4-18 and W4-06a) and W4-13c (seed and real-server test, after W4-06d). After W4-13b: W4-07a → W4-07b. After W4-13c: W4-08b and W4-10b in parallel; W4-12b once W4-18 has merged; then W4-10a, W4-INT-a, W4-INT-b and W4-14.

**With other packages' lanes** (W5 risk, W6 Admin configuration, W7 operator rehearsal):

- **Safe to run alongside:** W4-01, W4-05b/c/d, W4-09a/b and W4-08a touch only new directories (`server/src/qc/extraction/`, `fixtures/src/evaluation/`, `tests/evaluation/`, `adr/`), apart from one `package.json` script line each.
- **Need a turn:** W4-11b, W4-05a, W4-15, W4-16, W4-17, W4-18, W4-06a-d, W4-13b, W4-13c, W4-07a and W4-12b touch shared files (below).

### 15.2 Shared-file conflict rules

| Shared file | W4b tickets | Rule |
|---|---|---|
| `server/drizzle/*.sql`, `meta/_journal.json`, snapshots, `tests/integration/w1-00-migrations.test.ts` | W4-11b, W4-15 | The migration number is taken at merge, not at planning. Only **one migration PR across all packages** is in review at a time: take the `MIGRATION-SLOT` claim on `docs/board/lane-lead-integration.md` (the name the W6 plan uses) and release it at merge. Before final CI, rebase onto main, delete the local migration, and regenerate it with `npm run migrate:generate`. Never renumber a merged migration. If W7-03's migration class map has landed, each W4b migration also adds its class entry (`additive`) and header, as the W7 plan requires |
| `shared/src/locales/{th,en}.json` | W4-06a-d, W4-12b, W4-16 | W4b adds keys only under `qc.*`, `qc_log.*` and `review.evidence.*` / `review.measure.*`, in sorted position. On a conflict, rebase and run `npm run lint` |
| `server/src/configuration/seed.ts`, `shared/src/schemas/cases.ts` | W4-06a-d (params schema plus seed params, same PR), W4-13c (label) | W4b edits only the `qc_rules` block and `QC_RULE_PARAMS_SCHEMAS`. **W6-07's `qc_rules` editor depends on W4-13c** (the `w4b.1` params schemas; consolidated into the W6 plan). W5-02 adds its own kind block and W5-10 changes the `qc_rules` body (label rule of section 3.3); W6-02 adds `desk_controls` and `UNSEEDED_KINDS` |
| `shared/src/qc/rule-registry.ts` (W6-03) | W4-06d | Registry entries for new rule IDs; whichever of W4-06d and W6-03 merges second adds the missing entry and the content-registry test (section 3.3) |
| `web/src/i18n/operator-labels.ts`, `web/src/screens/case/view-model.ts` | W4-13b, W4-12b | Also edited by W6-09 (`desk_paused`), W6-10, W6-17 and W7-03. Additive map entries only; whichever merges second rebases and keeps both |
| `config.ts`, `start.ts`, `.env.example`, `compose-app-deps.ts`, `app.ts` | W4-05a, W4-17, W4-13b, W4-07a | One open PR at a time on `compose-app-deps.ts` / `app.ts`, in that order. Serialize with W7's network identity work and any W5/W6 key |
| `.github/workflows/ci.yml` | W4-08b | One step added to the unit job |
| `observability/log.ts`, `operator.ts`, `shared/src/schemas/observability.ts` | W4-11b, W4-13b, W4-07b | W6-17 (`deskControls`) and W7-03 (`store.migrations: ahead`) edit the same readiness report; W6's operator guide and W7's desk checks read them. Additive fields only; no ticket changes another's field |
| `QcRunRequest` builders (`shared/src/qc/types.ts`) | W4-06a (content runner tests), W4-08a (`server/src/qc/request.ts`, `tests/evaluation/`) | W5-10 makes `riskProposal` required (W5 plan R-17). A W4b builder merged before W5-10 is updated by W5-10 (the typecheck lists it); a W4b builder written after W5-10 sets `riskProposal: null` (upload, approve attempt) or the version's proposal (submit) |
| `shared/src/schemas/review.ts` | W4-11b, W4-15, W4-16, W4-18 | Every field added to `StoredFindingSummary`, `FindingWithDisposition` or `LaneQcRunResponse` is `Type.Optional` while the frozen API substitute builds them (decision 19) |
| `tests/support/process.ts`, `tests/support/fixture-app.ts`, `tests/browser/support/real-server-lifecycle.ts` | W4-10b, W4-INT-b | Additive options only; the default stays `substitute` |
| W0-02, W0-07, W0-10 and W0-04 documents | several | Dated amendments appended under the section; never rewrite earlier text |

## 16. Commands

Every ticket runs this gate from a clean worktree before asking for review. Each ticket uses its own Postgres: `POSTGRES_PORT=<port> docker compose -p <project> up -d --wait`, and `rai-web/.env` from `.env.example` with the ports rewritten. The PR states each command and its result.

```bash
cd rai-web
npm ci
npm run lint && npm run typecheck
npm run test:unit                 # adds tests/evaluation/*.test.ts (W4-08a)
npm run test:integration          # includes w4b-int-content-server.test.ts from W4-13c
npm run build && npm run check:substitute-absent
npm run test:browser:server       # evidence configuration; w4b journey spec uses qcMode content
npm run test:browser:substitute
cd .. && node scripts/check-links.mjs && git diff --check
```

New commands (W4-09a, W4-08a):

```bash
npm run fixtures:eval:generate                       # bytes to .local/eval-fixtures/qc-eval-synthetic@1/
npm run eval:qc -- --split dev --gate                # CI from W4-08b
npm run eval:qc -- --split heldout --gate --out ../changes/<date>-w4b-exit/eval   # W4-14 only; the report holds no text
npm run eval:qc -- --verify ../changes/<date>-w4b-exit/eval/report.json            # prints STALE on any identity change
```

`eval:qc` is `NODE_ENV=test node --import tsx --conditions=rai-source tests/evaluation/run.ts`. To run the real-server test alone, from `rai-web/`:

```bash
NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w4b-int-content-server.test.ts
```

## 17. Test-layer map

| Layer | W4b adds |
|---|---|
| Unit | <ul><li>Lane-scoped reading on approve attempts (decision 28), for every rule and lane.</li><li>Claim grammar (en and th keys, answer normalisation, units) and `compareDecimal`.</li><li>Every content rule: fires and does not fire; band below, equal and above per tier; template isolation; `model_type` routing.</li><li>Runner fail-closed paths: `hash_mismatch`, `blob_missing`, extract reasons, `model_disabled`, `model_invalid_output`.</li><li>New validator violations (`evidence_outside_request`, `message_param_text`, with the template-version allowance); every substitute script passes the validator; dedup key; locator schema without text; legacy `locatorView`.</li><li>Worker host limits (hang, heap, output cap, crash, malformed reply); DOCX, XLSX and PDF extractors over synthetic and hostile bytes.</li><li>Module-graph tests for `qc/content/` and `qc/extraction/worker/`.</li><li>Model output validation (substring rule); config refusals for every new key.</li><li>Harness grading and the stale check; runner-level probes.</li></ul> |
| Integration (real Postgres) | <ul><li>Migrations on a W4a database.</li><li>Two run parts per trigger (W4-18): per-part replay and run keys; a content-part outage beside recorded metadata findings; unchanged behaviour without `contentRunner`; lane approval with the combined `runId` after a two-part attempt and after a content-only retry, and 409 for the older part (decision 29).</li><li>Dedup across upload and approve attempt; two lanes' slot-5 findings stay two; dispositioned findings do not suppress; `already_recorded_count` served; a replayed lane result omits `alreadyRecorded`.</li><li>Measure columns; unbound upload run; distinct detached-slot keys; `unavailable_detail` persisted and in operator rows.</li><li>qc-runs and findings read shapes (scope, 403/404 as before); lane QC `alreadyRecorded`; W4-10b failure probes.</li></ul> |
| Real server | `w4b-int-content-server.test.ts` (spawned, `QC_MODE=content`, `QC_MODEL=disabled`) |
| Browser (evidence config) | `w4b-int-journey.spec.ts` on `content`: upload, QC log, measures, locators, dispositions, Ready; th and en; three widths; axe; keyboard |
| Evaluation | `eval:qc` dev gate in CI; held-out run at W4-14 |

## 18. Exit evidence (W4-14)

The exit record under `changes/<date>-w4b-exit/` needs all of the following:

- The section 16 gate is green from a clean checkout of main.
- The held-out `eval:qc` report meets every section 11.3 threshold, with its `identityDigest`, and `--verify` shows it is current.
- The dev report, the number of held-out runs and the agent-team grounding sample are included.
- W4-INT-a and W4-INT-b pass on `content`, including the image-only slot 2 journey (metadata findings recorded beside a visible content-part outage), and readiness reports `qc.kind = 'content'` and `qc.model = 'disabled'`.
- Every critical probe shows zero successes, and the failure probes show visible outages with submit still succeeding.
- `check:substitute-absent` passes.
- The record lists these identities next to each output: runner, runner version, extractor version, rules label and revision ID, templates, prompt revision, model identity (disabled), dataset `qc-eval-synthetic@1 <hash>`, grader version and thresholds hash.
- It states plainly that:
  - D08 and D09 are open, and what they are replaced by is working assumptions;
  - the labels are agent-made and unsigned by lane experts;
  - the rulings are provisional under Ta's delegation of 2026-09-27;
  - this is not real-data use and not PoC acceptance.
- A failed threshold or any critical probe success is recorded as a failed exit.

Ta reviews the exit record.

## 19. What this plan changes in other documents

Each amendment is dated and lands in the named ticket's PR.

- **`docs/product/decisions.md`** (W4-00b; recorded by the consolidated planning change [2026-09-27-w4b-w7-plans](../../changes/2026-09-27-w4b-w7-plans/intent.md), which replaced the three rows first planned here):
  - "Ta's delegation (2026-09-27)": the gate entry for W4b-W7 (decision 1 here).
  - "W4b delegated rulings (provisional)": decisions 7-9 and 17-30, and the D08 (2-6) and D09 (10-16, including 14b) working assumptions, labelled as assumptions. **D08 and D09 stay in the Open table.**
- **W4 work breakdown** (W4-00b): the W4b ticket list of section 15 replaces the draft W4b rows; status line; the W4-13 row's "test-only" wording corrected to plan section 2 of W4a; the W4-01 row's "ADR accepted by Ta and the tech lead before W4-05 or W4-07 merges" gains a dated note: under the delegation of 2026-09-27 ADR-0006 is provisional, and Ta's and the tech lead's acceptance moves to the W4b exit review (W4-14).
- **W4 decision briefs** (W4-00b): a dated note that the recommended options were adopted as working assumptions, with no owner approval.
- **BUILD_PLAN** (W4-00b): a dated status section, where W4b is opened provisionally on synthetic data. It says explicitly that the W4b preconditions "AI/COE lead and IT/Security owner named; D08 and D09 recorded" (the W4b rows of the BUILD_PLAN gate tables and the package entry line) is **replaced, for W4b on synthetic data only, by the labelled working assumptions of decisions 2-6 and 10-16** under decision 1(b) and Ta's delegation of 2026-09-27; D08 and D09 themselves stay open, and real-data use still needs them. At W4-14: the exit.
- **W0-06 section 7.2** (W4-00b): a dated note replacing the stale "upload on slot 5 or 9 is defined in W4" text with the W4-04 rule.
- **ADR-0006 and `adr/README.md`** (W4-01); **threat-model rows** for parser isolation, model input and no provider (W4-01); **upload safety section 10**: parsing worker implemented locally, real-data items still open (W4-01).
- **W0-02:**
  - section 5 (keys): W4-13b and W4-07a;
  - section 7 (read shapes): W4-11b, W4-15 and W4-16;
  - section 4: no new dependency (W4-01 records this).
- **W0-07:**
  - 3.3 (locators, `engine` on the result, model port): W4-16 and W4-07a;
  - 3.4 step 6 (dedup implemented): W4-15;
  - 3.4 and 3.7 (two run parts per trigger, per-part run key and replay, part stamping order): W4-18;
  - 3.4 step 5 (content rules read only the run lane's slots on an approve attempt, decision 28): W4-06a;
  - 3.5 (W4b rule rows): W4-06a-d;
  - 3.2 and 3.7 (unbound upload run, upload key): W4-17;
  - 3.9 and section 6 (`content`, `QC_MODEL`): W4-13b;
  - section 7 (logs): W4-11b.
- **W0-06 section 4.4** (what `observed_qc_run_id` names when one attempt has two run parts, decision 29): W4-18.
- **W0-10 catalogue** (`observability-contract.md`): W4-11b and W4-07b.
- **W0-04 and the data contract** (columns): W4-11b and W4-15.
- **Evaluation plan:** status moves to "synthetic set frozen (provisional labels), thresholds provisional", with a link to section 11 (W4-09b).
- **TESTING.md:** W4-13b (content mode), W4-08a (eval commands), W4-INT-b (walkthrough).
- **DEVLOG and CHANGELOG:** W4-14.

## 20. Plan review

Round 1 (2026-09-27, two independent reviewers). Each blocker was checked against the code before it was resolved.

| # | Blocker | Resolution |
|---|---|---|
| 1 | An extraction failure made the whole run unavailable, and an unavailable `QcRunResult` carries no findings, so the W4a metadata findings (`PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH`, `PACK-NA-VENDOR-DOC`) disappeared whenever slot 1, 2 or 5 was an image or a scan | New decision 27 with three options; **(b) two run parts per trigger** adopted (PR). The W4a deterministic runner keeps the metadata rules (it already skips `content` rules), and the content runner runs only content rules, each as its own `qc_run` row with its own `engine_id`, status, run key and replay (section 3.4). New ticket W4-18. Reflected in sections 2, 3.1, 10, 11.3 (new threshold row), 12, 17 and 18, and in the W4-06a, W4-13b/c, W4-10b and W4-INT-a done-when, including "a submit with an image-only slot 2 still records `PACK-SLOT-MISSING`/`PACK-STAGE-MISMATCH` findings, plus a visible outage" |
| 2 | Decision 14 had no options and no recommendation | Split into 14 (D09 Q1, options (a)-(c), working assumption follows 1(c): synthetic now, a new frozen version at W7) and 14b (D09 Q7, options (a)-(c), follows 7(b): deferred, because no signer is named). Both labelled WA-D09. Decisions 6 and 26 now say explicitly that no choice is made (moot; out of scope) |
| 3 | `message_param_text` would refuse `threshold_source: 'v1.0 Sheet3'`, which the QC substitute scripts emit, and CI stays on `substitute` | The check allows a string exactly equal to the request's `checklistTemplateVersion` (section 3.1). W4-06a tests that every substitute script passes the validator against its fixture request, and corrects a script only if its source differs from its case's template |
| 4 | `alreadyRecordedCount` had no stored column, and a replay could not rebuild `alreadyRecorded` | The W4-15 migration adds `qc_run.already_recorded_count` (CHECK `>= 0`), written in the run INSERT because the dedup lookup precedes `recordRun`; `listQcRunsForVersion` serves it. `alreadyRecorded` IDs are served on newly recorded runs only; a replay omits them and the UI shows the count (sections 6, 7, 9, 10) |
| 5 | New required fields on `StoredFindingSummary`, `FindingWithDisposition` and `LaneQcRunResponse` would break typecheck in the frozen API substitute | Every new field on those shapes is `Type.Optional`, as `evidence` already is (section 9, and a new shared-file rule for `shared/src/schemas/review.ts`). The substitute stays unchanged (decision 19); a server contract test asserts the real server always sends them |

Notes taken:

- Section 6 now names the W4-15 migration instead of a guessed number.
- W4-08a depends on W4-05c and W4-05d as well, so the dev report does not show XLSX and PDF as unavailable.
- W4-13b is split: W4-13b (HRR: config keys, two-part binding, readiness, self-test) and W4-13c (seed `w4b.1` and the content real-server test).
- Section 11.3 states that the held-out thresholds of 1.00 may well produce a recorded failed exit, and how that is remedied (a new held-out version, never a lowered threshold).
- W4-05b measures fork latency under both layouts against 4000 ms and the 10 000 ms deadline for a two-slot approve attempt, with a precompiled-worker fallback.
- PDF locators: one `page` locator per claim; no `text_range` for PDF; W4-16 leaves `page` and `text_range` unchanged (sections 3.2 and 4.3).
- W4-17's paths now name `compose-app-deps.ts` and `app.ts`, where the upload trigger is wired only when a runner exists; W4-17 joins the `compose-app-deps.ts` / `app.ts` serialisation rule.
- W4-05a makes `QcOrchestratorDeps.blobs` optional; with it absent, `read()` rejects and maps to `artifact_unreadable`.
- W4-10b runs its fault cases in process through `fixture-app.ts` with an injected fault extractor (a spawned server cannot take a function hook), and bomb and oversize text on a spawned `content` server; no test hook is added to `start.ts`.
- The BUILD_PLAN status section (W4-00b) states that the W4b preconditions "AI/COE lead and IT/Security owner named; D08 and D09 recorded" are replaced, for synthetic-data W4b only, by the labelled working assumptions, and that D08 and D09 stay open.

Round 2 (2026-09-27, two independent reviewers). Each blocker was checked against the code before it was resolved.

| # | Blocker | Resolution |
|---|---|---|
| 1 | Content rules on an approve attempt were not scoped to the run's lane. `buildRequest` carries every slot on an approve attempt, and `selectRules` does not filter by lane. `checkOwningLane` refuses a finding owned by another lane (`finding_outside_lane`, `shared/src/qc/validate.ts`), which fails the whole run. So a DPO or IT/Security attempt would turn AI/COE's slot-1 claims into a `runner_error` content part, and a scanned slot 1 would give those lanes an outage about a slot they do not review | New decision 28 (PR): on `approve_attempt`, a content rule reads only `params.slots ∩ slotsForLane(lane, mapping of the version)`. A rule with no readable slot emits nothing and reads no bytes; the AI/COE-only rules are silent on the other lanes' attempts (section 3.1 lane scope, section 3.3 table). W4-06a done-when adds unit tests with a recording fake extractor. The W4-INT-a journey names the lanes (AI/COE: outage plus slot-5 finding; DPO: completed content part, slot-5 finding, no outage). The W4-09a labels are per lane, and section 11.3 has a lane-scope threshold row. W0-07 3.4 step 5 gains a dated note (section 19) |
| 2 | Two run parts per trigger broke the lane approval gate. `approveLane` (`workflow/service.ts`) refuses with 409 `qc_run_superseded` unless `body.qcRunId` is the latest approve-attempt row of any engine, and section 3.4 did not fix which part is stamped later or which part the combined `runId` names | New decision 29 (PR), option (a): parts are stamped metadata then content with `nextMonotonicStamp` (strictly increasing), and the combined `runId` is always the latest-stamped part. `approveLane` keeps its any-engine check; `findLatestApproveAttemptRun` gains an **optional** engine ID that only the orchestrator passes. `observed_qc_run_id` names the latest part; the other part is found by engine, lane, revision and correlation ID (W0-06 4.4 note). W4-18 now lists `workflow/service.ts` and `qc/repository.ts`, and its done-when adds integration tests that approve after a two-part attempt and after a content-only retry, plus a 409 for the older part. W4-12b reads unavailable parts from `parts`, since the top-level `runId` may name the completed part (section 10) |

Notes taken:

- `QcFindingContext.artifacts` is optional; `evidence_outside_request` runs only when it is present, so the frozen API substitute's context literal in `routes-review.ts` typechecks unchanged. W4-06a asserts that the API substitute's `storeableFindings` drops no script finding, because it discards refused findings silently.
- `message_param_text` has exact patterns: a snake_case key, a comma list of keys, an item reference, a decimal string, or the request's template version. No closed set is taken from `request.rules`.
- `ACC-METRIC-CITED` uses `measure: null` when the metric or value is missing, and lists the gaps in `params.missing`. Decimal exactness applies to the comparison; stored measure fields are numbers.
- Readiness under `content` reports `qc.kind = 'content'` from the bound `contentRunner`, not from the deterministic `runner` that `start.ts` reads today. W4-13b changes the derivation and tests it; the W4-14 exit evidence keeps `qc.kind = 'content'`.
- W4-00b's work-breakdown update says that Ta's and the tech lead's acceptance of ADR-0006 moves to the W4b exit review, so the W4-01 dependency does not read as unmet.
- `PACK-CONTRADICTION` stays submit-only (run lane null, pack owned by AI/COE), which is consistent with the step 5 check. The W4-15 statement "the same slot-1 claim on upload and on the AI/COE approve attempt is stored once" holds under decision 28.

Round 3 (2026-09-27, two independent reviewers: PASS and BLOCK). The workflow stopped after round 3; the consolidator resolved the three blockers in the consolidated planning change, each checked against the code.

| # | Blocker | Resolution |
|---|---|---|
| 1 | W4-06a-d registered params schemas before the seed had params; `qcRulesBodyProblems` checks params on every publish, so the seed (which lists the four `ACC-*` rules without params) would be refused from W4-06a on | Each W4-06x PR adds its own rule's seed `params` together with the schema and keeps `seed.test.ts` green; W4-06d adds the `PACK-CONTRADICTION` entry with params; W4-13c only sets the label (section 3.3, W4-06a-d and W4-13c rows) |
| 2 | Decision 22 contradicted section 3.1 for upload: `ACC-METRIC-CITED` lists slot 5 in `params.slots`, so an upload to slot 5 would read slot 5 with no defined owning lane | Upload readable slots are `params.slots ∩ singleLaneSlots(mapping)`, so a slot-5 upload reads nothing and a scanned slot-5 upload is never an outage; the finding's owner is the slot's single lane; W4-06a unit test (section 3.1) |
| 3 | No per-scope emission rule, so two defective claims (or two contradicting facts) shared one `findingKey` and the W4-15 dedup dropped the second | New decision 30, option (b): `claimKey` (excerpt-hash prefix or fact ID) in `findingKey` and the dedup key, stored in `qc_finding.claim_key` (W4-15 migration), `duplicate_finding_key` run check, lookup only against rows that existed before the run (sections 3.1, 6, 7; W4-06a, W4-06d, W4-15 rows) |

Cross-plan consolidation (2026-09-27, the W4b, W5, W6 and W7 plans read together):

- **Recheck and dedup (W6-09).** An advisory recheck finding can never be dispositioned, so it would suppress later gating findings under the W4-15 dedup. The dedup lookup ignores recheck-run findings, and recheck runs do not dedup (section 6; W6 plan section 5).
- **Two run parts and W6.** A recheck runs every bound part as `recheck = true` rows; `qcPaused` records every part as `desk_paused`; `findLatestQcRun` carries both the optional engine ID and `recheck = false`; `parts[].reason` uses the single `QC_UNAVAILABLE_REASONS` list (section 3.4).
- **Seed label with W5-10.** The label names the last ticket that changed the seeded `qc_rules` body; whichever of W4-13c and W5-10 merges second sets its own label and updates the assertions (section 3.3; W5 plan section 8).
- **Implemented-rule registry (W6-03).** `PACK-CONTRADICTION` and a content-registry test, added by whichever of W4-06d and W6-03 merges second (section 3.3).
- **Operator labels.** A widened readiness enum needs an `operator-labels.ts` entry: W4-13b adds `content` (section 2); the same rule is written into the W6 and W7 plans.
- **`riskProposal` builders (W5-10).** W4b's request builders (`qc/request.ts`, runner tests, the evaluation harness) follow W5 R-17 (section 15.2).
- **Migration classes (W7-03).** Both W4b migrations are `additive` (section 7).
- **API substitute.** Decision 19's freeze binds W4b tickets only; W5 R-16 adds two read routes.
- **Register rows.** The consolidated planning change records "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)" in place of the three rows first planned in section 19.
- **W7 rehearsal.** The W7 scripted and manual rehearsals run `QC_MODE=content` once W4-13b has merged, so the R5 content finding is real (W7 plan, consolidated).
