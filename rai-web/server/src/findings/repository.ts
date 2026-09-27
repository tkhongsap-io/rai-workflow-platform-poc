// W2-05: qc_finding / disposition_event reads and appends, and the one definition of a finding's latest disposition.
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import type { Lane } from '@rai/shared/constants';
import type { QcTrigger } from '@rai/shared/qc/types';
import type {
  DispositionKind,
  FindingWithDisposition,
  StoredFindingSummary,
} from '@rai/shared/schemas/review';
import type { Executor, Tx } from '../db/client.js';
import { dispositionEvent } from '../db/schema/disposition-event.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { qcRun } from '../db/schema/qc-run.js';
import { packVersion } from '../db/schema/pack-version.js';
import { storedFindingSummary, type QcFindingRow } from '../qc/repository.js';

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

/**
 * Each qc_finding's latest disposition event, joined LATERAL ... ON true. Stamps are minted after the previous
 * event under the case lock (service.ts), so created_at DESC is commit order; id DESC settles an equal stamp.
 */
export const latestDisposition = new QueryBuilder()
  .select({ kind: dispositionEvent.kind, createdAt: dispositionEvent.createdAt })
  .from(dispositionEvent)
  .where(eq(dispositionEvent.findingId, qcFinding.id))
  .orderBy(desc(dispositionEvent.createdAt), desc(dispositionEvent.id))
  .limit(1)
  .as('latest_disposition');

/** The Ready rule's open finding: never dispositioned, or only proposed fixed and not yet confirmed. */
export const undispositioned = sql<boolean>`(${latestDisposition.kind} IS NULL OR ${latestDisposition.kind} = 'fixed_proposed')`;

export async function readLatestDisposition(
  exec: Executor,
  findingId: string,
): Promise<{ kind: DispositionKind; createdAt: Date } | undefined> {
  const [row] = await exec
    .select({ kind: latestDisposition.kind, createdAt: latestDisposition.createdAt })
    .from(qcFinding)
    .innerJoinLateral(latestDisposition, sql`true`)
    .where(eq(qcFinding.id, findingId));
  return row === undefined ? undefined : { kind: row.kind as DispositionKind, createdAt: row.createdAt };
}

/** Stored findings for a version plus each finding's latest disposition kind (GET …/findings; no qc_run write). */
export async function listFindingsForVersion(
  exec: Executor,
  caseId: string,
  versionId: string,
): Promise<FindingWithDisposition[]> {
  const rows = await exec
    .select({ finding: qcFinding, latestDisposition: latestDisposition.kind })
    .from(qcFinding)
    .innerJoin(packVersion, eq(qcFinding.versionId, packVersion.id))
    .leftJoinLateral(latestDisposition, sql`true`)
    .where(and(eq(qcFinding.versionId, versionId), eq(packVersion.caseId, caseId)))
    .orderBy(asc(qcFinding.createdAt), asc(qcFinding.id));
  return rows.map((row) => ({
    ...storedFindingSummary(row.finding),
    latestDisposition: row.latestDisposition as DispositionKind | null,
  }));
}

export interface LatestUnavailableFinding {
  summary: StoredFindingSummary;
  undispositioned: boolean;
}

/**
 * The latest QC-UNAVAILABLE finding for one version, trigger and lane, with whether it is still open. The scope
 * key of W0-07 3.6 is `run:${trigger}:${lane}`, which the finding's run row carries; dedup (3.4 step 6) appends a
 * new finding only when this one is dispositioned or absent.
 */
export async function findLatestUnavailableFinding(
  exec: Executor,
  versionId: string,
  trigger: QcTrigger,
  lane: Lane | null,
  /** W4-04: an upload outage is reused per version and owning lane (`QC-UNAVAILABLE:run:upload:<owningLane>`). */
  owningLane?: Lane,
): Promise<LatestUnavailableFinding | undefined> {
  const [row] = await exec
    .select({ finding: qcFinding, open: undispositioned })
    .from(qcFinding)
    .innerJoin(qcRun, eq(qcFinding.runId, qcRun.id))
    .leftJoinLateral(latestDisposition, sql`true`)
    .where(
      and(
        eq(qcFinding.versionId, versionId),
        eq(qcFinding.kind, 'unavailable'),
        eq(qcRun.trigger, trigger),
        lane === null ? isNull(qcRun.lane) : eq(qcRun.lane, lane),
        owningLane === undefined ? undefined : eq(qcFinding.owningLane, owningLane),
      ),
    )
    .orderBy(desc(qcFinding.createdAt), desc(qcFinding.id))
    .limit(1);
  return row === undefined
    ? undefined
    : { summary: storedFindingSummary(row.finding), undispositioned: row.open };
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
