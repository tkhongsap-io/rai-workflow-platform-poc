// W0-02 section 7.5, verbatim: GET /api/cases/{caseId}/draft and PUT /api/cases/{caseId}/draft. Each route
// declares its W0-05 action; the W1-01 middleware runs session → authorization → existence before anything here
// (401; 403 `role` for reviewers and Admin, 403 `scope` out of scope; 404 only for an `all_cases` holder on an
// unknown case). The PUT adds one preValidation hook so a projected status field answers `projected_field` and a
// reason-less N/A answers `validation.reason_required` on the slot's reason instead of the shape's generic
// failure; the rest of step 4, step 6 and step 7 are the service's transaction. No handler decides access on its own.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { InvalidInputError } from '@rai/shared/errors';
import { PackDraftSchema, PackDraftUpdateRequestSchema } from '@rai/shared/schemas/pack';
import { authorizedActor } from '../authz/middleware.js';
import { rejectProjectedFields } from '../cases/projected-fields.js';
import { readDraft, saveDraft, type PackServiceDeps } from './service.js';
import { reasonRequiredErrors } from './slots.js';

export type PackRouteDeps = PackServiceDeps;

const CaseParamsSchema = Type.Object({ caseId: Type.String({ minLength: 1 }) });

/**
 * Runs after the policy hook and before schema validation: the W0-04 fields rule (an inherited status field in a
 * save-draft body is 422 `projected_field`, W0-06 4.2) and the reason scan.
 */
function saveDraftBodyHook(request: FastifyRequest): Promise<void> {
  rejectProjectedFields(request.body);
  const errors = reasonRequiredErrors(request.body);
  if (errors.length > 0) throw new InvalidInputError(errors);
  return Promise.resolve();
}

export function registerPackRoutes(fastify: FastifyInstance, deps: PackRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/cases/{caseId}/draft → 200 PackDraft; 404 case (all_cases holder) or no open draft.
  app.get(
    '/api/cases/:caseId/draft',
    {
      config: { auth: { kind: 'action', action: 'case.view', target: 'case' } },
      schema: { params: CaseParamsSchema, response: { 200: PackDraftSchema } },
    },
    (request) => readDraft(deps.db, request.params.caseId, deps.subjects),
  );

  // PUT /api/cases/{caseId}/draft → 200 PackDraft, draftRevision + 1; audit draft.saved; upload trigger after commit.
  app.put(
    '/api/cases/:caseId/draft',
    {
      config: { auth: { kind: 'action', action: 'case.edit_draft', target: 'case' } },
      schema: {
        params: CaseParamsSchema,
        body: PackDraftUpdateRequestSchema,
        response: { 200: PackDraftSchema },
      },
      preValidation: saveDraftBodyHook,
    },
    (request) => {
      const { principal, role } = authorizedActor(request);
      return saveDraft(
        deps,
        { actor: principal, role, correlationId: request.id },
        request.params.caseId,
        request.body,
      );
    },
  );
}
