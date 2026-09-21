// W0-07 section 3.3, transcribed (W1-00 creates; W1-10 and W2-05 consume). Lane and Slot are the W0-06 exports
// from constants.ts; this file defines no second lane type. Findings carry locale keys, never document text (D12).

import type { Lane, Slot } from '../constants.js';

export type QcTrigger = 'upload' | 'submit' | 'approve_attempt'; // the W0-04 qc_run.trigger values
export type Severity = 'high' | 'medium' | 'low';
export type SlotNumber = Slot; // 1..9, W0-06
export type SlotDisposition = 'attached' | 'not_yet' | 'not_applicable' | 'missing'; // W0-04 artifact_slot.state words
export type StageContext = 'idea' | 'pre_build' | 'pre_launch'; // D11
export type ModelType = 'llm' | 'classic_ml' | 'other'; // W0-04 fields

export interface VersionRef {
  caseId: string; // desk-local case ID
  versionId: string; // immutable submitted-version ID; for `upload` on a draft: the draft ID
  versionNumber: number; // 1..n, the "vN" a reviewer sees
  isDraft: boolean; // true only for the `upload` trigger
}

/** A read handle the server built after authorization. Nothing else reaches the runner. */
export interface AuthorizedArtifactRef {
  artifactId: string;
  slot: SlotNumber;
  contentHash: string; // sha256 hex, the store key (W0-04)
  mediaType: string; // sniffed type from W0-08, not the extension
  filename: string; // for display in a finding only; may be Thai; never logged (W0-10)
  byteLength: number;
  /** Streams the stored bytes. Read-only; the server revokes it when the run ends. */
  read(): Promise<ReadableStream<Uint8Array>>;
}

export interface SlotState {
  slot: SlotNumber;
  disposition: SlotDisposition;
  reason: string | null; // required for not_applicable (a locale key for the non-vendor default, W0-04); null otherwise
  artifactId: string | null; // set only when attached
}

export interface QcRunRequest {
  correlationId: string; // W0-10; same value on the run row, the audit event and the log line
  runKey: string; // deterministic input identity, W0-07 section 3.7
  trigger: QcTrigger;
  lane: Lane | null; // set only for approve_attempt
  version: VersionRef;
  checklistTemplateVersion: string; // selects the threshold source (L12)
  qcRulesRevision: string; // configuration revision ID frozen on the version at submit (W1-05); W0-04 qc_run.rule_revision
  laneMappingVersion: string; // the W0-06 constant version recorded on the version
  stageContext: StageContext; // D11; QC input only
  modelType: ModelType;
  vendorInvolved: boolean;
  slots: SlotState[]; // all nine for submit; the lane's slots for approve_attempt; one for upload
  artifacts: AuthorizedArtifactRef[]; // exactly the artifacts referenced by `slots`
  deadlineMs: number; // orchestrator-owned; the runner also receives an AbortSignal
}

export type EvidenceLocator =
  | { kind: 'page'; page: number; region?: { x: number; y: number; w: number; h: number } }
  | { kind: 'text_range'; start: number; end: number }
  | { kind: 'cell'; sheet: string; cell: string }
  | { kind: 'section'; heading: string }
  | { kind: 'absent' }; // the rule looked for something and found nothing

/** Maps 1:1 onto W0-04 qc_finding.evidence: {artifact_id?, page?, locator?, excerpt_hash?}. References only. */
export interface EvidenceLocation {
  artifactId: string | null; // null only with locator.kind === 'absent' at pack level
  contentHash: string | null;
  slot: SlotNumber | null;
  locator: EvidenceLocator;
  excerptHash?: string; // sha256 hex of the NFC-normalised UTF-8 excerpt; the excerpt itself never leaves the runner
}

export interface Measure {
  metric: string; // e.g. "hallucination_rate"
  value: number | null;
  denominator: number | null;
  threshold: number | null;
  unit: 'percent' | 'ratio' | 'count';
  thresholdSource: string; // the checklistTemplateVersion the threshold came from; never another version's
}

export type FindingScope =
  | { kind: 'artifact'; slot: SlotNumber; artifactId: string; contentHash: string }
  | { kind: 'slot'; slot: SlotNumber } // slot-level with no artifact (missing / N/A / not yet)
  | { kind: 'pack' } // completeness, contradiction, stage mismatch
  | { kind: 'run'; trigger: QcTrigger; lane: Lane | null }; // the QC-unavailable finding; one per run; orchestrator-built only

export interface QcFinding {
  findingKey: string; // stable within the run: `${ruleId}:${scopeKey}`; the server assigns findingId on record
  ruleId: string; // matches /^[A-Z]+(-[A-Z0-9]+)+$/ e.g. "ACC-METRIC-CITED"
  ruleRevision: string; // equals request.qcRulesRevision; a run never applies another revision
  trigger: QcTrigger;
  scope: FindingScope;
  severity: Severity;
  owningLane: Lane; // assigned by the W0-06 rule (section 7 there). Never a pending or guessed value.
  evidence: EvidenceLocation[]; // at least one; kind 'absent' when the defect is an omission
  measure: Measure | null; // required when the rule is a metric/denominator/threshold rule
  message: { key: string; params: Record<string, string | number> }; // D12 locale key; Thai default in the UI
  provenance: { runner: string; runnerVersion: string }; // runner = W0-04 qc_run.engine_id ('substitute-scripted' in slice 1)
}

export const QC_RULE_ID_PATTERN = /^[A-Z]+(-[A-Z0-9]+)+$/;

export type QcUnavailableReason = 'timeout' | 'runner_error' | 'not_configured' | 'artifact_unreadable';

export type QcRunResult =
  | {
      status: 'completed';
      findings: QcFinding[];
      rulesEvaluated: string[];
      startedAt: string;
      finishedAt: string;
    }
  | {
      status: 'unavailable';
      reason: QcUnavailableReason;
      detail: string | null; // no document content, no PII. Carries no lane (W0-06 7.4).
      startedAt: string;
      finishedAt: string;
    };

/** The port. Exactly one implementation is selected at startup (W0-07 section 6). */
export interface QcRunner {
  readonly identity: { runner: string; runnerVersion: string }; // W0-04 engine_id; slice 1: 'substitute-scripted'
  run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult>;
}
