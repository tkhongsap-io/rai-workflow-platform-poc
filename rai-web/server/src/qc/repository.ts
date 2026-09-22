// W2-05 store helpers for qc_run / qc_finding (append-only inserts).
import type { Lane } from '@rai/shared/constants';
import type { QcTrigger } from '@rai/shared/qc/types';
import type { Tx } from '../db/client.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { qcRun } from '../db/schema/qc-run.js';

export interface InsertRunInput {
  id: string;
  versionId: string;
  trigger: QcTrigger;
  slot: number | null;
  lane: Lane | null;
  engineId: string;
  ruleRevision: string;
  status: 'completed' | 'unavailable';
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
    ruleRevision: input.ruleRevision,
    status: input.status,
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
