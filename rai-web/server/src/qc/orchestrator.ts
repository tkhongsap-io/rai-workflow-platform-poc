// W2-05 QC orchestrator: builds a request, calls the injected QcRunner, validates, and persists single-lane
// defect findings only (W0-06 7.1 / 7.4). Unavailable results store a qc_run with status unavailable and zero
// findings (W0-07 3.4 / 3.6). Production start leaves the runner unbound (no-op); tests inject the W1-10 substitute.

import { createHash } from 'node:crypto';
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
  SlotState,
} from '@rai/shared/qc/types';
import { checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { readCaseRow, readVersionRow } from '../cases/repository.js';
import { staleDetails } from '../cases/service.js';
import type { Db, Tx } from '../db/client.js';
import { setWorkflowWrite, lockCase, withTransaction } from '../db/transaction.js';
import { auditStore } from '../audit/store.js';
import { readSlotsWithArtifacts } from '../versions/repository.js';
import {
  findLatestApproveAttemptRun,
  insertQcFinding,
  insertQcRun,
  listFindingsForRun,
  type InsertFindingInput,
} from './repository.js';

export const QC_TIMEOUT_MS = 10_000;

export interface QcOrchestratorDeps {
  db: Db;
  runner: QcRunner;
  now?: () => Date;
  timeoutMs?: number;
}

export interface RunLaneQcInput {
  caseId: string;
  versionId: string;
  lane: Lane;
  correlationId: string;
}

export interface StoredFindingView {
  findingId: string;
  ruleId: string;
  slot: number | null;
  severity: string;
  owningLane: Lane;
  messageKey: string;
}

export type PersistQcOutcome =
  | { status: 'completed'; runId: string; findings: StoredFindingView[] }
  | { status: 'unavailable'; reason: string; runId: string; findings: [] };

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

function ruleRevisionOf(version: PackVersionRow): string {
  const frozen = (version.frozenConfiguration ?? {}) as Record<string, string>;
  return frozen.qc_rules ?? version.configurationRevisionId ?? '';
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
  now: Date,
  correlationId: string,
): Promise<{ runId: string; findings: StoredFindingView[] }> {
  const storeable = storeableFindings(result.findings, request.laneMappingVersion, {
    trigger: request.trigger,
    qcRulesRevision: request.qcRulesRevision,
    checklistTemplateVersion: request.checklistTemplateVersion,
  });
  const runId = uuidv7();
  await insertQcRun(tx, {
    id: runId,
    versionId: version.id,
    trigger: request.trigger,
    slot: request.trigger === 'upload' ? (request.slots[0]?.slot ?? null) : null,
    lane: request.lane,
    engineId: runner.identity.runner,
    ruleRevision: request.qcRulesRevision,
    status: 'completed',
    requestedAt: new Date(result.startedAt),
    completedAt: new Date(result.finishedAt),
    correlationId,
  });

  const findings: StoredFindingView[] = [];
  for (const finding of storeable) {
    const findingId = uuidv7();
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
    };
    await insertQcFinding(tx, row);
    findings.push({
      findingId,
      ruleId: finding.ruleId,
      slot,
      severity: finding.severity,
      owningLane: finding.owningLane,
      messageKey: finding.message.key,
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
    occurredAt: now,
  });

  return { runId, findings };
}

async function persistUnavailable(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  runner: QcRunner,
  startedAt: Date,
  finishedAt: Date,
  correlationId: string,
): Promise<string> {
  const runId = uuidv7();
  await insertQcRun(tx, {
    id: runId,
    versionId: version.id,
    trigger: request.trigger,
    slot: null,
    lane: request.lane,
    engineId: runner.identity.runner,
    ruleRevision: request.qcRulesRevision,
    status: 'unavailable',
    requestedAt: startedAt,
    completedAt: finishedAt,
    correlationId,
  });
  return runId;
}

/**
 * Runs lane QC (approve_attempt) and persists storeable defect findings or an unavailable run row.
 * Replay of a completed run for the same input returns the existing rows (W0-07 3.4 step 2 / 3.7).
 */
export async function runAndPersistLaneQc(
  deps: QcOrchestratorDeps,
  input: RunLaneQcInput,
): Promise<PersistQcOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const timeoutMs = deps.timeoutMs ?? QC_TIMEOUT_MS;

  return withTransaction(deps.db, async (tx) => {
    await setWorkflowWrite(tx);
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

    // W0-06 4.4 preconditions for the lane-QC read: submitted, current, not Ready.
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

    const ruleRevision = ruleRevisionOf(version);
    const prior = await findLatestApproveAttemptRun(tx, version.id, input.lane, ruleRevision);
    if (prior !== undefined && prior.status === 'completed') {
      const findings = await listFindingsForRun(tx, prior.id);
      return { status: 'completed', runId: prior.id, findings };
    }

    const request = await buildRequest(
      tx,
      caseRow,
      version,
      'approve_attempt',
      input.lane,
      input.correlationId,
      now.getTime() + timeoutMs,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let result: QcRunResult;
    const startedAt = now;
    try {
      result = await deps.runner.run(request, controller.signal);
    } catch {
      clearTimeout(timer);
      const finishedAt = (deps.now ?? (() => new Date()))();
      const runId = await persistUnavailable(
        tx,
        version,
        request,
        deps.runner,
        startedAt,
        finishedAt,
        input.correlationId,
      );
      return { status: 'unavailable', reason: 'timeout', runId, findings: [] };
    } finally {
      clearTimeout(timer);
    }

    if (result.status === 'unavailable') {
      const runId = await persistUnavailable(
        tx,
        version,
        request,
        deps.runner,
        new Date(result.startedAt),
        new Date(result.finishedAt),
        input.correlationId,
      );
      return { status: 'unavailable', reason: result.reason, runId, findings: [] };
    }

    const persisted = await persistCompleted(
      tx,
      version,
      request,
      result,
      deps.runner,
      now,
      input.correlationId,
    );
    return { status: 'completed', runId: persisted.runId, findings: persisted.findings };
  });
}

/** Test/helper: case row type re-export so callers need not dig into cases/. */
export type { CaseRow };
