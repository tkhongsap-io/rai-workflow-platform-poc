# QC boundary and mail sink (W0-07)

**Current status, 2026-09-23:** The specified synthetic QC and file-mail adapters and W3 delivery mechanisms are implemented. Ordinary notifications retain mandatory case-audit provenance. Daily digest provenance follows the later typed durable operator-job contract, not the early illustrative case-audit shape below. Real QC remains W4; external delivery remains gated. See the [W3 engineering exit](../../changes/2026-09-23-w3-exit/review.md).

Status: **W0 interface spec, agent draft for human review; reconciled with the sibling specs at the W0 exit review ([W0-09](../../changes/2026-09-21-w0-exit/review.md), 2026-09-21; each applied change is marked "W0-09:").** Ticket W0-07 of the [W0 technical contract](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink); GitHub issue #12; lane Lead. Depends on [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04). Proves A05 and A08 later, through the tickets that consume it. Nothing in this document is installed or running; W1-10 and W1-11 build the substitutes it specifies.

This document is stack-concrete (TypeScript on Node 24, Fastify, Drizzle on Postgres 16, `node:test`, Playwright) while the two boundaries stay stack-neutral in intent: a caller that provides the inputs below and reads the outputs below gets the same behaviour regardless of what is behind the interface. It is written against the merged sibling specs [W0-02 implementation plan](implementation-plan-w1-w3.md) (paths, configuration keys, test layers), [W0-04 persistence](persistence-and-artifact-store.md) (`qc_run`, `qc_finding`, `notification`), [W0-06 workflow](workflow-transition-and-error-contract.md) (lane mapping, owning-lane rule, error contract) and [W0-10 observability](observability-contract.md) (log events, readiness, operator view); where this spec needs something those documents do not yet define, section 10 lists it as a proposed amendment for the lead rather than defining a competing contract.

## 1. What this document decides and what it does not

| Decided here (within W0-07's remit) | Not decided here |
|---|---|
| The QC boundary interface: inputs, typed finding, `unavailable` result, timeout handling, authority limits, run and finding persistence rules, error mapping, test substitute behaviour and its tests (W1-10) | **Which model or extraction method runs behind the boundary.** Open under D08 and D09; recorded in ADR-0006 at W4 entry. The slice-1 runner is a scripted substitute and is never labelled "QC implemented". |
| The mail sink interface: committed-event input, authorized recipients, safe deep link, dedup key, delivery status, the transactional-outbox placement, retry ownership, test substitutes and their tests (W1-11) | **The owning lane of slot-5, slot-9, pack-level and QC-unavailable findings.** Recorded on 2026-09-25 in [W0-06 section 7.3](workflow-transition-and-error-contract.md#73-recorded-d05-refinement-2026-09-25); this document applies it (section 3.6) and never extends it. |
| How the two boundaries read the W0-02 configuration keys and fail closed on them | **Any transport that sends mail outside the process.** Slice 1 has exactly two sinks, `sink-memory` and `sink-file`. A real transport is W7/W8 work under D10 custody rules. |
| Locale-key rule for finding messages and mail templates (D12) | The exact QC rule catalogue, thresholds and the D07 rubric. The substitute uses the source-spec rule families as scripted examples only. |

Recorded decisions this spec carries as written: D05 (owning lane records waived and N/A; owner proposes "fixed"; no self-approval; the owning lane is a property of the finding), D06 (three retries with backoff; dedup by event, version, lane, recipient; one daily breach digest to `operator_recipients`; delivery failures visible to Admin), D12 (locale keys on every finding message and mail template, Thai default), L7 (QC is soft; submit and lane decisions always succeed), L8 (Ready is a server predicate, never a QC output).

## 2. Placement in the D04 stack

Under the ADR-0003 shape (one Fastify process serving the React SPA, Postgres 16 with Drizzle), both boundaries are in-process TypeScript interfaces behind which a substitute or a later real implementation is chosen by configuration at startup. Paths are the ones [W0-02 section 1](implementation-plan-w1-w3.md#1-repository-layout) records.

| Piece | Path (W0-02) | Lane / ticket |
|---|---|---|
| Shared types: `QcRunRequest`, `QcFinding`, `QcRunResult`, `DeliveryRequest`, `DeliveryReceipt` | `rai-web/shared/src/qc/types.ts`, `rai-web/shared/src/mail/types.ts` | Lane A owns `shared`; W1-00 creates the files from the shapes in this spec |
| QC port and orchestrator (timeout, replay lookup, run/finding persistence, `unavailable` conversion, owning-lane check) | `rai-web/server/src/qc/` | Lane A (W1-05 calls it on submit; W2-02 on approve attempt; W1-03 on upload) with the finding record owned by W2-05 |
| QC scripted substitute (`QcRunner` implementation) and its scripts | `rai-web/fixtures/src/substitutes/qc/` with scripts in `rai-web/fixtures/src/substitutes/qc/scripts/*.json` | Lane C, W1-10 |
| Notification outbox and dispatcher (retry, dedup, operator visibility) | `rai-web/server/src/notifications/` | Lane B, W3-03 and W3-04 |
| Mail sinks (`sink-memory`, `sink-file`) | `rai-web/fixtures/src/substitutes/mail-sink/` | Lane C, W1-11 |
| Runner and sink selection at startup | `rai-web/server/src/config.ts` (W1-00) reads `QC_MODE`, `MAIL_MODE`, `MAIL_SINK_DIR` and `PUBLIC_BASE_URL` (section 6) | Lane A |
| Unit tests | colocated `*.test.ts` next to each substitute (`rai-web/fixtures/src/substitutes/qc/*.test.ts`, `rai-web/fixtures/src/substitutes/mail-sink/*.test.ts`; section 10 asks W0-02 to include `fixtures/src` in the `test:unit` glob) and next to the orchestrator (`rai-web/server/src/qc/*.test.ts`); integration under `rai-web/tests/integration/<ticket>-<topic>.test.ts` | Lane C for substitutes; consuming tickets for integration |

Rules that keep the boundaries honest: **the substitutes import only from `rai-web/shared`.** They never import Drizzle, the database client, the Fastify instance, the notification module or each other. Both live in the `fixtures` workspace, which is a devDependency and carries the W0-02 `substitute-marker.ts`, so `npm run check:substitute-absent` proves the production build contains neither. The QC substitute is nonetheless the slice-1 QC implementation by design (W0-02 section 1.1): it is bound in `server/src/qc/` behind `QC_MODE=substitute` and labelled as a substitute in readiness and the operator view. Sections 3.9 and 4.8 turn the import rule into a test.

## 3. QC boundary

### 3.1 Authority and data-flow limits

QC is a read-only evaluator. The source spec makes it soft everywhere (L7) and the architecture gives it "no approval or mail-sending capability". Concretely:

- **Inputs are a version reference and authorized artifact references.** The server resolves the actor's scope (W0-05) and the version's frozen artifact references (W0-04, W1-05) *before* building the request. The runner receives read handles limited to those artifacts and nothing else: no repository, no database connection, no session, no HTTP client.
- **Outputs are data.** A `QcRunResult` is either `completed` with zero or more typed findings, or `unavailable` with a reason. It is validated at the boundary against the shared schema before anything is persisted. A runner cannot return an approval, a disposition, a transition, a recipient or a link.
- **QC has no write access to workflow state.** Only the server-side orchestrator (Lane A) persists the QC run and appends findings, and it does so through the same store rules as every other write (append-only findings, immutable run rows, version immutability; W0-04). The runner's process-level environment has no database URL in slice 1 (it runs in-process, but its module receives none of the server's handles; the W4 worker option in ADR-0003 keeps this by construction).
- **Document contents and runner output are untrusted data** (AGENTS.md, threat model). A finding's `message` is a locale key plus typed parameters. **No document text leaves the runner:** an evidence location is a locator (page, range, cell, section) plus at most an `excerptHash`, matching W0-04's `qc_finding.evidence` ("references only, never document text; an excerpt is at most a hash"). A runner result that carries document text fails validation (3.4 step 4).
- **QC never decides.** A run with zero findings is "no defects found by the rules in revision X", not an approval. A run that is `unavailable` is recorded as an `unavailable` run and as a finding (section 3.6; W0-06 7.3, recorded 2026-09-25); it is never a clean pass. Ready (W2-06) reads finding dispositions, never runner output.

### 3.2 Triggers

Three triggers from the source spec "When it runs" table. Each is fired by the server ticket that owns the business action, *after* that action's transaction has committed, so QC can never hold up or roll back an upload, a submit or a decision.

| Trigger | Fired by | Scope of the request | Rules that run |
|---|---|---|---|
| `upload` | The save-draft that attaches the stored artifact to a slot, after it commits (W0-02 7.5 `PUT /api/cases/{caseId}/draft`, W1-04; the upload itself, W1-03 `POST /api/cases/{caseId}/artifacts`, stores bytes and metadata only). Upload is idempotent by content hash (W0-06 section 5.3) and the trigger fires only when the slot's artifact reference actually changed | The one artifact, its slot, the draft's `checklist_template_version` | That artifact's own completeness rules |
| `submit` | W1-05 after the version is frozen. A retried submit replays through its idempotency record (W0-06 section 5.3) and fires no second trigger | The whole frozen version: all nine slots, all artifact references, `stage_context`, `model_type`, `vendor_involved` | Pack completeness, cross-document contradictions, pack-versus-stage mismatch |
| `approve_attempt` | The lane-QC run endpoint the W2-02 contract PR adds (W0-06 section 4.4): the reviewer workspace (W2-07) requests the run for (version, lane) before it offers the decision controls, and the approve event carries the run's ID | The frozen version restricted to that lane's slots under the lane-mapping constant recorded on the version | That lane's document rules |

An `upload` run on a draft is attached to the draft's artifact reference and is carried to the version that freezes it; it is not re-run on submit unless the submit rules ask for it. Findings from all three triggers accumulate on the version (append-only QC log per version, source spec).

The reviewer sees the `approve_attempt` result before the decision controls (W2-07 "findings render before the decision controls"). The decision itself does not wait for a completed run: if the run is `unavailable`, the reviewer sees the unavailable run and may still decide (L7); W0-06 section 4.4 makes an `unavailable` run "a valid run to have seen" that "never counts as clean".

**W4-04 amendment (2026-09-27): the upload trigger is bound; its run fields and target.** [W4a plan](implementation-plan-w4a.md) section 5, register rows "W4a gate entry" and "D05 refinement (upload slot 5 and 9)". The save-draft attach that changes a slot's artifact reference fires one `upload` run per changed slot after the save commits (`pack/qc-trigger.ts` `createUploadTrigger`, bound in `app.ts` next to the submit trigger when a runner is bound, and tracked by the shutdown drain); an unchanged save fires none, and two attaches in one save run separately. The save response never waits for it. The run's request carries the one uploaded slot and its artifact, the row's `checklist_template_version`, the `qc_rules` revision in force at the upload instant (3.3 W4-02 amendment) and, on a draft, the current lane-mapping constant. The run row has `trigger = 'upload'`, `lane = NULL` and `slot` set (`lane` stays set only on approve attempts). Slot 9 fires no run. Where the result lands: the draft row is the row that becomes the version at submit, so a run that completes while it is a draft appends to it, and one that completes after submit, while that version is still open, appends to the version ("carried to the version that freezes it" above); after Ready the run is late (nothing written, `qc.run.late`, a `qc_late_result` row); a version closed by a send-back refuses it with `version_closed` and nothing is written (W3 deferred rulings item 2). An upload run is never replayed (3.7); in-process concurrency is shared per `runKey`. With the W4a deterministic runner no rule has the `upload` trigger, so a completed upload run records `rules_evaluated = 0` and no finding; upload content rules are W4b's.

### 3.3 Interface, TypeScript notation

Types live in the shared package. `Lane`, `Slot`, `LaneMapping`, `owningLaneRule` and `unavailableOwningLane` are the W0-06 exports (sections 3 and 7 there; W0-02 places the constant in `shared/src/constants.ts`); this spec imports them and does not define a second lane type.

```ts
// rai-web/shared/src/qc/types.ts  (W1-00 creates; W1-10 and W2-05 consume)

import type { Lane, Slot } from '../constants.js';   // W0-06 lane type and mapping, per W0-02

export type QcTrigger = 'upload' | 'submit' | 'approve_attempt';   // the W0-04 qc_run.trigger values
export type Severity = 'high' | 'medium' | 'low';
export type SlotNumber = Slot;                                     // 1..9, W0-06
export type SlotDisposition = 'attached' | 'not_yet' | 'not_applicable' | 'missing';   // the W0-04 artifact_slot.state and W0-02 SlotState words (W0-09)
export type StageContext = 'idea' | 'pre_build' | 'pre_launch';   // D11
export type ModelType = 'llm' | 'classic_ml' | 'other';           // W0-04 fields

export interface VersionRef {
  caseId: string;            // desk-local case ID
  versionId: string;         // immutable submitted-version ID; for `upload` on a draft: the draft ID
  versionNumber: number;     // 1..n, the "vN" a reviewer sees
  isDraft: boolean;          // true only for the `upload` trigger
}

/** A read handle the server built after authorization. Nothing else reaches the runner. */
export interface AuthorizedArtifactRef {
  artifactId: string;
  slot: SlotNumber;
  contentHash: string;       // sha256 hex, the store key (W0-04)
  mediaType: string;         // sniffed type from W0-08, not the extension
  filename: string;          // for display in a finding only; may be Thai; never logged (W0-10)
  byteLength: number;
  /** Streams the stored bytes. Read-only; the server revokes it when the run ends. */
  read(): Promise<ReadableStream<Uint8Array>>;
}

export interface SlotState {
  slot: SlotNumber;
  disposition: SlotDisposition;
  reason: string | null;     // required for not_applicable (a locale key for the non-vendor default, W0-04); null otherwise
  artifactId: string | null; // set only when attached
}

export interface QcRunRequest {
  correlationId: string;             // W0-10; same value on the run row, the audit event and the log line
  runKey: string;                    // deterministic input identity, section 3.7
  trigger: QcTrigger;
  lane: Lane | null;                 // set only for approve_attempt
  version: VersionRef;
  checklistTemplateVersion: string;  // e.g. "v1.0-sheet3-sl2.1"; selects the threshold source (L12)
  qcRulesRevision: string;           // configuration revision ID frozen on the version at submit (W1-05); W0-04 qc_run.rule_revision
  laneMappingVersion: string;        // the W0-06 constant version recorded on the version
  stageContext: StageContext;        // D11; QC input only
  modelType: ModelType;
  vendorInvolved: boolean;
  slots: SlotState[];                // all nine for submit; the lane's slots for approve_attempt; one for upload
  artifacts: AuthorizedArtifactRef[];// exactly the artifacts referenced by `slots`
  deadlineMs: number;                // orchestrator-owned; the runner also receives an AbortSignal
}

export type EvidenceLocator =
  | { kind: 'page'; page: number; region?: { x: number; y: number; w: number; h: number } }
  | { kind: 'text_range'; start: number; end: number }
  | { kind: 'cell'; sheet: string; cell: string }
  | { kind: 'section'; heading: string }
  | { kind: 'absent' };              // the rule looked for something and found nothing

/** Maps 1:1 onto W0-04 qc_finding.evidence: {artifact_id?, page?, locator?, excerpt_hash?}. References only. */
export interface EvidenceLocation {
  artifactId: string | null;         // null only with locator.kind === 'absent' at pack level
  contentHash: string | null;
  slot: SlotNumber | null;
  locator: EvidenceLocator;
  excerptHash?: string;              // sha256 hex (64 lowercase characters) of the NFC-normalised UTF-8 excerpt the rule matched.
                                     // The excerpt text itself never leaves the runner; there is no `excerpt` field and a result carrying one is rejected (3.4 step 4).
}

export interface Measure {
  metric: string;                    // e.g. "hallucination_rate"; "extraction_accuracy" is a different metric
  value: number | null;
  denominator: number | null;
  threshold: number | null;
  unit: 'percent' | 'ratio' | 'count';
  thresholdSource: string;           // the checklistTemplateVersion the threshold came from; never another version's
}

export type FindingScope =
  | { kind: 'artifact'; slot: SlotNumber; artifactId: string; contentHash: string }
  | { kind: 'slot'; slot: SlotNumber }              // slot-level with no artifact (missing / N/A / not yet)
  | { kind: 'pack' }                                 // completeness, contradiction, stage mismatch
  | { kind: 'run'; trigger: QcTrigger; lane: Lane | null };   // the QC-unavailable finding; one per run; built by the orchestrator only

export interface QcFinding {
  findingKey: string;                // stable within the run: `${ruleId}:${scopeKey}`; the server assigns findingId on record
  ruleId: string;                    // matches /^[A-Z]+(-[A-Z0-9]+)+$/ e.g. "ACC-METRIC-CITED"
  ruleRevision: string;              // equals request.qcRulesRevision; a run never applies another revision
  trigger: QcTrigger;
  scope: FindingScope;
  severity: Severity;
  owningLane: Lane;                  // assigned by the W0-06 rule (section 7 there); section 3.6. Never a pending or guessed value.
  evidence: EvidenceLocation[];      // at least one; kind 'absent' when the defect is an omission
  measure: Measure | null;           // required when the rule is a metric/denominator/threshold rule
  message: { key: string; params: Record<string, string | number> };   // D12 locale key; Thai default in the UI
  provenance: { runner: 'substitute-scripted' | string; runnerVersion: string };   // runner = W0-04 qc_run.engine_id
}

export type QcUnavailableReason = 'timeout' | 'runner_error' | 'not_configured' | 'artifact_unreadable';

export type QcRunResult =
  | { status: 'completed'; findings: QcFinding[]; rulesEvaluated: string[]; startedAt: string; finishedAt: string }
  | { status: 'unavailable'; reason: QcUnavailableReason; detail: string | null;   // detail: no document content, no PII. Carries no lane (W0-06 7.4).
      startedAt: string; finishedAt: string };

/** The port. Exactly one implementation is selected at startup (section 6). */
export interface QcRunner {
  readonly identity: { runner: string; runnerVersion: string };   // W0-04 engine_id; slice 1: 'substitute-scripted'
  run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult>;
}
```

Timestamps are ISO-8601 UTC strings; the UI renders them in the D06 timezone (Asia/Bangkok).

**W4-02 amendment (2026-09-27): `request.rules` and the upload revision.** [W4a plan](implementation-plan-w4a.md) section 3.

- `QcRunRequest` gains `rules: SelectedRule[] | null`, with `SelectedRule = { ruleId; engine: 'metadata' | 'content'; severity: Severity; params?: Record<string, unknown> }`. The runner has no store, so the orchestrator loads the `qc_rules` catalogue body (`{ label, templates: { [checklistTemplateVersion]: { rules } } }`) by the revision ID it records, selects the template's rules for the trigger and model type (`server/src/qc/select.ts`) and passes them. The rules are configuration data, never instructions from a document.
- `qcRulesRevision` stays the `configuration_revision.id`; the body's `label` (e.g. `w4a.1`) is for people and is never recorded as the revision.
- `[]` means the catalogue selects no rule for this trigger (a zero-rule run). `null` means no `qc_rules` revision applies: the recorded revision is of another kind (a version frozen before W4-02) or names no row. The deterministic runner answers `null` with `unavailable:not_configured`, never a clean pass. An approve attempt answered that way is retried like any unavailable approve attempt (3.7).
- An unknown template version (absent from the catalogue) is `unavailable:runner_error` with detail `unknown_template_version`, recorded under the bound runner without calling it.
- A historical version reads its own frozen revision. A draft (the `upload` trigger, wired in W4-04) reads the revision the submit freeze would record at the upload instant (published strictly before it). If that differs from the revision frozen at submit, each run keeps its own `rule_revision`.
- The scripted substitute (3.9) ignores `rules`.

**W4-16 amendment (2026-09-27): locators carry no document text.** [W4b plan](implementation-plan-w4b.md) sections 9 and 15 (row W4-16), register row "W4b delegated rulings (provisional)" decision 21 (b). A heading or a sheet name is document text (3.1), so the `EvidenceLocator` above changes: `cell` is `{ kind: 'cell'; sheetIndex?: number; cell?: string }` (a 1-based sheet ordinal in workbook order and an A1 reference matching `^[A-Z]{1,3}[1-9][0-9]{0,6}$`, exported as `CELL_REFERENCE_PATTERN` from `shared/src/qc/types.ts`) and `section` is `{ kind: 'section'; index?: number }` (a 1-based ordinal). `page`, `text_range` and `absent` are unchanged. The runner-side schema (`EvidenceLocatorSchema` in `shared/src/qc/validate.ts`, step 4 of 3.4) accepts only this shape and refuses `heading` and `sheet` as unknown fields, so a finding carrying either makes the run `runner_error`; the extraction worker's wire (`WireLocatorSchema`) refuses them too (a reply carrying one is `crash`). A `qc_finding.evidence` row stored earlier with a `heading` or `sheet` is served as its kind only (`locatorView`, W0-02 section 7). The substitute scripts (3.9) locate their section findings by ordinal.

### 3.4 Orchestrator behaviour (server side, Lane A)

The orchestrator wraps the runner and is the only code that touches the store for QC. It follows W0-04's row rules: **a `qc_run` row is inserted once, with its final status, after the runner has answered, and is never updated** (W0-04 `qc_run`: "Immutable once `status` is set; ... never updated"; the trigger raises on UPDATE and `rai_app` has no UPDATE grant). There is no `running` status, no in-progress row and no age-out. Its **placement** is W0-06's, not W0-04's: the run happens *after* the triggering action's transaction has committed, in its own transaction under the case lock ([W0-06 4.3](workflow-transition-and-error-contract.md#43-submit) "After commit": "The submit response does not wait for QC"; [W0-06 9.1](workflow-transition-and-error-contract.md#91-one-transaction-per-event-serialised-per-case): "QC-finding appends (after commit of upload or submit) take the same lock"). W0-04's `qc_run` paragraph ("inserted with its final status in the same transaction as the trigger") and its Submit transaction row ("run submit QC through W0-07 and insert `qc_run` + `qc_finding` rows" inside the submit transaction) place the run *inside* the trigger's transaction; the two merged specs disagree. This spec follows W0-06 because a submit that waits for a 10 000 ms runner timer contradicts 4.3 and because the after-commit placement is what lets QC never hold up or roll back an action (3.2); it does not resolve the disagreement, and section 10 proposes the W0-04 amendment for the lead. Its contract, in order:

1. **Build the request** from the frozen version (or the draft for `upload`) and the actor's already-checked scope. It mints `qcRunId` (the ID `qc.run.started` carries, W0-10 3.3, and the `qc_run` row's `id` if one is inserted in step 6), computes `runKey` (section 3.7), takes `correlationId` from the request context (W0-10) and sets `deadlineMs` from the orchestrator's `timeoutMs` option (default 10 000 ms as a module constant; tests pass 100; section 10 proposes a `QC_TIMEOUT_MS` key to W0-02).
2. **Replay lookup and in-flight guard** (section 3.7). If the latest recorded run for the same input is `completed`, return it and stop. If a run for this `runKey` is in flight in this process, await it and return its result (the in-flight table is an in-process `Map<runKey, Promise<QcRunResult>>`; nothing about "in progress" is ever written to the store). Otherwise register this run in the table and continue.
3. **Call `runner.run(request, signal)`** with an `AbortController` whose timer is `deadlineMs`. On timer expiry: abort, and treat the outcome as `unavailable` with reason `timeout`, regardless of what the runner returns afterwards (a late result is discarded and logged, never persisted). A crash between this step and step 6 leaves no row at all; the next trigger simply runs again.
4. **Validate the result** against the shared schema. Any violation (unknown field, `ruleRevision` ≠ `qcRulesRevision`, `owningLane` outside the lane type, an `excerpt` or any other document-text field on evidence, an `excerptHash` that is not 64 lowercase hex characters, missing evidence, a `measure` whose `thresholdSource` ≠ `checklistTemplateVersion`, a finding with `scope.kind === 'run'` or `ruleId === 'QC-UNAVAILABLE'`, which only the orchestrator builds) is treated as `unavailable:runner_error` with the violation name in `detail`. Malformed output never becomes a finding.
5. **Check `owningLane`** against the W0-06 rule (`owningLaneRule`, section 7 there as recorded on 2026-09-25), using the mapping resolved by the version's `laneMappingVersion`. A single-lane slot (1, 2, 3, 4, 6, 7, 8) and the pack have one lane, which must equal the runner's value (`owning_lane_mismatch` otherwise); slot 5 accepts any lane that reviews it; slot 9 accepts no `defect` at all (`owning_lane_slot_informational`); and on an `approve_attempt` run every finding must belong to that run's lane (`finding_outside_lane`). Each violation is `runner_error` and fails the whole run: no finding is ever stored with a guessed lane. The orchestrator never stamps a lane the runner did not send; the one finding it builds itself, the QC-unavailable finding, takes its lane from `unavailableOwningLane` (3.6).
6. **Persist in one transaction**, under the case row lock (W0-06 section 9.1: QC-finding appends take the case lock). **Late check first.** Under the lock, before any insert, read the version V the request names: **if V's `ready_at` is set, the run is late** and the append is refused ([W0-06 section 6](workflow-transition-and-error-contract.md#6-ready-predicate), last paragraph: "if V is already Ready, the append is refused and recorded as an operator-visible QC-late event (W0-10), never as a reopening"). A late run writes **nothing**: no `qc_finding` row (not even the QC-unavailable finding), no dedup lookup, and no `qc_run` row either, because a Ready version accepts only reads (W0-06 2.2) and a run row with zero findings on a Ready version would read as a clean run while its findings were refused. The transaction ends with no writes, the in-flight table entry is removed, and the orchestrator emits one `qc.run.late` line (section 7; proposed to W0-10 in section 10, since W0-10's catalogue has no QC-late event yet) with the trigger's `correlationId`, `caseId`, `versionId`, the `qcRunId` minted in step 1 (the ID `qc.run.started` already carried), `trigger`, `lane` when set, the runner's `status` and `refusedFindingCount`. The run result returned to the caller carries `late: { reason: 'ready', refusedFindingCount }` in place of the finding list; because no row exists, the version's QC log does not show a late run, and its record is the log line and, once W0-10 accepts the section-10 proposal, the operator view (3.8). `ready_at` is never touched, no transition, decision, disposition or notification is written, and the case does not reopen. A version that is closed but not Ready (a successor draft exists after a send-back, W0-06 2.2) is **also refused**, not appended: the persist step re-checks the open submitted target and answers `version_closed`, and no `qc_run` or `qc_finding` row is written (amended 2026-09-26 by Ta's ruling on the W3 hardening review, section 5 item 2, register row "W3 deferred rulings"; this matches W0-06's "without modifying the closed version"). The successor version gets its own QC on submit; the closed version's QC log stays as it was when it closed. An `approve_attempt` run cannot reach the late branch in practice, because the lane-QC run endpoint applies the 4.4 preconditions (target submitted, current, not Ready) before QC is asked; the check is unconditional all the same. Otherwise, **not late:** insert the `qc_run` row with `status` = `completed` or `unavailable`, `trigger`, `slot` (set for `upload`), `lane` (set for `approve_attempt`), `engine_id` = the runner identity, `rule_revision` = `qcRulesRevision`, `requested_at` = `startedAt`, `completed_at` = `finishedAt`, `correlation_id`; then append each finding with a new `findingId`, `kind = 'defect'`, the run ID, `version_id`, `slot` from the scope (`NULL` for pack), `evidence` from `EvidenceLocation` (locator and `excerpt_hash` only), `metric`/`denominator`/`threshold` from `measure`, `message_key`/`message_params` from `message`, and `correlation_id`. A finding whose `(ruleId, ruleRevision, scopeKey)` already has an *open* finding on the same version is not appended again (`scopeKey` is the scope's fields joined in order, so findings from different triggers or lanes stay distinct); the run result reports `alreadyRecorded: findingId` for it (the demo's "already recorded as a finding on this submission" behaviour). Dispositioned findings do not suppress a new one. For an `unavailable` result the row is inserted with `status = 'unavailable'` and the QC-unavailable finding (3.6, `kind = 'unavailable'`) is appended once per open scope: if the latest QC-unavailable finding for the same version, trigger and lane is still undispositioned, the run reuses it and appends nothing; the run body names that finding either way (3.8). The in-flight table entry is removed after commit or rollback.
7. **Emit** the W0-10 events: `qc.run.started` before step 3 and `qc.run.completed` or `qc.run.unavailable` after step 6, or `qc.run.late` instead of either when step 6 refused the append because the version is Ready (section 7 lists the fields). A version closed by a send-back is refused with `version_closed` and emits no QC completion or late line. No `excerptHash` source text, no filename, no message params (W0-10 redaction rule).

The orchestrator never mails, never changes a slot, a version, a lane decision or a disposition, and never reads runner output as an instruction.

**W4-03 amendment (2026-09-27): step 6 dedup deferred to W4b.** [W4a plan](implementation-plan-w4a.md) section 4. W4a stores no `alreadyRecorded` dedup: the orchestrator does not implement step 6's "not appended again" rule, and W4a needs none. A completed submit or approve-attempt run already replays (3.7, `replayPrior`), so a deterministic rule is not re-raised for the same input, and a new run after an unavailable one has no earlier defect to duplicate. The dedup moves to W4b, where content rules on upload and submit can overlap; its scope key must then include the owning lane for slot 5, because each lane's approve attempt raises its own slot-5 finding under the same `(ruleId, ruleRevision, scopeKey)`. The once-per-open-scope reuse of the QC-unavailable finding (3.6) is unchanged.

**W4-06a amendment (2026-09-28): step 5 for content rules, lane-scoped reading.** [W4b plan](implementation-plan-w4b.md) section 3.1, decisions 22 and 28 (register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)"; D08 and D09 stay open). The request of an approve attempt still carries every slot and artifact of the version, and step 5 still refuses a finding owned by another lane (`finding_outside_lane`). The content runner (`server/src/qc/content/runner.ts`) therefore scopes its own reading: a content rule reads only its **readable slots**, on `upload` `params.slots` ∩ the single-lane slots of the version's mapping ∩ the uploaded slot (so an upload to slot 5 reads nothing and raises nothing, and is never a content outage), on `submit` `params.slots`, and on `approve_attempt` `params.slots` ∩ the run lane's slots (slot 1 for AI/COE only, slot 5 for every lane). Slot 9 is never read. A rule with nothing in scope reads no bytes, emits nothing and still counts in `rulesEvaluated`. Content findings are owned by the slot's single lane on upload and by the run's lane on an approve attempt, so a DPO or IT/Security attempt never reads slot 1 and a scanned slot 1 is an outage of the AI/COE content part only. Step 4 gains three checks, each `runner_error` with the name in `detail`: `evidence_outside_request` (evidence citing an artifact, hash or slot the request did not carry; checked when the context lists the request's artifacts, which the orchestrator always does), `message_param_text` (a string message param that is not a key, a comma list of keys, an item reference, a decimal string or exactly the request's `checklistTemplateVersion`), and, over the whole result, `duplicate_finding_key` (two findings with one `findingKey`). A content finding may carry `claimKey` (`^[a-z0-9_]{1,64}$`, decision 30), and its `findingKey` is then `${ruleId}:${scopeKey}:${claimKey}`; every other key is unchanged.

### 3.5 Rule families the substitute scripts (from the source spec; not a rule catalogue)

The real catalogue is Admin configuration keyed to `checklist_template_version` (L12) and is W4/W6 work. Slice 1 needs synthetic findings that look like the real ones, so the substitute's scripts use these families with these IDs. IDs are stable so W2-05, W2-07 and W2-09 tests can name them. Under W0-06 section 7.4 the scripts may carry a `defect` finding only on a single-lane slot; the rows marked *reserved* are IDs W1-10 does not script until the review leads record the slot-5, slot-9 and pack-level rule.

| `ruleId` | Trigger | Scope | `measure` | Source-spec rule | Scripted in slice 1 |
|---|---|---|---|---|---|
| `PACK-SLOT-MISSING` | submit | slot, single-lane slots only | null | Completeness: a lane-gated slot is `missing` with no reason | yes (slot 2, 3, 4, 6, 7, 8 cases); slot 5 reserved |
| `PACK-STAGE-MISMATCH` | submit | pack | null | Pack-versus-stage: e.g. a launch checklist filed at `idea`, or `pre_launch` with the privacy checklist `not_yet` | yes (fx-case-missing-slot, submit; `owningLane: ai_coe`, W0-06 7.3 part 3) |
| `PACK-CONTRADICTION` | submit | pack (evidence in two artifacts) | null | Cross-document contradiction | not yet scripted (rule recorded; no fixture needs it in slice 1) |
| `ACC-METRIC-CITED` | approve_attempt, upload | artifact, slot 1; slot 5 | required | A "Yes" on hallucination/accuracy must cite metric, denominator, threshold and artefact | yes; the slot-5 variant on fx-case-missing-slot (DPO approve attempt, `owningLane: dpo`, W0-06 7.3 part 1) |
| `ACC-EXTRACTION-NOT-HALLUCINATION` | approve_attempt | artifact, slot 1 | required (`metric: 'extraction_accuracy'`) | Extraction % is not a hallucination rate (v1.0 item 3.5) | yes |
| `ACC-BAND-V1-SHEET3` | approve_attempt | artifact, slot 1 | required, `thresholdSource` must be the v1.0 Sheet-3 SL#2.1 version | H <1%, M <2%, L <3% apply only under that template version; other versions never inherit them | yes |
| `ACC-CLASSIC-ML-METRIC` | approve_attempt | artifact, slot 1 | required or slot N/A reason | Classic-ML uses that sheet's matching metric or N/A | yes |
| `QC-UNAVAILABLE` | any | run | null | QC failure is an explicit finding, never a clean pass | never scripted: built by the orchestrator only (3.6); a runner that returns it fails validation (3.4 step 4) |

Severity: `high` for `ACC-BAND-V1-SHEET3` and `ACC-EXTRACTION-NOT-HALLUCINATION` in scripts and for `QC-UNAVAILABLE` in the orchestrator; `medium` for the rest. These are fixture values, not thresholds of record.

**W4-03 amendment (2026-09-27): the W4a metadata rules.** [W4a plan](implementation-plan-w4a.md) sections 3 and 4; register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings" (Ta, 2026-09-26). The table above stays the substitute's script families. From W4a the product catalogue is the `qc_rules` configuration revision (W4-02, 3.3 amendment), and the `deterministic` runner (`server/src/qc/deterministic/`) executes its `metadata` rules from structured pack data only: no document bytes, no parser, no model. All three are provisional until D09, which confirms or replaces them.

| `ruleId` | Trigger | Scope, owning lane | Fires when (W4a provisional) | Severity (seed `w4a.1`) | Message key |
|---|---|---|---|---|---|
| `PACK-SLOT-MISSING` | submit | slot; the single lane of slots 1-4, 6-8 | a single-lane slot is `missing`; slot 5 is not raised on submit, so no lane is invented | medium | `qc.finding.pack_slot_missing` |
| `PACK-SLOT-MISSING` | approve_attempt | slot 5; the run's lane | slot 5 is `missing`; each lane's approve attempt raises its own finding, owned and dispositionable only by that lane (W0-06 7.3 part 1) | medium | `qc.finding.pack_slot_missing` |
| `PACK-STAGE-MISMATCH` | submit | pack; AI/COE | a slot listed for the version's `stage_context` in `params.attachedForbiddenAt` is `attached`, or in `params.notYetForbiddenAt` is `not_yet`. Seed: slot 8 attached at `idea`; any of slots 1-8 not yet at `pre_launch`. One finding, one evidence entry per offending slot | medium | `qc.finding.pack_stage_mismatch` |
| `PACK-NA-VENDOR-DOC` (new) | submit | slot 3 or 4; DPO | `vendor_involved` is true and the slot is `not_applicable`, with any reason. A soft finding: the DPO confirms the reason by waiving it, or the owner fixes the slot | medium | `qc.finding.pack_na_vendor_doc` |

- No rule raises a `defect` on slot 9, and slot 9 is never evidence of one. Evidence is a slot reference with locator `absent` (the rule reads a state, not a place in a document), plus the artifact reference when the slot is attached.
- `content` rules (`ACC-*`) are selected but not executed in W4a; `rulesEvaluated` counts only the executed metadata rules. `request.rules === null` is `unavailable:not_configured`. A metadata rule the runner does not implement, one selected on a trigger it is not defined for, `params` that fail the rule's schema, an unknown lane mapping or an approve attempt without a lane make the run `unavailable:runner_error`, never a shorter clean pass.
- Every rule ID has a th/en label key `qc.rule.<rule_id>` for the QC log (W4-12), including the content rules and `QC-UNAVAILABLE`.

**W4-06a amendment (2026-09-28): the first content rule.** [W4b plan](implementation-plan-w4b.md) sections 3.2 and 3.3, decisions 10, 11, 22, 28 and 30 (provisional until D09; the grammar and its label lists are working assumption WA-D09). The `content` runner (`engine_id = 'content'`) executes `ACC-METRIC-CITED`; the other `ACC-*` rules and `PACK-CONTRADICTION` follow in W4-06b-d. The runner is not bound in any `QC_MODE` until W4-13b.

| `ruleId` | Trigger | Slots read, owning lane | Fires when (W4b provisional) | Severity (seed) | Evidence, measure, message |
|---|---|---|---|---|---|
| `ACC-METRIC-CITED` | upload, approve_attempt | upload: slot 1 → AI/COE (slot 5 is not read on upload); AI/COE approve attempt: 1 and 5 → AI/COE; DPO or IT/Security approve attempt: 5 → the run's lane | A claim of the synthetic grammar (`key: value` pairs in a DOCX paragraph or PDF line, or a data row under an XLSX header) answers `yes` on a hallucination or accuracy item (`params.items`) and lacks an accepted metric (`params.acceptedMetrics`; an extraction metric counts as absent), a value, a denominator, a threshold or evidence | medium | One finding per defective claim, artifact scope, `claimKey` = the first 16 hex characters of the claim's `excerptHash`; evidence = the claim's locator (the answer cell for XLSX, the paragraph ordinal for DOCX, the page for PDF) and `excerptHash`; `measure` = the stated metric and value (denominator and threshold null when missing, `thresholdSource` the version's template) when both are stated, else null; message `qc.finding.acc_metric_cited` with params `{ slot, missing, item? }` (`missing` a comma list of field keys) |

- Its params (`slots`, bilingual `labels` for the ten column keys and the answer words, `items`, `acceptedMetrics`, `claimSource`) are schema-checked on every publish (`QC_RULE_PARAMS_SCHEMAS`), and the seed carries them in both templates; the seed label stays `w4a.1` (W4-13c sets `w4b.1`).
- Before reading any byte the runner refuses what it cannot vouch for: `rules === null` → `not_configured`; an unknown content rule, a trigger the rule is not defined for, invalid params, an unknown lane mapping or an approve attempt without a lane → `runner_error`; `claimSource: 'grammar+model'` → `not_configured` / `model_disabled` (no model port before W4-07).
- Bytes are read up to `byteLength` and must hash to `contentHash` (`artifact_unreadable` / `hash_mismatch`; a rejected read is `blob_missing`), then extracted once per artifact per run. Extraction `unreadable` or `limit_*` → `artifact_unreadable` / `extract_<reason>`; `crash` → `runner_error` / `extract_crash`; an abort → `timeout`. The content part never returns a shorter clean result, and its outage leaves the metadata part of the same trigger untouched (decision 27, W4-18).

**W4-06b amendment (2026-09-28): two more content rules.** [W4b plan](implementation-plan-w4b.md) section 3.3, decisions 10, 26, 28 and 30 (provisional until D09; metric lists and item keywords are working assumption WA-D09). The `content` runner also executes these two rules; `ACC-BAND-V1-SHEET3` and `PACK-CONTRADICTION` follow in W4-06c-d, so a seeded `llm` or `other` approve-attempt selection is still refused (`unknown_content_rule`) until W4-06c, while a `classic_ml` selection now completes. `model_type` routing (`qc/select.ts`) is unchanged.

| `ruleId` | Trigger | Slots read, owning lane | Fires when (W4b provisional) | Severity (seed) | Evidence, measure, message |
|---|---|---|---|---|---|
| `ACC-EXTRACTION-NOT-HALLUCINATION` | approve_attempt | slot 1 on the AI/COE attempt → AI/COE; DPO and IT/Security attempts read nothing | A claim on the hallucination item (`params.items`) cites, as its `metric`, a metric in `params.extractionMetrics` (seed: `extraction_accuracy`), whatever its answer. Selected for `llm` and `other` | high | One finding per such claim, `claimKey` as for `ACC-METRIC-CITED`; evidence = the claim's locator and `excerptHash`; `measure` = `{ metric: <cited ID>, value, denominator, threshold }` as stated numbers (null when not), unit from the value, else the stated `unit`, else `percent`, `thresholdSource` the version's template; message `qc.finding.acc_extraction_not_hallucination` with params `{ slot, metric, item? }` |
| `ACC-CLASSIC-ML-METRIC` | approve_attempt | slot 1 on the AI/COE attempt → AI/COE; DPO and IT/Security attempts read nothing | Selected for `classic_ml` only. An attached slot 1 has no claim on `classic_ml_performance` that cites a metric in `params.matchingMetrics` (seed: `f1`, `precision`, `recall`, `auc_roc`, `accuracy`) with a value, and none that answers N/A with a reason (a non-empty `evidence` field). A slot 1 marked not applicable is metadata: no artifact, nothing read, no finding | medium | One finding per artifact, no `claimKey`; evidence = every performance claim's locator and `excerptHash`, or an `absent` locator on the artifact when it has none; `measure` null; message `qc.finding.acc_classic_ml_metric` with params `{ slot, threshold_source }` (the version's template) |

- Both rules' params (`slots` `[1]`, the shared `labels`, `items`, `extractionMetrics` or `matchingMetrics`, `claimSource`) are schema-checked on every publish (`QC_RULE_PARAMS_SCHEMAS`), and the seed carries them in both templates; the seed label stays `w4a.1`.

**W4-06c amendment (2026-09-28): the v1.0 Sheet-3 band rule.** [W4b plan](implementation-plan-w4b.md) section 3.3, decisions 10, 11, 26, 28 and 30 (provisional until D09; tier words and the metric list are working assumption WA-D09; the band values are the source spec's v1.0 Sheet-3 SL#2.1 bands). The `content` runner also executes `ACC-BAND-V1-SHEET3`, so every content rule of the seeded approve-attempt selection is implemented and a seeded `llm` or `other` approve attempt completes; `PACK-CONTRADICTION` (submit) follows in W4-06d.

| `ruleId` | Trigger | Slots read, owning lane | Fires when (W4b provisional) | Severity (seed) | Evidence, measure, message |
|---|---|---|---|---|---|
| `ACC-BAND-V1-SHEET3` | approve_attempt | slot 1 on the AI/COE attempt → AI/COE; DPO and IT/Security attempts read nothing | Template `v1.0 Sheet3` only (the seed lists it there only, publishing it elsewhere is `rule_template_isolated`, and the rule raises nothing on another template). A claim on the hallucination item citing a metric in `params.bandMetrics` (seed: `hallucination_rate`) with a `percent` or `ratio` value, whatever its answer: its rate in percent (a ratio × 100, exactly on the decimal string) is **≥** `params.bands[tier]` (seed `{ high: '1', medium: '2', low: '3' }`; strict less-than passes, so equal fails), or its `tier` is missing or matches no word of `params.tiers`. A claim with no value, an unparseable value or a count is not judged | high | One finding per such claim, `claimKey` as for `ACC-METRIC-CITED`; evidence = the claim's locator and `excerptHash`; `measure` = `{ metric: <cited ID>, value: <rate in percent>, denominator: <stated number or null>, threshold: <band, null when the tier is missing>, unit: 'percent', thresholdSource: 'v1.0 Sheet3' }`; message `qc.finding.acc_band_v1_sheet3` with params `{ slot, tier, value, threshold, threshold_source, item? }` (exact decimal strings), or `qc.finding.acc_band_v1_sheet3_tier_missing` with `{ slot, value, threshold_source, item? }` |

- Its params (`slots` `[1]`, the shared `labels`, `items`, `bandMetrics`, `tiers` with English and Thai words, `bands` as non-negative decimal strings, `claimSource`) are schema-checked on every publish; the seed carries them on the `v1.0 Sheet3` entry; the seed label stays `w4a.1`.

**W4-06d amendment (2026-09-28): the pack contradiction rule.** [W4b plan](implementation-plan-w4b.md) section 3.3, decisions 10, 28 and 30 (provisional until D09; the fact list and keywords are working assumption WA-D09). The `content` runner also executes `PACK-CONTRADICTION`, the only submit content rule, so every content rule the seeded catalogue lists is implemented. `IMPLEMENTED_RULES` lists it (`content`, `submit`), and a server test keeps the registry's `content` entries equal to `CONTENT_RULES`.

| `ruleId` | Trigger | Slots read, owning lane | Fires when (W4b provisional) | Severity (seed) | Evidence, measure, message |
|---|---|---|---|---|---|
| `PACK-CONTRADICTION` | submit | `params.slots` (seed 2 and 5), each fact compared across its own `params.facts[].slots`; pack → AI/COE | Two different attached artifacts state the same fact (`params.facts`, seed `personal_data` and `external_vendor`; a claim whose item by `params.items` keywords is the fact) with different `yes`/`no` answers. `na` and unrecognised answers state nothing; two answers inside one artifact, agreeing facts and facts one artifact states are not findings. Selected for every `model_type` | medium | One finding per contradicting fact, pack scope, `claimKey` = the fact ID (`findingKey` `PACK-CONTRADICTION:pack:<fact>`); evidence = two entries in slot order, the first statement and the first statement of another artifact with the other answer, each with its locator and `excerptHash`; `measure` null; message `qc.finding.pack_contradiction` with params `{ fact, slotA, slotB }` |

- Its params (`slots`, the shared `labels`, `items` keyed by fact ID, `facts` of `{ id, slots }` with at least two slots each, `claimSource`) are schema-checked on every publish, plus a cross-field check (`packContradictionParamsProblems`: each fact once, with keywords, on read slots only; no keywords without a fact) that publishing refuses and the runner treats as `runner_error` / `invalid_rule_params`. The seed carries them in both templates; the seed label stays `w4a.1`.
- An unreadable slot 2 or 5 makes the submit content part unavailable (`artifact_unreadable`), never clean; the submit metadata part keeps its findings (decision 27, W4-18).

### 3.6 Owning lane and the QC-unavailable finding

Every stored finding carries `owningLane` because D05 makes the owning lane the authority for waived and N/A dispositions and the confirmer of the owner's proposed "fixed" (W2-05). The value comes from the **W0-06 owning-lane assignment rule** ([section 7](workflow-transition-and-error-contract.md#7-owning-lane-assignment)), which this spec applies and does not extend:

- **Recorded (W0-06 7.1):** a `defect` finding whose slot is 1, 2, 3, 4, 6, 7 or 8 is owned by the one lane that reviews that slot under the mapping recorded on the version (`lane-mapping/v1`: slot 1 → `ai_coe`; 2, 3, 4 → `dpo`; 6, 7, 8 → `it_security`), through `owningLaneRule(scope, mapping)`. The runner sets that value; the orchestrator checks it (3.4 step 5).
- **Recorded (W0-06 7.3, 2026-09-25):** slot 5 belongs to the lane whose rule raised it (on an approve attempt, the run's lane); slot 9 carries no `defect`; the pack belongs to AI/COE; an `unavailable` finding follows the run (`unavailableOwningLane`: the approving lane, or AI/COE on submit); nothing is carried to N+1. The substitute still returns `unavailable` with no lane; the orchestrator assigns one when it stores the finding below. The scripts carry one slot-5 and one pack-level `defect` (3.5) and still no slot-9, run-scoped or `QC-UNAVAILABLE` finding (3.9).

**QC-unavailable finding.** When the result is `unavailable` (timeout, runner error, not configured, unreadable artifact), the orchestrator appends one finding per open scope: the first outage for a version, trigger and lane appends it, and further outages reuse it while it is undispositioned (3.4 step 6):

```ts
{
  findingKey: `QC-UNAVAILABLE:run:${trigger}:${lane ?? '-'}`,
  ruleId: 'QC-UNAVAILABLE',
  ruleRevision: request.qcRulesRevision,
  trigger: request.trigger,
  scope: { kind: 'run', trigger: request.trigger, lane: request.lane },
  severity: 'high',
  owningLane: unavailableOwningLane({ trigger: request.trigger, lane: request.lane }, mapping), // W0-06 7.2
  evidence: [{ artifactId: null, contentHash: null, slot: null, locator: { kind: 'absent' } }],
  measure: null,
  message: { key: 'qc.finding.unavailable', params: { reason, trigger, rulesEvaluated: 0 } },
  provenance: { runner: 'orchestrator', runnerVersion: /* server version */ }
}
```

Stored as a `qc_finding` row with `kind = 'unavailable'` (W0-04). It is dispositioned like any other finding (fixed by a later completed run, recorded by the owning lane, or waived with a reason). It is never auto-closed by a later successful run; the later run's findings are appended beside it, and the QC-unavailable finding stays `open` until a person dispositions it. This is what makes A08 "QC failure is visible, not clean-pass" and the threat-model row "QC/model outage presented as clean evidence" testable. The `unavailable` run row is also visible: it is the body of the lane-QC run endpoint for `approve_attempt` and on the version's QC log for `upload` and `submit` (3.8), in the operator view (W0-10 `unavailableQc`, section 7) and in the log; and the W2-07 reviewer workspace renders it before the decision controls (W0-06 4.4).

**W4-04 amendment (2026-09-27): the upload outage key and owner.** Register row "D05 refinement (upload slot 5 and 9)" (Ta, 2026-09-26). An upload run's QC-UNAVAILABLE finding is owned by `unavailableOwningLane({ trigger: 'upload', slot }, mapping)`: the slot's single lane for slots 1-4 and 6-8, AI/COE for slot 5 (as on submit and for the pack); for slot 9 the function returns `null`, and the trigger fires no run, so no such finding exists. The function is overloaded so submit and approve-attempt callers keep a non-null lane. Because an upload run has no lane, its open scope is the owning lane: `findingKey = QC-UNAVAILABLE:run:upload:<owningLane>`, reused per version and owning lane while undispositioned. Outages on slots of different lanes stay distinct; a repeat on one lane appends a run row and reuses the open finding. An upload outage carried into the submitted version counts against Ready like any open finding (A08). The operator view's `unavailableQc` rows derive the same owning lane from the run's `slot`.

### 3.7 Idempotency and replay

```ts
runKey = sha256(versionId | trigger | (lane ?? '-') | qcRulesRevision | sorted(`${slot}:${contentHash}` for each request.artifacts[i]))
```

`runKey` is the identity of a QC input. The `slot:contentHash` pair, not the bare hash, is what identifies it: the same bytes attached to two slots are two placements with two sets of completeness rules (source spec, QC triggers: "On each upload: that artefact's own completeness rules"), so on the `upload` trigger, where `versionId` is the draft ID, uploading the same file to a second slot on the same draft yields a different key. `artifactId` is not part of the key: it is a row identity, and two rows with the same `(slot, contentHash)` are the same QC input. The key is carried on the request and in the run result; section 10 proposes it as a `qc.run.started` field to W0-10, whose 3.3 catalogue does not list it yet, so it is not on the log line until then (section 7). W0-04's `qc_run` has no `run_key` column; section 10 proposes one. Until it exists the orchestrator finds "the latest recorded run for the same input" through the W0-04 columns, which is exact for the two triggers where a replay can occur:

| Trigger | How a repeat is recognised | Behaviour |
|---|---|---|
| `submit` | The version is frozen, so `(version_id, trigger = 'submit', rule_revision)` identifies the input. A retried submit request replays through the W0-06 5.3 idempotency record and never reaches the orchestrator; the lookup is a defensive check only. | Latest row `completed` → **replay**: return the existing run, nothing appended. Latest row `unavailable` or none → **new run**. |
| `approve_attempt` | The version is frozen, so `(version_id, trigger = 'approve_attempt', lane, rule_revision)` identifies the input. A reviewer reopening the approve action requests the run again (W0-06 4.4). | Latest row `completed` → **replay**: return the existing run, so the reviewer's `qc_run_id` stays the latest lane-QC run and W0-06's `qc_run_superseded` check does not fire for a mere reopen. Latest row `unavailable` → **new run**: QC runs again; its findings are appended beside the earlier run's record (beside its still-open QC-unavailable finding, which is never auto-closed). A transient timeout therefore never makes a lane's QC on a version permanently unavailable. |
| `upload` | The draft's slot reference changed (W1-03 fires the trigger only then), so every trigger is a new input by construction; the same bytes re-attached to the same slot without an intervening change fire no trigger at all. | Always a **new run**. Step 6's dedup rule prevents a second open finding for the same `(ruleId, ruleRevision, scopeKey)`. |

Concurrency: two triggers for one `runKey` in the same process share the in-flight promise (3.4 step 2), so at most one runner call is in progress per key; the single-process deployment of ADR-0003 makes this sufficient in slice 1, and the W4 worker option replaces the table with `pg_advisory_xact_lock(hashtext(runKey))` held across step 6. Runs are additions, never rewrites: a later run never changes an earlier run's row or any finding it produced (W0-04: `qc_run` and `qc_finding` are immutable). A deliberate re-run (a future Admin "recheck under revision Y", W6) has a different `qcRulesRevision` and therefore a different key, and it is an explicit recorded recheck, never a rewrite.

### 3.8 Error contract

| Situation | Where it surfaces | Code (ADR-0003, W0-06 8.1) |
|---|---|---|
| Runner timeout, runner error, not configured, artifact unreadable | The business action (upload, submit, decision) **succeeds** and, for `upload` and `submit`, **its response does not wait for QC** (W0-06 4.3 "The submit response does not wait for QC"; the `upload` trigger likewise fires after commit, 3.2), so it carries no QC field. Only the lane-QC run endpoint of W0-06 4.4 (`approve_attempt`, added by the W2-02 contract PR) answers synchronously with the run body `{ runId, status: 'unavailable', reason, findings }`, `findings` carrying the QC-unavailable finding (3.6), because the reviewer must see the run before the decision controls. For `upload` and `submit` the run, `completed`, `unavailable` or late (3.4 step 6), becomes visible after the fact on the version's QC log (the source spec's append-only log per version, which the W2-07 and W2-09 views read), in the operator view `unavailableQc` (W0-10 7.2) and on the `qc.run.*` log line that carries the action's correlation ID | Not an HTTP error on the action. A future endpoint whose only purpose is to return a QC result (none in slice 1) answers `503 qc_unavailable` with the same body as the run endpoint |
| Runner output fails schema validation or the owning-lane check | Same as above with `reason: 'runner_error'` | Same |
| Findings arrive after the version is Ready | The append is refused (3.4 step 6); nothing is written; one `qc.run.late` line (section 7, registered in W0-10 3.3 at W0-09) is the record, and an operator-view `lateQc` row once W3-07 adds the durable record proposed in section 10; the lane-QC run endpoint cannot reach this case (W0-06 4.4 preconditions) | Not an error on any action; no HTTP code |
| Caller passes an artifact the actor may not read | Cannot happen through the orchestrator (it builds the list from the authorized version); a unit test asserts the request builder throws `forbidden` before any runner call | `403 forbidden` on the originating action |
| Stale version on `approve_attempt` (reviewer's expected version ≠ current) | W2-02 rejects the decision before QC is asked | `409 stale_version` |
| Approval carries a `qc_run_id` that is not the latest lane-QC run | W2-02 rejects the decision (W0-06 4.4); a replayed `completed` run keeps its ID (3.7) | `409 stale_version` (`qc_run_superseded`) |
| Actor asks for QC on a case out of scope | Rejected by W0-05 before the orchestrator | `403 forbidden` |

Nothing QC-related ever returns `unauthenticated`, `unsafe_upload`, `invalid_input` or `mail_delivery_failed`; those belong to the actions around it.

### 3.9 Test substitute (W1-10)

Name: `ScriptedQcRunner`, `identity = { runner: 'substitute-scripted', runnerVersion: <package version> }` (the W0-04 `engine_id` value). Selected by `QC_MODE=substitute`, the only slice-1 value W0-02 section 5 defines. It is the slice-1 app-path runner (W2-05 needs synthetic findings in the real server), so it is not "absent from non-test configuration" the way the W1-13 UI substitute is; instead **readiness (W0-10) reports `qc.kind = 'substitute'`, and startup configuration validation (W1-00) refuses `production` identity mode together with `QC_MODE=substitute`** (fail closed, same posture as the W0-03 modes). W4 replaces it behind the same port.

Behaviour:

- **Script selection.** A script is a JSON file listing `QcFinding` values (without `findingKey`'s server-assigned ID) keyed by `(fixtureCaseId, trigger, lane?)`. Fixture case IDs follow the W0-02 fixture identity convention (`fx-case-<kind>`) and are the W1-09 cases (non-vendor, vendor, missing slot, N/A reasons). Scripts ship inside the substitute's package directory and are read relative to the module; no configuration key names them. A request whose version belongs to a fixture case with a script returns those findings, after the substitute rewrites `ruleRevision` to `request.qcRulesRevision` and validates each finding's `scope` against the request's slots and artifacts (a script that names an artifact not in the request is a script bug and the substitute throws in tests). A request with no matching script returns `completed` with zero findings and `rulesEvaluated: []`.
- **Test control API** (only on the instance; not reachable over HTTP):

```ts
export interface ScriptedQcRunnerControl {
  script(selector: { fixtureCaseId: string; trigger: QcTrigger; lane?: Lane }, findings: QcFinding[]): void;
  simulateTimeout(mode: 'hang' | 'immediate', selector?: { versionId?: string } | 'next'): void;
    // 'hang': never resolves until `signal` aborts, then rejects with AbortError — exercises the orchestrator timer
    // 'immediate': resolves { status: 'unavailable', reason: 'timeout' } at once — keeps suites fast
  simulateError(reason: 'runner_error' | 'artifact_unreadable', selector?: 'next'): void;
  health(answer: 'ok' | 'unavailable' | 'disabled'): void;     // the readiness probe answer (W0-10 section 8.1); default 'ok'
  calls: ReadonlyArray<{ request: QcRunRequest; at: string }>;   // every request received, for assertions
  reset(): void;
}
```

- **Determinism.** Same request, same script, same output, including `startedAt`/`finishedAt` order. No randomness, no clock dependence beyond timestamps.
- **No network, no filesystem writes.** The substitute reads script JSON at construction; it never opens a socket and never writes a file.

Tests W1-10 must ship (all `node:test`, unit layer, colocated in `rai-web/fixtures/src/substitutes/qc/`, no Postgres):

| Test | Asserts | Done-when clause |
|---|---|---|
| returns scripted findings for a version reference | `completed`, findings deep-equal the script after `ruleRevision` rewrite, each `scope` resolves to a request slot/artifact | "Returns scripted findings for a version ref" |
| unscripted version yields zero findings, not unavailable | `completed`, `findings.length === 0` | same |
| `unavailable` on demand, for every trigger | `simulateError('runner_error')` → `unavailable` on `upload`, `submit` and `approve_attempt`; the result has no lane field; `detail` contains no filename, document text or email | "returns `unavailable` on demand"; W0-06 7.4 |
| simulated timeout, both modes | `'immediate'` → `unavailable:timeout` in < 50 ms; `'hang'` → the call resolves only after `signal` aborts, and a caller with a 100 ms timer observes `timeout` | "simulates a timeout" |
| no write path to workflow state, structural | walking the substitute's module graph (`import.meta.resolve` over its files) reaches nothing under `rai-web/server`, no `drizzle-orm`, `pg`, `fastify`, `node:fs` write APIs, `node:net`, `node:http`; only `rai-web/shared` and `node:` read-only modules | "a test asserts it has no write path to workflow state" |
| no write path, behavioural | the request object is deep-frozen before the call and unchanged after; a store spy passed nowhere records zero calls; `artifacts[i].read` is the only capability and the run for a `submit` script never invokes it | same |
| schema conformance | every scripted finding passes the shared validator; a finding carrying an `excerpt` (or any document-text) field, or an `excerptHash` that is not 64 lowercase hex characters, fails | supports orchestrator step 4 |
| owning lane follows W0-06 section 7 | every finding in every script satisfies `owningLaneRule` for its scope under the script's `laneMappingVersion` (single-lane slot: that lane; slot 5: a reviewing lane, the entry's lane on an approve attempt; pack: AI/COE); one slot-5 and one pack-level finding are scripted; no script contains a slot-9 finding, a `run`-scoped finding or `ruleId = 'QC-UNAVAILABLE'` (the substitute throws at construction on any of these) | W0-06 7.3 as recorded 2026-09-25; section 3.6 |
| health answer reaches readiness | `health('unavailable')` → the W0-10 `qc` probe reports `unavailable` and readiness stays `ready` (QC does not gate readiness) | W0-10 section 5.3 |
| fail closed on configuration (owner W1-00 for the loader, W1-10 for the runner identity it selects, same pattern as the 4.8 "no external mail path" row) | the config loader with identity mode `production` and `QC_MODE=substitute` throws at startup, naming the key; `QC_MODE` unset, or any value other than `substitute` (for example `scripted`, `none`, `model`), throws in every identity mode, since W0-02 section 5 defines no other value; readiness reports `qc.kind = 'substitute'` and the operator view labels the runner `substitute-scripted` | 3.9 opening paragraph, section 6, W0-02 section 5 |

Integration tests that consume the substitute belong to W2-05 (record and disposition of single-lane findings; an `unavailable` result inserts an `unavailable` run row and is never treated as zero findings; a replayed `approve_attempt` after `completed` returns the same run and appends nothing; a second `approve_attempt` after `unavailable` runs again and appends its findings while the earlier `unavailable` run stays recorded; the same bytes uploaded to two slots on one draft produce two runs with distinct `runKey`s, each evaluating its own slot's rules; a raw `UPDATE qc_run` as `rai_app` fails; **findings arriving after Ready are refused, not appended** (the A09 "concurrent final approvals with new findings" negative case, shared with W2-06): the test wraps the substitute in a test-local `QcRunner` that awaits a gate before delegating, submits a scripted fixture case so a `submit` run is held open, brings the version to Ready through three approvals and the dispositions, releases the gate, and asserts that no `qc_finding` and no `qc_run` row exists for that run, `ready_at` is unchanged, the case status still reads Ready, and exactly one `qc.run.late` line carries the submit's `correlationId`, `versionId`, the `qcRunId` from its `qc.run.started` line and `refusedFindingCount` equal to the script's length; the mirror case, the same gate released after a send-back instead of Ready, writes nothing to the closed version either (amended 2026-09-26, section 3.4 step 6); the storage of the QC-unavailable finding, its dedup per open scope, the slot-5, slot-9, pack-level and outside-lane cases, the Ready gate and the carry-over case are in `tests/integration/w2-05-owning-lane.test.ts` under W0-06 7.3 as recorded), W2-07/W2-09 (rendering, disposition UI) and W3-07 (a simulated timeout appears once in the operator view and in the log with the same correlation ID).

**W4-13 amendment (2026-09-27): a real `QC_MODE` value and the production refusal.** [W4a plan](implementation-plan-w4a.md) section 2. The substitute is no longer the only runner: `QC_MODE=deterministic` binds the W4a metadata runner (3.5 W4-03 amendment) behind the same port in every environment, without ADR-0006, which stays W4b's for the content and model runner. The "fail closed on configuration" row now reads: `config.ts` refuses `QC_MODE=substitute` with `invalid:QC_MODE`, exit 78, when `NODE_ENV=production` **or** the identity mode is not local (`fixture`, `local-google`), so the refusal this section always required of the loader is now enforced, and a production process never runs silently without QC. `QC_MODE` unset (`missing:QC_MODE`) and any value other than `deterministic` or `substitute` (`invalid:QC_MODE`) are refused in every identity mode, and no runner falls back to the other. Readiness reports `qc.kind` from the bound runner: `deterministic` for the W4a runner, `substitute` for `substitute-scripted`, and the configured mode when the substitute cannot be loaded (`status = 'disabled'`). The test suites and CI keep `QC_MODE=substitute` explicitly.

**W4-04 amendment (2026-09-27): the bundled scripts carry no `upload` entry.** [W4a plan](implementation-plan-w4a.md) section 5. Once the upload trigger is bound, every suite that re-attaches a slot under `QC_MODE=substitute` would have written the scripted upload findings. Upload content rules are W4b's, and no test asserted an upload finding, so the `upload` entries of `fx-case-nonvendor.json` and `fx-case-vendor.json` are removed. The script format still accepts `upload` entries, and the substitute still scopes them to the uploaded slot (tested with an inline script); an unscripted trigger still answers `completed` with zero findings and `rulesEvaluated: []`, so under the substitute an upload run is recorded clean with no finding.

## 4. Mail sink

### 4.1 Placement: transactional outbox, then a sink

Mail is a notification, never the record (source spec). The chain is:

1. A business event commits (lane opened at submit or resubmit, send-back, Ready, or the daily SLA-breach digest generation). **In the same transaction** the notifier (W3-03) inserts one `notification` row per recipient (W0-04), status `queued`, with the D06 dedup identity as its unique constraint. A rolled-back transition therefore has no notification row and nothing is ever sent for it ("No mail exists for a rolled-back transition").
2. After commit, the dispatcher (W3-03, retry policy in W3-04) reads `queued` rows and calls the sink once per row.
3. The sink returns a `DeliveryReceipt`; the dispatcher records it on the row's four delivery columns (`status`, `attempts`, `next_attempt_at`, `last_error_code`; W0-04, the only updatable columns). Failure schedules a retry; the fourth failure marks the row `failed` and it appears in the Admin/operator view (D06, W3-07).

The sink is single-attempt and stateless with respect to retry. It does not know about the workflow, the case, the version's contents or the actor.

### 4.2 Interface, TypeScript notation

```ts
// rai-web/shared/src/mail/types.ts  (W1-00 creates; W1-11 and W3-03/W3-04 consume)

import type { Lane } from '../constants.js';

export type MailEventKind = 'lane_opened' | 'sent_back' | 'ready_for_launch' | 'sla_breach_digest';
export type Locale = 'th' | 'en';                 // D12; 'th' is the default

/** The W0-04 `notification.event` column value for each kind, 1:1; the first component of the dedup key (4.4). */
export const NOTIFICATION_EVENT_BY_KIND = {
  lane_opened: 'lane_open',
  sent_back: 'send_back',
  ready_for_launch: 'ready',
  sla_breach_digest: 'sla_breach_digest',
} as const satisfies Record<MailEventKind, string>;
export type NotificationEvent = (typeof NOTIFICATION_EVENT_BY_KIND)[MailEventKind];

/** A business event that has already committed. The sink cannot be handed an uncommitted one. */
export interface CommittedEvent {
  kind: MailEventKind;
  caseId: string | null;                 // null only for sla_breach_digest
  versionId: string | null;              // null only for sla_breach_digest
  versionNumber: number | null;
  digestDay: string | null;              // sla_breach_digest only: the digest's calendar day as `YYYY-MM-DD` in Asia/Bangkok (D06), the second dedup-key component (4.4);
                                         // null for every other kind. Set once by the W3-03 digest job from the instant the job run started (the W0-10 7.3 job-run `started_at`; the W3-05 fixture clock in tests) converted to Asia/Bangkok, never from a recipient's clock
  lane: Lane | null;                     // lane_opened: the opened lane; sent_back: the deciding lane (W0-04); ready_for_launch, digest: null
  auditEventId: string;                  // the audit event written with the state change (W0-04); proof it committed
  committedAt: string;                   // ISO-8601 UTC
  correlationId: string;                 // W0-10; shared with the audit event, the notification row and the log line
}

export interface AuthorizedRecipient {
  recipientId: string;                   // subject ID for a person; `operator_recipients:<n>` for a configured address. Metadata only: not part of the dedup key (4.4)
  address: string;                       // the W0-04 `notification.recipient` value and the fourth dedup-key component (4.4); must satisfy the synthetic-domain rule in 4.6 while slice 1 runs
  displayName: string | null;
  locale: Locale;
  basis: 'case_view_scope' | 'operator_recipients';   // W0-05 recipient rows: lane-open/send-back/Ready follow case-view scope; the digest follows configuration
}

/** Built by the server, never by a template or a document. Carries no secret and grants nothing. */
export interface SafeDeepLink {
  url: string;                           // `${PUBLIC_BASE_URL}${path}`; path is one of the canonical case routes; no query string, no fragment, no token
  route: 'case' | 'case_version' | 'queue_sla_breach';   // the canonical route the path was built from; the SPA owns the path strings
  caseId: string | null;                 // the case the path opens; null only for queue_sla_breach
  requiresSignIn: true;                  // the recipient must sign in and be in scope (A05)
}

/** One breached case in the operator digest (source spec Notifications table: "the list of cases past SLA, links to each"). */
export interface DigestCaseRef {
  caseId: string;
  lane: Lane;                            // the lane past its SLA (W3-05 breach query)
  deepLinkIndex: number;                 // index into DeliveryRequest.deepLinks; that link has route 'case' and caseId === this caseId
}

export interface RenderedMail {
  subject: string;                       // rendered from the locale template for recipient.locale; UTF-8; Thai-safe
  textBody: string;                      // plain text; contains every deep link; never document contents or finding evidence
  templateKey: string;                   // e.g. 'mail.lane_opened'; the D12 locale key
  templateParams: Record<string, string | number>;   // scalar params: caseName, laneLabel, findingCount (W3-F3: the lane's findings recorded so far, defects and QC-unavailable findings alike, dispositioned or not; recomposed per attempt, so it may differ between a failed attempt and the delivered one), dueDate (D06 timezone), feedback summary
                                         // the digest's per-case list is `digestCases`, not a param; the template renders it as one line per case with its link
}

export interface DeliveryRequest {
  dedupKey: string;                      // section 4.4; the W0-04 `notification` unique index (event, version_id, lane, recipient) as one string, D06
  event: CommittedEvent;
  recipient: AuthorizedRecipient;
  deepLinks: SafeDeepLink[];             // at least one. lane_opened, sent_back, ready_for_launch: exactly one, route 'case' or 'case_version', caseId === event.caseId. sent_back uses 'case' (W3-F4, 2026-09-26): the case page shows the owner's successor draft; the others use 'case_version'.
                                         // sla_breach_digest: one route 'case' link per breached case (A05 "correct authorized case links"), optionally plus one 'queue_sla_breach' link
  digestCases: DigestCaseRef[] | null;   // non-empty for sla_breach_digest; null for every other kind
  mail: RenderedMail;
  attempt: number;                       // 1..4 (D06: three retries)
}

export type DeliveryStatus = 'delivered' | 'failed' | 'duplicate';

export interface DeliveryReceipt {
  dedupKey: string;
  status: DeliveryStatus;
  attempt: number;
  at: string;                            // ISO-8601 UTC
  sinkMessageId: string | null;          // set when delivered; the sink's own handle (file name, memory index)
  error: { code: 'malformed_request' | 'sink_failure' | 'rejected_recipient' | 'unsafe_link' | 'duplicate'; message: string } | null;
                                         // message: no address, no case content. malformed_request: the message names the offending field
                                         // (4.3); sink_failure: forced or real sink failure, or an oversize payload with the size in the message
}

export interface MailSink {
  readonly identity: { sink: 'memory' | 'file'; version: string };   // the W0-10 ReadinessReport.mailSink.kind values
  deliver(request: DeliveryRequest): Promise<DeliveryReceipt>;
}
```

The four `MailEventKind` values are the four rows of the source-spec notification table and map 1:1 onto the W0-04 `notification.event` values through `NOTIFICATION_EVENT_BY_KIND` (`lane_opened` → `lane_open`, `sent_back` → `send_back`, `ready_for_launch` → `ready`, `sla_breach_digest` → `sla_breach_digest`); the stored column and the dedup key use the W0-04 value, the TypeScript union names the business event. The recipients, contents and the due date come from W3-03 and W3-05.

### 4.3 Validation the sink performs (defensive; the notifier already guarantees them)

Before accepting a request the sink checks, and on failure returns `failed` with the named `error.code` without recording a delivery. One bad link fails the whole delivery; the sink never sends a mail with some of its links stripped:

- `deepLinks` is non-empty, and **every** `deepLinks[i].url` starts with the configured `PUBLIC_BASE_URL` and has a path that is one of the canonical routes; no `?`, `#`, or credential-looking segment in any of them → otherwise `unsafe_link` (`error.message` names the failing index, never the URL).
- Every link points where the mail says it does: for `lane_opened`, `sent_back` and `ready_for_launch` there is exactly one link, its `caseId` equals `event.caseId` and `digestCases` is `null`; for `sla_breach_digest` `digestCases` is non-empty, every `deepLinkIndex` is in range, the indexed link has `route = 'case'` and `caseId` equal to the entry's `caseId`, and every `route = 'case'` link is referenced by exactly one entry → otherwise `unsafe_link`.
- `recipient.address` satisfies the synthetic-domain rule (4.6) → otherwise `rejected_recipient`.
- `mail.textBody` contains every `deepLinks[i].url` (the links are the point of every mail; the digest lists one line per breached case with its link) → otherwise `unsafe_link` (`error.message` names the missing link's index).
- `event.auditEventId` is a non-empty string (a request without a committed audit event is malformed; the notifier never builds one) → otherwise `malformed_request` (`error.message` names the field, `event.auditEventId`, and nothing else from the event).
- The dedup identity is complete: for `sla_breach_digest`, `event.digestDay` matches `^\d{4}-\d{2}-\d{2}$` and `event.versionId` is null; for every other kind `event.versionId` is a non-empty string and `event.digestDay` is null → otherwise `malformed_request` (`error.message` names the field, `event.digestDay` or `event.versionId`, and nothing else).
- Payload size is bounded: `mail.subject` ≤ 998 bytes after UTF-8 encoding (RFC 5322 line limit, with encoded-word folding left to a real transport), `mail.textBody` ≤ 64 KiB (65 536 bytes) after UTF-8 encoding → otherwise `sink_failure` (`error.message` names the field and its byte size, never its contents).

The checks run in the order listed; the first failure is the receipt's `error`. `malformed_request` is reserved for a structurally invalid request (a missing committed event or an incomplete dedup identity); a request that is well-formed but unsafe or oversize takes the more specific code above, so the dispatcher (W3-04) can distinguish a request it must rebuild (`malformed_request`, `unsafe_link`, `rejected_recipient`) from a sink-side failure (`sink_failure`); the retry policy itself stays in 4.5.

### 4.4 Dedup key

D06: deduplicated by (event, version, lane, recipient). The key is a string the notifier builds from the same four values, in the same spelling, that the W0-04 `notification` unique index `UNIQUE (event, version_id, lane, recipient)` holds, so the sink's `duplicate` answer and the database constraint name one identity:

```ts
// rai-web/shared/src/mail/dedup.ts  (W1-00 creates; W3-03 builds the key with it, W1-11 tests assert on it)
export function buildDedupKey(event: CommittedEvent, recipient: AuthorizedRecipient): string {
  const version = event.kind === 'sla_breach_digest' ? event.digestDay : event.versionId;
  if (version === null || version === '') {
    // never emit a key containing 'null': the sink's 4.3 check is the defensive copy of this rule
    throw new RangeError(event.kind === 'sla_breach_digest' ? 'event.digestDay' : 'event.versionId');
  }
  return `${NOTIFICATION_EVENT_BY_KIND[event.kind]}:${version}:${event.lane ?? '-'}:${recipient.address}`;
}
```

The function is pure and takes only the two typed inputs; every component comes from a field of `CommittedEvent` or `AuthorizedRecipient` (4.2), so the notifier, the dispatcher, the sinks and the W1-11 tests build the same string from the same event without any outside value.

- **First component: the W0-04 `event` column value**, never the TypeScript `MailEventKind` name: `lane_open`, `send_back`, `ready`, `sla_breach_digest` (the 1:1 table in 4.2). A key that read `lane_opened:…` would be unique in the sink while the row it belongs to reads `lane_open`, and the two would disagree on what is a duplicate.
- **Second: `versionId`** for lane-open, send-back and Ready (the W0-04 `version_id` column). Resubmission produces a new version and therefore new keys, so lanes reopened on v2 are notified again (D05 full re-review).
- **Third: `lane`**, the W0-04 `lane` column: the opened lane for `lane_opened` and the deciding lane for `sent_back`, so two lanes sending back the same version to the same owner are two keys; `'-'` for `ready_for_launch` and the digest, the value W0-04 stores for the two events without a lane.
- **Fourth: `recipient.address`**, the W0-04 `recipient` column (an email address). `recipientId` is metadata on `AuthorizedRecipient` for the audit and scope trail and is **not** part of the identity: the same address reached through two subject IDs (a person who is both a case owner and a configured operator recipient) is one recipient under D06, as it is one row in W0-04. Because the key contains an address, it is personal data under the W0-10 redaction rule: it is never logged (the `mail.*` lines carry `notificationId`), and the file sink hashes it before it becomes a file name (4.7).
- For `sla_breach_digest` the version position holds **`event.digestDay`**, the digest's calendar day as `YYYY-MM-DD` in Asia/Bangkok (D06 calendar), and lane is `-`, keeping the D06 tuple shape with one digest per recipient per day. The day is a field of the committed event (4.2), set once by the W3-03 digest job from the instant the job run started (the W0-10 7.3 job-run `started_at`; the W3-05 fixture clock in tests) converted to Asia/Bangkok, so every recipient's key for one run names the same day and a run that starts at 23:59 Bangkok time and finishes after midnight still produces one day; it is not derived from `committedAt` at key-building time and not from any recipient's clock. W0-04 stores `version_id` NULL for the digest, and a NULL does not collide under the unique index, so the per-day identity is enforced by this key in the dispatcher and the sinks until W3-03's contract PR confirms the mapping (or records the day on the row; section 10).

The dispatcher never sends a key it has already recorded as `sent`. The sinks keep their own index of accepted keys and answer `duplicate` for a repeat, which the dispatcher treats as success without a second delivery (A05 "retry avoids duplicate events").

### 4.5 Retry and failure (owned by W3-04, stated here so the sink contract matches)

- Attempts 1 to 4 (one send plus three retries, D06). Backoff between attempts: proposed 1 s, 5 s, 25 s local, held as a constant in the W3-04 dispatcher module (section 10 proposes a `MAIL_RETRY_BACKOFF_MS` key to W0-02 if W3-04 wants it configurable); W3-04 confirms the numbers. Only `failed` receipts schedule a retry; `duplicate` and `delivered` end the row.
- After the fourth failure the row is `failed` permanently, carries the last `error`, and is listed for Admin and the operator audience (D06, W3-07). The ADR-0003 code `mail_delivery_failed` (502) is the row's error code, exposed on the notification record and the operator view; **it is never returned to the actor whose decision committed the event**, because that decision has already committed and is not undone (workflow contract "Mail failure does not undo a valid human decision").
- Retries reuse the same `dedupKey` and increment `attempt`.

### 4.6 Content and safety rules

- **Locale keys (D12).** `RenderedMail.templateKey` and `templateParams` are recorded alongside the rendered text so the mail can be re-rendered in the other language and so tests can assert on keys, not on Thai or English prose. Thai default. Subjects are UTF-8 strings in the sink; RFC 2047 encoding belongs to a real transport, not to the sinks. A Thai subject round-trips unchanged through both sinks (W3-03 "a Thai subject line is intact").
- **Nothing sensitive in mail.** No attachment, no document contents, no finding evidence, no evidence panel text. Lane-open carries the defect *count*; send-back carries the reviewer's feedback summary that the reviewer typed (it is the reviewer's text, not document text) truncated to 500 code units. Threat model: deep links instead of contents.
- **Safe deep links.** A link is a location, not a capability. A recipient who follows it is sent through sign-in and the W0-05 scope check; an out-of-scope recipient gets `forbidden`. No token is ever embedded (A05 "recipient cannot gain access from link alone"). The three case-bound events carry one link to the case; the operator digest carries one `case` link per breached case, each validated by the sink (4.3), so the source-spec digest row ("the list of cases past SLA, links to each") is met without an unvalidated URL ever entering `textBody`. The origin is `PUBLIC_BASE_URL` (W0-02 section 5), loopback in the local modes.
- **Synthetic-domain rule (slice 1).** Every recipient address handed to a sink must have a domain under an RFC 2606 reserved name: `*.test`, `*.example`, `*.invalid`, `example.com`, `example.net`, `example.org`. The fixture addresses (`rai-desk.example`, W0-03 section 7, including the single operator recipient `operator-digest@rai-desk.example` of W0-08 section 8.2) satisfy it. Anything else is `rejected_recipient`. This is the sink-level guarantee behind "no external mail during synthetic test" and stays until a real transport is authorized under D10.
- **No external transport.** `MAIL_MODE` accepts exactly `sink-memory` and `sink-file` (W0-02 section 5: "No transport value exists until W7 authorizes one"). There is no `smtp`, no HTTP mail API, no third value; the config loader (W1-00) rejects any other string at startup. A grep-level test in W1-11 asserts that no module under `rai-web/` imports `node:net`, `node:tls`, `nodemailer` or any mail SDK ("no external mail path exists in any configuration"); W0-02's dependency list (section 4) adds no mail transport, on purpose.

### 4.7 Substitutes (W1-11)

Two sinks, both in Lane C's fixtures package (`rai-web/fixtures/src/substitutes/mail-sink/`), both implementing `MailSink`:

**`MemoryMailSink`** (`MAIL_MODE=sink-memory`, the default in tests and CI per W0-02 section 6).

- Keeps `sent: DeliveryRequest[]` and an accepted-key `Set`.
- Control API (instance only, not reachable over HTTP; the `failNext`/`failAlways` names are the ones W0-10 section 8.1 expects):

```ts
export interface MailSinkControl {
  failNext(count: number, code?: 'sink_failure'): void;     // the next `count` deliveries return failed
  failWhen(predicate: (req: DeliveryRequest) => boolean): void;
  failAlways(on: boolean): void;
  find(dedupKey: string): DeliveryRequest | undefined;
  sent: ReadonlyArray<DeliveryRequest>;
  receipts: ReadonlyArray<DeliveryReceipt>;
  reset(): void;
}
```

**`FileMailSink`** (`MAIL_MODE=sink-file`, the `.env.example` default, so a person can read what would have been sent).

- Writes **one JSON file per delivery attempt** (W0-02 section 5, `MAIL_SINK_DIR`, default `./.local/mail`, git-ignored) named `${sha256(dedupKey).slice(0, 16)}-${attempt}.json` with the full `DeliveryRequest` and `DeliveryReceipt`, and beside it `${sha256(dedupKey).slice(0, 16)}-${attempt}.txt` with the rendered subject and body for reading. A rejected request (4.3) writes nothing.
- The accepted-key index is rebuilt from the directory listing on construction (a `.json` whose receipt is `delivered` marks its key accepted), so `duplicate` survives a process restart.
- Same control API as the memory sink (`MailSinkControl`). Forced failure is a control-API call, not a configuration key (section 10 proposes `MAIL_SINK_FAIL_NEXT` to W0-02 for local rehearsal of W3-04 if the lead wants it).
- File names never contain the recipient address or case name: the dedup key is hashed to a safe filename.

Both sinks record the `correlationId` on every file they write and nothing else from the event beyond IDs.

### 4.8 Tests W1-11 must ship (`node:test`, unit layer, colocated in `rai-web/fixtures/src/substitutes/mail-sink/`)

| Test | Asserts | Done-when clause |
|---|---|---|
| accepts the four inputs and returns a status | a valid `lane_opened` request returns `delivered` with `sinkMessageId`, `attempt` echoed, `dedupKey` echoed; a valid `sla_breach_digest` request with three `case` links, three `digestCases` entries and all three URLs in `textBody` returns `delivered` | "Accepts the four inputs and returns a status" |
| forced failure is reported | `failNext(1)` → `failed:sink_failure`; the same request again → `delivered`; `failAlways(true)` → four consecutive `failed` | "a forced failure is reported" |
| duplicate key | second delivery of the same `dedupKey` → `duplicate`, `sent.length` unchanged | D06 dedup |
| dedup key is the W0-04 identity | `buildDedupKey(event, recipient)` (`shared/src/mail/dedup.ts`) for a `lane_opened` event on version `V` opening `ai_coe` to `ai-coe@rai-desk.example` returns `lane_open:V:ai_coe:ai-coe@rai-desk.example` (the W0-04 `event` value, not `lane_opened`); the same event to two `AuthorizedRecipient`s with different `recipientId` and the same `address` returns one key, and to two different addresses two keys; `ready_for_launch` returns `ready:V:-:<address>`; a `sla_breach_digest` event with `digestDay = '2026-09-21'` (and `versionId`, `caseId`, `lane` null) returns `sla_breach_digest:2026-09-21:-:<address>`, the day taken from `event.digestDay` and from nothing else (the test passes `committedAt = '2026-09-20T12:00:00Z'`, the previous day in both UTC and Asia/Bangkok, and the key still reads `2026-09-21`); a `sla_breach_digest` event with `digestDay = null`, or a `lane_opened` event with `versionId = null`, makes `buildDedupKey` throw a `RangeError` whose message is `event.digestDay` / `event.versionId` (no key containing `null` is ever built) | 4.4, W0-04 `UNIQUE (event, version_id, lane, recipient)` |
| unsafe link rejected | a URL on another origin than `PUBLIC_BASE_URL`, with a query string, or with a fragment → `failed:unsafe_link`; nothing recorded. A digest with five `case` links of which one is bad (another origin, a query string, or a `caseId` that differs from its `digestCases` entry) → `failed:unsafe_link` for the whole delivery, `error.message` names the index and not the URL, nothing recorded; a `lane_opened` request whose single link's `caseId` ≠ `event.caseId`, or a digest with a `case` link missing from `textBody`, → `failed:unsafe_link` | A05 |
| non-synthetic recipient rejected | `owner.cm@rai-desk.example`, `operator-digest@rai-desk.example`, `dpo@rai-desk.example` and `ops@rai-desk.test` accepted; `someone@gmail.com` and an address with no domain → `failed:rejected_recipient`, nothing recorded | "no external mail" |
| malformed or oversize request rejected | a `lane_opened` request with `event.auditEventId = ''` → `failed:malformed_request`, `error.message` contains `auditEventId`; a `sla_breach_digest` request with `event.digestDay = null` → `failed:malformed_request`, `error.message` contains `digestDay`; a request whose `mail.textBody` is 64 KiB + 1 byte (65 537 bytes, links intact) → `failed:sink_failure`, `error.message` contains `65537`; a request whose `mail.subject` is 999 bytes → `failed:sink_failure`, `error.message` contains `999`; in all four cases nothing is recorded (`sent.length` unchanged, no file in `MAIL_SINK_DIR`) and the same `dedupKey` delivered afterwards with a valid request → `delivered`, not `duplicate` | 4.3 (negative case of "Accepts the four inputs") |
| Thai subject intact | subject `แจ้งเตือน: เลนเปิดแล้ว` round-trips byte-identical through memory and file sinks | D12, W3-03 |
| file sink restart | write two receipts, construct a new `FileMailSink` on the same directory, redeliver one key → `duplicate` | 4.7 |
| no external mail path | module-graph walk over `rai-web/` finds no `node:net`, `node:tls`, `node:http` client use in the sinks and no mail SDK anywhere; the config loader throws at startup for `MAIL_MODE=smtp`, `MAIL_MODE=sink-smtp`, `MAIL_MODE=memory` (the W0-02 value set is exactly `sink-memory` \| `sink-file`) and for `MAIL_MODE` unset, naming the key | "no external mail path exists in any configuration" |
| no secrets or contents on disk | the file sink's output contains the deep links and IDs, and does not contain the W0-08 fixture sentinel (`RAI-DESK-SYNTHETIC-FIXTURE`, the canary W0-10 4.3 scans for), any password-like config value or the audit event's actor email | threat model |

Integration tests belong to W3-03 (four events, one mail each, rolled-back transition has no mail, deep link without session is `unauthenticated`), W3-04 (three retries with backoff, duplicate sends nothing, committed decision unchanged after permanent failure), W3-07 (a forced failure appears once in the operator view and log with the same correlation ID) and the W3-06 journey.

## 5. Error contract summary for both boundaries

| ADR-0003 / W0-06 error | QC boundary | Mail sink |
|---|---|---|
| `qc_unavailable` (503) | Recorded as the `unavailable` run row and as the QC-unavailable finding (3.6); returned as `status: 'unavailable'` by the lane-QC run endpoint, and visible on the version's QC log for `upload` and `submit`, whose action responses do not wait for QC (3.8); the 503 status itself only on a QC-only endpoint (none in slice 1) | — |
| `mail_delivery_failed` (502) | — | On the notification row after the fourth failed attempt; visible to Admin/operator; never on the actor's action response |
| `forbidden` (403) | The request builder refuses an artifact the actor may not read; W0-05 refuses the action before QC | Deep-link follower out of scope after sign-in |
| `unauthenticated` (401) | — | Deep-link follower without a session |
| `stale_version` (409) | W2-02 rejects the decision before `approve_attempt` QC runs; `qc_run_superseded` when the approval names a run that is not the latest (W0-06 4.4) | — |
| `invalid_input` (422) | Never from QC; a malformed runner result is `unavailable:runner_error` | Never from the sink; malformed requests are `failed` receipts with a named `error.code` from the 4.2 union (`malformed_request`, `unsafe_link`, `rejected_recipient`, `sink_failure`), per 4.3 |
| `unsafe_upload` (422) | Never from QC; W1-03 rejects bytes before QC sees them | — |

## 6. Configuration keys

[W0-02 section 5](implementation-plan-w1-w3.md#5-local-configuration-and-secrets) is the register of configuration keys; W1-00 creates `.env.example` from it and `server/src/config.ts` parses every key. This section states how the two boundaries read the keys that register already defines and how they fail closed. No key holds a credential; networked or production mail credentials, if a transport is ever authorized, live in the D10 custody mechanism (W0-03 secrets rule), not here.

| Key (W0-02) | Values (W0-02) | Read by | Fail-closed rule this spec adds |
|---|---|---|---|
| `QC_MODE` | `substitute` | the runner selection in `server/src/qc/` | Unset or any other value fails startup naming the key; `production` identity mode with `substitute` fails startup (3.9 "fail closed on configuration"). A real runner value is added to W0-02 by W4 under ADR-0006. |
| `MAIL_MODE` | `sink-memory` \| `sink-file` | the sink selection in `server/src/notifications/` | Unset or any other value (`smtp`, `sink-smtp`, `memory`, …) fails startup naming the key (4.8 "no external mail path"). |
| `MAIL_SINK_DIR` | path, default `./.local/mail` | `FileMailSink` | Created on start if absent; `sink-file` with an unwritable directory makes the W0-10 `mailSink` probe report `unavailable` (readiness `not_ready`). |
| `PUBLIC_BASE_URL` | URL origin, default `http://127.0.0.1:8787` | `SafeDeepLink` construction (W3-03) and the sink's origin check (4.3) | Must be a bare origin (no path, query or fragment); loopback in `local-google` and `fixture` modes (W0-03). |

Values this spec would like to be configurable but that W0-02 does not define are **not** read from the environment in slice 1: the QC timeout (orchestrator option, default constant 10 000 ms; tests pass 100), the retry backoff (W3-04 module constant, proposed 1 s / 5 s / 25 s), forced sink failure (control API only) and a "QC disabled" mode (none; `QC_MODE` has one value). Section 10 lists them as proposed additions to W0-02 section 5 for the lead; until accepted, no ticket adds a key.

**W4-13 amendment (2026-09-27): `QC_MODE` row.** [W4a plan](implementation-plan-w4a.md) section 2 and W0-02 section 5 (W4-13 amendment). Values: `deterministic` \| `substitute`; `.env.example` sets `deterministic`. Fail-closed rule: unset fails startup with `missing:QC_MODE` and any other value with `invalid:QC_MODE`, in every identity mode; `substitute` fails startup with `invalid:QC_MODE` under `NODE_ENV=production` or a non-local identity mode (`network`, `production`). The real runner value was added in W4a without ADR-0006, which stays W4b's. `QC_MODE` still has no "disabled" value.

## 7. Observability hooks (W0-10 contract)

The event names, readiness fields and operator-view rows are [W0-10](observability-contract.md)'s; this section states which of this spec's values fill them. W0-10 3.2 makes the emitter an allow-list: a field that W0-10 3.3 does not register is dropped (and throws `OBS_UNREGISTERED_FIELD` in test and CI). So W1-10 and W2-05 emit **only** the fields W0-10 3.3 lists for each event; the fields marked *proposed* below are carried in the run result and on the `qc_run` row where a column exists, are listed in section 10 as a W0-10 amendment, and are not emitted, and W3-07 does not assert on them, until W0-10 accepts them.

| W0-10 event or field | Fields this spec supplies | Never contains |
|---|---|---|
| `qc.run.started` | W0-10 3.3 fields: `qcRunId`, `caseId`, `versionId`, `trigger` (`upload` \| `submit` \| `approve_attempt`, the W0-04 column values, which W0-10 3.3 carries since W0-09), `qcKind = 'substitute'` in slice 1, `lane?` (registered at W0-09); `correlationId` is the line's top-level key (W0-10 3.2). **Proposed, not logged until W0-10 3.3 lists it** (section 10): `runKey` | filename, document text, message params, artifact bytes |
| `qc.run.completed` | W0-10 3.3 fields: `qcRunId`, `findingCount`, `durationMs`. **Proposed, not logged until W0-10 3.3 lists them** (section 10): `alreadyRecordedCount`, `runner`, `runnerVersion` | same |
| `qc.run.unavailable` | W0-10 3.3 fields: `qcRunId`, `caseId`, `versionId`, `reason` (`timeout` \| `runner_error` \| `not_configured` \| `artifact_unreadable`; W0-10 3.3 carries these values since W0-09); `owningLane` is the QC-unavailable finding's lane (3.6; W0-06 7.3 recorded 2026-09-25). **Proposed, not logged until W0-10 3.3 lists it** (section 10): `runner` | same |
| `qc.run.late` (registered in W0-10 3.3 at W0-09) | level `warn`; `correlationId` of the trigger, `caseId`, `versionId`, `qcRunId`, `trigger`, `lane` when set, `status` (the runner's `completed` \| `unavailable`), `refusedFindingCount`; emitted once per refused run (3.4 step 6), in place of `qc.run.completed` / `qc.run.unavailable` | same |
| `mail.sent`, `mail.attempt_failed`, `mail.failed` (dispatcher, W3-04) | `notificationId`, `attempt`, `sinkKind` (`memory` \| `file`), `errorCode` = the receipt's `error.code`; the sink itself logs nothing | address, subject, body, deep links, case IDs of the digest |
| readiness `qc` | `kind = 'substitute'`, `status` = the substitute's `health()` answer; QC does not gate readiness (W0-10 5.3) | — |
| readiness `mailSink` | `kind` = `memory` \| `file`, `status` = `ok`, or `unavailable` when `MAIL_SINK_DIR` is not writable; readiness fails closed when `QC_MODE` or `MAIL_MODE` is unset or invalid because the process never starts (section 6) | — |
| operator view (W3-07) | `failedMail` rows (`notificationId`, event, attempts, last error code, case link) and `unavailableQc` rows (`qcRunId`, version, trigger, reason, `startedAt`) from `qc_run WHERE status = 'unavailable'`; the `owningLane` column of that view waits for W0-06 7.3 like the finding does; a `lateQc` list is proposed in section 10, since a late run has no row to query | contents |
| W4-11b (2026-09-27): `qc.run.completed`, `qc.run.unavailable`, `qc.extract.failed` | Registered in W0-10 3.3 by [W4-11b](../../changes/2026-09-27-w4-11b-run-identity-for-extraction/spec.md) (W4b plan section 8): the completed and unavailable lines carry the run's `QcRunResult.engine` identity when recorded (`extractorVersion`, `modelProvider`, `modelId`, `promptRevision`, `modelInputTokens`, `modelOutputTokens`, `modelLatencyMs`), the unavailable line its stored `unavailableDetail` (a bounded code or `unspecified`), and `qc.extract.failed` (`qcRunId`, `slot`, `reason`, `durationMs`, `extractorVersion`) is registered for W4-05b and W4-13b. The `detail` of an unavailable result is now persisted as `qc_run.unavailable_detail` and logged only in that bounded form. The operator view's `unavailableQc` rows carry `unavailableDetail` | filename, document text, excerpts, model input or output, message params |

## 8. Test-layer map for this spec

| Acceptance | Layer | Ticket | What is proven |
|---|---|---|---|
| A08 (feeds; real QC is W4) | unit | W1-10 (loader check: W1-00) | Typed findings, `unavailable` without a lane, timeout, no write path, single-lane owning lane per W0-06 7.1, fail-closed `QC_MODE` configuration |
| A09 | integration (real Postgres + scripted runner) | W2-05, W2-06 | `unavailable` run recorded, never zero findings; findings append-only and `qc_run` immutable; open findings block Ready; findings arriving after Ready refused and logged as `qc.run.late`, never appended; owning-lane authority on single-lane findings now, on slot-5, pack-level and `unavailable` findings after W0-06 7.3 |
| A08 visibility | integration + browser | W2-07, W3-07, W2-INT | Findings and the `unavailable` run shown before decision controls; a timeout appears once in the operator view |
| A05 | unit | W1-11 | Status, forced failure, duplicate, dedup key equal to the W0-04 identity, unsafe link (single and one-of-many in a digest), per-case link correctness, synthetic-domain rule, malformed and oversize request, Thai subject, no external path, fail-closed `MAIL_MODE` |
| A05 | integration | W3-03, W3-04 | Outbox in the same transaction; four events; three retries with backoff; dedup; committed decision unchanged |
| A05 | browser | W3-06 | Notification links require sign-in and scope in the end-to-end journey |

Substitute runs are never acceptance evidence for the real QC (W4) or a real transport (W7/W8); A08's model-quality half and R5's real-mail half stay open until those packages.

## 9. Consumers and cross-links

| Ticket | Uses from this spec |
|---|---|
| W1-00 | Shared types in `shared/src/qc/types.ts` and `shared/src/mail/types.ts`, `NOTIFICATION_EVENT_BY_KIND` and `buildDedupKey` in `shared/src/mail/dedup.ts` (4.4, the function body as written there; `CommittedEvent.digestDay` in the types); the fail-closed rules for `QC_MODE` and `MAIL_MODE` in section 6 (the keys themselves are W0-02's); synthetic-domain rule for fixture user addresses |
| W1-03 | `upload` trigger after the artifact is stored; fires only when the slot reference changed (3.2, 3.7) |
| W1-05 | `submit` trigger after the version freezes; `qcRulesRevision` and `laneMappingVersion` on the request |
| W1-09 | Fixture case IDs the scripts key on; the single synthetic operator address |
| W1-10 | Section 3.9 in full |
| W1-11 | Sections 4.7 and 4.8 in full |
| W2-02 | `approve_attempt` trigger with `lane` through the lane-QC run endpoint its contract PR adds (W0-06 4.4); replay of a `completed` run keeps the run ID (3.7) |
| W2-05 | Finding record, column mapping (3.4 step 6), append-only rule; replay and new-run-after-`unavailable` rule (3.7); the QC-unavailable finding template (3.6), stored once per open scope under W0-06 7.3 as recorded on 2026-09-25 |
| W2-07, W2-09 | Finding shape for rendering; the D12 message key; the `unavailable` run shown before decision controls |
| W3-03 | Outbox placement, `DeliveryRequest` with `deepLinks` and `digestCases`, four event kinds, `buildDedupKey` (4.4: W0-04 `event` value and `recipient` address as components), `CommittedEvent.digestDay` set by the digest job from the job run's start instant in Asia/Bangkok (4.2), digest dedup mapping, locale templates, `PUBLIC_BASE_URL` origin |
| W3-04 | Retry ownership, attempt numbering, permanent failure, the four W0-04 delivery columns |
| W3-05 | Due date parameter on lane-open mail; breach query feeding the digest's `digestCases` and one `case` link per breached case |
| W3-07 | Section 7 |
| W4 | Replaces `ScriptedQcRunner` behind `QcRunner` under ADR-0006 (D08, D09) |

Related W0 specs, merged: [W0-02 implementation plan](implementation-plan-w1-w3.md) (paths, configuration keys, test layers, fixture identities), [W0-04 persistence](persistence-and-artifact-store.md) (`qc_run`, `qc_finding`, `notification`, immutability, roles), [W0-06 workflow and errors](workflow-transition-and-error-contract.md) (lane constant, owning-lane rule and its interim posture, approve-lane QC, idempotency, error types), [W0-10 observability](observability-contract.md) (correlation ID, events, readiness, operator view, substitute hooks). Also merged: [W0-03 identity adapter](identity-adapter.md) (production mode and secrets custody; fixture addresses), [W0-05 authorization](authorization-policy-matrix.md) (recipient rows, deep-link scope), [W0-08 upload safety](upload-safety-and-fixtures.md) (sniffed media type, fixture set, synthetic operator address).

Product sources: [workflow](../product/workflow.md) (failure behaviour, notifications), [data contract](../product/data-contract.md) (QC run/finding, notification entities), [source spec](../product/source-spec.md) QC and Notifications sections (frozen), [acceptance](../acceptance.md) A05 and A08, [threat model](../security/threat-model.md), [decision register](../product/decisions.md) D05, D06, D12, [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) error codes and the QC worker open item, [architecture](../architecture/README.md) QC and notification boundary rows.

## 10. Open items carried, not resolved

Owning lane, carried from W0-06:

- [ ] Owning lane for slot 5, slot 9, pack-level and QC-unavailable findings — review leads record it in W0-06 section 7.3 before W2-05; Ta enters the register row. Until then this spec follows W0-06 7.4 exactly (3.6): the substitute's `unavailable` result carries no lane, its scripts hold no slot-5, slot-9, pack-level or run-scoped finding, and the workflow stores the `unavailable` run row but not the QC-unavailable finding. The recording PR extends 3.5 (reserved rows), 3.9 (the owning-lane test row) and the W2-05 integration list; this spec adds no mechanism of its own.

Proposed amendments to merged sibling specs, for the lead to accept or refuse (nothing below is implemented until it is recorded in the owning document):

- [ ] **W0-04, `qc_run`:** add `run_key text NULL` (the 3.7 value) with a unique partial index on `(run_key) WHERE status = 'completed'`, so the replay lookup in 3.7 is by key for every trigger, including `upload`, instead of by the W0-04 columns. W0-04's migration rules allow a nullable column and an index on a frozen table. Owner: W0-04 (Lead); gate: before W2-05 starts, or the column-based lookup in 3.7 stays.
- [x] **W0-04, `qc_run` placement and the Submit row:** applied by W0-09 on 2026-09-21 (W0-06 owns the order): W0-04's `qc_run` paragraph now reads that the row is inserted once, with its final status, after the trigger's transaction has committed, in its own transaction under the case lock, and its Submit and Decide rows no longer run QC inside the transaction (the approve-attempt run is the separate W0-06 4.4 call, referenced through `observed_qc_run_id`).
- [x] **W0-10 section 3.3, `qc.run.late`:** registered by W0-09 on 2026-09-21 with the fields section 7 lists (`warn`; `qcRunId`, `caseId`, `versionId`, `trigger`, `lane?`, `status`, `refusedFindingCount`), because W0-06 section 6 requires the event. Still open: the operator-visible `lateQc` list on `DeskHealthReport` (7.2) backed by a durable desk-local record (W0-10 7.3 style), which W3-07 adds in its own migration; until then the log line is the only record, and that gap is stated, not hidden. Gate: before W2-06 lands.
- [ ] **W0-02 section 5, configuration keys:** `QC_TIMEOUT_MS` (integer, default `10000`; the orchestrator timer, 3.4 step 1), `MAIL_RETRY_BACKOFF_MS` (three integers, default `1000,5000,25000`; W3-04), `MAIL_SINK_FAIL_NEXT` (integer, default `0`; local rehearsal of W3-04 with the file sink), and a second `QC_MODE` value that disables the runner (every run `unavailable:not_configured`; readiness `qc.status = 'disabled'`, which W0-10 already models). W0-09 did not add them: the numbers are recorded as targets in [performance targets](performance-targets.md) and stay module constants (section 6); the lead may add the keys in a W1-00 amendment of W0-02 section 5.
- [x] **W0-02 section 3.5, `test:unit` glob:** applied by W0-09 on 2026-09-21; `fixtures/src` is in the `test:unit` glob and W0-02 section 1.1 says so.
- [ ] **W0-10 section 3.3, `qc.run.*` labels and fields:** (a) done at W0-09: `trigger` and `reason` carry the W0-04 column values this spec uses (`upload`/`submit`/`approve_attempt`; `timeout`/`runner_error`/`not_configured`/`artifact_unreadable`) and `lane?` is registered on `qc.run.started`; (b) still proposed, four additional allow-listed fields, none of which is personal data or document text under W0-10 4.1: on `qc.run.started` `runKey` (the 3.7 input identity, a hex digest, so a replayed run can be matched to its earlier line); on `qc.run.completed` `alreadyRecordedCount` (findings the run produced that 3.4 step 6 did not append again, so `findingCount` can be read against it), `runner` and `runnerVersion` (the `qc_run.engine_id` identity, so a W4 runner's lines are distinguishable from the substitute's); on `qc.run.unavailable` `runner`. Until W0-10 records them the emitter drops them (W0-10 3.2), section 7 marks them proposed, W1-10 and W2-05 do not pass them to `log()`, and W3-07's tests assert only on the W0-10 3.3 fields. Owner: W0-10 (Lead); gate: W3-07.

Other:

- [ ] Backoff numbers and the digest dedup mapping — W3-04 and W3-03 contract PRs confirm the proposals in 4.4 and 4.5.
- [ ] Model or extraction method behind `QcRunner`, its data handling and evaluation fixtures — ADR-0006 at W4 entry (D08, D09).
- [ ] Any transport that leaves the process, and its credential custody — D10; no slice-1 ticket may add one.

## 11. W0 contract traceability

| W0-07 clause | Where |
|---|---|
| Inputs are a version reference and authorized artifact references | 3.1, `QcRunRequest` in 3.3 |
| Typed findings: rule ID, rule revision, evidence location, metric/denominator/threshold where relevant, severity, `owning_lane` = AI/COE \| DPO \| IT/Security assigned by the W0-06 rule | `QcFinding`, `Measure`, `EvidenceLocation` in 3.3; 3.4 step 5; 3.6 (W0-06 7.1 applied; 7.3 carried open) |
| Explicit `unavailable` result recorded as a finding with an `owning_lane` under the same rule | 3.3 `QcRunResult` (no lane on the result); 3.6 finding template; the lane comes from the W0-06 rule, whose `unavailable` category is not yet recorded (7.3), so the run row is stored `unavailable` now and the finding is appended once the rule exists (7.4); a later run appends beside it, never closes it (3.7) |
| QC has no approval, mail or write access to workflow state | 3.1, 3.4, 3.9 structural and behavioural tests |
| Slice-1 substitute returns scripted synthetic findings and can simulate a timeout | 3.9 |
| No model chosen (D08, D09) | 1, 10 |
| Mail accepts a committed business event, authorized recipients, a safe deep link and a dedup key; returns delivery status | `DeliveryRequest` (`deepLinks`: one validated link for case-bound events, one validated `case` link per breached case plus `digestCases` for the operator digest, per the source-spec Notifications table and A05), `DeliveryReceipt` in 4.2 with the five-value `error.code` union (`malformed_request`, `sink_failure`, `rejected_recipient`, `unsafe_link`, `duplicate`); validation 4.3, each check with its code; 4.4; negative cases in 4.8 |
| Local substitute writes to a file or in-memory sink; no external mail | 4.6, 4.7, 4.8 |
| Interface, error contract and test substitute (W0 section text) | 3.3/4.2, 3.8/4.5/5, 3.9/4.7 |
| Cross-links to consuming tickets | 9 |

## W3-07a observability reconciliation — 2026-09-22

The [W3-07a contract](../../changes/2026-09-22-w3-07a-observability-contract/spec.md) implements the persistence prerequisite for the required lateQc list, preserves unknown historical unavailable reasons and requires synthetic submit-trigger/late-result integration proof in W3-INT. The owning-lane question remains unresolved. Digest job provenance requires a separate coordinated mail contract and sink regression tests; ordinary audit provenance remains mandatory. Existing CommittedEvent/sink validation is unchanged by this prerequisite.

## W3-03b committed digest provenance amendment

The W3-07a persisted operator job/link is the digest authority. `CommittedEvent` retains mandatory auditEventId for business events; `DeliveryRequest.event` is now the precisely narrowed case-event arm or `CommittedDigestEvent`. The digest arm has no auditEventId and requires `DigestJobProvenance` (kind=sla_digest_job, jobRunId, digestDay, correlationId). The sink validates the shared provenance schema, real calendar day and matching event/day/correlation; the server loader must separately prove the committed SQL linkage. A UUID alone is not authority. File-sink text records job-run/day headers for digest, audit-ID for case events.

This supersedes the illustrative digest-as-business-event shape above, not ordinary audit requirements. The dedup tuple remains event/Bangkok-day/-/recipient; 07a's unique day/recipient linkage and deferred orphan constraint supply persisted authority. Day is frozen from job start. Configured operator recipients only; empty breaches complete with zero count and no email. Retry uses original notification/job provenance. This amendment introduces no external transport or digest consumer.

## W7-07 in-product mail file drop and recipient directory — 2026-09-28

Amendment by [W7-07](../../changes/2026-09-27-w7-07-mail-file-drop-recipient/spec.md) under the [W7 plan](implementation-plan-w7.md) section 5.3 (register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)", W7-D11 option A, W7-D20 option B). It amends sections 4.3, 4.6, 4.7 and 5 for the modes outside `fixture`; nothing changes in `fixture` mode.

- **The shared contract moves to `@rai/shared`.** `validateDeliveryRequest`, `isSyntheticAddress`, `CANONICAL_ROUTE_PATTERNS`, `MAX_SUBJECT_BYTES` and `MAX_BODY_BYTES` (section 4.3) now live in `rai-web/shared/src/mail/validate.ts`, and `mailFileStem` (section 4.7) in `rai-web/shared/src/mail/file-stem.ts` (`node:crypto`; imported by the server and the fixtures, never by `web/`). The fixtures modules re-export them under the same names, so the W1-11 substitutes and their tests are unchanged.
- **In-product file drop.** `rai-web/server/src/notifications/file-drop.ts` `createFileDropMailSink({ dir, publicBaseUrl, now })`, identity `{ sink: 'file', version: 'w7-07' }`, behaves as `FileMailSink` step for step: validate (a failure writes nothing); on first use create the directory 0700 and rebuild the accepted-key index from every `<16 hex>-<attempt>.json` whose receipt is `delivered` (a half-written or foreign file marks nothing); answer `duplicate` for an accepted key, also after a restart; write `<mailFileStem(dedupKey, attempt)>.txt`, then `.json` (`{ request, receipt }`, `receipt.sinkMessageId` the JSON name), each as `<name>.<pid>.tmp` (flag `wx`, mode 0600) renamed into place; serialize attempts per `dedupKey`. The text copy carries `X-RAI-Sink: file (in-product drop; nothing was sent)`. It has no forced-failure control and no substitute marker, imports nothing from `@rai/fixtures`, and is walked by the fixtures `no-external-mail.test.ts` transport rule. It sends nothing: there is still no transport value (section 4.6), and the synthetic-address rule stays in force (relaxing it for real addresses is D08-gated).
- **Binding (section 5, W0-02 section 5).** `MAIL_MODE=sink-file` binds the file drop in `local-google` and `network`; `sink-memory` there binds nothing (mail `unavailable`, readiness 503). `fixture` mode keeps the W1-11 substitutes. `parseConfig` is unchanged.
- **Recipients outside `fixture` mode.** `rai-web/server/src/notifications/directory.ts` holds the `subject_profile` rows (W7-06) of the running identity mode in memory, loaded before `listen` and refreshed by the sign-in hook after each committed sign-in. Lane-opened recipients are the profiles whose role snapshot holds the lane; send-back and ready recipients the case owner's profile; `resolveRecipient` (section 4.2 `case_view_scope` basis) is unchanged. A person who never signed in has no profile and gets no mail, so the operator guide asks every participant to sign in once first.
