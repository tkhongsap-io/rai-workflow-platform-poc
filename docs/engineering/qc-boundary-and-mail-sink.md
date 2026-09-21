# QC boundary and mail sink (W0-07)

Status: **W0 interface spec, agent draft for human review.** Ticket W0-07 of the [W0 technical contract](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink); GitHub issue #12; lane Lead. Depends on [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04). Proves A05 and A08 later, through the tickets that consume it. Nothing in this document is installed or running; W1-10 and W1-11 build the substitutes it specifies.

This document is stack-concrete (TypeScript on Node 24, Fastify, Drizzle on Postgres 16, `node:test`, Playwright) while the two boundaries stay stack-neutral in intent: a caller that provides the inputs below and reads the outputs below gets the same behaviour regardless of what is behind the interface.

## 1. What this document decides and what it does not

| Decided here (within W0-07's remit) | Not decided here |
|---|---|
| The QC boundary interface: inputs, typed finding, `unavailable` result, timeout handling, authority limits, run and finding persistence rules, error mapping, test substitute behaviour and its tests (W1-10) | **Which model or extraction method runs behind the boundary.** Open under D08 and D09; recorded in ADR-0006 at W4 entry. The slice-1 runner is a scripted substitute and is never labelled "QC implemented". |
| The mail sink interface: committed-event input, authorized recipients, safe deep link, dedup key, delivery status, the transactional-outbox placement, retry ownership, test substitutes and their tests (W1-11) | **The owning-lane rule for slot 5, slot 9, pack-level and QC-unavailable findings.** That is the W0-06 D05 refinement the review leads record before W2-05. This document carries the placeholder visibly (section 3.6) and never fills it. |
| Configuration keys and their allowed values for both boundaries in slice 1 | **Any transport that sends mail outside the process.** Slice 1 has exactly two sinks, `memory` and `file`. A real transport is W7/W8 work under D10 custody rules. |
| Locale-key rule for finding messages and mail templates (D12) | The exact QC rule catalogue, thresholds and the D07 rubric. The substitute uses the source-spec rule families as scripted examples only. |

Recorded decisions this spec carries as written: D05 (owning lane records waived and N/A; owner proposes "fixed"; no self-approval; the owning lane is a property of the finding), D06 (three retries with backoff; dedup by event, version, lane, recipient; one daily breach digest to `operator_recipients`; delivery failures visible to Admin), D12 (locale keys on every finding message and mail template, Thai default), L7 (QC is soft; submit and lane decisions always succeed), L8 (Ready is a server predicate, never a QC output).

## 2. Placement in the D04 stack

Under the ADR-0003 shape (one Fastify process serving the React SPA, Postgres 16 with Drizzle), both boundaries are in-process TypeScript interfaces behind which a substitute or a later real implementation is chosen by configuration at startup. The paths below follow the ADR-0003 "Proposed for W0-02" layout; **W0-02 records the final paths** and this section is corrected to match if W0-02 differs.

| Piece | Path (proposed, W0-02 confirms) | Lane / ticket |
|---|---|---|
| Shared types: `QcRunRequest`, `QcFinding`, `QcRunResult`, `DeliveryRequest`, `DeliveryReceipt`, config enums | `rai-web/shared/src/contracts/qc.ts`, `rai-web/shared/src/contracts/mail.ts` | Lane A owns `shared`; W1-00 creates the files from the shapes in this spec |
| QC port and orchestrator (timeout, run/finding persistence, `unavailable` conversion, owning-lane stamping) | `rai-web/server/src/qc/` | Lane A (W1-05 calls it on submit; W2-02 on approve attempt; W1-03 on upload) with the finding record owned by W2-05 |
| QC scripted substitute (`QcRunner` implementation) and its scripts | `rai-web/fixtures/src/qc-substitute/` with scripts in `rai-web/fixtures/src/qc-substitute/scripts/*.json` | Lane C, W1-10 |
| Notification outbox and dispatcher (retry, dedup, operator visibility) | `rai-web/server/src/notifications/` | Lane B, W3-03 and W3-04 |
| Mail sinks (`memory`, `file`) | `rai-web/fixtures/src/mail-sink/` | Lane C, W1-11 |
| Runner and sink selection at startup | `rai-web/server/src/config.ts` (W1-00) reads the keys in section 6 | Lane A |
| Tests | `rai-web/tests/unit/qc-substitute.test.ts`, `rai-web/tests/unit/mail-sink.test.ts`, integration under `rai-web/tests/integration/` | Lane C for substitutes; consuming tickets for integration |

Rule that keeps the boundaries honest: **the substitutes import only from `rai-web/shared`.** They never import Drizzle, the database client, the Fastify instance, the notification module or each other. Section 3.9 and 4.8 turn that into a test.

## 3. QC boundary

### 3.1 Authority and data-flow limits

QC is a read-only evaluator. The source spec makes it soft everywhere (L7) and the architecture gives it "no approval or mail-sending capability". Concretely:

- **Inputs are a version reference and authorized artifact references.** The server resolves the actor's scope (W0-05) and the version's frozen artifact references (W0-04, W1-05) *before* building the request. The runner receives read handles limited to those artifacts and nothing else: no repository, no database connection, no session, no HTTP client.
- **Outputs are data.** A `QcRunResult` is either `completed` with zero or more typed findings, or `unavailable` with a reason. It is validated at the boundary against the shared schema before anything is persisted. A runner cannot return an approval, a disposition, a transition, a recipient or a link.
- **QC has no write access to workflow state.** Only the server-side orchestrator (Lane A) persists the QC run and appends findings, and it does so through the same store rules as every other write (append-only findings, version immutability). The runner's process-level environment has no database URL in slice 1 (it runs in-process, but its module receives none of the server's handles; the W4 worker option in ADR-0003 keeps this by construction).
- **Document contents and runner output are untrusted data** (AGENTS.md, threat model). A finding's `message` is a locale key plus typed parameters; the only free text from a document is the bounded `excerpt` inside an evidence location, rendered as text, never as HTML or a link, and never written to a log line.
- **QC never decides.** A run with zero findings is "no defects found by the rules in revision X", not an approval. A run that is `unavailable` is recorded as a finding (section 3.6), never as a clean pass. Ready (W2-06) reads finding dispositions, never runner output.

### 3.2 Triggers

Three triggers from the source spec "When it runs" table. Each is fired by the server ticket that owns the business action, *after* that action's transaction has committed, so QC can never hold up or roll back an upload, a submit or a decision.

| Trigger | Fired by | Scope of the request | Rules that run |
|---|---|---|---|
| `upload` | W1-03 after the artifact is stored and its slot assigned on the draft | The one artifact, its slot, the draft's `checklist_template_version` | That artifact's own completeness rules |
| `submit` | W1-05 after the version is frozen | The whole frozen version: all nine slots, all artifact references, `stage_context`, `model_type`, `vendor_involved` | Pack completeness, cross-document contradictions, pack-versus-stage mismatch |
| `approve_attempt` | W2-02 when a reviewer opens the approve action (before the decision is written), with `lane` set | The frozen version restricted to that lane's slots under the lane-mapping constant recorded on the version | That lane's document rules |

An `upload` run on a draft is attached to the draft's artifact reference and is carried to the version that freezes it; it is not re-run on submit unless the submit rules ask for it. Findings from all three triggers accumulate on the version (append-only QC log per version, source spec).

The reviewer sees the `approve_attempt` result before the decision controls (W2-07 "findings render before the decision controls"). The decision itself does not wait for a completed run: if the run is `unavailable`, the reviewer sees the unavailable finding and may still decide (L7).

### 3.3 Interface, TypeScript notation

Types live in the shared package. `Lane` is the shared lane type that W0-06 defines with the versioned mapping constant (`ai_coe` | `dpo` | `it_security`, labelled AI/COE, DPO, IT/Security); this spec reuses it and does not define a second one.

```ts
// rai-web/shared/src/contracts/qc.ts  (W1-00 creates; W1-10 and W2-05 consume)

export type QcTrigger = 'upload' | 'submit' | 'approve_attempt';
export type Severity = 'high' | 'medium' | 'low';
export type Lane = 'ai_coe' | 'dpo' | 'it_security';          // from W0-06 / W1-00, imported not redefined
export type SlotNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
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
  filename: string;          // for display in a finding only; may be Thai
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
  runKey: string;                    // idempotency key, section 3.7
  attempt: number;                   // 1..n under the same runKey; incremented only after an `unavailable` or aged-out run (3.7)
  trigger: QcTrigger;
  lane: Lane | null;                 // set only for approve_attempt
  version: VersionRef;
  checklistTemplateVersion: string;  // e.g. "v1.0-sheet3-sl2.1"; selects the threshold source (L12)
  qcRulesRevision: string;           // configuration revision ID frozen on the version at submit (W1-05)
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

export interface EvidenceLocation {
  artifactId: string | null;         // null only with locator.kind === 'absent' at pack level
  contentHash: string | null;
  slot: SlotNumber | null;
  locator: EvidenceLocator;
  excerpt?: string;                  // max 300 UTF-16 code units; document text; rendered as text only; never logged
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
  | { kind: 'run'; trigger: QcTrigger; lane: Lane | null };   // the QC-unavailable finding; one per run

export type OwningLaneBasis =
  | 'recorded_rule'                                  // single-lane slot under the recorded W0-06 mapping
  | 'provisional_pending_w0_06_refinement';          // slot 5, slot 9, pack, run: the review-leads refinement

export interface QcFinding {
  findingKey: string;                // stable within the run: `${ruleId}:${scopeKey}`; the server assigns findingId on record
  ruleId: string;                    // matches /^[A-Z]+(-[A-Z0-9]+)+$/ e.g. "ACC-METRIC-CITED"
  ruleRevision: string;              // equals request.qcRulesRevision; a run never applies another revision
  trigger: QcTrigger;
  scope: FindingScope;
  severity: Severity;
  owningLane: Lane;                  // assigned by the W0-06 rule; section 3.6
  owningLaneBasis: OwningLaneBasis;
  evidence: EvidenceLocation[];      // at least one; kind 'absent' when the defect is an omission
  measure: Measure | null;           // required when the rule is a metric/denominator/threshold rule
  message: { key: string; params: Record<string, string | number> };   // D12 locale key; Thai default in the UI
  provenance: { runner: 'scripted_substitute' | string; runnerVersion: string };
}

export type QcUnavailableReason = 'timeout' | 'runner_error' | 'not_configured' | 'artifact_unreadable';

export type QcRunResult =
  | { status: 'completed'; findings: QcFinding[]; rulesEvaluated: string[]; startedAt: string; finishedAt: string }
  | { status: 'unavailable'; reason: QcUnavailableReason; detail: string | null;   // detail: no document content, no PII
      startedAt: string; finishedAt: string };

/** The port. Exactly one implementation is selected at startup (section 6). */
export interface QcRunner {
  readonly identity: { runner: string; runnerVersion: string };
  run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult>;
}
```

Timestamps are ISO-8601 UTC strings; the UI renders them in the D06 timezone (Asia/Bangkok).

### 3.4 Orchestrator behaviour (server side, Lane A)

The orchestrator wraps the runner and is the only code that touches the store for QC. Its contract, in order:

1. **Build the request** from the frozen version (or the draft for `upload`) and the actor's already-checked scope. It sets `runKey` and `attempt` (section 3.7: the lookup of the latest attempt under the key decides whether this is a replay that returns the existing run or a new attempt), `correlationId` from the request context, and `deadlineMs` from `QC_TIMEOUT_MS`.
2. **Insert the QC run row** with status `running` and this `attempt` in its own short transaction, so a crash mid-run leaves a visible `running` row. A `running` row whose `startedAt` is older than `2 × QC_TIMEOUT_MS` (proposed margin; W2-05 confirms) is **aged out**: the readiness/operator view (W0-10) and the next trigger's lookup (3.7) both treat it as `unavailable:runner_error`, the orchestrator moves the row to that status and appends the QC-unavailable finding for it (3.6; or records `alreadyRecorded` under step 6 when one is already open for that trigger and lane) in the same transaction as the next attempt's `running` row, and a late result for the aged-out row is discarded as in step 3. An aged-out row is never returned as the current run.
3. **Call `runner.run(request, signal)`** with an `AbortController` whose timer is `deadlineMs`. On timer expiry: abort, and treat the outcome as `unavailable` with reason `timeout`, regardless of what the runner returns afterwards (a late result is discarded and logged, never persisted).
4. **Validate the result** against the shared schema. Any violation (unknown field, `ruleRevision` ≠ `qcRulesRevision`, `owningLane` outside the lane type, `excerpt` over 300 code units, missing evidence, a `measure` whose `thresholdSource` ≠ `checklistTemplateVersion`, a finding with `scope.kind === 'run'` or `ruleId === 'QC-UNAVAILABLE'`, which only the orchestrator builds) is treated as `unavailable:runner_error` with the violation name in `detail`. Malformed output never becomes a finding.
5. **Stamp `owningLane`** through the resolution in section 3.6, which wraps the W0-06 assignment function. For **runner-produced** findings: on `recorded_rule` scopes the function's value must equal the runner's, and a mismatch is a `runner_error`; on provisional scopes (slot 5, slot 9, pack) the orchestrator writes the runner's value and keeps `owningLaneBasis` on the row. For findings the **orchestrator builds itself** (the QC-unavailable finding, whether from an `unavailable` result, an aged-out `running` row in step 2, or the `QC_RUNNER=none` runner) there is no runner value to take: the orchestrator resolves the lane from the provisional owning-lane companion entry for the version's `laneMappingVersion` (section 3.6) and stamps `owningLaneBasis = 'provisional_pending_w0_06_refinement'`.
6. **Persist** in one transaction: the run row moves to `completed` or `unavailable`; each finding is appended with a new `findingId`, `status = 'open'`, the run ID and `correlationId`; for `unavailable` the single QC-unavailable finding (section 3.6) is appended. A finding whose `(ruleId, ruleRevision, scopeKey)` already has an *open* finding on the same version is not appended again (`scopeKey` is the scope's fields joined in order, so two unavailable runs with different triggers or lanes stay distinct); the run records `alreadyRecorded: findingId` for it (the demo's "already recorded as a finding on this submission" behaviour). Dispositioned findings do not suppress a new one.
7. **Emit** one structured log event per run (`qc.run.finished`) with `correlationId`, `runId`, `versionId`, `trigger`, `lane`, `status`, `reason`, finding count and `runner` identity. No `excerpt`, no filename, no message params (W0-10 redaction rule).

The orchestrator never mails, never changes a slot, a version, a lane decision or a disposition, and never reads runner output as an instruction.

### 3.5 Rule families the substitute scripts (from the source spec; not a rule catalogue)

The real catalogue is Admin configuration keyed to `checklist_template_version` (L12) and is W4/W6 work. Slice 1 needs synthetic findings that look like the real ones, so the substitute's scripts use these families with these IDs. IDs are stable so W2-05, W2-07 and W2-09 tests can name them.

| `ruleId` | Trigger | Scope | `measure` | Source-spec rule |
|---|---|---|---|---|
| `PACK-SLOT-MISSING` | submit | slot | null | Completeness: a lane-gated slot is `missing` with no reason |
| `PACK-STAGE-MISMATCH` | submit | pack | null | Pack-versus-stage: e.g. a launch checklist filed at `idea`, or `pre_launch` with the privacy checklist `not_yet` |
| `PACK-CONTRADICTION` | submit | pack (evidence in two artifacts) | null | Cross-document contradiction |
| `ACC-METRIC-CITED` | approve_attempt, upload | artifact (slot 1 or 5) | required | A "Yes" on hallucination/accuracy must cite metric, denominator, threshold and artefact |
| `ACC-EXTRACTION-NOT-HALLUCINATION` | approve_attempt | artifact | required (`metric: 'extraction_accuracy'`) | Extraction % is not a hallucination rate (v1.0 item 3.5) |
| `ACC-BAND-V1-SHEET3` | approve_attempt | artifact | required, `thresholdSource` must be the v1.0 Sheet-3 SL#2.1 version | H <1%, M <2%, L <3% apply only under that template version; other versions never inherit them |
| `ACC-CLASSIC-ML-METRIC` | approve_attempt | artifact | required or slot N/A reason | Classic-ML uses that sheet's matching metric or N/A |
| `QC-UNAVAILABLE` | any | run | null | QC failure is an explicit finding, never a clean pass. Built by the orchestrator only (3.6); a script never contains it, and a runner that returns it fails validation (3.4 step 4) |

Severity: `high` for `ACC-BAND-V1-SHEET3` and `ACC-EXTRACTION-NOT-HALLUCINATION` in scripts and for `QC-UNAVAILABLE` in the orchestrator; `medium` for the rest. These are fixture values, not thresholds of record.

### 3.6 Owning lane and the QC-unavailable finding

Every finding carries `owningLane` because D05 makes the owning lane the authority for waived and N/A dispositions and the confirmer of the owner's proposed "fixed" (W2-05). The value comes from the **W0-06 owning-lane assignment rule**:

- **Recorded now (W0-06, under D02 and D05):** a finding on a single-lane slot (1, 2, 3, 4, 6, 7, 8) is owned by that slot's lane under the mapping constant recorded on the version (AI/COE 1 and 5; DPO 2, 3, 4, 5; IT/Security 5, 6, 7, 8). `owningLaneBasis = 'recorded_rule'`.
- **Not recorded yet (W0-06 open item, review leads before W2-05):** slot 5 (BRD, shared), slot 9 (no lane gate), pack-level findings and the QC-unavailable finding. Until the refinement is recorded, every finding in these categories carries `owningLaneBasis = 'provisional_pending_w0_06_refinement'`, the orchestrator persists that basis on the finding row, and the UI (W2-09) shows the basis. The provisional value has exactly one source per producer, and **this spec chooses neither value**; both sources hold whatever value W2-05's tests need (to exercise "a waiver by a non-owning lane is forbidden" on a slot-5 and a pack-level finding, and "`unavailable` recorded, not zero findings"), both are replaced by the recorded rule when W0-06 records it, and the tests are rewritten to that rule then. No code path defaults to a lane: a missing value is a startup error, never a fallback.
  - *Runner-produced findings (slot 5, slot 9, pack):* the substitute's script files carry an explicit `owningLane`, and the orchestrator writes that value (3.4 step 5).
  - *Orchestrator-built findings (the QC-unavailable finding, scope `run`):* the orchestrator never receives a runner value for these (an `unavailable` result carries no lane, an aged-out `running` row has no result at all, and the `QC_RUNNER=none` runner returns nothing), so it reads the **provisional owning-lane companion** of the lane-mapping constant, resolved by the `laneMappingVersion` recorded on the version (for an `upload` on a draft, the current constant's version, which is what submit will record), never by the current constant directly.

The companion and the resolution the orchestrator calls, in TypeScript notation:

```ts
// rai-web/shared/src/workflow/provisional-owning-lane.ts  (W1-00 creates; path per W0-02; deleted when W0-06 records the rule)

export interface ProvisionalOwningLane {
  readonly basis: 'provisional_pending_w0_06_refinement';   // the only basis this constant can ever confer
  readonly pendingRecord: 'W0-06 section 7.3';              // the recorded rule replaces this file
  /** Owning lane of the QC-unavailable finding, by trigger. 'trigger_lane' resolves to request.lane and is valid only for approve_attempt. */
  readonly run: {
    readonly upload: Lane;
    readonly submit: Lane;
    readonly approve_attempt: Lane | 'trigger_lane';
  };
}

/** Keyed by LaneMapping.version (W0-06). One entry per exported mapping constant; values are W1-00 fixture choices, not decisions. */
export const PROVISIONAL_OWNING_LANE_BY_MAPPING: Readonly<Record<string, ProvisionalOwningLane>>;

/** The resolution the orchestrator calls (Lane A). Wraps owningLaneForSlot (W0-06) for artifact and slot scopes. */
export function resolveOwningLane(
  scope: FindingScope,
  request: Pick<QcRunRequest, 'trigger' | 'lane' | 'laneMappingVersion'>,
  runnerValue: { owningLane: Lane; owningLaneBasis: OwningLaneBasis } | null,   // null for orchestrator-built findings
): { owningLane: Lane; owningLaneBasis: OwningLaneBasis };
```

Rules for the companion:

- **A separate constant keyed by the same version string**, not a field of `LANE_MAPPING_V1`: the D02 constant is frozen by the W0-06 test on its exact shape and changing it needs a register row, while this file exists only until the refinement is recorded. Resolving by the recorded `laneMappingVersion` means a later entry, or the recorded rule, never reinterprets a finding stored under an earlier one.
- **Startup fails closed** (W1-00 configuration validation, same posture as the `QC_RUNNER` row in 3.9): the server refuses to start unless every exported lane-mapping version has an entry whose three `run` fields are each a `Lane` (or `'trigger_lane'` for `approve_attempt`). A missing entry or an unset field is a startup error naming the mapping version; the shared type has no optional field and no default value.
- **No miss at run time.** A stored version can only record an exported mapping version, so the lookup cannot miss after the startup check. If it ever does (a row restored with an unknown `laneMappingVersion`), `resolveOwningLane` throws before the run row is written, the error is logged with the `correlationId` (W0-10), and nothing is recorded with a guessed lane.
- **`resolveOwningLane` is pure and unit-tested by W1-00:** an `artifact` or `slot` scope on a single-lane slot returns `owningLaneForSlot` with `recorded_rule` and throws when `runnerValue` disagrees (the orchestrator maps that throw to `runner_error`, 3.4 step 5); an `artifact`, `slot` or `pack` scope on a provisional category returns `runnerValue` and throws when it is `null` (a runner may not omit it); a `run` scope ignores `runnerValue` and returns the companion value with the provisional basis, `'trigger_lane'` resolving to `request.lane` on `approve_attempt` and throwing on any other trigger; an unknown `laneMappingVersion` throws.

**QC-unavailable finding.** When the result is `unavailable` (timeout, runner error, not configured, unreadable artifact), the orchestrator appends exactly one finding per run:

```ts
{
  findingKey: `QC-UNAVAILABLE:run:${trigger}:${lane ?? '-'}`,
  ruleId: 'QC-UNAVAILABLE',
  ruleRevision: request.qcRulesRevision,
  trigger: request.trigger,
  scope: { kind: 'run', trigger: request.trigger, lane: request.lane },
  severity: 'high',
  owningLane: resolveOwningLane(scope, request, null).owningLane,   // companion entry for request.laneMappingVersion, by trigger (above); no runner value exists
  owningLaneBasis: 'provisional_pending_w0_06_refinement',
  evidence: [{ artifactId: null, contentHash: null, slot: null, locator: { kind: 'absent' } }],
  measure: null,
  message: { key: 'qc.finding.unavailable', params: { reason, trigger, rulesEvaluated: 0 } },
  provenance: { runner: 'orchestrator', runnerVersion: /* server version */ }
}
```

It is dispositioned like any other finding (fixed by a later completed run, the next attempt under the same `runKey` in 3.7, recorded by the owning lane, or waived with a reason). It is never auto-closed by a later successful run; the later run's findings are appended beside it, and the QC-unavailable finding stays `open` until a person dispositions it. This is what makes A08 "QC failure is visible, not clean-pass" and the threat-model row "QC/model outage presented as clean evidence" testable.

### 3.7 Idempotency, attempts and replay

```ts
runKey = sha256(versionId | trigger | (lane ?? '-') | qcRulesRevision | sorted(`${slot}:${contentHash}` for each request.artifacts[i]))
```

The `slot:contentHash` pair, not the bare hash, is what identifies the input: the same bytes attached to two slots are two placements with two sets of completeness rules (source spec, QC triggers: "On each upload: that artefact's own completeness rules"), so on the `upload` trigger, where `versionId` is the draft ID, uploading the same file to a second slot on the same draft yields a different key and a new run, never a replay of the first slot's run. Uploading the same bytes to the *same* slot again does replay (same placement, same rules, same result). `artifactId` is not part of the key: it is a row identity, and two rows with the same `(slot, contentHash)` are the same QC input. Every run row carries `runKey` and `attempt` (1..n). The QC run table has a unique index on `(runKey, attempt)` and a partial unique index on `runKey` where `status = 'completed'`, so a key has any number of `unavailable` attempts but at most one `completed` run. On a trigger the orchestrator reads the latest attempt under the key, in the same short transaction as step 2 of 3.4, and acts on its status:

| Latest attempt under `runKey` | Behaviour |
|---|---|
| none | Start `attempt = 1`. |
| `completed` | **Replay.** A retried submit request under the same idempotency key, or a reviewer reopening the approve action, returns the existing run; QC does not run again and nothing is appended. |
| `unavailable` (timeout, runner error, not configured, unreadable artifact) | **New attempt.** Start `attempt + 1` under the same `runKey`. Its findings are appended beside the still-open QC-unavailable finding of the earlier attempt (3.6); that finding is never auto-closed. A transient timeout on `approve_attempt` therefore never makes the lane's QC on that version permanently unavailable: the next approve attempt gets a real run, and the earlier failure stays visible until the owning lane dispositions it. |
| `running`, within the age-out margin (3.4 step 2) | Return the existing run (a request in flight is not duplicated). |
| `running`, past the age-out margin | Age the row out to `unavailable:runner_error` with its QC-unavailable finding, then start `attempt + 1` as above. |

Two concurrent triggers for a key with no current attempt race on the `(runKey, attempt)` index; the loser re-reads and returns the winner's `running` row. Attempts are additions, never rewrites: a later attempt never changes an earlier attempt's row (beyond the age-out of a stale `running` row) or any finding it produced (data contract, append-only findings). A deliberate re-run (a future Admin "recheck under revision Y", W6) has a different `qcRulesRevision` and therefore a different key, and it is an explicit recorded recheck, never a rewrite.

### 3.8 Error contract

| Situation | Where it surfaces | Code (ADR-0003) |
|---|---|---|
| Runner timeout, runner error, not configured, artifact unreadable | The business action (upload, submit, decision) **succeeds**; its response carries `qc: { runId, status: 'unavailable', reason, findingId }`; the QC-unavailable finding is on the version | Not an HTTP error on the action. A future endpoint whose only purpose is to return a QC result (none in slice 1) answers `503 qc_unavailable` with the same body |
| Runner output fails schema validation | Same as above with `reason: 'runner_error'` | Same |
| Caller passes an artifact the actor may not read | Cannot happen through the orchestrator (it builds the list from the authorized version); a unit test asserts the request builder throws `forbidden` before any runner call | `403 forbidden` on the originating action |
| Stale version on `approve_attempt` (reviewer's expected version ≠ current) | W2-02 rejects the decision before QC is asked | `409 stale_version` |
| Actor asks for QC on a case out of scope | Rejected by W0-05 before the orchestrator | `403 forbidden` |

Nothing QC-related ever returns `unauthenticated`, `unsafe_upload`, `invalid_input` or `mail_delivery_failed`; those belong to the actions around it.

### 3.9 Test substitute (W1-10)

Name: `ScriptedQcRunner`, `identity = { runner: 'scripted_substitute', runnerVersion: <package version> }`. Selected by `QC_RUNNER=scripted`. It is the slice-1 app-path runner (W2-05 needs synthetic findings in the real server), so it is not "absent from non-test configuration" the way the W1-13 UI substitute is; instead **the readiness check (W0-10) reports the runner identity, and startup configuration validation (W1-00) refuses `production` identity mode together with `QC_RUNNER=scripted`** (fail closed, same posture as the W0-03 modes). W4 replaces it behind the same port.

Behaviour:

- **Script selection.** A script is a JSON file listing `QcFinding` values (without `findingKey`'s server-assigned ID) keyed by `(fixtureCaseId, trigger, lane?)`. Fixture case IDs follow the W0-02 fixture identity convention and are the W1-09 cases (non-vendor, vendor, missing slot, N/A reasons). A request whose version belongs to a fixture case with a script returns those findings, after the substitute rewrites `ruleRevision` to `request.qcRulesRevision` and validates each finding's `scope` against the request's slots and artifacts (a script that names an artifact not in the request is a script bug and the substitute throws in tests). A request with no matching script returns `completed` with zero findings and `rulesEvaluated: []`.
- **Test control API** (only on the instance; not reachable over HTTP):

```ts
export interface ScriptedQcRunnerControl {
  script(selector: { fixtureCaseId: string; trigger: QcTrigger; lane?: Lane }, findings: QcFinding[]): void;
  simulateTimeout(mode: 'hang' | 'immediate', selector?: { versionId?: string } | 'next'): void;
    // 'hang': never resolves until `signal` aborts, then rejects with AbortError — exercises the orchestrator timer
    // 'immediate': resolves { status: 'unavailable', reason: 'timeout' } at once — keeps suites fast
  simulateError(reason: 'runner_error' | 'artifact_unreadable', selector?: 'next'): void;
  calls: ReadonlyArray<{ request: QcRunRequest; at: string }>;   // every request received, for assertions
  reset(): void;
}
```

- **Determinism.** Same request, same script, same output, including `startedAt`/`finishedAt` order. No randomness, no clock dependence beyond timestamps.
- **No network, no filesystem writes.** The substitute reads script JSON at construction; it never opens a socket and never writes a file.

Tests W1-10 must ship (all `node:test`, unit layer, no Postgres):

| Test | Asserts | Done-when clause |
|---|---|---|
| returns scripted findings for a version reference | `completed`, findings deep-equal the script after `ruleRevision` rewrite, each `scope` resolves to a request slot/artifact | "Returns scripted findings for a version ref" |
| unscripted version yields zero findings, not unavailable | `completed`, `findings.length === 0` | same |
| `unavailable` on demand | `simulateError('runner_error')` → `unavailable`, `detail` contains no filename, excerpt or email | "returns `unavailable` on demand" |
| simulated timeout, both modes | `'immediate'` → `unavailable:timeout` in < 50 ms; `'hang'` → the call resolves only after `signal` aborts, and a caller with a 100 ms timer observes `timeout` | "simulates a timeout" |
| no write path to workflow state, structural | walking the substitute's module graph (`import.meta.resolve` over its files) reaches nothing under `rai-web/server`, no `drizzle-orm`, `pg`, `fastify`, `node:fs` write APIs, `node:net`, `node:http`; only `rai-web/shared` and `node:` read-only modules | "a test asserts it has no write path to workflow state" |
| no write path, behavioural | the request object is deep-frozen before the call and unchanged after; a store spy passed nowhere records zero calls; `artifacts[i].read` is the only capability and the run for a `submit` script never invokes it | same |
| schema conformance | every scripted finding passes the shared validator; a finding with a 301-code-unit excerpt fails | supports orchestrator step 4 |
| provisional owning lane visible | every slot-5, slot-9 and pack finding in the scripts has `owningLaneBasis = 'provisional_pending_w0_06_refinement'`; every single-lane-slot finding has `'recorded_rule'` and its `owningLane` equals the W0-06 function's value; no script contains a `run`-scoped finding or `ruleId = 'QC-UNAVAILABLE'` (the substitute throws at construction on such a script, since only the orchestrator builds that finding) | section 3.6 |
| fail closed on configuration (owner W1-00 for the loader, W1-10 for the runner identity it selects, same pattern as the 4.8 "no external mail path" row) | the config loader with identity mode `production` and `QC_RUNNER=scripted` throws at startup, naming the key; `QC_RUNNER=other` (any value outside `scripted` \| `none`) throws, in every identity mode; `QC_RUNNER` unset throws; `QC_RUNNER=none` loads and every run is `unavailable:not_configured`; the readiness payload (W0-10) reports `qc.runner = { runner: 'scripted_substitute', runnerVersion }` when `scripted` is selected; startup throws, naming the mapping version, when `PROVISIONAL_OWNING_LANE_BY_MAPPING` lacks an entry for an exported lane-mapping version or an entry's `run` field is unset (3.6) | 3.9 opening paragraph, 3.6, section 6 |

Integration tests that consume the substitute belong to W2-05 (record and disposition; `unavailable` recorded not treated as zero findings; a replayed trigger after `completed` returns the same run and appends nothing; a second run after `unavailable` starts `attempt = 2` under the same `runKey`, completes and appends its findings while the QC-unavailable finding stays `open`; an aged-out `running` row becomes `unavailable:runner_error` and the next trigger starts a new attempt; the same bytes uploaded to two slots on one draft produce two runs with distinct `runKey`s, each evaluating its own slot's rules, while the same bytes uploaded to the same slot again replay the first run; the QC-unavailable finding recorded for a `QC_RUNNER=none` run or a simulated timeout carries the provisional owning lane resolved from the version's `laneMappingVersion` (3.6) with `owningLaneBasis = 'provisional_pending_w0_06_refinement'`, and a request built for a version whose `laneMappingVersion` has no provisional entry fails before any run row is written), W2-07/W2-09 (rendering, disposition UI) and W3-07 (a simulated timeout appears once in the operator view and in the log with the same correlation ID).

## 4. Mail sink

### 4.1 Placement: transactional outbox, then a sink

Mail is a notification, never the record (source spec). The chain is:

1. A business event commits (lane opened at submit or resubmit, send-back, Ready, or the daily SLA-breach digest generation). **In the same transaction** the notifier (W3-03) inserts one notification row per recipient, status `pending`, with the dedup key as a unique constraint. A rolled-back transition therefore has no notification row and nothing is ever sent for it ("No mail exists for a rolled-back transition").
2. After commit, the dispatcher (W3-03, retry policy in W3-04) reads `pending` rows and calls the sink once per row.
3. The sink returns a `DeliveryReceipt`; the dispatcher records it on the row. Failure schedules a retry; the fourth failure marks the row `failed` and it appears in the Admin/operator view (D06, W3-07).

The sink is single-attempt and stateless with respect to retry. It does not know about the workflow, the case, the version's contents or the actor.

### 4.2 Interface, TypeScript notation

```ts
// rai-web/shared/src/contracts/mail.ts  (W1-00 creates; W1-11 and W3-03/W3-04 consume)

export type MailEventKind = 'lane_opened' | 'sent_back' | 'ready_for_launch' | 'sla_breach_digest';
export type Locale = 'th' | 'en';                 // D12; 'th' is the default

/** A business event that has already committed. The sink cannot be handed an uncommitted one. */
export interface CommittedEvent {
  kind: MailEventKind;
  caseId: string | null;                 // null only for sla_breach_digest
  versionId: string | null;              // null only for sla_breach_digest
  versionNumber: number | null;
  lane: Lane | null;                     // lane_opened, sent_back: the lane; ready_for_launch, digest: null
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
  url: string;                           // `${APP_PUBLIC_ORIGIN}${path}`; path is one of the canonical case routes; no query string, no fragment, no token
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
  textBody: string;                      // plain text; contains every deep link; never document contents or finding excerpts
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
  sinkMessageId: string | null;          // set when delivered; the sink's own handle (file line number, memory index)
  error: { code: 'malformed_request' | 'sink_failure' | 'rejected_recipient' | 'unsafe_link' | 'duplicate'; message: string } | null;
                                         // message: no address, no case content. malformed_request: the message names the offending field
                                         // (4.3); sink_failure: forced or real sink failure, or an oversize payload with the size in the message
}

export interface MailSink {
  readonly identity: { sink: 'memory' | 'file'; version: string };
  deliver(request: DeliveryRequest): Promise<DeliveryReceipt>;
}
```

The four `MailEventKind` values are the four rows of the source-spec notification table; the recipients, contents and the due date come from W3-03 and W3-05.

### 4.3 Validation the sink performs (defensive; the notifier already guarantees them)

Before accepting a request the sink checks, and on failure returns `failed` with the named `error.code` without recording a delivery. One bad link fails the whole delivery; the sink never sends a mail with some of its links stripped:

- `deepLinks` is non-empty, and **every** `deepLinks[i].url` starts with the configured `APP_PUBLIC_ORIGIN` and has a path that is one of the canonical routes; no `?`, `#`, or credential-looking segment in any of them → otherwise `unsafe_link` (`error.message` names the failing index, never the URL).
- Every link points where the mail says it does: for `lane_opened`, `sent_back` and `ready_for_launch` there is exactly one link, its `caseId` equals `event.caseId` and `digestCases` is `null`; for `sla_breach_digest` `digestCases` is non-empty, every `deepLinkIndex` is in range, the indexed link has `route = 'case'` and `caseId` equal to the entry's `caseId`, and every `route = 'case'` link is referenced by exactly one entry → otherwise `unsafe_link`.
- `recipient.address` satisfies the synthetic-domain rule (4.6) → otherwise `rejected_recipient`.
- `mail.textBody` contains every `deepLinks[i].url` (the links are the point of every mail; the digest lists one line per breached case with its link) → otherwise `unsafe_link` (`error.message` names the missing link's index).
- `event.auditEventId` is a non-empty string (a request without a committed audit event is malformed; the notifier never builds one) → otherwise `malformed_request` (`error.message` names the field, `event.auditEventId`, and nothing else from the event).
- Payload size is bounded: `mail.subject` ≤ 998 bytes after UTF-8 encoding (RFC 5322 line limit, with encoded-word folding left to a real transport), `mail.textBody` ≤ 64 KiB (65 536 bytes) after UTF-8 encoding → otherwise `sink_failure` (`error.message` names the field and its byte size, never its contents).

The checks run in the order listed; the first failure is the receipt's `error`. `malformed_request` is reserved for a structurally invalid request (a missing committed event); a request that is well-formed but unsafe or oversize takes the more specific code above, so the dispatcher (W3-04) can distinguish a request it must rebuild (`malformed_request`, `unsafe_link`, `rejected_recipient`) from a sink-side failure (`sink_failure`); the retry policy itself stays in 4.5.

### 4.4 Dedup key

D06: deduplicated by (event, version, lane, recipient). The key is a string the notifier builds and the notification table enforces as unique:

```
dedupKey = `${event.kind}:${versionId ?? digestDay}:${lane ?? '-'}:${recipientId}`
```

- `versionId` for lane-open, send-back and Ready. Resubmission produces a new version and therefore new keys, so lanes reopened on v2 are notified again (D05 full re-review).
- For `sla_breach_digest` the version position holds the digest day as `YYYY-MM-DD` in Asia/Bangkok (D06 calendar) and lane is `-`, keeping the D06 tuple shape with one digest per recipient per day. W3-03's contract PR confirms this mapping.

The dispatcher never sends a key it has already recorded as `delivered`. The sinks keep their own index of accepted keys and answer `duplicate` for a repeat, which the dispatcher treats as success without a second delivery (A05 "retry avoids duplicate events").

### 4.5 Retry and failure (owned by W3-04, stated here so the sink contract matches)

- Attempts 1 to 4 (one send plus three retries, D06). Backoff between attempts: proposed 1 s, 5 s, 25 s local, configurable through `MAIL_RETRY_BACKOFF_MS` as three integers; W3-04 confirms the numbers. Only `failed` receipts schedule a retry; `duplicate` and `delivered` end the row.
- After the fourth failure the row is `failed` permanently, carries the last `error`, and is listed for Admin and the operator audience (D06, W3-07). The ADR-0003 code `mail_delivery_failed` (502) is the row's error code, exposed on the notification record and the operator view; **it is never returned to the actor whose decision committed the event**, because that decision has already committed and is not undone (workflow contract "Mail failure does not undo a valid human decision").
- Retries reuse the same `dedupKey` and increment `attempt`.

### 4.6 Content and safety rules

- **Locale keys (D12).** `RenderedMail.templateKey` and `templateParams` are recorded alongside the rendered text so the mail can be re-rendered in the other language and so tests can assert on keys, not on Thai or English prose. Thai default. Subjects are UTF-8 strings in the sink; RFC 2047 encoding belongs to a real transport, not to the sinks. A Thai subject round-trips unchanged through both sinks (W3-03 "a Thai subject line is intact").
- **Nothing sensitive in mail.** No attachment, no document contents, no finding excerpt, no evidence panel text. Lane-open carries the defect *count*; send-back carries the reviewer's feedback summary that the reviewer typed (it is the reviewer's text, not document text) truncated to 500 code units. Threat model: deep links instead of contents.
- **Safe deep links.** A link is a location, not a capability. A recipient who follows it is sent through sign-in and the W0-05 scope check; an out-of-scope recipient gets `forbidden`. No token is ever embedded (A05 "recipient cannot gain access from link alone"). The three case-bound events carry one link to the case; the operator digest carries one `case` link per breached case, each validated by the sink (4.3), so the source-spec digest row ("the list of cases past SLA, links to each") is met without an unvalidated URL ever entering `textBody`.
- **Synthetic-domain rule (slice 1).** Every recipient address handed to a sink must have a domain under an RFC 2606 reserved name: `*.test`, `*.example`, `*.invalid`, `example.com`, `example.net`, `example.org`. Fixture user addresses (W1-00) and the single synthetic operator address in `operator_recipients` (W0-08, W1-09) must satisfy it. Anything else is `rejected_recipient`. This is the sink-level guarantee behind "no external mail during synthetic test" and stays until a real transport is authorized under D10.
- **No external transport.** `MAIL_TRANSPORT` accepts exactly `memory` and `file`. There is no `smtp`, no HTTP mail API, no third value; the config loader (W1-00) rejects any other string at startup. A grep-level test in W1-11 asserts that no module under `rai-web/` imports `node:net`, `node:tls`, `nodemailer` or any mail SDK ("no external mail path exists in any configuration").

### 4.7 Substitutes (W1-11)

Two sinks, both in Lane C's fixtures package, both implementing `MailSink`:

**`MemoryMailSink`** (`MAIL_TRANSPORT=memory`, the default in tests).

- Keeps `sent: DeliveryRequest[]` and an accepted-key `Set`.
- Control API (instance only, not reachable over HTTP):

```ts
export interface MemoryMailSinkControl {
  failNext(count: number, code?: 'sink_failure'): void;     // the next `count` deliveries return failed
  failWhen(predicate: (req: DeliveryRequest) => boolean): void;
  failAlways(on: boolean): void;
  find(dedupKey: string): DeliveryRequest | undefined;
  sent: ReadonlyArray<DeliveryRequest>;
  receipts: ReadonlyArray<DeliveryReceipt>;
  reset(): void;
}
```

**`FileMailSink`** (`MAIL_TRANSPORT=file`, local development so a person can read what would have been sent).

- Appends one JSON line per receipt to `${MAIL_SINK_DIR}/outbox.jsonl` (`MAIL_SINK_DIR` defaults to `.local/mail/` under the repo, git-ignored by W1-00) with the full `DeliveryRequest` and `DeliveryReceipt`, and writes `${MAIL_SINK_DIR}/<dedupKey-safe>.txt` with the rendered subject and body for reading.
- The accepted-key index is rebuilt from `outbox.jsonl` on construction, so `duplicate` survives a process restart.
- Forced failure for the file sink is `MAIL_SINK_FAIL_NEXT=<n>` read at construction (an operator-facing knob for rehearsing W3-04 locally), otherwise the same control API as memory.
- File names never contain the recipient address or case name: the dedup key is hashed to a safe filename.

Both sinks record the `correlationId` on every line they write and nothing else from the event beyond IDs.

### 4.8 Tests W1-11 must ship (`node:test`, unit layer)

| Test | Asserts | Done-when clause |
|---|---|---|
| accepts the four inputs and returns a status | a valid `lane_opened` request returns `delivered` with `sinkMessageId`, `attempt` echoed, `dedupKey` echoed; a valid `sla_breach_digest` request with three `case` links, three `digestCases` entries and all three URLs in `textBody` returns `delivered` | "Accepts the four inputs and returns a status" |
| forced failure is reported | `failNext(1)` → `failed:sink_failure`; the same request again → `delivered`; `failAlways(true)` → four consecutive `failed` | "a forced failure is reported" |
| duplicate key | second delivery of the same `dedupKey` → `duplicate`, `sent.length` unchanged | D06 dedup |
| unsafe link rejected | a URL on another origin, with a query string, or with a fragment → `failed:unsafe_link`; nothing recorded. A digest with five `case` links of which one is bad (another origin, a query string, or a `caseId` that differs from its `digestCases` entry) → `failed:unsafe_link` for the whole delivery, `error.message` names the index and not the URL, nothing recorded; a `lane_opened` request whose single link's `caseId` ≠ `event.caseId`, or a digest with a `case` link missing from `textBody`, → `failed:unsafe_link` | A05 |
| non-synthetic recipient rejected | `owner@bu-a.example` and `ops@rai-desk.test` accepted; `someone@gmail.com` and an address with no domain → `failed:rejected_recipient`, nothing recorded | "no external mail" |
| malformed or oversize request rejected | a `lane_opened` request with `event.auditEventId = ''` → `failed:malformed_request`, `error.message` contains `auditEventId`; a request whose `mail.textBody` is 64 KiB + 1 byte (65 537 bytes, links intact) → `failed:sink_failure`, `error.message` contains `65537`; a request whose `mail.subject` is 999 bytes → `failed:sink_failure`, `error.message` contains `999`; in all three cases nothing is recorded (`sent.length` unchanged, no `outbox.jsonl` line, no `.txt` file) and the same `dedupKey` delivered afterwards with a valid request → `delivered`, not `duplicate` | 4.3 (negative case of "Accepts the four inputs") |
| Thai subject intact | subject `แจ้งเตือน: เลนเปิดแล้ว` round-trips byte-identical through memory and file sinks | D12, W3-03 |
| file sink restart | write two receipts, construct a new `FileMailSink` on the same directory, redeliver one key → `duplicate` | 4.7 |
| no external mail path | module-graph walk over `rai-web/` finds no `node:net`, `node:tls`, `node:http` client use in the sinks and no mail SDK anywhere; `MAIL_TRANSPORT=smtp` makes the config loader throw | "no external mail path exists in any configuration" |
| no secrets or contents on disk | the file sink's output contains the deep links and IDs, and does not contain the string of any `excerpt`, any password-like config value or the audit event's actor email | threat model |

Integration tests belong to W3-03 (four events, one mail each, rolled-back transition has no mail, deep link without session is `unauthenticated`), W3-04 (three retries with backoff, duplicate sends nothing, committed decision unchanged after permanent failure), W3-07 (a forced failure appears once in the operator view and log with the same correlation ID) and the W3-06 journey.

## 5. Error contract summary for both boundaries

| ADR-0003 error | QC boundary | Mail sink |
|---|---|---|
| `qc_unavailable` (503) | Recorded as the QC-unavailable finding; carried on the successful action response as `qc.status = 'unavailable'`; the 503 status itself only on a QC-only endpoint (none in slice 1) | — |
| `mail_delivery_failed` (502) | — | On the notification row after the fourth failed attempt; visible to Admin/operator; never on the actor's action response |
| `forbidden` (403) | The request builder refuses an artifact the actor may not read; W0-05 refuses the action before QC | Deep-link follower out of scope after sign-in |
| `unauthenticated` (401) | — | Deep-link follower without a session |
| `stale_version` (409) | W2-02 rejects the decision before `approve_attempt` QC runs | — |
| `invalid_input` (422) | Never from QC; a malformed runner result is `unavailable:runner_error` | Never from the sink; malformed requests are `failed` receipts with a named `error.code` from the 4.2 union (`malformed_request`, `unsafe_link`, `rejected_recipient`, `sink_failure`), per 4.3 |
| `unsafe_upload` (422) | Never from QC; W1-03 rejects bytes before QC sees them | — |

## 6. Configuration keys (W1-00 adds them to the sample env file with placeholders)

| Key | Values | Default (local) | Notes |
|---|---|---|---|
| `QC_RUNNER` | `scripted` \| `none` | `scripted` | `none` makes every run `unavailable:not_configured`. `production` identity mode refuses `scripted`; any other value, or no value, fails startup (3.9 test row "fail closed on configuration"). A real runner value is added by W4 under ADR-0006. |
| `QC_TIMEOUT_MS` | integer | `10000` | Orchestrator timer; tests use 100 |
| `QC_SCRIPTS_DIR` | path | `rai-web/fixtures/src/qc-substitute/scripts` | Read once at startup |
| `MAIL_TRANSPORT` | `memory` \| `file` | `file` for `npm run dev`, `memory` for tests | Any other value fails startup |
| `MAIL_SINK_DIR` | path | `.local/mail` | File sink only; git-ignored |
| `MAIL_SINK_FAIL_NEXT` | integer | `0` | File sink only; local rehearsal of W3-04 |
| `MAIL_RETRY_BACKOFF_MS` | three integers, comma-separated | `1000,5000,25000` | Dispatcher (W3-04) |
| `APP_PUBLIC_ORIGIN` | URL origin | `http://127.0.0.1:<port W0-02 names>` | Deep-link origin; loopback in `local-google` mode (W0-03) |

No key holds a credential. Networked or production mail credentials, if a transport is ever authorized, live in the D10 custody mechanism (W0-03 secrets rule), not here.

## 7. Observability hooks (W0-10 contract)

| Event | Fields | Never contains |
|---|---|---|
| `qc.run.started` / `qc.run.finished` | `correlationId`, `runId`, `runKey`, `attempt`, `versionId`, `trigger`, `lane`, `status`, `reason`, `findingCount`, `alreadyRecordedCount`, `runner`, `runnerVersion`, `durationMs` | excerpt, filename, message params, artifact bytes |
| `mail.delivery.attempted` | `correlationId`, `dedupKey`, `event.kind`, `recipientId`, `attempt`, `status`, `error.code`, `sink`, `linkCount` | address, subject, body, deep links, case IDs of the digest |
| readiness (W0-10) | `qc.runner` identity and `mail.sink` identity; readiness fails closed when `QC_RUNNER` or `MAIL_TRANSPORT` is unset or invalid | — |
| operator view (W3-07) | failed notification rows (`dedupKey`, kind, attempts, last error code, case link) and `unavailable` QC runs (`runId`, version, trigger, reason) | contents |

## 8. Test-layer map for this spec

| Acceptance | Layer | Ticket | What is proven |
|---|---|---|---|
| A08 (feeds; real QC is W4) | unit | W1-10 (loader check: W1-00) | Typed findings, `unavailable`, timeout, no write path, fail-closed `QC_RUNNER` configuration |
| A09 | integration (real Postgres + scripted runner) | W2-05, W2-06 | `unavailable` recorded not zero; findings append-only; open findings block Ready; owning-lane authority on single-lane, slot-5 and pack-level findings |
| A08 visibility | integration + browser | W2-07, W3-07, W2-INT | Findings shown before decision controls; a timeout appears once in the operator view |
| A05 | unit | W1-11 | Status, forced failure, duplicate, unsafe link (single and one-of-many in a digest), per-case link correctness, synthetic-domain rule, malformed and oversize request, Thai subject, no external path |
| A05 | integration | W3-03, W3-04 | Outbox in the same transaction; four events; three retries with backoff; dedup; committed decision unchanged |
| A05 | browser | W3-06 | Notification links require sign-in and scope in the end-to-end journey |

Substitute runs are never acceptance evidence for the real QC (W4) or a real transport (W7/W8); A08's model-quality half and R5's real-mail half stay open until those packages.

## 9. Consumers and cross-links

| Ticket | Uses from this spec |
|---|---|
| W1-00 | Shared types in `contracts/qc.ts` and `contracts/mail.ts`; the provisional owning-lane companion, `resolveOwningLane` and its startup check (3.6); the config keys in section 6; synthetic-domain rule for fixture user addresses; the `(runKey, attempt)` and completed-`runKey` unique indexes on the W0-04 QC run entity (3.7) |
| W1-03 | `upload` trigger after the artifact is stored |
| W1-05 | `submit` trigger after the version freezes; `qcRulesRevision` and `laneMappingVersion` on the request |
| W1-09 | Fixture case IDs the scripts key on; the single synthetic operator address |
| W1-10 | Section 3.9 in full |
| W1-11 | Sections 4.7 and 4.8 in full |
| W2-02 | `approve_attempt` trigger with `lane`, before the decision writes |
| W2-05 | Finding record, `unavailable` finding, `owningLane` and `owningLaneBasis`, append-only rule; `runKey`/`attempt` lookup and the new-attempt-after-`unavailable` rule (3.7) |
| W2-07, W2-09 | Finding shape for rendering; the D12 message key; the visible provisional basis |
| W3-03 | Outbox placement, `DeliveryRequest` with `deepLinks` and `digestCases`, four event kinds, digest dedup mapping, locale templates |
| W3-04 | Retry ownership, attempt numbering, permanent failure |
| W3-05 | Due date parameter on lane-open mail; breach query feeding the digest's `digestCases` and one `case` link per breached case |
| W3-07 | Section 7 |
| W4 | Replaces `ScriptedQcRunner` behind `QcRunner` under ADR-0006 (D08, D09) |

Related W0 specs: [W0-03 identity adapter](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) (production mode and secrets custody), [W0-04 persistence](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec) (QC run/finding and notification entities, append-only findings, audit event in the same transaction), [W0-05 authorization](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix) (recipient rows, deep-link scope), [W0-06 workflow and errors](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract) (owning-lane rule, lane constant, error types), [W0-08 upload safety](../delivery/w0-technical-contract.md#w0-08--upload-safety-policy-and-fixtures) (sniffed media type, fixture set, synthetic operator address), [W0-10 observability](../delivery/w0-technical-contract.md#w0-10--observability-contract-for-the-desk-runtime). Each of those is written on its own branch; when its `docs/engineering/` file merges, the link here is updated to the file.

Product sources: [workflow](../product/workflow.md) (failure behaviour, notifications), [data contract](../product/data-contract.md) (QC run/finding, notification entities), [source spec](../product/source-spec.md) QC and Notifications sections (frozen), [acceptance](../acceptance.md) A05 and A08, [threat model](../security/threat-model.md), [decision register](../product/decisions.md) D05, D06, D12, [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) error codes and the QC worker open item, [architecture](../architecture/README.md) QC and notification boundary rows.

## 10. Open items carried, not resolved

- [ ] Owning lane for slot 5, slot 9, pack-level and QC-unavailable findings — review leads, W0-06, before W2-05. Until then the scripts (slot 5, slot 9, pack) and the provisional owning-lane companion (QC-unavailable, by trigger) carry `provisional_pending_w0_06_refinement` values that this spec does not choose (3.6); the companion file is deleted when the rule is recorded. W0-06 section 7.4, merged after this branch was cut, states the alternative posture for the interim (no owning lane on slot-5, slot-9 or pack fixtures and no stored `unavailable` finding until the record exists); the W0-09 exit review picks one interim posture for W1-10 and W2-05. Neither posture chooses a lane, and the recorded rule replaces both.
- [ ] Final repository paths for the pieces in section 2 — W0-02.
- [ ] Backoff numbers and the digest dedup mapping — W3-04 and W3-03 contract PRs confirm the proposals in 4.4 and 4.5.
- [ ] Model or extraction method behind `QcRunner`, its data handling and evaluation fixtures — ADR-0006 at W4 entry (D08, D09).
- [ ] Any transport that leaves the process, and its credential custody — D10; no slice-1 ticket may add one.

## 11. W0 contract traceability

| W0-07 clause | Where |
|---|---|
| Inputs are a version reference and authorized artifact references | 3.1, `QcRunRequest` in 3.3 |
| Typed findings: rule ID, rule revision, evidence location, metric/denominator/threshold where relevant, severity, `owning_lane` = AI/COE \| DPO \| IT/Security assigned by the W0-06 rule | `QcFinding`, `Measure`, `EvidenceLocation` in 3.3; 3.6 |
| Explicit `unavailable` result recorded as a finding with an `owning_lane` under the same rule | 3.3 `QcRunResult`, 3.6 (`resolveOwningLane`, the provisional companion resolved by `laneMappingVersion`, fail-closed startup check); a later attempt under the same `runKey` appends beside it, never closes it (3.7) |
| QC has no approval, mail or write access to workflow state | 3.1, 3.4, 3.9 structural and behavioural tests |
| Slice-1 substitute returns scripted synthetic findings and can simulate a timeout | 3.9 |
| No model chosen (D08, D09) | 1, 10 |
| Mail accepts a committed business event, authorized recipients, a safe deep link and a dedup key; returns delivery status | `DeliveryRequest` (`deepLinks`: one validated link for case-bound events, one validated `case` link per breached case plus `digestCases` for the operator digest, per the source-spec Notifications table and A05), `DeliveryReceipt` in 4.2 with the five-value `error.code` union (`malformed_request`, `sink_failure`, `rejected_recipient`, `unsafe_link`, `duplicate`); validation 4.3, each check with its code; 4.4; negative cases in 4.8 |
| Local substitute writes to a file or in-memory sink; no external mail | 4.6, 4.7, 4.8 |
| Interface, error contract and test substitute (W0 section text) | 3.3/4.2, 3.8/4.5/5, 3.9/4.7 |
| Cross-links to consuming tickets | 9 |
