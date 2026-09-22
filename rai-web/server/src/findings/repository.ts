// W2-05: qc_finding / disposition_event reads and appends.
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import type { Lane } from '@rai/shared/constants';
import type { DispositionKind } from '@rai/shared/schemas/review';
import type { Executor, Tx } from '../db/client.js';
import { dispositionEvent } from '../db/schema/disposition-event.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { packVersion } from '../db/schema/pack-version.js';

export type QcFindingRow = typeof qcFinding.$inferSelect;

export async function readFinding(exec: Executor, findingId: string): Promise<QcFindingRow | undefined> {
  const [row] = await exec.select().from(qcFinding).where(eq(qcFinding.id, findingId)).limit(1);
  return row;
}

export async function readFindingForCase(
  exec: Executor,
  caseId: string,
  findingId: string,
): Promise<QcFindingRow | undefined> {
  const [row] = await exec
    .select({ finding: qcFinding })
    .from(qcFinding)
    .innerJoin(packVersion, eq(qcFinding.versionId, packVersion.id))
    .where(and(eq(qcFinding.id, findingId), eq(packVersion.caseId, caseId)))
    .limit(1);
  return row?.finding;
}

export async function latestDispositionKind(
  exec: Executor,
  findingId: string,
): Promise<DispositionKind | undefined> {
  const [row] = await exec
    .select({ kind: dispositionEvent.kind })
    .from(dispositionEvent)
    .where(eq(dispositionEvent.findingId, findingId))
    .orderBy(desc(dispositionEvent.createdAt), desc(dispositionEvent.id))
    .limit(1);
  return row?.kind as DispositionKind | undefined;
}

export async function listDispositions(
  exec: Executor,
  findingId: string,
): Promise<Array<{ id: string; kind: string; reason: string | null; createdAt: Date }>> {
  return exec
    .select({
      id: dispositionEvent.id,
      kind: dispositionEvent.kind,
      reason: dispositionEvent.reason,
      createdAt: dispositionEvent.createdAt,
    })
    .from(dispositionEvent)
    .where(eq(dispositionEvent.findingId, findingId))
    .orderBy(asc(dispositionEvent.createdAt), asc(dispositionEvent.id));
}

/** Latest submitted version id for a case (max version_number among submitted rows). */
export async function findLatestSubmittedVersionId(
  exec: Executor,
  caseId: string,
): Promise<string | undefined> {
  const [row] = await exec
    .select({ id: packVersion.id })
    .from(packVersion)
    .where(and(eq(packVersion.caseId, caseId), isNotNull(packVersion.submittedAt)))
    .orderBy(desc(packVersion.versionNumber))
    .limit(1);
  return row?.id;
}

export interface InsertDispositionInput {
  id: string;
  findingId: string;
  kind: DispositionKind;
  reason: string | null;
  evidenceRef: Record<string, unknown> | null;
  actorSubjectId: string;
  actorRole: string;
  createdAt: Date;
  correlationId: string;
}

export async function insertDisposition(tx: Tx, input: InsertDispositionInput): Promise<void> {
  await tx.insert(dispositionEvent).values({
    id: input.id,
    findingId: input.findingId,
    kind: input.kind,
    reason: input.reason,
    evidenceRef: input.evidenceRef,
    actorSubjectId: input.actorSubjectId,
    actorRole: input.actorRole,
    createdAt: input.createdAt,
    correlationId: input.correlationId,
    idempotencyKeyId: null,
  });
}

export function owningLaneOf(row: QcFindingRow): Lane {
  return row.owningLane as Lane;
}
