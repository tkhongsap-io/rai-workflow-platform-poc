// W2-05 QC orchestrator: builds a request, calls the injected QcRunner, validates, and persists single-lane
// defect findings only (W0-06 7.1 / 7.4). Unavailable results store a qc_run with status unavailable and zero
// findings (W0-07 3.4 / 3.6). An unbound runner (production) persists engine_id `unbound` and replays that row.

import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { QcUnavailableReasonSchema } from '@rai/shared/schemas/observability';
import { LANE_MAPPINGS_BY_VERSION, owningLaneForSlot, type Lane, type Slot } from '@rai/shared/constants';
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
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { readCaseRow, readVersionRow } from '../cases/repository.js';
import { staleDetails } from '../cases/service.js';
import type { Db, Tx } from '../db/client.js';
import { setWorkflowWrite, lockCase, withTransaction } from '../db/transaction.js';
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
  type InsertFindingInput,
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

export interface StoredFindingView {
  findingId: string;
  ruleId: string;
  slot: number | null;
  severity: string;
  owningLane: Lane;
  messageKey: string;
  messageParams?: Record<string, string | number>;
}

export type PersistQcOutcome =
  | { status: 'completed'; runId: string; findings: StoredFindingView[] }
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

/** Keep only defect findings whose slot maps to a real owning lane under the version's mapping. */
export function storeableFindings(
  findings: readonly QcFinding[],
  mappingVersion: string,
  context: { trigger: QcTrigger; qcRulesRevision: string; checklistTemplateVersion: string },
): QcFinding[] {
  const mapping = LANE_MAPPINGS_BY_VERSION[mappingVersion];
  if (mapping === undefined) return [];
  const out: QcFinding[] = [];
  for (const finding of findings) {
    const v = validateQcFinding(finding, context);
    if (v !== null) continue;
    const laneCheck = checkOwningLane(finding, mapping);
    if (laneCheck === 'owning_lane_rule_pending') continue;
    if (laneCheck !== null) continue;
    const slot = slotOfFinding(finding);
    if (slot === null) continue;
    const owned = owningLaneForSlot(slot, mapping);
    if (owned === 'refinement_pending') continue;
    out.push(finding);
  }
  return out;
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
    laneMappingVersion: version.laneMappingVersion ?? 'lane-mapping/v1',
    stageContext: version.stageContext as QcRunRequest['stageContext'],
    modelType: caseRow.modelType as QcRunRequest['modelType'],
    vendorInvolved: caseRow.vendorInvolved,
    slots,
    artifacts,
    deadlineMs,
  };
}

async function persistCompleted(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  result: Extract<QcRunResult, { status: 'completed' }>,
  runner: QcRunner,
  stamp: Date,
  correlationId: string,
  runId: string,
): Promise<{ runId: string; findings: StoredFindingView[] }> {
  const storeable = storeableFindings(result.findings, request.laneMappingVersion, {
    trigger: request.trigger,
    qcRulesRevision: request.qcRulesRevision,
    checklistTemplateVersion: request.checklistTemplateVersion,
  });
  const stampMs = stamp.getTime();
  await insertQcRun(tx, {
    id: runId,
    versionId: version.id,
    trigger: request.trigger,
    slot: request.trigger === 'upload' ? (request.slots[0]?.slot ?? null) : null,
    lane: request.lane,
    engineId: runner.identity.runner,
    ruleRevision: request.qcRulesRevision,
    status: 'completed',
    requestedAt: stamp,
    completedAt: stamp,
    correlationId,
  });

  const findings: StoredFindingView[] = [];
  for (const finding of storeable) {
    const findingId = uuidv7(stampMs);
    const slot = slotOfFinding(finding);
    const row: InsertFindingInput = {
      id: findingId,
      runId,
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
      createdAt: stamp,
    };
    await insertQcFinding(tx, row);
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

  await auditStore.append(tx, {
    actorSubjectId: 'system',
    actorRole: 'system',
    action: 'qc.run_recorded',
    targetCaseId: version.caseId,
    targetVersionId: version.id,
    targetRef: {
      run_id: runId,
      trigger: request.trigger,
      finding_count: findings.length,
      ...(request.lane === null ? {} : { lane: request.lane }),
    },
    correlationId,
    occurredAt: stamp,
  });

  return { runId, findings };
}

async function persistUnavailable(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  engineId: string,
  stamp: Date,
  correlationId: string,
  runId: string,
  reason: QcUnavailableReason,
): Promise<string> {
  await insertQcRun(tx, {
    id: runId,
    versionId: version.id,
    trigger: request.trigger,
    slot: null,
    lane: request.lane,
    engineId,
    ruleRevision: request.qcRulesRevision,
    status: 'unavailable',
    unavailableReason: reason,
    requestedAt: stamp,
    completedAt: stamp,
    correlationId,
  });
  await auditStore.append(tx, {
    actorSubjectId: 'system',
    actorRole: 'system',
    action: 'qc.run_recorded',
    targetCaseId: version.caseId,
    targetVersionId: version.id,
    targetRef: {
      run_id: runId,
      trigger: request.trigger,
      finding_count: 0,
      ...(request.lane === null ? {} : { lane: request.lane }),
    },
    correlationId,
    occurredAt: stamp,
  });
  return runId;
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
 * Runs lane QC (approve_attempt) and persists storeable defect findings or an unavailable run row.
 * Replay of a completed run for the same input returns the existing rows (W0-07 3.4 step 2 / 3.7).
 * An unbound runner persists `unbound` / unavailable and replays that row while still unbound.
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

  const prepared = await withTransaction(deps.db, async (tx) => {
    await setWorkflowWrite(tx);
    const { caseRow, version } = await loadOpenSubmittedTarget(tx, input);

    const ruleRevision = ruleRevisionOf(version);
    const prior =
      input.trigger === 'submit'
        ? await findLatestSubmitRun(tx, version.id, ruleRevision)
        : await findLatestApproveAttemptRun(tx, version.id, input.lane, ruleRevision);
    if (prior !== undefined && prior.status === 'completed') {
      const findings = await listFindingsForRun(tx, prior.id);
      return {
        kind: 'outcome' as const,
        outcome: { status: 'completed' as const, runId: prior.id, findings },
      };
    }
    if (
      prior !== undefined &&
      prior.status === 'unavailable' &&
      (input.trigger === 'submit' || (prior.engineId === UNBOUND_ENGINE_ID && deps.runner === undefined))
    ) {
      return {
        kind: 'outcome' as const,
        outcome: {
          status: 'unavailable' as const,
          reason:
            input.trigger === 'submit'
              ? Value.Check(QcUnavailableReasonSchema, prior.unavailableReason)
                ? prior.unavailableReason
                : ('unknown' as const)
              : ('not_configured' as const),
          runId: prior.id,
          findings: [] as [],
        },
      };
    }

    const stamp = nextMonotonicStamp(clock);
    const attemptId = uuidv7(stamp.getTime());
    const request = await buildRequest(
      tx,
      caseRow,
      version,
      input.trigger,
      input.lane,
      input.correlationId,
      stamp.getTime() + timeoutMs,
    );

    if (deps.runner === undefined) {
      const runId = await persistUnavailable(
        tx,
        version,
        request,
        UNBOUND_ENGINE_ID,
        stamp,
        input.correlationId,
        attemptId,
        'not_configured',
      );
      return {
        recorded: true,
        kind: 'outcome' as const,
        outcome: {
          status: 'unavailable' as const,
          reason: 'not_configured' as const,
          runId,
          findings: [] as [],
        },
      };
    }

    return { kind: 'ready' as const, request, stamp, attemptId };
  });

  if (prepared.kind === 'outcome') {
    if ('recorded' in prepared) emitUnavailable(deps, input, prepared.outcome.runId, 'not_configured');
    return prepared.outcome;
  }
  deps.emitter?.log('qc.run.started', {
    qcRunId: prepared.attemptId,
    caseId: input.caseId,
    versionId: input.versionId,
    trigger: input.trigger,
    ...(input.lane === null ? {} : { lane: input.lane }),
    qcKind: 'substitute', // W0-W3 binds only synthetic QC; real engines remain W4-gated.
  });
  const startedAt = performance.now();

  const runner = deps.runner;
  if (runner === undefined) {
    throw new Error('lane QC prepared a run without a runner');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: QcRunResult;
  try {
    result = await runner.run(prepared.request, controller.signal);
  } catch {
    result = {
      status: 'unavailable',
      reason: controller.signal.aborted ? 'timeout' : 'runner_error',
      detail: null,
      startedAt: prepared.stamp.toISOString(),
      finishedAt: prepared.stamp.toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }

  try {
    const stored = await withTransaction(deps.db, async (tx) => {
      await setWorkflowWrite(tx);
      const { version } = await loadOpenSubmittedTarget(tx, input);
      const prior =
        input.trigger === 'submit'
          ? await findLatestSubmitRun(tx, version.id, ruleRevisionOf(version))
          : await findLatestApproveAttemptRun(tx, version.id, input.lane, ruleRevisionOf(version));
      if (prior !== undefined && prior.status === 'completed') {
        const findings = await listFindingsForRun(tx, prior.id);
        return { status: 'completed' as const, runId: prior.id, findings, recorded: false };
      }

      if (input.trigger === 'submit' && prior?.status === 'unavailable') {
        return {
          status: 'unavailable' as const,
          reason: Value.Check(QcUnavailableReasonSchema, prior.unavailableReason)
            ? prior.unavailableReason
            : ('unknown' as const),
          runId: prior.id,
          findings: [] as [],
          recorded: false,
        };
      }

      if (result.status === 'unavailable') {
        const runId = await persistUnavailable(
          tx,
          version,
          prepared.request,
          runner.identity.runner,
          prepared.stamp,
          input.correlationId,
          prepared.attemptId,
          result.reason,
        );
        return {
          status: 'unavailable' as const,
          reason: result.reason,
          runId,
          findings: [] as [],
          recorded: true,
        };
      }

      const persisted = await persistCompleted(
        tx,
        version,
        prepared.request,
        result,
        runner,
        prepared.stamp,
        input.correlationId,
        prepared.attemptId,
      );
      return {
        status: 'completed' as const,
        runId: persisted.runId,
        findings: persisted.findings,
        recorded: true,
      };
    });
    const { recorded, ...outcome } = stored;
    if (recorded) {
      if (outcome.status === 'unavailable' && outcome.reason !== 'unknown')
        emitUnavailable(deps, input, outcome.runId, outcome.reason);
      else if (outcome.status === 'completed')
        deps.emitter?.log('qc.run.completed', {
          qcRunId: outcome.runId,
          findingCount: outcome.findings.length,
          durationMs: Math.max(0, performance.now() - startedAt),
        });
    }
    return outcome;
  } catch (error) {
    if (error instanceof StaleVersionError) {
      // The refused persistence transaction rolled back. A separate diagnostic transaction cannot append
      // QC evidence to Ready, and locks the same case before proving this was a late result for that version.
      const late = await withTransaction(deps.db, async (tx) => {
        if (!(await lockCase(tx, input.caseId))) return undefined;
        const version = await readVersionRow(tx, input.versionId);
        if (version?.caseId !== input.caseId || version.readyAt === null) return undefined;
        const fields = {
          qcRunId: prepared.attemptId,
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
