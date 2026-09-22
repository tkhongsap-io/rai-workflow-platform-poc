// W1-13: W0-02 section 7.6 — submit (W0-06 4.3: freeze the draft into an immutable version, embed the artifact
// references, record the configuration revision and the D02 lane-mapping version, close the draft, reset the
// three lane projections, store the idempotency key) and version navigation (list ascending, by id, latest).
// A submitted version is never mutated: every read returns a deep copy of the same frozen object.

import { InvalidInputError, NotFoundError, type FieldError } from '@rai/shared/errors';
import { CURRENT_LANE_MAPPING, LANES } from '@rai/shared/constants';
import { dueOn } from '@rai/shared/sla/working-days';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import type { SlotNumber } from '@rai/shared/schemas/pack';
import {
  SubmitRequestSchema,
  type FrozenSlot,
  type SubmitRequest,
  type SubmittedVersion,
  type VersionListResponse,
} from '@rai/shared/schemas/versions';
import type { RouteContext, RouteDefinition } from './handler.js';
import { authorizedCase } from './routes-cases.js';
import type { StoredCase } from './store.js';
import { assertValid, json, parseJsonBody } from './support.js';
import {
  SLOT_NUMBERS,
  replayFor,
  requestDigest,
  requireIdempotencyKey,
  staleVersion,
  storeReplay,
} from './workflow.js';

function freezeSlots(ctx: RouteContext, stored: StoredCase): Record<SlotNumber, FrozenSlot> {
  const draft = stored.draft;
  if (draft === null) throw staleVersion(stored, 'version_superseded');
  const out = {} as Record<SlotNumber, FrozenSlot>;
  for (const slot of SLOT_NUMBERS) {
    const state = draft.slots[slot];
    if (state.state === 'attached') {
      const artifact = ctx.store.artifacts.get(state.artifactId);
      if (artifact === undefined)
        throw new InvalidInputError([
          { path: `slots[${slot}].artifactId`, messageKey: 'error.artifact_case_mismatch' },
        ]);
      out[slot] = { state: 'attached', artifact: structuredClone(artifact.ref) }; // embedded, immutable copy
    } else out[slot] = structuredClone(state);
  }
  return out;
}

/** W0-06 4.3 precondition: every not_applicable slot carries a reason (a soft-QC miss is never an error, L7). */
function submitSlotErrors(stored: StoredCase): FieldError[] {
  const out: FieldError[] = [];
  if (stored.draft === null) return out;
  for (const slot of SLOT_NUMBERS) {
    const state = stored.draft.slots[slot];
    if (state.state === 'not_applicable' && state.reason.kind === 'text' && state.reason.text.trim() === '')
      out.push({ path: `slots[${slot}].reason`, messageKey: 'validation.reason_required' });
  }
  return out;
}

export function versionRoutes(): RouteDefinition[] {
  return [
    {
      method: 'POST',
      path: '/api/cases/:caseId/draft/submit',
      auth: { kind: 'action', action: 'case.submit', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        if (ctx.principal === undefined) throw new NotFoundError('case'); // unreachable after the 401 step
        // Step 4: validation.
        const key = requireIdempotencyKey(ctx);
        const body = parseJsonBody(ctx.request);
        assertValid(SubmitRequestSchema, body);
        const request = body as SubmitRequest;
        const slotErrors = submitSlotErrors(stored);
        if (slotErrors.length > 0) throw new InvalidInputError(slotErrors);
        // Step 5: idempotency replay (same actor and key → the original 201; another body → 422).
        const digest = requestDigest('case.submit', ctx.path, ctx.request.body);
        const replay = replayFor(ctx, key, digest, stored.caseId);
        if (replay !== undefined) return replay;
        // Step 6: expected version (W0-06 5.2 submit row).
        if (stored.draft === null || request.expectedVersion.versionId !== stored.draft.draftId)
          throw staleVersion(stored, 'version_superseded');
        if (request.expectedVersion.revision !== stored.draft.draftRevision)
          throw staleVersion(stored, 'revision_changed');
        // Step 7: apply, as one unit.
        const draft = stored.draft;
        const slots = freezeSlots(ctx, stored);
        for (const previous of stored.versions) previous.isLatest = false;
        const version: SubmittedVersion = {
          versionId: draft.draftId, // the draft row becomes the version row (W0-04 pack_version)
          caseId: stored.caseId,
          versionNumber: draft.versionNumber,
          parentVersionId: draft.parentVersionId,
          submittedBy: ctx.principal.subjectId, // the actor; a SPOC on the owner's behalf is recorded as itself
          submittedAt: ctx.options.now().toISOString(),
          checklistTemplateVersion: draft.checklistTemplateVersion,
          stageContext: draft.stageContext,
          configurationRevisionId: ctx.store.configuration.revisionId,
          laneMappingVersion: CURRENT_LANE_MAPPING.version,
          slots,
          isLatest: true,
        };
        stored.versions.push(version);
        ctx.store.laneDueByVersion.set(
          version.versionId,
          LANES.map((lane) => ({
            lane,
            openedAt: version.submittedAt,
            dueOn: dueOn(new Date(version.submittedAt), ctx.store.configuration.slaWorkingDays[lane], [
              ...CONFIGURATION_SEED.calendar.holidays,
            ]),
          })),
        );
        stored.draft = null;
        stored.status = 'in_review';
        stored.privacyStatus = 'pending';
        stored.securityStatus = 'pending';
        stored.raiStatus = 'pending';
        stored.aiReadinessStatus = 'not_ready';
        stored.updatedAt = version.submittedAt;
        ctx.emitter.log('workflow.transition', {
          caseId: stored.caseId,
          fromVersionId: draft.draftId,
          toVersionId: version.versionId,
          transition: 'version.submitted',
        });
        const response = json(201, ctx.correlationId, version);
        storeReplay(ctx, key, digest, response);
        return response;
      },
    },
    {
      method: 'GET',
      path: '/api/cases/:caseId/versions',
      auth: { kind: 'action', action: 'version.view', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        const body: VersionListResponse = {
          items: stored.versions.map((v) => ({
            versionId: v.versionId,
            versionNumber: v.versionNumber,
            submittedBy: v.submittedBy,
            submittedAt: v.submittedAt,
            isLatest: v.isLatest,
          })),
        };
        return json(200, ctx.correlationId, body);
      },
    },
    {
      method: 'GET',
      path: '/api/cases/:caseId/versions/latest',
      auth: { kind: 'action', action: 'version.view', target: 'case' },
      handler: (ctx) => {
        const latest = authorizedCase(ctx).versions.at(-1);
        if (latest === undefined) throw new NotFoundError('version'); // never submitted
        return json(200, ctx.correlationId, structuredClone(latest));
      },
    },
    {
      method: 'GET',
      path: '/api/cases/:caseId/versions/:versionId',
      auth: { kind: 'action', action: 'version.view', target: 'case' },
      handler: (ctx) => {
        const version = authorizedCase(ctx).versions.find((v) => v.versionId === ctx.params.versionId);
        if (version === undefined) throw new NotFoundError('version'); // also when it belongs to another case
        return json(200, ctx.correlationId, structuredClone(version));
      },
    },
  ];
}
