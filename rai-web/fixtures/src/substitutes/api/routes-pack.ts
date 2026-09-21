// W1-13: W0-02 section 7.5 — read and save the nine-slot draft with the W0-06 4.2 save-draft rules: 404 when the
// case has no open draft, 422 for a reason-less N/A, an artifact of another case or an unconfigured template,
// 409 `version_superseded` / `revision_changed` from the ExpectedVersion (W0-06 5.1, 5.2), 422 `unsafe_upload`
// `pack_total_exceeded` when an attach would take the draft over the pack limit (W0-08 check 10).

import { InvalidInputError, NotFoundError, UnsafeUploadError, type FieldError } from '@rai/shared/errors';
import {
  PackDraftUpdateRequestSchema,
  type PackDraftUpdateRequest,
  type SlotNumber,
  type SlotState,
} from '@rai/shared/schemas/pack';
import type { RouteContext, RouteDefinition } from './handler.js';
import { attachedBytes } from './routes-artifacts.js';
import { authorizedCase } from './routes-cases.js';
import type { StoredCase } from './store.js';
import { fieldErrorsFor, json, parseJsonBody } from './support.js';
import { SLOT_NUMBERS, staleVersion } from './workflow.js';

const MIB = 1024 * 1024;

/** W0-02 7.5 error rows that the TypeBox shape alone does not carry, with the locale keys the row names. */
function slotValueErrors(
  ctx: RouteContext,
  stored: StoredCase,
  request: PackDraftUpdateRequest,
): FieldError[] {
  const out: FieldError[] = [];
  if (
    request.checklistTemplateVersion !== undefined &&
    !ctx.store.configuration.checklistTemplateVersions.includes(request.checklistTemplateVersion)
  )
    out.push({ path: 'body.checklistTemplateVersion', messageKey: 'validation.not_in_configured_list' });
  for (const [slot, state] of Object.entries(request.slots ?? {})) {
    if (state.state === 'not_applicable' && state.reason.kind === 'text' && state.reason.text.trim() === '')
      out.push({ path: `body.slots[${slot}].reason`, messageKey: 'validation.reason_required' });
    if (state.state === 'attached') {
      const artifact = ctx.store.artifacts.get(state.artifactId);
      if (artifact === undefined || artifact.ref.caseId !== stored.caseId)
        out.push({ path: `body.slots[${slot}].artifactId`, messageKey: 'error.artifact_case_mismatch' });
    }
  }
  return out;
}

/** The shape's own N/A rule (`text` minLength 1) must surface as `validation.reason_required` on the slot's reason. */
function reasonRequiredErrors(body: unknown): FieldError[] {
  const slots = (body as { slots?: Record<string, unknown> } | null)?.slots;
  if (typeof slots !== 'object' || slots === null) return [];
  const out: FieldError[] = [];
  for (const [slot, raw] of Object.entries(slots)) {
    const state = raw as { state?: unknown; reason?: { kind?: unknown; text?: unknown } } | null;
    if (state?.state !== 'not_applicable') continue;
    const reason = state.reason;
    const text = reason?.kind === 'text' ? reason.text : undefined;
    if (
      reason === undefined ||
      reason === null ||
      (reason.kind === 'text' && (typeof text !== 'string' || text.trim() === ''))
    )
      out.push({ path: `body.slots[${slot}].reason`, messageKey: 'validation.reason_required' });
  }
  return out;
}

export function packRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/api/cases/:caseId/draft',
      auth: { kind: 'action', action: 'case.view', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        if (stored.draft === null) throw new NotFoundError('version'); // no open draft (W0-02 7.5)
        return json(200, ctx.correlationId, stored.draft);
      },
    },
    {
      method: 'PUT',
      path: '/api/cases/:caseId/draft',
      auth: { kind: 'action', action: 'case.edit_draft', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        const body = parseJsonBody(ctx.request);
        // W0-06 step 4: validation.
        const reasons = reasonRequiredErrors(body);
        if (reasons.length > 0) throw new InvalidInputError(reasons);
        const shape = fieldErrorsFor(PackDraftUpdateRequestSchema, body);
        if (shape.length > 0) throw new InvalidInputError(shape);
        const request = body as PackDraftUpdateRequest;
        const values = slotValueErrors(ctx, stored, request);
        if (values.length > 0) throw new InvalidInputError(values);
        // Step 6: expected version (W0-06 5.2 save-draft row).
        if (stored.draft === null || request.expectedVersion.versionId !== stored.draft.draftId)
          throw staleVersion(stored, 'version_superseded');
        if (request.expectedVersion.revision !== stored.draft.draftRevision)
          throw staleVersion(stored, 'revision_changed');
        // W0-08 check 10, re-checked at attach.
        let total = attachedBytes(ctx, stored);
        for (const [slot, state] of Object.entries(request.slots ?? {})) {
          const current = stored.draft.slots[Number(slot) as SlotNumber];
          if (current.state === 'attached')
            total -= ctx.store.artifacts.get(current.artifactId)?.ref.sizeBytes ?? 0;
          if (state.state === 'attached')
            total += ctx.store.artifacts.get(state.artifactId)?.ref.sizeBytes ?? 0;
        }
        if (total > ctx.options.uploadMaxPackBytes)
          throw new UnsafeUploadError('pack_total_exceeded', {
            max_pack_mb: Math.floor(ctx.options.uploadMaxPackBytes / MIB),
          });
        // Step 7: apply.
        const draft = stored.draft;
        if (request.checklistTemplateVersion !== undefined)
          draft.checklistTemplateVersion = request.checklistTemplateVersion;
        if (request.stageContext !== undefined) draft.stageContext = request.stageContext;
        const changed = (request.slots ?? {}) as Partial<Record<SlotNumber, SlotState>>;
        const slots = draft.slots as Record<SlotNumber, SlotState>;
        for (const slot of SLOT_NUMBERS) {
          const next = changed[slot];
          if (next !== undefined) slots[slot] = structuredClone(next);
        }
        stored.caseRevision += 1;
        draft.draftRevision = stored.caseRevision;
        const at = ctx.options.now().toISOString();
        draft.updatedAt = at;
        stored.updatedAt = at;
        return json(200, ctx.correlationId, draft);
      },
    },
  ];
}
