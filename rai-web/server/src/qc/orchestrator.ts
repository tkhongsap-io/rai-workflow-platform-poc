// W2-05 QC orchestrator: builds a request, calls the injected QcRunner, validates, and persists single-lane
// defect findings (W0-06 7.1 / 7.4). One finding that fails validation or has no recorded owning lane (slot 5,
// slot 9, pack; issue #35) fails the whole run as unavailable:runner_error, never a silently shorter clean run.
// Unavailable results store a qc_run with status unavailable and zero findings (W0-07 3.4 / 3.6). An unbound
// runner (production) persists engine_id `unbound` and replays that row.

import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { QcUnavailableReasonSchema } from '@rai/shared/schemas/observability';
import { LANE_MAPPINGS_BY_VERSION, type Lane, type Slot } from '@rai/shared/constants';
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
  SlotState,
} from '@rai/shared/qc/types';
import { checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import type { StoredFindingSummary } from '@rai/shared/schemas/review';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { readCaseRow, readVersionRow } from '../cases/repository.js';
import { staleDetails } from '../cases/service.js';
import type { Db, Tx } from '../db/client.js';
import { lockCase, withTransaction } from '../db/transaction.js';
import { auditStore } from '../audit/store.js';
import type { Emitter } from '../observability/log.js';
import type { ErrorCapture } from '../observability/errors.js';
import { runWithContext, maybeContext } from '../observability/context.js';
import { qcLateResult } from '../db/schema/operator-job-run.js';
import { readSlotsWithArtifacts } from '../versions/repository.js';
import { nextMonotonicStamp } from '../workflow/monotonic-stamp.js';
import {
  findLatestApproveAttemptRun,
  findLatestSubmitRun,
  insertQcFinding,
  insertQcRun,
  listFindingsForRun,
  ruleRevisionOf,
} from './repository.js';

export const QC_TIMEOUT_MS = 10_000;
export const UNBOUND_ENGINE_ID = 'unbound' as const;

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

export type PersistQcOutcome =
  | { status: 'completed'; runId: string; findings: StoredFindingSummary[] }
  | { status: 'unavailable'; reason: QcUnavailableReason; runId: string; findings: [] };

export type SubmitQcOutcome =
  PersistQcOutcome | { status: 'unavailable'; reason: 'unknown'; runId: string; findings: [] };

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

function refreshPathFor(caseId: string, version: PackVersionRow): string {
  return `/cases/${caseId}/versions/${version.id}`;
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
): Promise<QcRunRequest> {
  const { rows, artifacts: artifactMap } = await readSlotsWithArtifacts(tx, version.id);
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
  const ruleRevision = ruleRevisionOf(version);
  if (version.laneMappingVersion === null) throw new Error('submitted version has no lane_mapping_version');
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
    laneMappingVersion: version.laneMappingVersion,
    stageContext: version.stageContext as QcRunRequest['stageContext'],
    modelType: caseRow.modelType as QcRunRequest['modelType'],
    vendorInvolved: caseRow.vendorInvolved,
    slots,
    artifacts,
    deadlineMs,
  };
}

interface RunRecord {
  id: string;
  engineId: string;
  stamp: Date;
  correlationId: string;
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
    // An unknown mapping has no recorded owning-lane rule for any finding.
    const violation =
      validateQcFinding(finding, request) ??
      (mapping === undefined ? 'owning_lane_rule_pending' : checkOwningLane(finding, mapping));
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
): Promise<void> {
  await insertQcRun(tx, {
    id: run.id,
    versionId: version.id,
    trigger: request.trigger,
    slot: null,
    lane: request.lane,
    engineId: run.engineId,
    ruleRevision: request.qcRulesRevision,
    status: unavailableReason === null ? 'completed' : 'unavailable',
    unavailableReason,
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
    await recordRun(tx, version, request, run, result.reason, 0);
    return { status: 'unavailable', reason: result.reason, runId: run.id, findings: [] };
  }
  await recordRun(tx, version, request, run, null, result.findings.length);
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
    throw new StaleVersionError(
      staleDetails(
        'version_closed',
        'error.stale_version.guidance.ready',
        current,
        caseRow.rowVersion,
        refreshPathFor(input.caseId, current),
      ),
    );
  }
  if (current.id !== version.id) {
    throw new StaleVersionError(
      staleDetails(
        'version_superseded',
        'error.stale_version.guidance.version_superseded',
        current,
        caseRow.rowVersion,
        refreshPathFor(input.caseId, current),
      ),
    );
  }
  if (version.submittedAt === null) {
    throw new NotFoundError('version');
  }
  // Send-back sets draft_version_id and leaves current_version_id on N (W0-06 §5.2 approve row).
  if (caseRow.draftVersionId !== null) {
    throw new StaleVersionError(
      staleDetails(
        'version_closed',
        'error.stale_version.guidance.version_closed',
        version,
        caseRow.rowVersion,
        refreshPathFor(input.caseId, version),
      ),
    );
  }
  return { caseRow, version };
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
  if (input.trigger === 'submit') {
    const reason = Value.Check(QcUnavailableReasonSchema, prior.unavailableReason)
      ? prior.unavailableReason
      : 'unknown';
    return { status: 'unavailable', reason, runId: prior.id, findings: [] };
  }
  if (!runnerBound && prior.engineId === UNBOUND_ENGINE_ID) {
    return { status: 'unavailable', reason: 'not_configured', runId: prior.id, findings: [] };
  }
  return undefined;
}

type Settled =
  { kind: 'replayed'; outcome: SubmitQcOutcome } | { kind: 'recorded'; outcome: PersistQcOutcome };

/** A replay emits nothing; a newly recorded run emits its W0-10 completion line. */
function settle(deps: QcOrchestratorDeps, input: RunQcInput, settled: Settled, startedAt: number) {
  if (settled.kind === 'recorded') {
    const { outcome } = settled;
    if (outcome.status === 'unavailable') emitUnavailable(deps, input, outcome.runId, outcome.reason);
    else
      deps.emitter?.log('qc.run.completed', {
        qcRunId: outcome.runId,
        findingCount: outcome.findings.length,
        durationMs: Math.max(0, performance.now() - startedAt),
      });
  }
  return settled.outcome;
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
  input: RunQcInput,
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
    const request = await buildRequest(
      tx,
      caseRow,
      version,
      input.trigger,
      input.lane,
      input.correlationId,
      stamp.getTime() + timeoutMs,
    );
    if (runner === undefined) {
      const notConfigured = unavailableResult('not_configured', null, stamp);
      const outcome = await persistResult(tx, version, request, notConfigured, {
        ...run,
        engineId: UNBOUND_ENGINE_ID,
      });
      return { kind: 'recorded' as const, outcome };
    }
    return { kind: 'ready' as const, request, run: { ...run, engineId: runner.identity.runner }, runner };
  });
  if (prepared.kind !== 'ready') return settle(deps, input, prepared, performance.now());

  const { request, run } = prepared;
  deps.emitter?.log('qc.run.started', {
    qcRunId: run.id,
    caseId: input.caseId,
    versionId: input.versionId,
    trigger: input.trigger,
    ...(input.lane === null ? {} : { lane: input.lane }),
    qcKind: 'substitute', // W0-W3 binds only synthetic QC; real engines remain W4-gated.
  });
  const startedAt = performance.now();
  const result = await callRunner(prepared.runner, request, run.stamp, timeoutMs);

  try {
    const stored = await withTransaction(deps.db, async (tx): Promise<Settled> => {
      const { version } = await loadOpenSubmittedTarget(tx, input);
      const replayed = await replayPrior(tx, input, version, true);
      if (replayed !== undefined) return { kind: 'replayed', outcome: replayed };
      return { kind: 'recorded', outcome: await persistResult(tx, version, request, result, run) };
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
): void {
  const fields = { qcRunId: runId, caseId: input.caseId, versionId: input.versionId, reason };
  deps.emitter?.log('qc.run.unavailable', fields);
  deps.errors?.job({ category: 'qc_unavailable', ...fields });
}

/** Preserve the originating correlation even for callers outside an HTTP handler. */
export function runAndPersistLaneQc(
  deps: QcOrchestratorDeps,
  input: RunLaneQcInput,
): Promise<PersistQcOutcome> {
  return runWithContext(
    {
      ...maybeContext(),
      correlationId: input.correlationId,
      startedAt: maybeContext()?.startedAt ?? performance.now(),
    },
    () => runQc(deps, { ...input, trigger: 'approve_attempt' }),
  );
}

/** Coalesce same-process adapter retries; the locked recheck also protects separate app instances. */
const submitFlights = new WeakMap<Db, Map<string, Promise<SubmitQcOutcome>>>();
export function runAndPersistSubmitQc(
  deps: QcOrchestratorDeps,
  input: RunSubmitQcInput,
): Promise<SubmitQcOutcome> {
  let flights = submitFlights.get(deps.db);
  if (flights === undefined) {
    flights = new Map();
    submitFlights.set(deps.db, flights);
  }
  const key = `${input.caseId}:${input.versionId}`;
  const current = flights.get(key);
  if (current !== undefined) return current;
  const flight = runWithContext(
    {
      ...maybeContext(),
      correlationId: input.correlationId,
      startedAt: maybeContext()?.startedAt ?? performance.now(),
    },
    () => runQc(deps, { ...input, trigger: 'submit', lane: null }),
  );
  const tracked = flight.finally(() => {
    flights.delete(key);
  });
  flights.set(key, tracked);
  return tracked;
}

/** Test/helper: case row type re-export so callers need not dig into cases/. */
export type { CaseRow };
