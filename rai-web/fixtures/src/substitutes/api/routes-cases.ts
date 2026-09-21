// W1-13: W0-02 section 7.3 — configuration read, the scoped case list, create, read and edit — with the W0-05
// create and edit targets (role step, body validation, scope step on the facts the body describes) and the
// W0-06 4.1/4.2 rules. Scope for the list is the W0-05 `caseScopeWhere` predicate over the actor's grants.

import { InvalidInputError, NotFoundError } from '@rai/shared/errors';
import type { CaseId } from '@rai/shared/ids';
import {
  CASE_LIST_DEFAULTS,
  CaseCreateRequestSchema,
  CaseListQuerySchema,
  CaseUpdateRequestSchema,
  type CaseCreateRequest,
  type CaseListResponse,
  type CaseUpdateRequest,
} from '@rai/shared/schemas/cases';
import type { RouteContext, RouteDefinition } from './handler.js';
import type { StoredCase } from './store.js';
import { assertValid, fieldErrorsFor, json, parseJsonBody } from './support.js';
import {
  actorOf,
  applyVendorFlip,
  authorizeOnFacts,
  caseFieldValueErrors,
  caseSummary,
  caseView,
  inListScope,
  newDraft,
  projectedFieldErrors,
  replayFor,
  requestDigest,
  requireIdempotencyKey,
  staleVersion,
  storeReplay,
} from './workflow.js';

/** The stored case the middleware already authorized; absent only if the store changed under the request. */
export function authorizedCase(ctx: RouteContext): StoredCase {
  const stored = ctx.store.cases.get(ctx.params.caseId ?? '');
  if (stored === undefined) throw new NotFoundError('case');
  return stored;
}

function listQuery(ctx: RouteContext): { page: number; pageSize: number } {
  const raw: Record<string, unknown> = {};
  for (const key of ['page', 'pageSize'] as const) {
    const value = ctx.query.get(key);
    if (value === null) continue;
    raw[key] = /^-?\d+$/.test(value) ? Number(value) : value; // a non-integer stays a string and fails the schema
  }
  assertValid(CaseListQuerySchema, raw, 'query');
  const parsed = raw as { page?: number; pageSize?: number };
  return {
    page: parsed.page ?? CASE_LIST_DEFAULTS.page,
    pageSize: parsed.pageSize ?? CASE_LIST_DEFAULTS.pageSize,
  };
}

export function caseRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/api/configuration/current',
      auth: { kind: 'action', action: 'config.read_effective', target: 'none' },
      handler: (ctx) => json(200, ctx.correlationId, ctx.store.configuration),
    },
    {
      method: 'GET',
      path: '/api/cases',
      auth: { kind: 'action', action: 'case.list', target: 'none' },
      handler: (ctx) => {
        if (ctx.principal === undefined) throw new NotFoundError('case'); // unreachable after the 401 step
        const { page, pageSize } = listQuery(ctx);
        const actor = actorOf(ctx.principal);
        const inScope = [...ctx.store.cases.values()]
          .filter((stored) => inListScope(actor, stored)) // scope before any filter, LIMIT or COUNT (W0-05)
          .sort((a, b) =>
            a.updatedAt === b.updatedAt
              ? a.registryId.localeCompare(b.registryId)
              : a.updatedAt < b.updatedAt
                ? 1
                : -1,
          );
        const items = inScope.slice((page - 1) * pageSize, page * pageSize).map(caseSummary);
        const body: CaseListResponse = { items, page, pageSize, total: inScope.length };
        return json(200, ctx.correlationId, body);
      },
    },
    {
      method: 'POST',
      path: '/api/cases',
      // The role step (W0-05 create target, step a): reviewers and Admin are 403 `role` before the body is read.
      auth: { kind: 'action', action: 'case.create', target: 'none' },
      handler: (ctx) => {
        if (ctx.principal === undefined) throw new NotFoundError('case'); // unreachable after the 401 step
        // Step b: validation (W0-06 step 4): header, projected fields, shape, value rules.
        const key = requireIdempotencyKey(ctx);
        const body = parseJsonBody(ctx.request);
        const projected = projectedFieldErrors(body, 'body.');
        if (projected.length > 0) throw new InvalidInputError(projected);
        const shape = fieldErrorsFor(CaseCreateRequestSchema, body);
        if (shape.length > 0) throw new InvalidInputError(shape);
        const request = body as CaseCreateRequest;
        const values = caseFieldValueErrors(ctx.store, request, 'body.');
        if (values.length > 0) throw new InvalidInputError(values);
        // Step c: the scope step on the facts the body describes (owner must name itself; SPOC within its BU).
        authorizeOnFacts(
          ctx,
          'case.create',
          { ownerSubjectId: request.businessOwner, businessUnitId: request.businessUnitId },
          undefined,
        );
        // W0-06 step 5: idempotency replay.
        const digest = requestDigest('case.create', ctx.path, ctx.request.body);
        const replay = replayFor(ctx, key, digest, undefined);
        if (replay !== undefined) return replay;
        // Step 7: apply.
        const now = ctx.options.now();
        const at = now.toISOString();
        const caseId = crypto.randomUUID() as CaseId; // server-generated, non-guessable (W0-05 section 4)
        const stored: StoredCase = {
          caseId,
          registryId: ctx.store.nextRegistryId(now),
          fields: structuredClone(request),
          status: 'draft',
          riskTier: null,
          privacyStatus: 'pending',
          securityStatus: 'pending',
          raiStatus: 'pending',
          aiReadinessStatus: 'not_ready',
          caseRevision: 1,
          createdBy: ctx.principal.subjectId,
          createdAt: at,
          updatedAt: at,
          draft: newDraft(caseId, request, ctx.store.configuration.checklistTemplateVersions[0] ?? '', at),
          versions: [],
        };
        ctx.store.cases.set(caseId, stored);
        const response = json(201, ctx.correlationId, caseView(stored));
        storeReplay(ctx, key, digest, response);
        return response;
      },
    },
    {
      method: 'GET',
      path: '/api/cases/:caseId',
      auth: { kind: 'action', action: 'case.view', target: 'case' },
      handler: (ctx) => json(200, ctx.correlationId, caseView(authorizedCase(ctx))),
    },
    {
      method: 'PATCH',
      path: '/api/cases/:caseId',
      // Stored facts first (the middleware); post-edit facts after validation (W0-05 edit target).
      auth: { kind: 'action', action: 'case.edit_draft', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        const body = parseJsonBody(ctx.request);
        const fieldsBody =
          typeof body === 'object' && body !== null ? (body as { fields?: unknown }).fields : undefined;
        const projected = projectedFieldErrors(fieldsBody, 'body.fields.');
        if (projected.length > 0) throw new InvalidInputError(projected);
        const shape = fieldErrorsFor(CaseUpdateRequestSchema, body);
        if (shape.length > 0) throw new InvalidInputError(shape);
        const request = body as CaseUpdateRequest;
        const values = caseFieldValueErrors(ctx.store, request.fields, 'body.fields.');
        if (values.length > 0) throw new InvalidInputError(values);
        if (request.fields.businessOwner !== undefined || request.fields.businessUnitId !== undefined)
          authorizeOnFacts(
            ctx,
            'case.edit_draft',
            {
              caseId: stored.caseId,
              ownerSubjectId: request.fields.businessOwner ?? stored.fields.businessOwner,
              businessUnitId: request.fields.businessUnitId ?? stored.fields.businessUnitId,
            },
            stored.caseId,
          );
        // W0-06 step 6: expected version (one counter per case; no open draft → version_superseded).
        if (stored.draft === null) throw staleVersion(stored, 'version_superseded');
        if (request.expectedCaseRevision !== stored.caseRevision)
          throw staleVersion(stored, 'revision_changed');
        // Step 7: apply.
        const before = stored.fields.vendorInvolved;
        Object.assign(stored.fields, structuredClone(request.fields));
        applyVendorFlip(stored.draft, before, stored.fields.vendorInvolved);
        stored.caseRevision += 1;
        stored.draft.draftRevision = stored.caseRevision;
        const at = ctx.options.now().toISOString();
        stored.updatedAt = at;
        stored.draft.updatedAt = at;
        return json(200, ctx.correlationId, caseView(stored));
      },
    },
  ];
}
