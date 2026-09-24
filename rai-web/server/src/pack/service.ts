// The W0-06 4.2 save-draft event for the pack (W0-04 "Edit case / save draft" row) and the draft read behind
// W0-02 7.5. Authentication, authorization and the case's existence in the actor's scope ran in the middleware
// (W0-06 section 4 steps 1-3); the shape ran in Fastify's validation and the reason scan in the route's
// preValidation (step 4, first half). What runs here, in one transaction under the case row lock (W0-06 9.1):
//   step 4 (values)  — template version in the configured list; slot values; the W0-04 artifact case binding;
//   step 6           — ExpectedVersion (W0-06 5.1, 5.2 save-draft row): `version_superseded` when the named draft
//                      is not the open draft, `revision_changed` when the revision differs, `version_closed` on a
//                      Ready case; and the W0-08 check 10 pack total over the slots as they would be after the write;
//   step 7           — write the slots and the context, `row_version + 1`, audit `draft.saved`, commit.
// After commit, the W0-07 `upload` trigger fires once per slot whose artifact reference actually changed.
// No idempotency key: the revision check makes a duplicate save fail closed (W0-06 5.3). Nothing here sets
// `rai.workflow_write`, so the W1-00 projection gate stays armed: a draft save can never touch a projection.

import {
  InvalidInputError,
  NotFoundError,
  StaleVersionError,
  UnsafeUploadError,
  type FieldError,
} from '@rai/shared/errors';
import type { PackDraft, PackDraftUpdateRequest, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import type { ExpectedVersion } from '@rai/shared/schemas/versions';
import type { UploadLimits } from '../artifacts/pipeline.js';
import { auditStore, type AuditRefValue } from '../audit/store.js';
import { readCaseRow, readVersionRow, updateDraftFields, type CaseRow } from '../cases/repository.js';
import { currentBody } from '../configuration/store.js';
import type { Db, Executor, Tx } from '../db/client.js';
import { lockCase, withTransaction } from '../db/transaction.js';
import { createErrorCapture, type ErrorCapture } from '../observability/errors.js';
import type { Emitter } from '../observability/log.js';
import type { ActionContext } from '../versions/transaction.js';
import { staleDetails } from '../workflow/refs.js';
import { noopUploadTrigger, type UploadTrigger, type UploadTriggerEvent } from './qc-trigger.js';
import {
  ArtifactCaseMismatch,
  attachedBytesBySlot,
  loadArtifactForSlot,
  packDraftView,
  readDraftSlots,
  updateDraftContext,
  updateDraftSlot,
  type ArtifactRow,
} from './repository.js';
import { SLOT_NUMBERS, slotPath, slotStateFromColumns, validateSlotValues } from './slots.js';

export interface PackServiceDeps {
  db: Db;
  limits: Pick<UploadLimits, 'maxPackBytes'>;
  emitter: Emitter;
  errors?: ErrorCapture;
  uploadTrigger?: UploadTrigger; // the W0-07 hook point; the no-op until an orchestrator is bound
  now?: () => Date;
}

export const NOT_IN_LIST = 'validation.not_in_configured_list' as const;
export const ARTIFACT_CASE_MISMATCH = 'error.artifact_case_mismatch' as const;
const MIB = 1024 * 1024;

/** `GET /api/cases/{caseId}/draft`: 404 `case` when the row is gone, 404 `version` when no draft is open. */
export async function readDraft(exec: Executor, caseId: string): Promise<PackDraft> {
  const row = await readCaseRow(exec, caseId);
  if (row === undefined) throw new NotFoundError('case');
  if (row.draftVersionId === null) throw new NotFoundError('version');
  const draft = await readVersionRow(exec, row.draftVersionId);
  if (draft === undefined) throw new NotFoundError('version');
  return packDraftView(exec, row, draft);
}

interface SlotWrite {
  slot: SlotNumber;
  state: SlotState;
  artifact?: ArtifactRow; // loaded for an attach (case binding)
}

/**
 * Step 4, second half: the configured template list, the slot value rules and the artifact case binding. Every
 * problem is collected into one 422 (W0-06 8.2 `fields`).
 */
async function validateValues(
  tx: Tx,
  caseRow: CaseRow,
  request: PackDraftUpdateRequest,
  at: Date,
): Promise<{ writes: SlotWrite[]; checklistTemplateVersion?: string }> {
  const errors: FieldError[] = [];
  let checklistTemplateVersion: string | undefined;
  if (request.checklistTemplateVersion !== undefined) {
    const versions = (await currentBody(tx, 'checklist_templates', at))?.versions ?? [];
    if (!versions.includes(request.checklistTemplateVersion))
      errors.push({ path: 'body.checklistTemplateVersion', messageKey: NOT_IN_LIST });
    else checklistTemplateVersion = request.checklistTemplateVersion;
  }
  const slots = request.slots ?? {};
  errors.push(...validateSlotValues(slots, caseRow.vendorInvolved));
  const writes: SlotWrite[] = [];
  for (const slot of SLOT_NUMBERS) {
    const state = slots[slot];
    if (state === undefined) continue;
    if (state.state !== 'attached') {
      writes.push({ slot, state });
      continue;
    }
    try {
      writes.push({
        slot,
        state,
        artifact: await loadArtifactForSlot(tx, caseRow.id, slot, state.artifactId),
      });
    } catch (err) {
      if (!(err instanceof ArtifactCaseMismatch)) throw err;
      errors.push({ path: slotPath(slot, 'artifactId'), messageKey: ARTIFACT_CASE_MISMATCH });
    }
  }
  if (errors.length > 0) throw new InvalidInputError(errors);
  return checklistTemplateVersion === undefined ? { writes } : { writes, checklistTemplateVersion };
}

/** Step 6 (W0-06 5.2 save-draft row) for the named draft: the open draft, not Ready, revision matches. */
async function assertExpectedDraft(tx: Tx, row: CaseRow, expected: ExpectedVersion) {
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
  const draft = row.draftVersionId === null ? undefined : await readVersionRow(tx, row.draftVersionId);
  if (draft === undefined || draft.id !== expected.versionId) {
    const shown = draft ?? current;
    if (shown === undefined) throw new NotFoundError('version'); // no draft and no version: cannot happen after create
    throw new StaleVersionError(
      staleDetails(
        'version_superseded',
        'error.stale_version.guidance.version_superseded',
        shown,
        row.rowVersion,
        refreshPath,
      ),
    );
  }
  if (row.rowVersion !== expected.revision) {
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
  return draft;
}

/** W0-08 check 10 at attach: the pack total over the slots as they would be after this write. */
async function assertPackTotal(
  tx: Tx,
  draftId: string,
  writes: SlotWrite[],
  maxPackBytes: number,
): Promise<void> {
  if (!writes.some((w) => w.artifact !== undefined)) return; // nothing attaches: the total can only shrink
  const bySlot = await attachedBytesBySlot(tx, draftId);
  for (const write of writes) bySlot[write.slot] = write.artifact?.sizeBytes ?? 0;
  const total = Object.values(bySlot).reduce((sum, n) => sum + n, 0);
  if (total > maxPackBytes)
    throw new UnsafeUploadError('pack_total_exceeded', { max_pack_mb: maxPackBytes / MIB }); // same param as W1-03 check 10
}

/** The save-draft transaction; fires the `upload` hook after commit for every changed artifact reference. */
export async function saveDraft(
  deps: PackServiceDeps,
  ctx: ActionContext,
  caseId: string,
  request: PackDraftUpdateRequest,
): Promise<PackDraft> {
  const now = (deps.now ?? (() => new Date()))();
  const { draft, attached } = await withTransaction(deps.db, async (tx) => {
    if (!(await lockCase(tx, caseId))) throw new NotFoundError('case');
    const before = (await readCaseRow(tx, caseId))!;
    const validated = await validateValues(tx, before, request, now); // step 4 before step 6 (W0-06 section 4)
    const draftRow = await assertExpectedDraft(tx, before, request.expectedVersion);
    await assertPackTotal(tx, draftRow.id, validated.writes, deps.limits.maxPackBytes);

    // Step 7: apply.
    const previous = await readDraftSlots(tx, draftRow.id);
    const slotRefs: AuditRefValue[] = [];
    const attached: UploadTriggerEvent[] = [];
    for (const write of validated.writes) {
      const was = slotStateFromColumns(previous[write.slot]);
      const row = await updateDraftSlot(tx, draftRow, write.slot, write.state, ctx.actor.subjectId, now);
      const ref: Record<string, AuditRefValue> = { slot: write.slot, state: row.state };
      if (write.artifact !== undefined) {
        ref.artifact_id = write.artifact.id;
        ref.content_hash = write.artifact.contentHash; // "attaching an artifact also records the blob hash reference"
        if (!(was.state === 'attached' && was.artifactId === write.artifact.id))
          attached.push({
            caseId,
            draftId: draftRow.id,
            versionNumber: draftRow.versionNumber,
            slot: write.slot,
            artifactId: write.artifact.id,
            checklistTemplateVersion: validated.checklistTemplateVersion ?? draftRow.checklistTemplateVersion,
            correlationId: ctx.correlationId,
          });
      }
      slotRefs.push(ref);
    }
    const contextPatch: { stageContext?: PackDraft['stageContext']; checklistTemplateVersion?: string } = {};
    if (request.stageContext !== undefined) contextPatch.stageContext = request.stageContext;
    if (validated.checklistTemplateVersion !== undefined)
      contextPatch.checklistTemplateVersion = validated.checklistTemplateVersion;
    const draftAfter = await updateDraftContext(tx, draftRow.id, contextPatch);

    const changed: string[] = [];
    if (contextPatch.stageContext !== undefined && contextPatch.stageContext !== draftRow.stageContext)
      changed.push('stage_context');
    if (
      contextPatch.checklistTemplateVersion !== undefined &&
      contextPatch.checklistTemplateVersion !== draftRow.checklistTemplateVersion
    )
      changed.push('checklist_template_version');
    if (slotRefs.length > 0) changed.push('slots');

    const after = await bumpRevision(tx, before, now);
    await auditStore.append(tx, {
      actorSubjectId: ctx.actor.subjectId,
      actorRole: ctx.role,
      action: 'draft.saved',
      targetCaseId: caseId,
      targetVersionId: draftRow.id,
      targetRef: { changed_fields: changed, slots: slotRefs },
      beforeRef: { row_version: before.rowVersion },
      afterRef: { row_version: after.rowVersion },
      correlationId: ctx.correlationId,
      occurredAt: now,
    });
    return { draft: await packDraftView(tx, after, draftAfter), attached };
  });
  fireUploadTriggers(deps, attached);
  return draft;
}

/** `row_version + 1` and `updated_at` on the case row (W0-04: every draft-time write increments the one counter). */
function bumpRevision(tx: Tx, before: CaseRow, now: Date): Promise<CaseRow> {
  return updateDraftFields(tx, before.id, {}, before.rowVersion, now);
}

/** After commit: the hook fires once per changed reference; a failure is logged, never surfaced (W0-07 3.2). */
function fireUploadTriggers(deps: PackServiceDeps, events: UploadTriggerEvent[]): void {
  const trigger = deps.uploadTrigger ?? noopUploadTrigger;
  for (const event of events) {
    void Promise.resolve()
      .then(() => trigger(event))
      .catch((err: unknown) => {
        (deps.errors ?? createErrorCapture(deps.emitter)).internal(err);
      });
  }
}
