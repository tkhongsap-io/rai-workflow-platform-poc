// W0-04 `CaseWriteRepository` for W1-02 (`create`, `updateDraftFields`) plus the reads behind the 7.3 shapes. The
// editable column set is a Pick (W0-04 fields rule, layer 2): the four projections and `risk_tier` are not in it and
// cannot be written from here; lane projections and readiness are written only by workflow/repository.ts
// writeLaneProjection and workflow/ready.ts. The status in every read is cases/status.ts caseStatusSql. Every write
// takes a transaction handle; the create caller holds the (actor, key) lock and the edit caller holds the case row
// lock (service.ts). The two scope columns are written only by `updateDraftFields` after the W0-05 post-edit
// authorization, which is the one W0-05-permitted action that may change them.

import { and, count, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { uuidv7 } from '@rai/shared/ids';
import type { StageContext } from '@rai/shared/schemas/pack';
import type { CaseSummary, CaseView } from '@rai/shared/schemas/cases';
import type { Actor } from '../authz/policy.js';
import type { Executor, Tx } from '../db/client.js';
import { artifactSlot } from '../db/schema/artifact-slot.js';
import { cases } from '../db/schema/case.js';
import { packVersion } from '../db/schema/pack-version.js';
import { registryCounter } from '../db/schema/registry-counter.js';
import { SLOT_NUMBERS, defaultSlotState, slotStateToColumns } from '../pack/slots.js';
import { caseScopeWhere } from './scope.js';
import { fromStoredSourceRecordId } from './source-record-id.js';
import { caseStatusSql, deskStatusFor } from './status.js';

export type CaseRow = typeof cases.$inferSelect;
export type PackVersionRow = typeof packVersion.$inferSelect;

/** W0-04 `EditableCaseFields`: the inherited descriptive fields and the two desk-local fields; no projections. */
export type EditableCaseFields = Pick<
  CaseRow,
  | 'sourceRecordId'
  | 'useCaseName'
  | 'businessUnit'
  | 'businessOwner'
  | 'technicalOwner'
  | 'useCaseGroup'
  | 'vendorInvolved'
  | 'modelType'
>;
/** The two W0-05 scope columns, writable through `case.edit_draft` only after the post-edit authorization. */
export type ScopeColumns = Pick<CaseRow, 'ownerSubjectId' | 'businessUnitId'>;
export type DraftEditableColumns = EditableCaseFields & ScopeColumns;

export const REGISTRY_ID_MAX_PER_YEAR = 9999;

export class RegistryYearExhausted extends Error {
  constructor(readonly year: number) {
    super(`registry year ${year} has no number left`);
    this.name = 'RegistryYearExhausted';
  }
}

/** `RAI-<yyyy>-<nnnn>` from the per-year counter, under the counter row's lock (W0-04 `case.registry_id`). */
export async function allocateRegistryId(tx: Tx, at: Date): Promise<string> {
  const year = at.getUTCFullYear();
  const [row] = await tx
    .insert(registryCounter)
    .values({ year, last: 1 })
    .onConflictDoUpdate({ target: registryCounter.year, set: { last: sql`${registryCounter.last} + 1` } })
    .returning({ last: registryCounter.last });
  const n = row?.last;
  if (n === undefined || n > REGISTRY_ID_MAX_PER_YEAR) throw new RegistryYearExhausted(year);
  return `RAI-${year}-${String(n).padStart(4, '0')}`;
}

export interface CreateCaseInput {
  fields: EditableCaseFields;
  ownerSubjectId: string;
  businessUnitId: string;
  createdBy: string;
  stageContext: StageContext;
  checklistTemplateVersion: string;
  now: Date;
}

export interface CreatedCase {
  caseRow: CaseRow;
  draft: PackVersionRow;
}

/** Inserts the case (registry id allocated here), draft v1 and its nine slots (W0-04 "Create case" row). */
export async function insertCase(tx: Tx, input: CreateCaseInput): Promise<CreatedCase> {
  const caseId = uuidv7(input.now.getTime());
  const draftId = uuidv7(input.now.getTime());
  const registryId = await allocateRegistryId(tx, input.now);
  const [caseRow] = await tx
    .insert(cases)
    .values({
      id: caseId,
      registryId,
      ...input.fields,
      ownerSubjectId: input.ownerSubjectId,
      businessUnitId: input.businessUnitId,
      deskStatus: deskStatusFor('draft'),
      currentVersionId: null,
      draftVersionId: draftId, // deferrable FK: the draft row follows in this transaction
      rowVersion: 1,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  const [draft] = await tx
    .insert(packVersion)
    .values({
      id: draftId,
      caseId,
      versionNumber: 1,
      parentVersionId: null,
      createdBy: input.createdBy,
      createdAt: input.now,
      stageContext: input.stageContext,
      checklistTemplateVersion: input.checklistTemplateVersion,
    })
    .returning();
  await tx.insert(artifactSlot).values(
    SLOT_NUMBERS.map((slot) => ({
      id: uuidv7(input.now.getTime()),
      versionId: draftId,
      slot,
      ...slotStateToColumns(defaultSlotState(slot, input.fields.vendorInvolved)), // slots 3/4 N/A only when no vendor (W1-04)
      updatedBy: input.createdBy,
      updatedAt: input.now,
    })),
  );
  return { caseRow: caseRow!, draft: draft! };
}

export class RowVersionMismatch extends Error {
  constructor(readonly caseId: string) {
    super(`case ${caseId} row_version does not match the expected revision`);
    this.name = 'RowVersionMismatch';
  }
}

/**
 * Writes a Pick of the editable columns with the W0-04 `row_version` check; the counter increments by exactly one.
 * Throws RowVersionMismatch when nothing matched (the caller, holding the case lock, maps it to 409 stale_version).
 */
export async function updateDraftFields(
  tx: Tx,
  caseId: string,
  fields: Partial<DraftEditableColumns>,
  expectedRowVersion: number,
  now: Date,
): Promise<CaseRow> {
  const [row] = await tx
    .update(cases)
    .set({ ...fields, rowVersion: sql`${cases.rowVersion} + 1`, updatedAt: now })
    .where(and(eq(cases.id, caseId), eq(cases.rowVersion, expectedRowVersion)))
    .returning();
  if (row === undefined) throw new RowVersionMismatch(caseId);
  return row;
}

export async function readCaseRow(exec: Executor, caseId: string): Promise<CaseRow | undefined> {
  const [row] = await exec.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  return row;
}

export async function readVersionRow(exec: Executor, versionId: string): Promise<PackVersionRow | undefined> {
  const [row] = await exec.select().from(packVersion).where(eq(packVersion.id, versionId)).limit(1);
  return row;
}

/** W3-F1: the submitter's display name as an optional spread; nothing when unknown or when no lookup is given. */
async function submitterName(
  subjectId: string | null,
  names: ((subjectId: string) => Promise<string | undefined>) | undefined,
): Promise<{ submittedByDisplayName?: string }> {
  if (subjectId === null || names === undefined) return {};
  const name = await names(subjectId);
  return name === undefined ? {} : { submittedByDisplayName: name };
}

/** W3-F1: names the current version's submitter on a view built without a lookup; unchanged when unknown. */
export async function withCurrentSubmitterName(
  view: CaseView,
  names: (subjectId: string) => Promise<string | undefined>,
): Promise<CaseView> {
  const current = view.currentVersion;
  if (current === null) return view;
  const name = await names(current.submittedBy);
  if (name === undefined) return view;
  const { versionId, versionNumber, submittedBy, ...rest } = current;
  return {
    ...view,
    currentVersion: { versionId, versionNumber, submittedBy, submittedByDisplayName: name, ...rest },
  };
}

/** The 7.3 `CaseView` for one stored case: the row plus its open draft and latest submitted version. */
export async function readCaseView(
  exec: Executor,
  caseId: string,
  names?: (subjectId: string) => Promise<string | undefined>,
): Promise<CaseView | undefined> {
  const row = await readCaseRow(exec, caseId);
  if (row === undefined) return undefined;
  return caseViewFrom(exec, row, names);
}

/** Reads through `exec`, so inside the caller's write transaction it derives from the row just written. */
export async function caseViewFrom(
  exec: Executor,
  row: CaseRow,
  names?: (subjectId: string) => Promise<string | undefined>,
): Promise<CaseView> {
  const currentAlias = alias(packVersion, 'current');
  const draftAlias = alias(packVersion, 'draft');
  const [joined] = await exec
    .select({ status: caseStatusSql(currentAlias, draftAlias), current: currentAlias, draft: draftAlias })
    .from(cases)
    .leftJoin(currentAlias, eq(currentAlias.id, cases.currentVersionId))
    .leftJoin(draftAlias, eq(draftAlias.id, cases.draftVersionId))
    .where(eq(cases.id, row.id));
  const { status, current, draft } = joined!;
  return {
    caseId: row.id,
    registryId: row.registryId,
    useCaseName: row.useCaseName,
    businessUnitId: row.businessUnitId,
    businessUnit: row.businessUnit,
    businessOwner: row.ownerSubjectId, // the SubjectId in owner_subject_id, not the descriptive text (W0-05 section 8)
    ownerDisplayName: row.businessOwner, // W3-F1: the descriptive column, written at create and every owner change
    technicalOwner: row.technicalOwner,
    sourceRecordId: fromStoredSourceRecordId(row.sourceRecordId),
    useCaseGroup: row.useCaseGroup,
    vendorInvolved: row.vendorInvolved,
    modelType: row.modelType as CaseView['modelType'],
    status,
    riskTier: row.riskTier, // null throughout slice 1 (D07 before W5)
    privacyStatus: row.privacyStatus as CaseView['privacyStatus'],
    securityStatus: row.securityStatus as CaseView['securityStatus'],
    raiStatus: row.raiStatus as CaseView['raiStatus'],
    aiReadinessStatus: row.aiReadinessStatus as CaseView['aiReadinessStatus'],
    currentVersion:
      current === null || current.submittedAt === null
        ? null
        : {
            versionId: current.id,
            versionNumber: current.versionNumber,
            submittedBy: current.submittedBy ?? '',
            ...(await submitterName(current.submittedBy, names)),
            submittedAt: current.submittedAt.toISOString(),
            isLatest: true,
          },
    draft:
      draft === null
        ? null
        : { draftId: draft.id, versionNumber: draft.versionNumber, updatedAt: row.updatedAt.toISOString() },
    caseRevision: row.rowVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ListPage {
  page: number;
  pageSize: number;
}

/** The scoped list (W0-05 "Query scope"): `caseScopeWhere(actor)` first, then order, LIMIT and COUNT over it. */
export async function listCases(
  exec: Executor,
  actor: Actor,
  page: ListPage,
): Promise<{ items: CaseSummary[]; total: number }> {
  const where = caseScopeWhere(actor);
  const current = alias(packVersion, 'current');
  const draft = alias(packVersion, 'draft');
  const [rows, [totalRow]] = await Promise.all([
    exec
      .select({
        c: cases,
        currentVersionNumber: current.versionNumber,
        status: caseStatusSql(current, draft),
      })
      .from(cases)
      .leftJoin(current, eq(current.id, cases.currentVersionId))
      .leftJoin(draft, eq(draft.id, cases.draftVersionId))
      .where(where)
      .orderBy(desc(cases.updatedAt), desc(cases.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize),
    exec.select({ total: count() }).from(cases).where(where),
  ]);
  const items: CaseSummary[] = rows.map((r) => ({
    caseId: r.c.id,
    registryId: r.c.registryId,
    useCaseName: r.c.useCaseName,
    businessUnitId: r.c.businessUnitId,
    businessUnit: r.c.businessUnit,
    businessOwner: r.c.ownerSubjectId,
    ownerDisplayName: r.c.businessOwner, // W3-F1, as CaseView
    useCaseGroup: r.c.useCaseGroup,
    status: r.status,
    currentVersionNumber: r.c.currentVersionId === null ? null : r.currentVersionNumber,
    updatedAt: r.c.updatedAt.toISOString(),
  }));
  return { items, total: totalRow?.total ?? 0 };
}
