// W2-05 store helpers for qc_run / qc_finding (append-only inserts).
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Lane } from '@rai/shared/constants';
import type { QcTrigger, QcUnavailableReason } from '@rai/shared/qc/types';
import type { EvidenceLocatorView, FindingEvidence, StoredFindingSummary } from '@rai/shared/schemas/review';
import type { PackVersionRow } from '../cases/repository.js';
import type { Executor, Tx } from '../db/client.js';
import type { EngineColumns } from './engine-identity.js';
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
  engine: EngineColumns; // W4-11b: extractor and model identity and usage; all NULL without extraction or model use
  unavailableDetail: string | null; // W4-11b: a bounded code or 'unspecified'; NULL when none or completed
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
    ...input.engine,
    unavailableDetail: input.unavailableDetail,
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
    evidence: evidenceView(row.evidence),
  };
}

const SLOTS: ReadonlySet<unknown> = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A stored locator in the read shape, or undefined when it is not one of the W0-07 3.3 kinds. Copies known fields only. */
function locatorView(value: unknown): EvidenceLocatorView | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'page': {
      if (!isNumber(value.page)) return undefined;
      const r = value.region;
      return isRecord(r) && isNumber(r.x) && isNumber(r.y) && isNumber(r.w) && isNumber(r.h)
        ? { kind: 'page', page: value.page, region: { x: r.x, y: r.y, w: r.w, h: r.h } }
        : { kind: 'page', page: value.page };
    }
    case 'text_range':
      return isNumber(value.start) && isNumber(value.end)
        ? { kind: 'text_range', start: value.start, end: value.end }
        : undefined;
    case 'cell':
      return typeof value.sheet === 'string' && typeof value.cell === 'string'
        ? { kind: 'cell', sheet: value.sheet, cell: value.cell }
        : undefined;
    case 'section':
      return typeof value.heading === 'string' ? { kind: 'section', heading: value.heading } : undefined;
    case 'absent':
      return { kind: 'absent' };
    default:
      return undefined;
  }
}

/**
 * W4-12: stored `qc_finding.evidence` ({artifact_id, content_hash, slot, locator, excerpt_hash?}) as the read shape
 * `{ slot, artifactId, locator }`. Locators only: the content and excerpt hashes are never served, and an entry
 * whose locator is not a W0-07 3.3 kind is left out.
 */
export function evidenceView(stored: unknown): FindingEvidence[] {
  if (!Array.isArray(stored)) return [];
  const out: FindingEvidence[] = [];
  for (const entry of stored) {
    if (!isRecord(entry)) continue;
    const locator = locatorView(entry.locator);
    if (locator === undefined) continue;
    out.push({
      slot: SLOTS.has(entry.slot) ? (entry.slot as FindingEvidence['slot']) : null,
      artifactId: typeof entry.artifact_id === 'string' ? entry.artifact_id : null,
      locator,
    });
  }
  return out;
}
