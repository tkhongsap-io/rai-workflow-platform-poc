// The two W1-02 business actions as W0-04 transactions: create (W0-04 "Create case" row, W0-06 4.1) and edit case
// fields (W0-04 "Edit case / save draft" row, W0-06 4.2), plus the step-4 validation both share (D11 use_case_group
// against the current configuration revision; configured BU key; resolvable owner subject; TPM-/VRO- prefix).
// Authentication and authorization ran before anything here (W0-06 section 4 order; the middleware and the route's
// scope step). Neither action sets `rai.workflow_write`: nothing here may touch a projection, so W1-00's
// `case_projection_gate` trigger stays armed as the third layer of the W0-04 fields rule.

import {
  InvalidInputError,
  NotFoundError,
  StaleVersionError,
  type ErrorDetails,
  type FieldError,
} from '@rai/shared/errors';
import type { Principal, Role } from '@rai/shared/schemas/auth';
import type {
  CaseCreateRequest,
  CaseUpdateRequest,
  CaseView,
  CaseWritableFields,
} from '@rai/shared/schemas/cases';
import type { StageContext } from '@rai/shared/schemas/pack';
import { auditStore } from '../audit/store.js';
import { currentBody } from '../configuration/store.js';
import type { Db, Executor, Tx } from '../db/client.js';
import { lockCase, withTransaction } from '../db/transaction.js';
import type { BusinessUnitDirectory } from './business-units.js';
import { findReplay, lockIdempotencyKey, requestDigest, storeIdempotencyKey } from './idempotency.js';
import {
  caseViewFrom,
  insertCase,
  readCaseRow,
  readVersionRow,
  updateDraftFields,
  type DraftEditableColumns,
} from './repository.js';
import { toStoredSourceRecordId, validateSourceRecordId } from './source-record-id.js';
import type { SubjectDirectory } from './subject-directory.js';

export interface CaseServiceDeps {
  db: Db;
  businessUnits: BusinessUnitDirectory;
  subjects: SubjectDirectory;
  now?: () => Date;
}

/** Who acts, as which role (the policy row that allowed), under which correlation id (W0-10). */
export interface ActionContext {
  actor: Principal;
  role: Role;
  correlationId: string;
}

/** Draft v1 values the create transaction records; W1-04's PUT /draft changes them (W0-02 7.5). */
export const DRAFT_DEFAULTS: Readonly<{ stageContext: StageContext; checklistTemplateVersionIndex: number }> =
  Object.freeze({
    stageContext: 'idea', // D11: the earliest stage; stored, never a lifecycle state
    checklistTemplateVersionIndex: 0, // the first configured checklist_templates entry
  });

export const NOT_IN_LIST = 'validation.not_in_configured_list' as const;
export const SUBJECT_UNRESOLVABLE = 'validation.subject_unresolvable' as const;
export const CREATE_ACTION = 'case.create' as const;

interface ValidatedFields {
  columns: Partial<DraftEditableColumns>;
}

/**
 * W0-06 step 4 for the fields present in `fields`: use_case_group in the current D11 list, business unit a configured
 * key, owner subject resolvable (its display name becomes the `business_owner` text), source record prefix. Collects
 * every field error into one 422. Returns the column patch for the repository.
 */
export async function validateWritableFields(
  deps: CaseServiceDeps,
  exec: Executor,
  fields: Partial<CaseWritableFields>,
  actor: Principal,
  at: Date,
  prefix = 'body',
): Promise<ValidatedFields> {
  const errors: FieldError[] = [];
  const columns: Partial<DraftEditableColumns> = {};

  if (fields.useCaseGroup !== undefined) {
    const groups = (await currentBody(exec, 'use_case_groups', at))?.groups ?? [];
    if (!groups.includes(fields.useCaseGroup))
      errors.push({ path: `${prefix}.useCaseGroup`, messageKey: NOT_IN_LIST });
    else columns.useCaseGroup = fields.useCaseGroup;
  }
  if (fields.businessUnitId !== undefined) {
    if (!deps.businessUnits.has(fields.businessUnitId))
      errors.push({ path: `${prefix}.businessUnitId`, messageKey: NOT_IN_LIST });
    else columns.businessUnitId = fields.businessUnitId;
  }
  if (fields.businessOwner !== undefined) {
    const resolved = await deps.subjects.resolve(fields.businessOwner, actor);
    if (resolved === undefined)
      errors.push({ path: `${prefix}.businessOwner`, messageKey: SUBJECT_UNRESOLVABLE });
    else {
      columns.ownerSubjectId = resolved.subjectId;
      columns.businessOwner = resolved.displayName; // the server-written descriptive text (W0-04 case row)
    }
  }
  if (fields.sourceRecordId !== undefined) {
    const problem = validateSourceRecordId(fields.sourceRecordId, `${prefix}.sourceRecordId`);
    if (problem !== undefined) errors.push(problem);
    else columns.sourceRecordId = toStoredSourceRecordId(fields.sourceRecordId);
  }
  if (fields.useCaseName !== undefined) columns.useCaseName = fields.useCaseName;
  if (fields.businessUnit !== undefined) columns.businessUnit = fields.businessUnit;
  if (fields.technicalOwner !== undefined) columns.technicalOwner = fields.technicalOwner;
  if (fields.vendorInvolved !== undefined) columns.vendorInvolved = fields.vendorInvolved;
  if (fields.modelType !== undefined) columns.modelType = fields.modelType;

  if (errors.length > 0) throw new InvalidInputError(errors);
  return { columns };
}

export interface CreateResult {
  status: 201;
  body: CaseView;
  replayed: boolean;
}

/**
 * The create transaction: (actor, key) lock → replay or reuse check → insert case, draft v1, nine slots →
 * audit `case.created` → key stored. `columns` is the already validated and authorized patch (the route ran the
 * scope step on `ownerSubjectId` / `businessUnitId` before calling).
 */
export async function createCase(
  deps: CaseServiceDeps,
  ctx: ActionContext,
  request: CaseCreateRequest,
  columns: Partial<DraftEditableColumns>,
  idempotencyKey: string,
): Promise<CreateResult> {
  const now = (deps.now ?? (() => new Date()))();
  const digest = requestDigest(CREATE_ACTION, request);
  return withTransaction(deps.db, async (tx) => {
    await lockIdempotencyKey(tx, ctx.actor.subjectId, idempotencyKey);
    const replay = await findReplay(tx, ctx.actor.subjectId, idempotencyKey, digest);
    if (replay !== undefined) return { status: 201, body: replay.body as CaseView, replayed: true };

    const templates = (await currentBody(tx, 'checklist_templates', now))?.versions ?? [];
    const checklistTemplateVersion = templates[DRAFT_DEFAULTS.checklistTemplateVersionIndex];
    if (checklistTemplateVersion === undefined)
      throw new Error('no checklist_templates configuration in force');
    const required = requireAll(columns);
    const created = await insertCase(tx, {
      fields: required.fields,
      ownerSubjectId: required.ownerSubjectId,
      businessUnitId: required.businessUnitId,
      createdBy: ctx.actor.subjectId,
      stageContext: DRAFT_DEFAULTS.stageContext,
      checklistTemplateVersion,
      now,
    });
    const view = await caseViewFrom(tx, created.caseRow);
    await auditStore.append(tx, {
      actorSubjectId: ctx.actor.subjectId,
      actorRole: ctx.role,
      action: 'case.created',
      targetCaseId: created.caseRow.id,
      targetVersionId: created.draft.id,
      targetRef: { registry_id: created.caseRow.registryId, idempotency_key: idempotencyKey },
      beforeRef: null,
      afterRef: {
        draft_version_id: created.draft.id,
        current_version_id: null,
        desk_status: created.caseRow.deskStatus,
        owner_subject_id: created.caseRow.ownerSubjectId,
        business_unit_id: created.caseRow.businessUnitId,
        row_version: created.caseRow.rowVersion,
        privacy_status: created.caseRow.privacyStatus,
        security_status: created.caseRow.securityStatus,
        rai_status: created.caseRow.raiStatus,
        ai_readiness_status: created.caseRow.aiReadinessStatus,
      },
      correlationId: ctx.correlationId,
      occurredAt: now,
    });
    await storeIdempotencyKey(tx, {
      actorSubjectId: ctx.actor.subjectId,
      key: idempotencyKey,
      action: CREATE_ACTION,
      targetCaseId: created.caseRow.id,
      digest,
      status: 201,
      body: view,
      now,
    });
    return { status: 201, body: view, replayed: false };
  });
}

/** Create needs every column; the schema guarantees the request fields and validation filled the rest. */
function requireAll(columns: Partial<DraftEditableColumns>): {
  fields: DraftEditableColumns extends infer T ? Omit<T, 'ownerSubjectId' | 'businessUnitId'> : never;
  ownerSubjectId: string;
  businessUnitId: string;
} {
  const { ownerSubjectId, businessUnitId, ...rest } = columns;
  const missing = (
    [
      'sourceRecordId',
      'useCaseName',
      'businessUnit',
      'businessOwner',
      'technicalOwner',
      'useCaseGroup',
      'vendorInvolved',
      'modelType',
    ] as const
  ).filter((k) => rest[k] === undefined);
  if (ownerSubjectId === undefined || businessUnitId === undefined || missing.length > 0)
    throw new Error(`create: validated columns incomplete (${[...missing].join(', ')})`);
  return { fields: rest as Required<typeof rest>, ownerSubjectId, businessUnitId };
}

const SCOPE_KEYS = ['ownerSubjectId', 'businessUnitId'] as const;

/**
 * The edit transaction (W0-06 4.2, W0-04 "Edit case" row): case lock → open-draft and Ready checks
 * (`version_superseded` / `version_closed`) → `row_version` check (`revision_changed`) → write the Pick →
 * audit `draft.saved` with the changed-field list and, for a scope change, the old and new scope values.
 * `columns` is the validated and (post-edit) authorized patch.
 */
export async function updateCase(
  deps: CaseServiceDeps,
  ctx: ActionContext,
  caseId: string,
  request: CaseUpdateRequest,
  columns: Partial<DraftEditableColumns>,
): Promise<CaseView> {
  const now = (deps.now ?? (() => new Date()))();
  return withTransaction(deps.db, async (tx) => {
    if (!(await lockCase(tx, caseId))) throw new NotFoundError('case');
    const before = (await readCaseRow(tx, caseId))!;
    await assertDraftOpen(tx, before, request.expectedCaseRevision);

    const changed = (Object.keys(columns) as Array<keyof DraftEditableColumns>).filter(
      (k) => columns[k] !== undefined && columns[k] !== before[k],
    );
    const after = await updateDraftFields(tx, caseId, columns, request.expectedCaseRevision, now);
    const scopeChanged = SCOPE_KEYS.some((k) => changed.includes(k));
    await auditStore.append(tx, {
      actorSubjectId: ctx.actor.subjectId,
      actorRole: ctx.role,
      action: 'draft.saved',
      targetCaseId: caseId,
      targetVersionId: before.draftVersionId,
      targetRef: { changed_fields: changed },
      beforeRef: {
        row_version: before.rowVersion,
        ...(scopeChanged
          ? { owner_subject_id: before.ownerSubjectId, business_unit_id: before.businessUnitId }
          : {}),
      },
      afterRef: {
        row_version: after.rowVersion,
        ...(scopeChanged
          ? { owner_subject_id: after.ownerSubjectId, business_unit_id: after.businessUnitId }
          : {}),
      },
      correlationId: ctx.correlationId,
      occurredAt: now,
    });
    return caseViewFrom(tx, after);
  });
}

/** W0-06 5.2 for save draft (case fields): the open draft must exist and be the current version; the revision must match. */
async function assertDraftOpen(
  tx: Tx,
  row: NonNullable<Awaited<ReturnType<typeof readCaseRow>>>,
  expected: number,
) {
  const refreshPath = `/cases/${row.id}`;
  const current = row.currentVersionId === null ? undefined : await readVersionRow(tx, row.currentVersionId);
  if (current?.readyAt != null) {
    throw new StaleVersionError(
      staleDetails(
        'version_closed',
        'error.stale_version.guidance.ready',
        current,
        row.rowVersion,
        refreshPath,
      ),
    );
  }
  if (row.draftVersionId === null) {
    if (current === undefined) throw new NotFoundError('version'); // no draft and no version: cannot happen after create
    throw new StaleVersionError(
      staleDetails(
        'version_superseded',
        'error.stale_version.guidance.version_superseded',
        current,
        row.rowVersion,
        refreshPath,
      ),
    );
  }
  if (row.rowVersion !== expected) {
    const draft = (await readVersionRow(tx, row.draftVersionId))!;
    throw new StaleVersionError(
      staleDetails(
        'revision_changed',
        'error.stale_version.guidance.revision_changed',
        draft,
        row.rowVersion,
        refreshPath,
      ),
    );
  }
}

function staleDetails(
  reason: ErrorDetails['stale_version']['reason'],
  guidanceKey: ErrorDetails['stale_version']['guidanceKey'],
  version: { id: string; versionNumber: number; submittedAt: Date | null; readyAt: Date | null },
  revision: number,
  refreshPath: string,
): ErrorDetails['stale_version'] {
  return {
    reason,
    guidanceKey,
    current: {
      versionId: version.id,
      versionNumber: version.versionNumber,
      revision,
      state: version.submittedAt === null ? 'draft' : 'submitted',
      ready: version.readyAt != null,
    },
    refreshPath,
  };
}
