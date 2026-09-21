# QC boundary and mail sink (W0-07)

Status: **W0 interface spec, agent draft for human review.** Ticket W0-07 of the [W0 technical contract](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink); GitHub issue #12; lane Lead. Depends on [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04). Proves A05 and A08 later, through the tickets that consume it. Nothing in this document is installed or running; W1-10 and W1-11 build the substitutes it specifies.

This document is stack-concrete (TypeScript on Node 24, Fastify, Drizzle on Postgres 16, `node:test`, Playwright) while the two boundaries stay stack-neutral in intent: a caller that provides the inputs below and reads the outputs below gets the same behaviour regardless of what is behind the interface. It is written against the merged sibling specs [W0-02 implementation plan](implementation-plan-w1-w3.md) (paths, configuration keys, test layers), [W0-04 persistence](persistence-and-artifact-store.md) (`qc_run`, `qc_finding`, `notification`), [W0-06 workflow](workflow-transition-and-error-contract.md) (lane mapping, owning-lane rule, error contract) and [W0-10 observability](observability-contract.md) (log events, readiness, operator view); where this spec needs something those documents do not yet define, section 10 lists it as a proposed amendment for the lead rather than defining a competing contract.

## 1. What this document decides and what it does not

| Decided here (within W0-07's remit) | Not decided here |
|---|---|
| The QC boundary interface: inputs, typed finding, `unavailable` result, timeout handling, authority limits, run and finding persistence rules, error mapping, test substitute behaviour and its tests (W1-10) | **Which model or extraction method runs behind the boundary.** Open under D08 and D09; recorded in ADR-0006 at W4 entry. The slice-1 runner is a scripted substitute and is never labelled "QC implemented". |
| The mail sink interface: committed-event input, authorized recipients, safe deep link, dedup key, delivery status, the transactional-outbox placement, retry ownership, test substitutes and their tests (W1-11) | **The owning lane of slot-5, slot-9, pack-level and QC-unavailable findings.** That is the D05 refinement the review leads record in [W0-06 section 7.3](workflow-transition-and-error-contract.md#73-open-d05-refinement-the-review-leads-record-before-w2-05). This document carries the interim posture of [W0-06 section 7.4](workflow-transition-and-error-contract.md#74-what-w2-05-and-w1-10-may-do-meanwhile) as written (section 3.6) and never fills the rule. |
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
- **QC never decides.** A run with zero findings is "no defects found by the rules in revision X", not an approval. A run that is `unavailable` is recorded as an `unavailable` run and, once W0-06 section 7.3 is recorded, as a finding (section 3.6); it is never a clean pass. Ready (W2-06) reads finding dispositions, never runner output.

### 3.2 Triggers

Three triggers from the source spec "When it runs" table. Each is fired by the server ticket that owns the business action, *after* that action's transaction has committed, so QC can never hold up or roll back an upload, a submit or a decision.

| Trigger | Fired by | Scope of the request | Rules that run |
|---|---|---|---|
| `upload` | W1-03 after the artifact is stored and its slot assigned on the draft. W1-03 is idempotent by content hash (W0-06 section 5.3), so the trigger fires only when the slot's artifact reference actually changed | The one artifact, its slot, the draft's `checklist_template_version` | That artifact's own completeness rules |
| `submit` | W1-05 after the version is frozen. A retried submit replays through its idempotency record (W0-06 section 5.3) and fires no second trigger | The whole frozen version: all nine slots, all artifact references, `stage_context`, `model_type`, `vendor_involved` | Pack completeness, cross-document contradictions, pack-versus-stage mismatch |
| `approve_attempt` | The lane-QC run endpoint the W2-02 contract PR adds (W0-06 section 4.4): the reviewer workspace (W2-07) requests the run for (version, lane) before it offers the decision controls, and the approve event carries the run's ID | The frozen version restricted to that lane's slots under the lane-mapping constant recorded on the version | That lane's document rules |

An `upload` run on a draft is attached to the draft's artifact reference and is carried to the version that freezes it; it is not re-run on submit unless the submit rules ask for it. Findings from all three triggers accumulate on the version (append-only QC log per version, source spec).

The reviewer sees the `approve_attempt` result before the decision controls (W2-07 "findings render before the decision controls"). The decision itself does not wait for a completed run: if the run is `unavailable`, the reviewer sees the unavailable run and may still decide (L7); W0-06 section 4.4 makes an `unavailable` run "a valid run to have seen" that "never counts as clean".

### 3.3 Interface, TypeScript notation

Types live in the shared package. `Lane`, `Slot`, `LaneMapping` and `owningLaneForSlot` are the W0-06 exports (section 3 and 7.1 there; W0-02 places the constant in `shared/src/constants.ts`); this spec imports them and does not define a second lane type.

```ts
// rai-web/shared/src/qc/types.ts  (W1-00 creates; W1-10 and W2-05 consume)

import type { Lane, Slot } from '../constants.js';   // W0-06 lane type and mapping, per W0-02

export type QcTrigger = 'upload' | 'submit' | 'approve_attempt';   // the W0-04 qc_run.trigger values
export type Severity = 'high' | 'medium' | 'low';
export type SlotNumber = Slot;                                     // 1..9, W0-06
export type SlotDisposition = 'attached' | 'not_yet' | 'na_with_reason' | 'missing';
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
  reason: string | null;     // required text for na_with_reason; null otherwise
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

### 3.4 Orchestrator behaviour (server side, Lane A)

The orchestrator wraps the runner and is the only code that touches the store for QC. It follows W0-04 exactly: **a `qc_run` row is inserted once, with its final status, after the runner has answered, and is never updated** (W0-04 `qc_run`: "Immutable once `status` is set; ... never updated"; the trigger raises on UPDATE and `rai_app` has no UPDATE grant). There is no `running` status, no in-progress row and no age-out. Its contract, in order:

1. **Build the request** from the frozen version (or the draft for `upload`) and the actor's already-checked scope. It computes `runKey` (section 3.7), takes `correlationId` from the request context (W0-10) and sets `deadlineMs` from the orchestrator's `timeoutMs` option (default 10 000 ms as a module constant; tests pass 100; section 10 proposes a `QC_TIMEOUT_MS` key to W0-02).
2. **Replay lookup and in-flight guard** (section 3.7). If the latest recorded run for the same input is `completed`, return it and stop. If a run for this `runKey` is in flight in this process, await it and return its result (the in-flight table is an in-process `Map<runKey, Promise<QcRunResult>>`; nothing about "in progress" is ever written to the store). Otherwise register this run in the table and continue.
3. **Call `runner.run(request, signal)`** with an `AbortController` whose timer is `deadlineMs`. On timer expiry: abort, and treat the outcome as `unavailable` with reason `timeout`, regardless of what the runner returns afterwards (a late result is discarded and logged, never persisted). A crash between this step and step 6 leaves no row at all; the next trigger simply runs again.
4. **Validate the result** against the shared schema. Any violation (unknown field, `ruleRevision` ≠ `qcRulesRevision`, `owningLane` outside the lane type, an `excerpt` or any other document-text field on evidence, an `excerptHash` that is not 64 lowercase hex characters, missing evidence, a `measure` whose `thresholdSource` ≠ `checklistTemplateVersion`, a finding with `scope.kind === 'run'` or `ruleId === 'QC-UNAVAILABLE'`, which only the orchestrator builds) is treated as `unavailable:runner_error` with the violation name in `detail`. Malformed output never becomes a finding.
5. **Check `owningLane`** against the W0-06 rule, using the mapping resolved by the version's `laneMappingVersion`. For an `artifact` or `slot` scope on a single-lane slot (1, 2, 3, 4, 6, 7, 8), `owningLaneForSlot(slot, mapping)` must equal the runner's value; a mismatch is `runner_error` (`owning_lane_mismatch`). For a scope on slot 5, slot 9 or the pack, `owningLaneForSlot` returns `'refinement_pending'` until W0-06 section 7.3 is recorded, and the orchestrator rejects the finding as `runner_error` (`owning_lane_rule_pending`): no finding is ever stored with a pending or guessed lane (W0-06 section 7.1). This branch cannot fire in slice 1, because the substitute's scripts contain no such finding (3.9) and the W4 runner arrives after the record. The orchestrator never stamps a lane the runner did not send; the one finding it builds itself, the QC-unavailable finding, takes its lane from the recorded rule and is not stored until that rule exists (3.6).
6. **Persist in one transaction**, under the case row lock (W0-06 section 9.1: QC-finding appends take the case lock): insert the `qc_run` row with `status` = `completed` or `unavailable`, `trigger`, `slot` (set for `upload`), `lane` (set for `approve_attempt`), `engine_id` = the runner identity, `rule_revision` = `qcRulesRevision`, `requested_at` = `startedAt`, `completed_at` = `finishedAt`, `correlation_id`; then append each finding with a new `findingId`, `kind = 'defect'`, the run ID, `version_id`, `slot` from the scope (`NULL` for pack), `evidence` from `EvidenceLocation` (locator and `excerpt_hash` only), `metric`/`denominator`/`threshold` from `measure`, `message_key`/`message_params` from `message`, and `correlation_id`. A finding whose `(ruleId, ruleRevision, scopeKey)` already has an *open* finding on the same version is not appended again (`scopeKey` is the scope's fields joined in order, so findings from different triggers or lanes stay distinct); the run result reports `alreadyRecorded: findingId` for it (the demo's "already recorded as a finding on this submission" behaviour). Dispositioned findings do not suppress a new one. For an `unavailable` result the row is inserted with `status = 'unavailable'` and the QC-unavailable finding (3.6, `kind = 'unavailable'`) is appended **only once W0-06 section 7.3 is recorded**; until then no finding row is written for it (W0-06 section 7.4) and the action response carries `findingId: null` (3.8). The in-flight table entry is removed after commit or rollback.
7. **Emit** the W0-10 events: `qc.run.started` before step 3 and `qc.run.completed` or `qc.run.unavailable` after step 6 (section 7 lists the fields). No `excerptHash` source text, no filename, no message params (W0-10 redaction rule).

The orchestrator never mails, never changes a slot, a version, a lane decision or a disposition, and never reads runner output as an instruction.

### 3.5 Rule families the substitute scripts (from the source spec; not a rule catalogue)

The real catalogue is Admin configuration keyed to `checklist_template_version` (L12) and is W4/W6 work. Slice 1 needs synthetic findings that look like the real ones, so the substitute's scripts use these families with these IDs. IDs are stable so W2-05, W2-07 and W2-09 tests can name them. Under W0-06 section 7.4 the scripts may carry a `defect` finding only on a single-lane slot; the rows marked *reserved* are IDs W1-10 does not script until the review leads record the slot-5, slot-9 and pack-level rule.

| `ruleId` | Trigger | Scope | `measure` | Source-spec rule | Scripted in slice 1 |
|---|---|---|---|---|---|
| `PACK-SLOT-MISSING` | submit | slot, single-lane slots only | null | Completeness: a lane-gated slot is `missing` with no reason | yes (slot 2, 3, 4, 6, 7, 8 cases); slot 5 reserved |
| `PACK-STAGE-MISMATCH` | submit | pack | null | Pack-versus-stage: e.g. a launch checklist filed at `idea`, or `pre_launch` with the privacy checklist `not_yet` | reserved (pack-level owning lane, W0-06 7.3) |
| `PACK-CONTRADICTION` | submit | pack (evidence in two artifacts) | null | Cross-document contradiction | reserved (pack-level owning lane, W0-06 7.3) |
| `ACC-METRIC-CITED` | approve_attempt, upload | artifact, slot 1 | required | A "Yes" on hallucination/accuracy must cite metric, denominator, threshold and artefact | yes; the slot-5 variant is reserved |
| `ACC-EXTRACTION-NOT-HALLUCINATION` | approve_attempt | artifact, slot 1 | required (`metric: 'extraction_accuracy'`) | Extraction % is not a hallucination rate (v1.0 item 3.5) | yes |
| `ACC-BAND-V1-SHEET3` | approve_attempt | artifact, slot 1 | required, `thresholdSource` must be the v1.0 Sheet-3 SL#2.1 version | H <1%, M <2%, L <3% apply only under that template version; other versions never inherit them | yes |
| `ACC-CLASSIC-ML-METRIC` | approve_attempt | artifact, slot 1 | required or slot N/A reason | Classic-ML uses that sheet's matching metric or N/A | yes |
| `QC-UNAVAILABLE` | any | run | null | QC failure is an explicit finding, never a clean pass | never scripted: built by the orchestrator only (3.6); a runner that returns it fails validation (3.4 step 4) |

Severity: `high` for `ACC-BAND-V1-SHEET3` and `ACC-EXTRACTION-NOT-HALLUCINATION` in scripts and for `QC-UNAVAILABLE` in the orchestrator; `medium` for the rest. These are fixture values, not thresholds of record.

### 3.6 Owning lane and the QC-unavailable finding

Every stored finding carries `owningLane` because D05 makes the owning lane the authority for waived and N/A dispositions and the confirmer of the owner's proposed "fixed" (W2-05). The value comes from the **W0-06 owning-lane assignment rule** ([section 7](workflow-transition-and-error-contract.md#7-owning-lane-assignment)), which this spec applies and does not extend:

- **Recorded (W0-06 7.1):** a `defect` finding whose slot is 1, 2, 3, 4, 6, 7 or 8 is owned by the one lane that reviews that slot under the mapping recorded on the version (`lane-mapping/v1`: slot 1 → `ai_coe`; 2, 3, 4 → `dpo`; 6, 7, 8 → `it_security`), through `owningLaneForSlot(slot, mapping)`. The runner sets that value; the orchestrator checks it (3.4 step 5).
- **Open (W0-06 7.3):** slot 5, slot 9, pack-level findings and every `unavailable` finding have no owning lane until the review leads record the rule in W0-06 section 7.3. This spec chooses nothing for them, carries no provisional value, no companion constant and no fixture-chosen lane, and defines no `pending` value for `owningLane`: a finding either has the lane the recorded rule gives it or is not stored.
- **Interim posture, carried from W0-06 7.4 as written:** the substitute returns `unavailable` with no lane; its scripts contain no `defect` finding on slot 5, slot 9 or the pack and no run-scoped finding (3.9 asserts this); the workflow inserts the `unavailable` run row (W0-04 allows it) but does not store an `unavailable` finding until 7.3 is recorded, which blocks the W2-05 and W2-06 `unavailable` cases and the W2-05 slot-5 and pack-level cases, not W1-10. When the rule is recorded, W1-10 adds the reserved fixtures of 3.5 with the recorded lane, the orchestrator starts appending the QC-unavailable finding below with the recorded lane, and the 3.9 row and the W2-05 list are extended in the same PR; nothing else in this spec changes.

**QC-unavailable finding.** When the result is `unavailable` (timeout, runner error, not configured, unreadable artifact), the orchestrator appends exactly one finding per run, once W0-06 7.3 exists:

```ts
{
  findingKey: `QC-UNAVAILABLE:run:${trigger}:${lane ?? '-'}`,
  ruleId: 'QC-UNAVAILABLE',
  ruleRevision: request.qcRulesRevision,
  trigger: request.trigger,
  scope: { kind: 'run', trigger: request.trigger, lane: request.lane },
  severity: 'high',
  owningLane: /* the W0-06 section 7.3 recorded rule for `unavailable` findings; until it is recorded this finding is not built (W0-06 7.4) */,
  evidence: [{ artifactId: null, contentHash: null, slot: null, locator: { kind: 'absent' } }],
  measure: null,
  message: { key: 'qc.finding.unavailable', params: { reason, trigger, rulesEvaluated: 0 } },
  provenance: { runner: 'orchestrator', runnerVersion: /* server version */ }
}
```

Stored as a `qc_finding` row with `kind = 'unavailable'` (W0-04). It is dispositioned like any other finding (fixed by a later completed run, recorded by the owning lane, or waived with a reason). It is never auto-closed by a later successful run; the later run's findings are appended beside it, and the QC-unavailable finding stays `open` until a person dispositions it. This is what makes A08 "QC failure is visible, not clean-pass" and the threat-model row "QC/model outage presented as clean evidence" testable. Until the finding exists, the `unavailable` run row itself is the visible record: it is on the action response (3.8), in the operator view (W0-10 `unavailableQc`, section 7) and in the log; and the W2-07 reviewer workspace renders it before the decision controls (W0-06 4.4).

### 3.7 Idempotency and replay

```ts
runKey = sha256(versionId | trigger | (lane ?? '-') | qcRulesRevision | sorted(`${slot}:${contentHash}` for each request.artifacts[i]))
```

`runKey` is the identity of a QC input. The `slot:contentHash` pair, not the bare hash, is what identifies it: the same bytes attached to two slots are two placements with two sets of completeness rules (source spec, QC triggers: "On each upload: that artefact's own completeness rules"), so on the `upload` trigger, where `versionId` is the draft ID, uploading the same file to a second slot on the same draft yields a different key. `artifactId` is not part of the key: it is a row identity, and two rows with the same `(slot, contentHash)` are the same QC input. The key is carried on the request and on every log line of the run (section 7). W0-04's `qc_run` has no `run_key` column; section 10 proposes one. Until it exists the orchestrator finds "the latest recorded run for the same input" through the W0-04 columns, which is exact for the two triggers where a replay can occur:

| Trigger | How a repeat is recognised | Behaviour |
|---|---|---|
| `submit` | The version is frozen, so `(version_id, trigger = 'submit', rule_revision)` identifies the input. A retried submit request replays through the W0-06 5.3 idempotency record and never reaches the orchestrator; the lookup is a defensive check only. | Latest row `completed` → **replay**: return the existing run, nothing appended. Latest row `unavailable` or none → **new run**. |
| `approve_attempt` | The version is frozen, so `(version_id, trigger = 'approve_attempt', lane, rule_revision)` identifies the input. A reviewer reopening the approve action requests the run again (W0-06 4.4). | Latest row `completed` → **replay**: return the existing run, so the reviewer's `qc_run_id` stays the latest lane-QC run and W0-06's `qc_run_superseded` check does not fire for a mere reopen. Latest row `unavailable` → **new run**: QC runs again; its findings are appended beside the earlier run's record (and, once 7.3 is recorded, beside its still-open QC-unavailable finding, which is never auto-closed). A transient timeout therefore never makes a lane's QC on a version permanently unavailable. |
| `upload` | The draft's slot reference changed (W1-03 fires the trigger only then), so every trigger is a new input by construction; the same bytes re-attached to the same slot without an intervening change fire no trigger at all. | Always a **new run**. Step 6's dedup rule prevents a second open finding for the same `(ruleId, ruleRevision, scopeKey)`. |

Concurrency: two triggers for one `runKey` in the same process share the in-flight promise (3.4 step 2), so at most one runner call is in progress per key; the single-process deployment of ADR-0003 makes this sufficient in slice 1, and the W4 worker option replaces the table with `pg_advisory_xact_lock(hashtext(runKey))` held across step 6. Runs are additions, never rewrites: a later run never changes an earlier run's row or any finding it produced (W0-04: `qc_run` and `qc_finding` are immutable). A deliberate re-run (a future Admin "recheck under revision Y", W6) has a different `qcRulesRevision` and therefore a different key, and it is an explicit recorded recheck, never a rewrite.

### 3.8 Error contract

| Situation | Where it surfaces | Code (ADR-0003, W0-06 8.1) |
|---|---|---|
| Runner timeout, runner error, not configured, artifact unreadable | The business action (upload, submit, decision) **succeeds**; its response carries `qc: { runId, status: 'unavailable', reason, findingId }` with `findingId: string | null` (null until W0-06 7.3 is recorded, 3.6); the `unavailable` run is on the version | Not an HTTP error on the action. A future endpoint whose only purpose is to return a QC result (none in slice 1) answers `503 qc_unavailable` with the same body |
| Runner output fails schema validation or the owning-lane check | Same as above with `reason: 'runner_error'` | Same |
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
| owning lane follows W0-06 7.1 only | every finding in every script is `artifact`- or `slot`-scoped on a single-lane slot (1, 2, 3, 4, 6, 7, 8) and its `owningLane` equals `owningLaneForSlot(slot, mapping)` for the script's `laneMappingVersion`; no script contains a finding on slot 5, slot 9 or the pack, a `run`-scoped finding or `ruleId = 'QC-UNAVAILABLE'` (the substitute throws at construction on any of these). The slot-5/9/pack assertion is relaxed only by the PR that records W0-06 7.3 | W0-06 7.3 and 7.4; section 3.6 |
| health answer reaches readiness | `health('unavailable')` → the W0-10 `qc` probe reports `unavailable` and readiness stays `ready` (QC does not gate readiness) | W0-10 section 5.3 |
| fail closed on configuration (owner W1-00 for the loader, W1-10 for the runner identity it selects, same pattern as the 4.8 "no external mail path" row) | the config loader with identity mode `production` and `QC_MODE=substitute` throws at startup, naming the key; `QC_MODE` unset, or any value other than `substitute` (for example `scripted`, `none`, `model`), throws in every identity mode, since W0-02 section 5 defines no other value; readiness reports `qc.kind = 'substitute'` and the operator view labels the runner `substitute-scripted` | 3.9 opening paragraph, section 6, W0-02 section 5 |

Integration tests that consume the substitute belong to W2-05 (record and disposition of single-lane findings; an `unavailable` result inserts an `unavailable` run row and is never treated as zero findings; a replayed `approve_attempt` after `completed` returns the same run and appends nothing; a second `approve_attempt` after `unavailable` runs again and appends its findings while the earlier `unavailable` run stays recorded; the same bytes uploaded to two slots on one draft produce two runs with distinct `runKey`s, each evaluating its own slot's rules; a raw `UPDATE qc_run` as `rai_app` fails; the storage of the QC-unavailable finding, and the slot-5 and pack-level cases, are written against W0-06 7.3 and blocked until it is recorded), W2-07/W2-09 (rendering, disposition UI) and W3-07 (a simulated timeout appears once in the operator view and in the log with the same correlation ID).

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

/** A business event that has already committed. The sink cannot be handed an uncommitted one. */
export interface CommittedEvent {
  kind: MailEventKind;
  caseId: string | null;                 // null only for sla_breach_digest
  versionId: string | null;              // null only for sla_breach_digest
  versionNumber: number | null;
  lane: Lane | null;                     // lane_opened: the opened lane; sent_back: the deciding lane (W0-04); ready_for_launch, digest: null
  auditEventId: string;                  // the audit event written with the state change (W0-04); proof it committed
  committedAt: string;                   // ISO-8601 UTC
  correlationId: string;                 // W0-10; shared with the audit event, the notification row and the log line
}

export interface AuthorizedRecipient {
  recipientId: string;                   // subject ID for a person; `operator_recipients:<n>` for a configured address
  address: string;                       // must satisfy the synthetic-domain rule in 4.6 while slice 1 runs
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
  templateParams: Record<string, string | number>;   // scalar params: caseName, laneLabel, defectCount, dueDate (D06 timezone), feedback summary
                                         // the digest's per-case list is `digestCases`, not a param; the template renders it as one line per case with its link
}

export interface DeliveryRequest {
  dedupKey: string;                      // section 4.4; unique per (event, version, lane, recipient) under D06
  event: CommittedEvent;
  recipient: AuthorizedRecipient;
  deepLinks: SafeDeepLink[];             // at least one. lane_opened, sent_back, ready_for_launch: exactly one, route 'case' or 'case_version', caseId === event.caseId.
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

The four `MailEventKind` values are the four rows of the source-spec notification table and map 1:1 onto the W0-04 `notification.event` values (`lane_open`, `send_back`, `ready`, `sla_breach_digest`); the recipients, contents and the due date come from W3-03 and W3-05.

### 4.3 Validation the sink performs (defensive; the notifier already guarantees them)

Before accepting a request the sink checks, and on failure returns `failed` with the named `error.code` without recording a delivery. One bad link fails the whole delivery; the sink never sends a mail with some of its links stripped:

- `deepLinks` is non-empty, and **every** `deepLinks[i].url` starts with the configured `PUBLIC_BASE_URL` and has a path that is one of the canonical routes; no `?`, `#`, or credential-looking segment in any of them → otherwise `unsafe_link` (`error.message` names the failing index, never the URL).
- Every link points where the mail says it does: for `lane_opened`, `sent_back` and `ready_for_launch` there is exactly one link, its `caseId` equals `event.caseId` and `digestCases` is `null`; for `sla_breach_digest` `digestCases` is non-empty, every `deepLinkIndex` is in range, the indexed link has `route = 'case'` and `caseId` equal to the entry's `caseId`, and every `route = 'case'` link is referenced by exactly one entry → otherwise `unsafe_link`.
- `recipient.address` satisfies the synthetic-domain rule (4.6) → otherwise `rejected_recipient`.
- `mail.textBody` contains every `deepLinks[i].url` (the links are the point of every mail; the digest lists one line per breached case with its link) → otherwise `unsafe_link` (`error.message` names the missing link's index).
- `event.auditEventId` is a non-empty string (a request without a committed audit event is malformed; the notifier never builds one) → otherwise `malformed_request` (`error.message` names the field, `event.auditEventId`, and nothing else from the event).
- Payload size is bounded: `mail.subject` ≤ 998 bytes after UTF-8 encoding (RFC 5322 line limit, with encoded-word folding left to a real transport), `mail.textBody` ≤ 64 KiB (65 536 bytes) after UTF-8 encoding → otherwise `sink_failure` (`error.message` names the field and its byte size, never its contents).

The checks run in the order listed; the first failure is the receipt's `error`. `malformed_request` is reserved for a structurally invalid request (a missing committed event); a request that is well-formed but unsafe or oversize takes the more specific code above, so the dispatcher (W3-04) can distinguish a request it must rebuild (`malformed_request`, `unsafe_link`, `rejected_recipient`) from a sink-side failure (`sink_failure`); the retry policy itself stays in 4.5.

### 4.4 Dedup key

D06: deduplicated by (event, version, lane, recipient). The key is a string the notifier builds from the same four values the W0-04 `notification` unique index holds:

```
dedupKey = `${event.kind}:${versionId ?? digestDay}:${lane ?? '-'}:${recipientId}`
```

- `versionId` for lane-open, send-back and Ready. Resubmission produces a new version and therefore new keys, so lanes reopened on v2 are notified again (D05 full re-review). `lane` is the opened lane for `lane_opened` and the deciding lane for `sent_back` (W0-04), so two lanes sending back the same version to the same owner are two keys.
- For `sla_breach_digest` the version position holds the digest day as `YYYY-MM-DD` in Asia/Bangkok (D06 calendar) and lane is `-`, keeping the D06 tuple shape with one digest per recipient per day. W3-03's contract PR confirms this mapping.

The dispatcher never sends a key it has already recorded as `sent`. The sinks keep their own index of accepted keys and answer `duplicate` for a repeat, which the dispatcher treats as success without a second delivery (A05 "retry avoids duplicate events").

### 4.5 Retry and failure (owned by W3-04, stated here so the sink contract matches)

- Attempts 1 to 4 (one send plus three retries, D06). Backoff between attempts: proposed 1 s, 5 s, 25 s local, held as a constant in the W3-04 dispatcher module (section 10 proposes a `MAIL_RETRY_BACKOFF_MS` key to W0-02 if W3-04 wants it configurable); W3-04 confirms the numbers. Only `failed` receipts schedule a retry; `duplicate` and `delivered` end the row.
- After the fourth failure the row is `failed` permanently, carries the last `error`, and is listed for Admin and the operator audience (D06, W3-07). The ADR-0003 code `mail_delivery_failed` (502) is the row's error code, exposed on the notification record and the operator view; **it is never returned to the actor whose decision committed the event**, because that decision has already committed and is not undone (workflow contract "Mail failure does not undo a valid human decision").
- Retries reuse the same `dedupKey` and increment `attempt`.

### 4.6 Content and safety rules

- **Locale keys (D12).** `RenderedMail.templateKey` and `templateParams` are recorded alongside the rendered text so the mail can be re-rendered in the other language and so tests can assert on keys, not on Thai or English prose. Thai default. Subjects are UTF-8 strings in the sink; RFC 2047 encoding belongs to a real transport, not to the sinks. A Thai subject round-trips unchanged through both sinks (W3-03 "a Thai subject line is intact").
- **Nothing sensitive in mail.** No attachment, no document contents, no finding evidence, no evidence panel text. Lane-open carries the defect *count*; send-back carries the reviewer's feedback summary that the reviewer typed (it is the reviewer's text, not document text) truncated to 500 code units. Threat model: deep links instead of contents.
- **Safe deep links.** A link is a location, not a capability. A recipient who follows it is sent through sign-in and the W0-05 scope check; an out-of-scope recipient gets `forbidden`. No token is ever embedded (A05 "recipient cannot gain access from link alone"). The three case-bound events carry one link to the case; the operator digest carries one `case` link per breached case, each validated by the sink (4.3), so the source-spec digest row ("the list of cases past SLA, links to each") is met without an unvalidated URL ever entering `textBody`. The origin is `PUBLIC_BASE_URL` (W0-02 section 5), loopback in the local modes.
- **Synthetic-domain rule (slice 1).** Every recipient address handed to a sink must have a domain under an RFC 2606 reserved name: `*.test`, `*.example`, `*.invalid`, `example.com`, `example.net`, `example.org`. The W0-02 fixture addresses (`rai-desk.example`, including `operator@rai-desk.example`) and the W0-10 fixture identities (`fixture.invalid`) satisfy it. Anything else is `rejected_recipient`. This is the sink-level guarantee behind "no external mail during synthetic test" and stays until a real transport is authorized under D10.
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
| unsafe link rejected | a URL on another origin than `PUBLIC_BASE_URL`, with a query string, or with a fragment → `failed:unsafe_link`; nothing recorded. A digest with five `case` links of which one is bad (another origin, a query string, or a `caseId` that differs from its `digestCases` entry) → `failed:unsafe_link` for the whole delivery, `error.message` names the index and not the URL, nothing recorded; a `lane_opened` request whose single link's `caseId` ≠ `event.caseId`, or a digest with a `case` link missing from `textBody`, → `failed:unsafe_link` | A05 |
| non-synthetic recipient rejected | `owner@rai-desk.example`, `operator@rai-desk.example`, `reviewer.dpo@fixture.invalid` and `ops@rai-desk.test` accepted; `someone@gmail.com` and an address with no domain → `failed:rejected_recipient`, nothing recorded | "no external mail" |
| malformed or oversize request rejected | a `lane_opened` request with `event.auditEventId = ''` → `failed:malformed_request`, `error.message` contains `auditEventId`; a request whose `mail.textBody` is 64 KiB + 1 byte (65 537 bytes, links intact) → `failed:sink_failure`, `error.message` contains `65537`; a request whose `mail.subject` is 999 bytes → `failed:sink_failure`, `error.message` contains `999`; in all three cases nothing is recorded (`sent.length` unchanged, no file in `MAIL_SINK_DIR`) and the same `dedupKey` delivered afterwards with a valid request → `delivered`, not `duplicate` | 4.3 (negative case of "Accepts the four inputs") |
| Thai subject intact | subject `แจ้งเตือน: เลนเปิดแล้ว` round-trips byte-identical through memory and file sinks | D12, W3-03 |
| file sink restart | write two receipts, construct a new `FileMailSink` on the same directory, redeliver one key → `duplicate` | 4.7 |
| no external mail path | module-graph walk over `rai-web/` finds no `node:net`, `node:tls`, `node:http` client use in the sinks and no mail SDK anywhere; the config loader throws at startup for `MAIL_MODE=smtp`, `MAIL_MODE=sink-smtp`, `MAIL_MODE=memory` (the W0-02 value set is exactly `sink-memory` \| `sink-file`) and for `MAIL_MODE` unset, naming the key | "no external mail path exists in any configuration" |
| no secrets or contents on disk | the file sink's output contains the deep links and IDs, and does not contain any W0-10 fixture canary (`RAI-FIXTURE-CANARY-*`), any password-like config value or the audit event's actor email | threat model |

Integration tests belong to W3-03 (four events, one mail each, rolled-back transition has no mail, deep link without session is `unauthenticated`), W3-04 (three retries with backoff, duplicate sends nothing, committed decision unchanged after permanent failure), W3-07 (a forced failure appears once in the operator view and log with the same correlation ID) and the W3-06 journey.

## 5. Error contract summary for both boundaries

| ADR-0003 / W0-06 error | QC boundary | Mail sink |
|---|---|---|
| `qc_unavailable` (503) | Recorded as the `unavailable` run row and, once W0-06 7.3 is recorded, as the QC-unavailable finding; carried on the successful action response as `qc.status = 'unavailable'`; the 503 status itself only on a QC-only endpoint (none in slice 1) | — |
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

## 7. Observability hooks (W0-10 contract)

The event names, readiness fields and operator-view rows are [W0-10](observability-contract.md)'s; this section states which of this spec's values fill them.

| W0-10 event or field | Fields this spec supplies | Never contains |
|---|---|---|
| `qc.run.started` | `correlationId`, `caseId`, `versionId`, `trigger` (this spec's `upload` \| `submit` \| `approve_attempt`, the W0-04 column values; W0-10's labels artifact/pack/lane map 1:1 and W3-07 renders whichever W0-10 settles on), `lane`, `runKey`, `qcKind = 'substitute'` in slice 1 | filename, document text, message params, artifact bytes |
| `qc.run.completed` | `qcRunId`, `findingCount`, `alreadyRecordedCount`, `durationMs`, `runner`, `runnerVersion` | same |
| `qc.run.unavailable` | `qcRunId`, `caseId`, `versionId`, `reason` (`timeout` \| `runner_error` \| `not_configured` \| `artifact_unreadable`; W0-10's `error`/`disabled` labels map onto `runner_error`/`not_configured`), `runner`; `owningLane` is absent until W0-06 7.3 is recorded (3.6), and W0-10's field is filled from the finding once it exists | same |
| `mail.sent`, `mail.attempt_failed`, `mail.failed` (dispatcher, W3-04) | `notificationId`, `attempt`, `sinkKind` (`memory` \| `file`), `errorCode` = the receipt's `error.code`; the sink itself logs nothing | address, subject, body, deep links, case IDs of the digest |
| readiness `qc` | `kind = 'substitute'`, `status` = the substitute's `health()` answer; QC does not gate readiness (W0-10 5.3) | — |
| readiness `mailSink` | `kind` = `memory` \| `file`, `status` = `ok`, or `unavailable` when `MAIL_SINK_DIR` is not writable; readiness fails closed when `QC_MODE` or `MAIL_MODE` is unset or invalid because the process never starts (section 6) | — |
| operator view (W3-07) | `failedMail` rows (`notificationId`, event, attempts, last error code, case link) and `unavailableQc` rows (`qcRunId`, version, trigger, reason, `startedAt`) from `qc_run WHERE status = 'unavailable'`; the `owningLane` column of that view waits for W0-06 7.3 like the finding does | contents |

## 8. Test-layer map for this spec

| Acceptance | Layer | Ticket | What is proven |
|---|---|---|---|
| A08 (feeds; real QC is W4) | unit | W1-10 (loader check: W1-00) | Typed findings, `unavailable` without a lane, timeout, no write path, single-lane owning lane per W0-06 7.1, fail-closed `QC_MODE` configuration |
| A09 | integration (real Postgres + scripted runner) | W2-05, W2-06 | `unavailable` run recorded, never zero findings; findings append-only and `qc_run` immutable; open findings block Ready; owning-lane authority on single-lane findings now, on slot-5, pack-level and `unavailable` findings after W0-06 7.3 |
| A08 visibility | integration + browser | W2-07, W3-07, W2-INT | Findings and the `unavailable` run shown before decision controls; a timeout appears once in the operator view |
| A05 | unit | W1-11 | Status, forced failure, duplicate, unsafe link (single and one-of-many in a digest), per-case link correctness, synthetic-domain rule, malformed and oversize request, Thai subject, no external path, fail-closed `MAIL_MODE` |
| A05 | integration | W3-03, W3-04 | Outbox in the same transaction; four events; three retries with backoff; dedup; committed decision unchanged |
| A05 | browser | W3-06 | Notification links require sign-in and scope in the end-to-end journey |

Substitute runs are never acceptance evidence for the real QC (W4) or a real transport (W7/W8); A08's model-quality half and R5's real-mail half stay open until those packages.

## 9. Consumers and cross-links

| Ticket | Uses from this spec |
|---|---|
| W1-00 | Shared types in `shared/src/qc/types.ts` and `shared/src/mail/types.ts`; the fail-closed rules for `QC_MODE` and `MAIL_MODE` in section 6 (the keys themselves are W0-02's); synthetic-domain rule for fixture user addresses |
| W1-03 | `upload` trigger after the artifact is stored; fires only when the slot reference changed (3.2, 3.7) |
| W1-05 | `submit` trigger after the version freezes; `qcRulesRevision` and `laneMappingVersion` on the request |
| W1-09 | Fixture case IDs the scripts key on; the single synthetic operator address |
| W1-10 | Section 3.9 in full |
| W1-11 | Sections 4.7 and 4.8 in full |
| W2-02 | `approve_attempt` trigger with `lane` through the lane-QC run endpoint its contract PR adds (W0-06 4.4); replay of a `completed` run keeps the run ID (3.7) |
| W2-05 | Finding record, column mapping (3.4 step 6), append-only rule; replay and new-run-after-`unavailable` rule (3.7); the QC-unavailable finding template (3.6), stored only once W0-06 7.3 is recorded |
| W2-07, W2-09 | Finding shape for rendering; the D12 message key; the `unavailable` run shown before decision controls |
| W3-03 | Outbox placement, `DeliveryRequest` with `deepLinks` and `digestCases`, four event kinds, digest dedup mapping, locale templates, `PUBLIC_BASE_URL` origin |
| W3-04 | Retry ownership, attempt numbering, permanent failure, the four W0-04 delivery columns |
| W3-05 | Due date parameter on lane-open mail; breach query feeding the digest's `digestCases` and one `case` link per breached case |
| W3-07 | Section 7 |
| W4 | Replaces `ScriptedQcRunner` behind `QcRunner` under ADR-0006 (D08, D09) |

Related W0 specs, merged: [W0-02 implementation plan](implementation-plan-w1-w3.md) (paths, configuration keys, test layers, fixture identities), [W0-04 persistence](persistence-and-artifact-store.md) (`qc_run`, `qc_finding`, `notification`, immutability, roles), [W0-06 workflow and errors](workflow-transition-and-error-contract.md) (lane constant, owning-lane rule and its interim posture, approve-lane QC, idempotency, error types), [W0-10 observability](observability-contract.md) (correlation ID, events, readiness, operator view, substitute hooks). Not yet merged, linked by contract row: [W0-03 identity adapter](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) (production mode and secrets custody), [W0-05 authorization](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix) (recipient rows, deep-link scope), [W0-08 upload safety](../delivery/w0-technical-contract.md#w0-08--upload-safety-policy-and-fixtures) (sniffed media type, fixture set, synthetic operator address); when each `docs/engineering/` file merges, its link here is updated to the file.

Product sources: [workflow](../product/workflow.md) (failure behaviour, notifications), [data contract](../product/data-contract.md) (QC run/finding, notification entities), [source spec](../product/source-spec.md) QC and Notifications sections (frozen), [acceptance](../acceptance.md) A05 and A08, [threat model](../security/threat-model.md), [decision register](../product/decisions.md) D05, D06, D12, [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) error codes and the QC worker open item, [architecture](../architecture/README.md) QC and notification boundary rows.

## 10. Open items carried, not resolved

Owning lane, carried from W0-06:

- [ ] Owning lane for slot 5, slot 9, pack-level and QC-unavailable findings — review leads record it in W0-06 section 7.3 before W2-05; Ta enters the register row. Until then this spec follows W0-06 7.4 exactly (3.6): the substitute's `unavailable` result carries no lane, its scripts hold no slot-5, slot-9, pack-level or run-scoped finding, and the workflow stores the `unavailable` run row but not the QC-unavailable finding. The recording PR extends 3.5 (reserved rows), 3.9 (the owning-lane test row) and the W2-05 integration list; this spec adds no mechanism of its own.

Proposed amendments to merged sibling specs, for the lead to accept or refuse (nothing below is implemented until it is recorded in the owning document):

- [ ] **W0-04, `qc_run`:** add `run_key text NULL` (the 3.7 value) with a unique partial index on `(run_key) WHERE status = 'completed'`, so the replay lookup in 3.7 is by key for every trigger, including `upload`, instead of by the W0-04 columns. W0-04's migration rules allow a nullable column and an index on a frozen table. Owner: W0-04 (Lead); gate: before W2-05 starts, or the column-based lookup in 3.7 stays.
- [ ] **W0-02 section 5, configuration keys:** `QC_TIMEOUT_MS` (integer, default `10000`; the orchestrator timer, 3.4 step 1), `MAIL_RETRY_BACKOFF_MS` (three integers, default `1000,5000,25000`; W3-04), `MAIL_SINK_FAIL_NEXT` (integer, default `0`; local rehearsal of W3-04 with the file sink), and a second `QC_MODE` value that disables the runner (every run `unavailable:not_configured`; readiness `qc.status = 'disabled'`, which W0-10 already models). Owner: W0-02 (Lead); gate: W1-00 before it writes `.env.example`, otherwise the constants in section 6 stand.
- [ ] **W0-02 section 3.5, `test:unit` glob:** include `fixtures/src` so the colocated W1-10 and W1-11 unit tests run under `npm run test:unit` (section 8.1 there lists `server/`, `shared/`, `web/` only). Owner: W0-02 (Lead); gate: W1-00.
- [ ] **W0-10 section 3, `qc.run.*` labels:** `trigger` and `reason` values to be the W0-04 column values this spec uses (`upload`/`submit`/`approve_attempt`; `timeout`/`runner_error`/`not_configured`/`artifact_unreadable`) or a stated mapping (section 7). Owner: W0-10 (Lead); gate: W3-07.

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
