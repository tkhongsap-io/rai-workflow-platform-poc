// W2-05 store helpers for qc_run / qc_finding (append-only inserts).
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Lane } from '@rai/shared/constants';
import type { QcTrigger, QcUnavailableReason } from '@rai/shared/qc/types';
import type { StoredFindingSummary } from '@rai/shared/schemas/review';
import type { PackVersionRow } from '../cases/repository.js';
import type { Executor, Tx } from '../db/client.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { qcRun } from '../db/schema/qc-run.js';

export type QcFindingRow = typeof qcFinding.$inferSelect;

export interface InsertRunInput {
  id: string;
  versionId: string;
  trigger: QcTrigger;
  slot: number | null;
  lane: Lane | null;
  engineId: string;
  runnerVersion: string; // W4-11a: the bound runner's identity.runnerVersion ('unbound' when none is bound)
  ruleRevision: string;
  status: 'completed' | 'unavailable';
  unavailableReason: QcUnavailableReason | null;
  rulesEvaluated: number; // W4-11a: executed rules; 0 on an unavailable run
  requestedAt: Date;
  completedAt: Date;
  correlationId: string;
}

export interface InsertFindingInput {
  id: string;
  runId: string;
  versionId: string;
  slot: number | null;
  kind: 'defect' | 'unavailable';
  ruleId: string;
  ruleRevision: string;
  severity: string;
  owningLane: Lane;
  evidence: unknown;
  metric: string | null;
  denominator: number | null;
  threshold: number | null;
  messageKey: string;
  messageParams: unknown;
  createdAt: Date;
}

export async function insertQcRun(tx: Tx, input: InsertRunInput): Promise<void> {
  await tx.insert(qcRun).values({
    id: input.id,
    versionId: input.versionId,
    trigger: input.trigger,
    slot: input.slot,
    lane: input.lane,
    engineId: input.engineId,
    runnerVersion: input.runnerVersion,
    ruleRevision: input.ruleRevision,
    status: input.status,
    unavailableReason: input.unavailableReason,
    rulesEvaluated: input.rulesEvaluated,
    requestedAt: input.requestedAt,
    completedAt: input.completedAt,
    correlationId: input.correlationId,
  });
}

export async function insertQcFinding(tx: Tx, input: InsertFindingInput): Promise<void> {
  await tx.insert(qcFinding).values({
    id: input.id,
    runId: input.runId,
    versionId: input.versionId,
    slot: input.slot,
    kind: input.kind,
    ruleId: input.ruleId,
    ruleRevision: input.ruleRevision,
    severity: input.severity,
    owningLane: input.owningLane,
    evidence: input.evidence,
    metric: input.metric,
    denominator: input.denominator === null ? null : String(input.denominator),
    threshold: input.threshold === null ? null : String(input.threshold),
    messageKey: input.messageKey,
    messageParams: input.messageParams,
    createdAt: input.createdAt,
  });
}

export function ruleRevisionOf(version: PackVersionRow): string {
  const frozen = (version.frozenConfiguration ?? {}) as Record<string, string>;
  return frozen.qc_rules ?? version.configurationRevisionId ?? '';
}

/** Latest approve_attempt run for the frozen input identity (W0-07 §3.7); order by monotonic requested_at. */
export function findLatestApproveAttemptRun(
  exec: Executor,
  versionId: string,
  lane: Lane,
  ruleRevision: string,
) {
  return findLatestQcRun(exec, versionId, 'approve_attempt', lane, ruleRevision);
}

export function findLatestSubmitRun(exec: Executor, versionId: string, ruleRevision: string) {
  return findLatestQcRun(exec, versionId, 'submit', null, ruleRevision);
}

async function findLatestQcRun(
  exec: Executor,
  versionId: string,
  trigger: QcTrigger,
  lane: Lane | null,
  ruleRevision: string,
) {
  const [row] = await exec
    .select({
      id: qcRun.id,
      status: qcRun.status,
      engineId: qcRun.engineId,
      unavailableReason: qcRun.unavailableReason,
    })
    .from(qcRun)
    .where(
      and(
        eq(qcRun.versionId, versionId),
        eq(qcRun.trigger, trigger),
        lane === null ? isNull(qcRun.lane) : eq(qcRun.lane, lane),
        eq(qcRun.ruleRevision, ruleRevision),
      ),
    )
    .orderBy(desc(qcRun.requestedAt), desc(qcRun.id))
    .limit(1);
  return row;
}

export async function listFindingsForRun(exec: Executor, runId: string): Promise<StoredFindingSummary[]> {
  const rows = await exec
    .select()
    .from(qcFinding)
    .where(eq(qcFinding.runId, runId))
    .orderBy(asc(qcFinding.createdAt), asc(qcFinding.id));
  return rows.map(storedFindingSummary);
}

/** A stored finding as every findings response shows it; params keep the string / number entries t() interpolates. */
export function storedFindingSummary(row: QcFindingRow): StoredFindingSummary {
  const messageParams: Record<string, string | number> = {};
  if (
    typeof row.messageParams === 'object' &&
    row.messageParams !== null &&
    !Array.isArray(row.messageParams)
  ) {
    for (const [key, entry] of Object.entries(row.messageParams)) {
      if (typeof entry === 'string' || typeof entry === 'number') messageParams[key] = entry;
    }
  }
  return {
    findingId: row.id,
    ruleId: row.ruleId,
    slot: row.slot as StoredFindingSummary['slot'],
    severity: row.severity as StoredFindingSummary['severity'],
    owningLane: row.owningLane as Lane,
    messageKey: row.messageKey,
    messageParams,
  };
}
