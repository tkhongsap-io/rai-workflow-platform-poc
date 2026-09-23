// W0-02 section 7.3, verbatim: POST /api/cases, GET /api/cases/{caseId}, PATCH /api/cases/{caseId},
// GET /api/cases?page&pageSize, GET /api/configuration/current. Every route declares its W0-05 action; the
// middleware (authz/) runs session → authorization → existence before anything here. What the handlers add is the
// W0-06 step 4 validation and the two W0-05 scope evaluations that need a validated body: the create scope step
// (facts from the body) and the post-edit step of case.edit_draft (facts the case would have after the write).
// No handler decides 403 versus 404 on its own; the two body-driven denials reuse `authorize` and emit the same
// `authz.denied` line the middleware emits. No route reads an external register (L3, L6).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { NotFoundError } from '@rai/shared/errors';
import type { Principal } from '@rai/shared/schemas/auth';
import {
  CASE_LIST_DEFAULTS,
  CaseCreateRequestSchema,
  CaseListQuerySchema,
  CaseUpdateRequestSchema,
  type CaseListResponse,
} from '@rai/shared/schemas/cases';
import { actorOf, authorizedActor, denyUnlessAllowed } from '../authz/middleware.js';
import type { Action, CaseScopeFacts } from '../authz/policy.js';
import { effectiveConfiguration } from '../configuration/store.js';
import type { Emitter } from '../observability/log.js';
import { IDEMPOTENCY_HEADER, requireIdempotencyKey } from './idempotency.js';
import { rejectProjectedFields } from './projected-fields.js';
import { listCases, readCaseView } from './repository.js';
import { createCase, updateCase, validateWritableFields, type CaseServiceDeps } from './service.js';

export interface CaseRouteDeps extends CaseServiceDeps {
  emitter: Emitter;
}

const CaseParamsSchema = Type.Object({ caseId: Type.String({ minLength: 1 }) });

/** The route-level projected-field check (W0-05 section 5): after the policy hook, before schema validation. */
function projectedFieldsHook(request: FastifyRequest): Promise<void> {
  rejectProjectedFields(request.body);
  return Promise.resolve();
}

export function registerCaseRoutes(fastify: FastifyInstance, deps: CaseRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const now = deps.now ?? (() => new Date());

  /** A body-driven scope evaluation: same `authorize`, same `authz.denied` line, same plain 403 envelope. */
  const authorizeFacts = (principal: Principal, action: Action, facts: CaseScopeFacts) =>
    denyUnlessAllowed(
      deps.emitter,
      actorOf(principal),
      action,
      { kind: 'case', facts },
      {
        targetType: 'case',
        targetId: facts.caseId,
      },
    );

  // POST /api/cases → 201 CaseView. Role step in the middleware (target none); validation; scope step on the body.
  app.post(
    '/api/cases',
    {
      config: { auth: { kind: 'action', action: 'case.create', target: 'none' } },
      schema: { body: CaseCreateRequestSchema },
      preValidation: projectedFieldsHook,
    },
    async (request, reply) => {
      const { principal } = authorizedActor(request);
      const key = requireIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);
      const { columns } = await validateWritableFields(deps, deps.db, request.body, principal, now());
      const decision = authorizeFacts(principal, 'case.create', {
        ownerSubjectId: columns.ownerSubjectId!,
        businessUnitId: columns.businessUnitId!,
      });
      const result = await createCase(
        deps,
        { actor: principal, role: decision.via.role, correlationId: request.id },
        request.body,
        columns,
        key,
      );
      return reply.status(result.status).send(result.body);
    },
  );

  // GET /api/cases?page&pageSize → 200 CaseListResponse, scoped by caseScopeWhere; total counts in-scope rows only.
  app.get(
    '/api/cases',
    {
      config: { auth: { kind: 'action', action: 'case.list', target: 'none' } },
      schema: { querystring: CaseListQuerySchema },
    },
    async (request): Promise<CaseListResponse> => {
      const page = request.query.page ?? CASE_LIST_DEFAULTS.page;
      const pageSize = request.query.pageSize ?? CASE_LIST_DEFAULTS.pageSize;
      const { items, total } = await listCases(deps.db, actorOf(authorizedActor(request).principal), {
        page,
        pageSize,
      });
      return { items, page, pageSize, total };
    },
  );

  // GET /api/cases/{caseId} → 200 CaseView; 403 out of scope; 404 only for an all_cases holder (middleware).
  app.get(
    '/api/cases/:caseId',
    {
      config: { auth: { kind: 'action', action: 'case.view', target: 'case' } },
      schema: { params: CaseParamsSchema },
    },
    async (request) => {
      const view = await readCaseView(deps.db, request.params.caseId);
      if (view === undefined) throw new NotFoundError('case');
      return view;
    },
  );

  // PATCH /api/cases/{caseId} → 200 CaseView, caseRevision + 1; stored-facts authorization in the middleware,
  // validation, then the post-edit evaluation when a scope field is in the body (W0-05 "Edit target").
  app.patch(
    '/api/cases/:caseId',
    {
      config: { auth: { kind: 'action', action: 'case.edit_draft', target: 'case' } },
      schema: { params: CaseParamsSchema, body: CaseUpdateRequestSchema },
      preValidation: projectedFieldsHook,
    },
    async (request) => {
      const { principal, role: storedRole, facts } = authorizedActor(request);
      const stored = facts!; // target 'case': the middleware already answered 404 for a missing case
      const { columns } = await validateWritableFields(
        deps,
        deps.db,
        request.body.fields,
        principal,
        now(),
        'body.fields',
      );
      let role = storedRole;
      if (
        request.body.fields.businessOwner !== undefined ||
        request.body.fields.businessUnitId !== undefined
      ) {
        role = authorizeFacts(principal, 'case.edit_draft', {
          caseId: request.params.caseId,
          ownerSubjectId: columns.ownerSubjectId ?? stored.ownerSubjectId,
          businessUnitId: columns.businessUnitId ?? stored.businessUnitId,
        }).via.role;
      }
      return updateCase(
        deps,
        { actor: principal, role, correlationId: request.id },
        request.params.caseId,
        request.body,
        columns,
      );
    },
  );

  // GET /api/configuration/current → 200 ConfigurationView (the published revisions in force now).
  app.get(
    '/api/configuration/current',
    { config: { auth: { kind: 'action', action: 'config.read_effective', target: 'none' } } },
    () => effectiveConfiguration(deps.db, now()),
  );
}
