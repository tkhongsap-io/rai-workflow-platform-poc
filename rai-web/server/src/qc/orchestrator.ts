// W2-05 QC orchestrator: builds a request, calls the injected QcRunner, validates, and persists defect findings
// with the owning lane W0-06 section 7 gives them (recorded 2026-09-25, #35). One finding that fails validation
// or the owning-lane check fails the whole run as unavailable:runner_error, never a silently shorter clean run.
// An unavailable result stores a qc_run with status unavailable plus the QC-UNAVAILABLE finding of W0-07 3.6,
// owned per W0-06 7.3 part 4 and appended once per open scope. An unbound runner (production) persists engine_id
// `unbound` and replays that row. W4-11a: every run row and qc.run.* line names the runner (engine_id,
// runner_version) and the rule revision, and a recorded run stores how many rules it evaluated. W4-02: the request
// carries the rules the recorded qc_rules revision selects (`request.rules`, null when no qc_rules revision
// applies); an unknown template version is recorded as runner_error without calling the runner. W4-04: the
// `upload` trigger (runAndPersistUploadQc) runs on the open draft, or the version it became while still open; its
// run has lane NULL and its slot, never replays, shares in-flight work by runKey, and its outage finding is owned by
// the slot's lane (slot 5: AI/COE; slot 9: no run) and reused per version and owning lane.

import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { QcUnavailableReasonSchema } from '@rai/shared/schemas/observability';
import {
  CURRENT_LANE_MAPPING,
  LANE_MAPPINGS_BY_VERSION,
  type Lane,
  type Slot,
  unavailableOwningLane,
} from '@rai/shared/constants';
import { NotFoundError, StaleVersionError } from '@rai/shared/errors';
import { uuidv7 } from '@rai/shared/ids';
import type {
  AuthorizedArtifactRef,
  QcFinding,
  QcRunRequest,
  QcRunResult,
  QcRunner,
  QcTrigger,
  QcUnavailableReason,
  SelectedRule,
  SlotState,
} from '@rai/shared/qc/types';
import { checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import type { StoredFindingSummary } from '@rai/shared/schemas/review';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { readCaseRow, readVersionRow } from '../cases/repository.js';
import type { Db, Tx } from '../db/client.js';
import { lockCase, withTransaction } from '../db/transaction.js';
import { auditStore } from '../audit/store.js';
import { findLatestUnavailableFinding } from '../findings/repository.js';
import type { Emitter } from '../observability/log.js';
import type { ErrorCapture } from '../observability/errors.js';
import { runWithContext, maybeContext } from '../observability/context.js';
import { qcLateResult } from '../db/schema/operator-job-run.js';
import { readSlotsWithArtifacts } from '../versions/repository.js';
import { nextMonotonicStamp } from '../workflow/monotonic-stamp.js';
import { staleAt } from '../workflow/refs.js';
import {
  findLatestApproveAttemptRun,
  findLatestSubmitRun,
  insertQcFinding,
  insertQcRun,
  listFindingsForRun,
  ruleRevisionOf,
} from './repository.js';
import { qcKindOf } from './kind.js';
import { requestRules, ruleContextOf } from './rules-revision.js';
import { RuleSelectionError } from './select.js';

export const QC_TIMEOUT_MS = 10_000;
export const UNBOUND_ENGINE_ID = 'unbound' as const;
/** W4-11a: the runner_version recorded beside engine_id `unbound`; no runner, so no version to name. */
export const UNBOUND_RUNNER_VERSION = 'unbound' as const;

export interface QcOrchestratorDeps {
  emitter?: Emitter;
  errors?: ErrorCapture;
  db: Db;
  runner?: QcRunner;
  now?: () => Date;
  timeoutMs?: number;
}

export interface RunLaneQcInput {
  caseId: string;
  versionId: string;
  lane: Lane;
  correlationId: string;
}

export type RunSubmitQcInput = Omit<RunLaneQcInput, 'lane'>;
type RunQcInput = RunSubmitQcInput &
  ({ trigger: 'submit'; lane: null } | { trigger: 'approve_attempt'; lane: Lane });

/** W4-04: one changed attach. `versionId` is the draft the save wrote (the row that becomes the version at submit). */
export interface RunUploadQcInput extends RunSubmitQcInput {
  slot: Slot;
}
type UploadQcInput = RunUploadQcInput & { trigger: 'upload'; lane: null };
/** Any run's input, for the helpers every trigger shares (logging, late results). */
type AnyQcInput = RunQcInput | UploadQcInput;

export type PersistQcOutcome =
  | { status: 'completed'; runId: string; findings: StoredFindingSummary[] }
  | {
      status: 'unavailable';
      reason: QcUnavailableReason;
      runId: string;
      findings: StoredFindingSummary[]; // the open QC-UNAVAILABLE finding for this run's scope (W0-07 3.6)
    };

export type SubmitQcOutcome =
  | PersistQcOutcome
  | { status: 'unavailable'; reason: 'unknown'; runId: string; findings: StoredFindingSummary[] };

function runKeyOf(
  versionId: string,
  trigger: QcTrigger,
  lane: Lane | null,
  qcRulesRevision: string,
  artifacts: ReadonlyArray<{ slot: number; contentHash: string }>,
): string {
  const parts = artifacts
    .map((a) => `${a.slot}:${a.contentHash}`)
    .sort()
    .join('|');
  return createHash('sha256')
    .update(`${versionId}|${trigger}|${lane ?? '-'}|${qcRulesRevision}|${parts}`)
    .digest('hex');
}

function slotOfFinding(finding: QcFinding): Slot | null {
  if (finding.scope.kind === 'artifact' || finding.scope.kind === 'slot') return finding.scope.slot;
  return null;
}

function evidenceForStore(finding: QcFinding): unknown {
  return finding.evidence.map((e) => ({
    artifact_id: e.artifactId,
    content_hash: e.contentHash,
    slot: e.slot,
    locator: e.locator,
    ...(e.excerptHash === undefined ? {} : { excerpt_hash: e.excerptHash }),
  }));
}

async function buildRequest(
  tx: Tx,
  caseRow: CaseRow,
  version: PackVersionRow,
  trigger: QcTrigger,
  lane: Lane | null,
  correlationId: string,
  deadlineMs: number,
  ruleRevision: string,
  rules: SelectedRule[] | null,
  uploadSlot: Slot | null = null,
): Promise<QcRunRequest> {
  const read = await readSlotsWithArtifacts(tx, version.id);
  const artifactMap = read.artifacts;
  // W0-07 3.3: an upload request carries the one uploaded slot and its artifact; runKey follows (3.7).
  const rows = uploadSlot === null ? read.rows : read.rows.filter((s) => s.slot === uploadSlot);
  const slots: SlotState[] = rows.map((s) => ({
    slot: s.slot as SlotState['slot'],
    disposition: s.state as SlotState['disposition'],
    reason: s.reason,
    artifactId: s.artifactId,
  }));
  const artifacts: AuthorizedArtifactRef[] = [];
  for (const s of rows) {
    if (s.state !== 'attached' || s.artifactId === null) continue;
    const art = artifactMap.get(s.artifactId);
    if (art === undefined) continue;
    artifacts.push({
      artifactId: art.artifactId,
      slot: s.slot as AuthorizedArtifactRef['slot'],
      contentHash: art.sha256,
      mediaType: art.mediaType,
      filename: art.filename,
      byteLength: art.sizeBytes,
      read: () => Promise.resolve(new ReadableStream()),
    });
  }
  // A draft has no mapping frozen yet; its upload run uses the current constant (W4a plan section 5).
  const laneMappingVersion =
    version.laneMappingVersion ?? (version.submittedAt === null ? CURRENT_LANE_MAPPING.version : null);
  if (laneMappingVersion === null) throw new Error('submitted version has no lane_mapping_version');
  return {
    correlationId,
    runKey: runKeyOf(
      version.id,
      trigger,
      lane,
      ruleRevision,
      artifacts.map((a) => ({ slot: a.slot, contentHash: a.contentHash })),
    ),
    trigger,
    lane,
    version: {
      caseId: version.caseId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      isDraft: version.submittedAt === null,
    },
    checklistTemplateVersion: version.checklistTemplateVersion,
    qcRulesRevision: ruleRevision,
    laneMappingVersion,
    stageContext: version.stageContext as QcRunRequest['stageContext'],
    modelType: caseRow.modelType as QcRunRequest['modelType'],
    vendorInvolved: caseRow.vendorInvolved,
    slots,
    artifacts,
    deadlineMs,
    rules,
  };
}

interface RunRecord {
  id: string;
  engineId: string; // the bound runner's identity.runner, or `unbound`
  runnerVersion: string; // the bound runner's identity.runnerVersion, or `unbound`
  stamp: Date;
  correlationId: string;
}

/** The W0-10 run identity fields (W4-11a) of a recorded run's qc.run.* lines. */
interface RunLabel {
  runner: string;
  runnerVersion: string;
  ruleRevision: string;
}

function labelOf(run: RunRecord, request: QcRunRequest): RunLabel {
  return { runner: run.engineId, runnerVersion: run.runnerVersion, ruleRevision: request.qcRulesRevision };
}

function unavailableResult(reason: QcUnavailableReason, detail: string | null, stamp: Date): QcRunResult {
  const at = stamp.toISOString();
  return { status: 'unavailable', reason, detail, startedAt: at, finishedAt: at };
}

/** W0-07 3.4 steps 4-5: the first finding that fails validation or the owning-lane check fails the whole run. */
function checkedResult(result: QcRunResult, request: QcRunRequest, stamp: Date): QcRunResult {
  if (result.status === 'unavailable') return result;
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion];
  for (const finding of result.findings) {
    // An unknown mapping can vouch for no lane.
    const violation =
      validateQcFinding(finding, request) ??
      (mapping === undefined ? 'owning_lane_mismatch' : checkOwningLane(finding, mapping, request.lane));
    if (violation !== null) return unavailableResult('runner_error', violation, stamp);
  }
  return result;
}

/** Inserts the immutable qc_run row and its audit event; findings follow under the same run id. */
async function recordRun(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  run: RunRecord,
  unavailableReason: QcUnavailableReason | null,
  findingCount: number,
  rulesEvaluated: number,
): Promise<void> {
  await insertQcRun(tx, {
    id: run.id,
    versionId: version.id,
    trigger: request.trigger,
    slot: uploadSlotOf(request),
    lane: request.lane,
    engineId: run.engineId,
    runnerVersion: run.runnerVersion,
    ruleRevision: request.qcRulesRevision,
    status: unavailableReason === null ? 'completed' : 'unavailable',
    unavailableReason,
    rulesEvaluated,
    requestedAt: run.stamp,
    completedAt: run.stamp,
    correlationId: run.correlationId,
  });
  await auditStore.append(tx, {
    actorSubjectId: 'system',
    actorRole: 'system',
    action: 'qc.run_recorded',
    targetCaseId: version.caseId,
    targetVersionId: version.id,
    targetRef: {
      run_id: run.id,
      trigger: request.trigger,
      finding_count: findingCount,
      ...(request.lane === null ? {} : { lane: request.lane }),
      ...(request.trigger === 'upload' ? { slot: uploadSlotOf(request) } : {}),
    },
    correlationId: run.correlationId,
    occurredAt: run.stamp,
  });
}

async function persistResult(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  result: QcRunResult,
  run: RunRecord,
): Promise<PersistQcOutcome> {
  if (result.status === 'unavailable') {
    // W0-07 3.6: one open outage finding per scope; for upload the scope is the owning lane (W4-04 amendment).
    const prior = await findLatestUnavailableFinding(
      tx,
      version.id,
      request.trigger,
      request.lane,
      request.trigger === 'upload' ? outageOwningLane(request) : undefined,
    );
    const reuse = prior !== undefined && prior.undispositioned;
    // The run row names the bound runner, not the orchestrator that builds the QC-UNAVAILABLE finding (W0-07 3.6).
    await recordRun(tx, version, request, run, result.reason, reuse ? 0 : 1, 0);
    if (reuse)
      return { status: 'unavailable', reason: result.reason, runId: run.id, findings: [prior.summary] };
    const summary = await appendUnavailableFinding(tx, version, request, run, result.reason);
    return { status: 'unavailable', reason: result.reason, runId: run.id, findings: [summary] };
  }
  await recordRun(tx, version, request, run, null, result.findings.length, result.rulesEvaluated.length);
  const findings: StoredFindingSummary[] = [];
  for (const finding of result.findings) {
    const findingId = uuidv7(run.stamp.getTime());
    const slot = slotOfFinding(finding);
    await insertQcFinding(tx, {
      id: findingId,
      runId: run.id,
      versionId: version.id,
      slot,
      kind: 'defect',
      ruleId: finding.ruleId,
      ruleRevision: finding.ruleRevision,
      severity: finding.severity,
      owningLane: finding.owningLane,
      evidence: evidenceForStore(finding),
      metric: finding.measure?.metric ?? null,
      denominator: finding.measure?.denominator ?? null,
      threshold: finding.measure?.threshold ?? null,
      messageKey: finding.message.key,
      messageParams: finding.message.params,
      createdAt: run.stamp,
    });
    findings.push({
      findingId,
      ruleId: finding.ruleId,
      slot,
      severity: finding.severity,
      owningLane: finding.owningLane,
      messageKey: finding.message.key,
      messageParams: { ...finding.message.params },
    });
  }
  return { status: 'completed', runId: run.id, findings };
}

/** The slot an upload run is scoped to (its request carries exactly that one slot); null for other triggers. */
function uploadSlotOf(request: QcRunRequest): Slot | null {
  if (request.trigger !== 'upload') return null;
  const [only] = request.slots;
  if (only === undefined || request.slots.length !== 1) throw new Error('an upload request carries one slot');
  return only.slot;
}

/**
 * The lane of a QC-UNAVAILABLE finding (W0-06 7.3 part 4). Submit and approve attempts need no mapping, so an
 * outage is recorded whatever the version's mapping version is. Upload (W4-04): the slot's lane under the request's
 * mapping; slot 5 → AI/COE (register row "D05 refinement (upload slot 5 and 9)"); slot 9 never reaches a run.
 */
function outageOwningLane(request: QcRunRequest): Lane {
  if (request.trigger === 'approve_attempt') {
    if (request.lane === null) throw new Error('an approve-attempt run names its lane'); // unreachable (RunQcInput)
    return unavailableOwningLane({ trigger: 'approve_attempt', lane: request.lane });
  }
  if (request.trigger === 'submit') return unavailableOwningLane({ trigger: 'submit', lane: null });
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion];
  if (mapping === undefined) throw new Error('an upload run needs a known lane mapping');
  const lane = unavailableOwningLane({ trigger: 'upload', slot: uploadSlotOf(request)! }, mapping);
  if (lane === null) throw new Error('slot 9 has no upload run'); // the trigger never calls the orchestrator for it
  return lane;
}

/** W0-07 3.6: the one finding the orchestrator builds itself. Its lane follows the run (W0-06 7.3 part 4). */
async function appendUnavailableFinding(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  run: RunRecord,
  reason: QcUnavailableReason,
): Promise<StoredFindingSummary> {
  const owningLane = outageOwningLane(request);
  const findingId = uuidv7(run.stamp.getTime());
  const messageParams = { reason, trigger: request.trigger, rulesEvaluated: 0 };
  await insertQcFinding(tx, {
    id: findingId,
    runId: run.id,
    versionId: version.id,
    slot: null,
    kind: 'unavailable',
    ruleId: 'QC-UNAVAILABLE',
    ruleRevision: request.qcRulesRevision,
    severity: 'high',
    owningLane,
    evidence: [{ artifact_id: null, content_hash: null, slot: null, locator: { kind: 'absent' } }],
    metric: null,
    denominator: null,
    threshold: null,
    messageKey: 'qc.finding.unavailable',
    messageParams,
    createdAt: run.stamp,
  });
  return {
    findingId,
    ruleId: 'QC-UNAVAILABLE',
    slot: null,
    severity: 'high',
    owningLane,
    messageKey: 'qc.finding.unavailable',
    messageParams,
  };
}

/** Case lock plus W0-06 4.4 preconditions: submitted, current, not Ready. */
async function loadOpenSubmittedTarget(
  tx: Tx,
  input: RunSubmitQcInput,
): Promise<{ caseRow: CaseRow; version: PackVersionRow }> {
  if (!(await lockCase(tx, input.caseId))) throw new NotFoundError('case');
  const caseRow = await readCaseRow(tx, input.caseId);
  if (caseRow === undefined) throw new NotFoundError('case');

  const version = await readVersionRow(tx, input.versionId);
  if (version === undefined || version.caseId !== input.caseId) {
    throw new NotFoundError('version');
  }

  const current =
    caseRow.currentVersionId === null ? undefined : await readVersionRow(tx, caseRow.currentVersionId);
  if (current === undefined) throw new NotFoundError('version');

  if (current.readyAt != null) {
    throw staleAt('version_closed', 'error.stale_version.guidance.ready', current, caseRow);
  }
  // The current version is always a submitted one, so a named draft is superseded here.
  if (current.id !== version.id) {
    throw staleAt('version_superseded', 'error.stale_version.guidance.version_superseded', current, caseRow);
  }
  // Send-back sets draft_version_id and leaves current_version_id on N (W0-06 §5.2 approve row).
  if (caseRow.draftVersionId !== null) {
    throw staleAt('version_closed', 'error.stale_version.guidance.version_closed', version, caseRow);
  }
  return { caseRow, version };
}

/**
 * W4-04 (W4a plan section 5): case lock plus the upload target: the case's open draft, or the version that draft
 * became while that version is still open, which {@link loadOpenSubmittedTarget} checks unchanged (Ready →
 * `version_closed`, a send-back → `version_closed`, a later version → `version_superseded`).
 */
async function loadUploadTarget(
  tx: Tx,
  input: RunUploadQcInput,
): Promise<{ caseRow: CaseRow; version: PackVersionRow }> {
  if (!(await lockCase(tx, input.caseId))) throw new NotFoundError('case');
  const caseRow = await readCaseRow(tx, input.caseId);
  if (caseRow === undefined) throw new NotFoundError('case');
  const version = await readVersionRow(tx, input.versionId);
  if (version === undefined || version.caseId !== input.caseId) throw new NotFoundError('version');
  if (version.submittedAt !== null) return loadOpenSubmittedTarget(tx, input);
  if (caseRow.draftVersionId === version.id) return { caseRow, version };
  // A draft row that is no longer the case's open draft: never written to.
  throw staleAt('version_superseded', 'error.stale_version.guidance.version_superseded', version, caseRow);
}

/**
 * W0-07 3.7: the recorded run a call returns instead of running QC. A completed run always replays. For submit,
 * an unavailable run replays with its stored reason. For approve_attempt an unavailable run is retried, except
 * that an unbound runner replays its own `unbound` row rather than stacking identical not_configured rows.
 */
async function replayPrior(
  tx: Tx,
  input: RunQcInput,
  version: PackVersionRow,
  runnerBound: boolean,
): Promise<SubmitQcOutcome | undefined> {
  const ruleRevision = ruleRevisionOf(version);
  const prior =
    input.trigger === 'submit'
      ? await findLatestSubmitRun(tx, version.id, ruleRevision)
      : await findLatestApproveAttemptRun(tx, version.id, input.lane, ruleRevision);
  if (prior === undefined) return undefined;
  if (prior.status === 'completed') {
    return { status: 'completed', runId: prior.id, findings: await listFindingsForRun(tx, prior.id) };
  }
  // An unavailable replay carries the scope's latest QC-UNAVAILABLE finding, as the recorded run did (W0-07 3.8).
  const latest = await findLatestUnavailableFinding(tx, version.id, input.trigger, input.lane);
  const findings = latest === undefined ? [] : [latest.summary];
  if (input.trigger === 'submit') {
    const reason = Value.Check(QcUnavailableReasonSchema, prior.unavailableReason)
      ? prior.unavailableReason
      : 'unknown';
    return { status: 'unavailable', reason, runId: prior.id, findings };
  }
  if (!runnerBound && prior.engineId === UNBOUND_ENGINE_ID) {
    return { status: 'unavailable', reason: 'not_configured', runId: prior.id, findings };
  }
  return undefined;
}

type Settled =
  | { kind: 'replayed'; outcome: SubmitQcOutcome }
  | { kind: 'recorded'; outcome: PersistQcOutcome; label: RunLabel; rulesEvaluated: number };

/** A replay emits nothing; a newly recorded run emits its W0-10 completion line. */
function settle(deps: QcOrchestratorDeps, input: AnyQcInput, settled: Settled, startedAt: number) {
  if (settled.kind === 'recorded') {
    const { outcome, label } = settled;
    if (outcome.status === 'unavailable')
      emitUnavailable(deps, input, outcome.runId, outcome.reason, label, outcome.findings[0]?.owningLane);
    else
      deps.emitter?.log('qc.run.completed', {
        qcRunId: outcome.runId,
        ...label,
        rulesEvaluated: settled.rulesEvaluated,
        findingCount: outcome.findings.length,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
  }
  return settled.outcome;
}

function recorded(outcome: PersistQcOutcome, label: RunLabel, result: QcRunResult): Settled {
  const rulesEvaluated = result.status === 'completed' ? result.rulesEvaluated.length : 0;
  return { kind: 'recorded', outcome, label, rulesEvaluated };
}

async function callRunner(
  runner: QcRunner,
  request: QcRunRequest,
  stamp: Date,
  timeoutMs: number,
): Promise<QcRunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return checkedResult(await runner.run(request, controller.signal), request, stamp);
  } catch {
    return unavailableResult(controller.signal.aborted ? 'timeout' : 'runner_error', null, stamp);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A result refused because the version became Ready is kept as an operator-visible diagnostic. The refused
 * persistence transaction rolled back; this one cannot append QC evidence to Ready, and locks the same case
 * before proving the result was late for that version.
 */
async function recordLate(
  deps: QcOrchestratorDeps,
  input: AnyQcInput,
  qcRunId: string,
  result: QcRunResult,
  clock: () => Date,
): Promise<void> {
  const late = await withTransaction(deps.db, async (tx) => {
    if (!(await lockCase(tx, input.caseId))) return undefined;
    const version = await readVersionRow(tx, input.versionId);
    if (version?.caseId !== input.caseId || version.readyAt === null) return undefined;
    const fields = {
      qcRunId,
      versionId: input.versionId,
      trigger: input.trigger,
      lane: input.lane,
      status: result.status,
      refusedFindingCount: result.status === 'completed' ? result.findings.length : 0,
      correlationId: input.correlationId,
    };
    const [inserted] = await tx
      .insert(qcLateResult)
      .values({ id: uuidv7(), ...fields, recordedAt: clock() })
      .onConflictDoNothing({ target: qcLateResult.qcRunId })
      .returning({ id: qcLateResult.id });
    return inserted === undefined ? undefined : fields;
  });
  if (late !== undefined)
    deps.emitter?.log('qc.run.late', {
      qcRunId: late.qcRunId,
      caseId: input.caseId,
      versionId: late.versionId,
      trigger: late.trigger,
      lane: late.lane,
      status: late.status,
      refusedFindingCount: late.refusedFindingCount,
    });
}

/**
 * Runs submit or lane QC and persists its defect findings or an unavailable run row, replaying a recorded run
 * where {@link replayPrior} says so (W0-07 3.4 step 2 / 3.7). An unbound runner records `unbound` /
 * not_configured under the first lock.
 *
 * The runner is awaited outside the case-row lock. `lock_timeout` is 5s and the runner may take up to
 * {@link QC_TIMEOUT_MS}, so holding `FOR UPDATE` across `runner.run` makes every other action on the
 * case fail. Persist re-locks and re-checks the target so a send-back during the run does not store
 * findings, and a concurrent completed run is replayed instead of inserted twice.
 */
function runQc(
  deps: QcOrchestratorDeps,
  input: RunQcInput & { trigger: 'approve_attempt' },
): Promise<PersistQcOutcome>;
function runQc(deps: QcOrchestratorDeps, input: RunQcInput & { trigger: 'submit' }): Promise<SubmitQcOutcome>;
async function runQc(deps: QcOrchestratorDeps, input: RunQcInput): Promise<SubmitQcOutcome> {
  const clock = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? QC_TIMEOUT_MS;
  const { runner } = deps;

  const prepared = await withTransaction(deps.db, async (tx) => {
    const { caseRow, version } = await loadOpenSubmittedTarget(tx, input);
    const replayed = await replayPrior(tx, input, version, runner !== undefined);
    if (replayed !== undefined) return { kind: 'replayed' as const, outcome: replayed };

    const stamp = nextMonotonicStamp(clock);
    const run = { id: uuidv7(stamp.getTime()), stamp, correlationId: input.correlationId };
    // W4-02: the rules of the recorded qc_rules revision for this template, trigger and model type (plan section 3).
    const context = await ruleContextOf(tx, version, stamp);
    let rules: SelectedRule[] | null = null;
    let selectionError: RuleSelectionError | undefined;
    try {
      rules = requestRules(
        context,
        version.checklistTemplateVersion,
        input.trigger,
        caseRow.modelType as QcRunRequest['modelType'],
      );
    } catch (error) {
      if (!(error instanceof RuleSelectionError)) throw error;
      selectionError = error;
    }
    const request = await buildRequest(
      tx,
      caseRow,
      version,
      input.trigger,
      input.lane,
      input.correlationId,
      stamp.getTime() + timeoutMs,
      context.ruleRevision,
      rules,
    );
    if (runner === undefined) {
      const notConfigured = unavailableResult('not_configured', null, stamp);
      const unbound = { ...run, engineId: UNBOUND_ENGINE_ID, runnerVersion: UNBOUND_RUNNER_VERSION };
      const outcome = await persistResult(tx, version, request, notConfigured, unbound);
      return recorded(outcome, labelOf(unbound, request), notConfigured);
    }
    const bound = { ...run, engineId: runner.identity.runner, runnerVersion: runner.identity.runnerVersion };
    if (selectionError !== undefined) {
      // No trustworthy rule list (an unknown template version): an outage under the bound runner, never a clean
      // pass, recorded without calling the runner.
      const failed = unavailableResult('runner_error', selectionError.detail, stamp);
      const outcome = await persistResult(tx, version, request, failed, bound);
      return recorded(outcome, labelOf(bound, request), failed);
    }
    return { kind: 'ready' as const, request, run: bound, runner };
  });
  if (prepared.kind !== 'ready') return settle(deps, input, prepared, performance.now());

  const { request, run } = prepared;
  deps.emitter?.log('qc.run.started', {
    qcRunId: run.id,
    caseId: input.caseId,
    versionId: input.versionId,
    trigger: input.trigger,
    ...(input.lane === null ? {} : { lane: input.lane }),
    qcKind: qcKindOf(prepared.runner.identity),
    ...labelOf(run, request),
  });
  const startedAt = performance.now();
  const result = await callRunner(prepared.runner, request, run.stamp, timeoutMs);

  try {
    const stored = await withTransaction(deps.db, async (tx): Promise<Settled> => {
      const { version } = await loadOpenSubmittedTarget(tx, input);
      const replayed = await replayPrior(tx, input, version, true);
      if (replayed !== undefined) return { kind: 'replayed', outcome: replayed };
      return recorded(await persistResult(tx, version, request, result, run), labelOf(run, request), result);
    });
    return settle(deps, input, stored, startedAt);
  } catch (error) {
    if (error instanceof StaleVersionError) await recordLate(deps, input, run.id, result, clock);
    throw error;
  }
}

function emitUnavailable(
  deps: QcOrchestratorDeps,
  input: RunSubmitQcInput,
  runId: string,
  reason: QcUnavailableReason,
  label: RunLabel,
  owningLane?: Lane,
): void {
  const fields = { qcRunId: runId, caseId: input.caseId, versionId: input.versionId, reason };
  // W0-10 3.3: the log line names the QC-UNAVAILABLE finding's lane (W0-07 3.6) and, since W4-11a, the run's
  // runner and rule revision; the error capture keeps its shape.
  deps.emitter?.log('qc.run.unavailable', {
    ...fields,
    ...label,
    ...(owningLane === undefined ? {} : { owningLane }),
  });
  deps.errors?.job({ category: 'qc_unavailable', ...fields });
}

/**
 * W0-07 3.4 step 2: concurrent calls for one version and trigger (and lane) share one in-flight run, whatever it
 * settles to; the locked recheck protects separate app instances. The run keeps the originating correlation even
 * for callers outside an HTTP handler.
 */
function shareFlight<T>(
  table: WeakMap<Db, Map<string, Promise<T>>>,
  deps: QcOrchestratorDeps,
  input: RunQcInput,
  run: () => Promise<T>,
): Promise<T> {
  return runWithContext(contextOf(input), () =>
    inFlight(table, deps.db, `${input.caseId}:${input.versionId}:${input.lane ?? input.trigger}`, run),
  );
}

/** The run keeps the originating correlation even for callers outside an HTTP handler. */
function contextOf(input: AnyQcInput) {
  return {
    ...maybeContext(),
    correlationId: input.correlationId,
    startedAt: maybeContext()?.startedAt ?? performance.now(),
  };
}

/** The in-flight table: one promise per key and database while it is pending. */
function inFlight<T>(
  table: WeakMap<Db, Map<string, Promise<T>>>,
  db: Db,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  let flights = table.get(db);
  if (flights === undefined) {
    flights = new Map();
    table.set(db, flights);
  }
  const current = flights.get(key);
  if (current !== undefined) return current;
  const tracked = run().finally(() => {
    flights.delete(key);
  });
  flights.set(key, tracked);
  return tracked;
}

const laneFlights = new WeakMap<Db, Map<string, Promise<PersistQcOutcome>>>();
export function runAndPersistLaneQc(
  deps: QcOrchestratorDeps,
  input: RunLaneQcInput,
): Promise<PersistQcOutcome> {
  const lane = { ...input, trigger: 'approve_attempt' as const };
  return shareFlight(laneFlights, deps, lane, () => runQc(deps, lane));
}

const submitFlights = new WeakMap<Db, Map<string, Promise<SubmitQcOutcome>>>();
export function runAndPersistSubmitQc(
  deps: QcOrchestratorDeps,
  input: RunSubmitQcInput,
): Promise<SubmitQcOutcome> {
  const submit = { ...input, trigger: 'submit' as const, lane: null };
  return shareFlight(submitFlights, deps, submit, () => runQc(deps, submit));
}

const uploadFlights = new WeakMap<Db, Map<string, Promise<PersistQcOutcome>>>();

/**
 * W4-04 (W4a plan section 5, W0-07 3.2): the QC run for one changed attach on a save-draft, fired after the save
 * committed. Slot 9 has no upload run (register row "D05 refinement (upload slot 5 and 9)"): `undefined`, nothing
 * written. Otherwise the run is recorded on the draft row, or on the version it became while that version is still
 * open; after Ready it is late (nothing written, `qc.run.late`), and a version closed by a send-back refuses it
 * (`version_closed`, nothing written). Upload never replays (every trigger is a new input, W0-07 3.7); two calls
 * for the same runKey in this process share one in-flight run, so two attaches in one save run separately.
 */
export function runAndPersistUploadQc(
  deps: QcOrchestratorDeps,
  input: RunUploadQcInput,
): Promise<PersistQcOutcome | undefined> {
  if (unavailableOwningLane({ trigger: 'upload', slot: input.slot }, CURRENT_LANE_MAPPING) === null)
    return Promise.resolve(undefined);
  const upload: UploadQcInput = { ...input, trigger: 'upload', lane: null };
  return runWithContext(contextOf(upload), () => runUploadQc(deps, upload));
}

async function runUploadQc(deps: QcOrchestratorDeps, input: UploadQcInput): Promise<PersistQcOutcome> {
  const clock = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? QC_TIMEOUT_MS;
  const { runner } = deps;

  // Read only: the request (and its runKey) for the row as it is now; nothing is written before the runner answers.
  const prepared = await withTransaction(deps.db, async (tx) => {
    const { caseRow, version } = await loadUploadTarget(tx, input);
    const stamp = nextMonotonicStamp(clock);
    // Plan section 3: a draft reads the qc_rules revision in force at the upload instant; a submitted row its own.
    const context = await ruleContextOf(tx, version, stamp);
    let rules: SelectedRule[] | null = null;
    let selectionError: RuleSelectionError | undefined;
    try {
      rules = requestRules(
        context,
        version.checklistTemplateVersion,
        'upload',
        caseRow.modelType as QcRunRequest['modelType'],
      );
    } catch (error) {
      if (!(error instanceof RuleSelectionError)) throw error;
      selectionError = error;
    }
    const request = await buildRequest(
      tx,
      caseRow,
      version,
      'upload',
      null,
      input.correlationId,
      stamp.getTime() + timeoutMs,
      context.ruleRevision,
      rules,
      input.slot,
    );
    return { request, stamp, selectionError };
  });
  const { request, stamp, selectionError } = prepared;

  return inFlight(uploadFlights, deps.db, request.runKey, async () => {
    const base = { id: uuidv7(stamp.getTime()), stamp, correlationId: input.correlationId };
    let run: RunRecord;
    let result: QcRunResult;
    let startedAt = performance.now();
    if (runner === undefined) {
      run = { ...base, engineId: UNBOUND_ENGINE_ID, runnerVersion: UNBOUND_RUNNER_VERSION };
      result = unavailableResult('not_configured', null, stamp);
    } else {
      run = { ...base, engineId: runner.identity.runner, runnerVersion: runner.identity.runnerVersion };
      if (selectionError !== undefined) {
        // No trustworthy rule list: an outage under the bound runner, never a clean pass (plan section 3).
        result = unavailableResult('runner_error', selectionError.detail, stamp);
      } else {
        deps.emitter?.log('qc.run.started', {
          qcRunId: run.id,
          caseId: input.caseId,
          versionId: input.versionId,
          trigger: 'upload',
          qcKind: qcKindOf(runner.identity),
          ...labelOf(run, request),
        });
        startedAt = performance.now();
        result = await callRunner(runner, request, stamp, timeoutMs);
      }
    }
    try {
      const stored = await withTransaction(deps.db, async (tx): Promise<Settled> => {
        const { version } = await loadUploadTarget(tx, input); // re-checked under the lock: Ready or closed refuses
        return recorded(
          await persistResult(tx, version, request, result, run),
          labelOf(run, request),
          result,
        );
      });
      return settle(deps, input, stored, startedAt) as PersistQcOutcome;
    } catch (error) {
      if (error instanceof StaleVersionError) await recordLate(deps, input, run.id, result, clock);
      throw error;
    }
  });
}

/** Test/helper: case row type re-export so callers need not dig into cases/. */
export type { CaseRow };
