// W0-02 section 7.6, verbatim: POST /api/cases/{caseId}/draft/submit, GET /api/cases/{caseId}/versions,
// GET /api/cases/{caseId}/versions/latest, GET /api/cases/{caseId}/versions/{versionId}. Each route declares its
// W0-05 action (`case.submit`: owner or BU SPOC of the case; reviewers and Admin 403 `role`; out of scope 403
// `scope`; `version.view`: every role under scope, never hidden from an in-scope actor, A07); the W1-01 middleware
// runs session → authorization → existence before anything here. The POST handler adds the `Idempotency-Key`
// header check (W0-06 5.3: missing → 422 at `header.idempotency-key`); steps 5-7 are the service's transaction.

import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { NotFoundError } from '@rai/shared/errors';
import { StageContextSchema } from '@rai/shared/schemas/slots';
import { FrozenSlotSchema, SubmitRequestSchema, VersionSummarySchema } from '@rai/shared/schemas/versions';
import { IDEMPOTENCY_HEADER, requireIdempotencyKey } from '../cases/idempotency.js';
import { latestVersion, listVersions, readVersion, submitDraft, type VersionServiceDeps } from './service.js';

export type VersionRouteDeps = VersionServiceDeps;

const CaseParamsSchema = Type.Object({ caseId: Type.String({ minLength: 1 }) });

/**
 * The 7.6 `SubmittedVersion` as a response schema, key for key in the contract's order, so a fresh 201, its
 * replay from the stored key (jsonb keeps no key order) and every later read serialise byte-identically (A07).
 */
const SlotKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const SubmittedVersionResponseSchema = Type.Object({
  versionId: Type.String(),
  caseId: Type.String(),
  versionNumber: Type.Integer(),
  parentVersionId: Type.Union([Type.String(), Type.Null()]),
  submittedBy: Type.String(),
  submittedAt: Type.String(),
  checklistTemplateVersion: Type.String(),
  stageContext: StageContextSchema,
  configurationRevisionId: Type.String(),
  laneMappingVersion: Type.String(),
  slots: Type.Object(Object.fromEntries(SlotKeys.map((k) => [k, FrozenSlotSchema]))),
  isLatest: Type.Boolean(),
});
const VersionListResponseSchema = Type.Object({ items: Type.Array(VersionSummarySchema) });
const VersionParamsSchema = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
});

export function registerVersionRoutes(fastify: FastifyInstance, deps: VersionRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // POST /api/cases/{caseId}/draft/submit → 201 SubmittedVersion; replay with the same key → the same 201 body.
  app.post(
    '/api/cases/:caseId/draft/submit',
    {
      config: { auth: { kind: 'action', action: 'case.submit', target: 'case' } },
      schema: {
        params: CaseParamsSchema,
        body: SubmitRequestSchema,
        response: { 201: SubmittedVersionResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      const decision = request.authz?.decision;
      if (principal === undefined || decision === undefined) throw new NotFoundError('case'); // unreachable after the middleware
      const key = requireIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);
      const result = await submitDraft(
        deps,
        { actor: principal, role: decision.via.role, correlationId: request.id },
        request.params.caseId,
        request.body,
        key,
      );
      return reply.status(201).send(result.body); // a replay is the original 201 (W0-06 5.3)
    },
  );

  // GET /api/cases/{caseId}/versions → 200 VersionListResponse (ascending by versionNumber).
  app.get(
    '/api/cases/:caseId/versions',
    {
      config: { auth: { kind: 'action', action: 'version.view', target: 'case' } },
      schema: { params: CaseParamsSchema, response: { 200: VersionListResponseSchema } },
    },
    (request) => listVersions(deps.db, request.params.caseId),
  );

  // GET /api/cases/{caseId}/versions/latest → 200 SubmittedVersion; 404 when never submitted.
  app.get(
    '/api/cases/:caseId/versions/latest',
    {
      config: { auth: { kind: 'action', action: 'version.view', target: 'case' } },
      schema: { params: CaseParamsSchema, response: { 200: SubmittedVersionResponseSchema } },
    },
    (request) => latestVersion(deps.db, request.params.caseId),
  );

  // GET /api/cases/{caseId}/versions/{versionId} → 200 SubmittedVersion, byte-identical on every read.
  app.get(
    '/api/cases/:caseId/versions/:versionId',
    {
      config: { auth: { kind: 'action', action: 'version.view', target: 'case' } },
      schema: { params: VersionParamsSchema, response: { 200: SubmittedVersionResponseSchema } },
    },
    (request) => readVersion(deps.db, request.params.caseId, request.params.versionId),
  );
}
