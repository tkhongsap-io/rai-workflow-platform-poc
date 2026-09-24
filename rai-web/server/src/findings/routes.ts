// W2-05 routes: lane QC run (persist single-lane defects) and disposition append.
// Disposition maps body.kind → finding.* action and authorizes the finding target after body validation
// (W0-05: "resolves the body's kind to its action before authorize runs").
// Lane QC uses lane.approve + target:lane (owning-lane reviewer only), same ownership gate as lane.approve.

import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { NotFoundError } from '@rai/shared/errors';
import { LANES } from '@rai/shared/constants';
import {
  DispositionRequestSchema,
  DispositionResponseSchema,
  LaneQcRunRequestSchema,
  LaneQcRunResponseSchema,
  LaneSchema,
  VersionFindingsResponseSchema,
  type DispositionKind,
} from '@rai/shared/schemas/review';
import { actorOf, denyUnlessAllowed } from '../authz/middleware.js';
import { authorize, type Action } from '../authz/policy.js';
import type { ErrorCapture } from '../observability/errors.js';
import type { Emitter } from '../observability/log.js';
import { IDEMPOTENCY_HEADER, requireIdempotencyKey } from '../cases/idempotency.js';
import { createScopeFactsSource } from '../authz/facts.js';
import { readVersionRow } from '../cases/repository.js';
import { runAndPersistLaneQc, type QcOrchestratorDeps } from '../qc/orchestrator.js';
import { listFindingsForVersion, owningLaneOf, readFindingForCase } from './repository.js';
import { recordDisposition, type DispositionServiceDeps } from './service.js';
import { isUuid } from '../versions/repository.js';

export interface FindingsRouteDeps extends DispositionServiceDeps {
  emitter: Emitter;
  errors?: ErrorCapture;
  /** Optional QC runner injection; absent → lane QC persists unavailable:not_configured with engine_id unbound. */
  qc?: Omit<QcOrchestratorDeps, 'db'>;
}

const KIND_TO_ACTION: Record<DispositionKind, Action> = {
  fixed_proposed: 'finding.propose_fixed',
  fixed: 'finding.mark_fixed',
  fixed_confirmed: 'finding.confirm_fixed',
  waived: 'finding.waive',
  not_applicable: 'finding.mark_na',
};

const CaseFindingParams = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  findingId: Type.String({ minLength: 1 }),
});

const LaneQcParams = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
  lane: LaneSchema,
});

const VersionFindingsParams = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
});

export function registerFindingsRoutes(fastify: FastifyInstance, deps: FindingsRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const facts = createScopeFactsSource(deps.db);

  // GET …/versions/:versionId/findings — version.view; returns stored findings + latestDisposition (no qc_run write).
  app.get(
    '/api/cases/:caseId/versions/:versionId/findings',
    {
      config: { auth: { kind: 'action', action: 'version.view', target: 'case' } },
      schema: {
        params: VersionFindingsParams,
        response: { 200: VersionFindingsResponseSchema },
      },
    },
    async (request) => {
      if (!isUuid(request.params.versionId)) throw new NotFoundError('version');
      const version = await readVersionRow(deps.db, request.params.versionId);
      if (version === undefined || version.caseId !== request.params.caseId) {
        throw new NotFoundError('version');
      }
      return {
        findings: await listFindingsForVersion(deps.db, request.params.caseId, request.params.versionId),
      };
    },
  );

  // POST …/findings/:findingId/dispositions — session only in middleware; kind→action authorize here.
  app.post(
    '/api/cases/:caseId/findings/:findingId/dispositions',
    {
      config: { auth: { kind: 'session' } },
      schema: {
        params: CaseFindingParams,
        body: DispositionRequestSchema,
        response: { 201: DispositionResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal!;
      const key = requireIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);
      const { caseId, findingId } = request.params;
      const actor = actorOf(principal);
      // Body schema already validated kind; map to action before authorize (W0-05).
      const action = KIND_TO_ACTION[request.body.kind];
      const log = { targetType: 'finding', targetId: caseId };

      // A malformed id is a missing row: the same 403-before-404 answers the middleware gives.
      const caseFacts = isUuid(caseId) ? await facts.byCaseId(caseId) : undefined;
      if (caseFacts === undefined) {
        denyUnlessAllowed(deps.emitter, actor, action, { kind: 'unresolved' }, log);
        throw new NotFoundError('case');
      }
      const finding = isUuid(findingId) ? await readFindingForCase(deps.db, caseId, findingId) : undefined;
      // An unknown finding has no owning lane (issue #35 assigns none), so any lane that would allow means 404.
      const owningLane =
        finding === undefined
          ? (LANES.find(
              (lane) =>
                authorize(actor, action, { kind: 'finding', facts: caseFacts, owningLane: lane }).allow,
            ) ?? LANES[0]!)
          : owningLaneOf(finding);
      const decision = denyUnlessAllowed(
        deps.emitter,
        actor,
        action,
        { kind: 'finding', facts: caseFacts, owningLane },
        log,
      );
      if (finding === undefined) throw new NotFoundError('finding');

      const result = await recordDisposition(
        deps,
        { actor: principal, role: decision.via.role, correlationId: request.id },
        caseId,
        findingId,
        request.body,
        key,
      );
      return reply.status(201).send(result.body);
    },
  );

  // POST …/lanes/:lane/qc-run — owning-lane reviewer only (lane.approve); persists storeable defects.
  // Unbound (no runner) still records an unavailable qc_run with engine_id `unbound`.
  app.post(
    '/api/cases/:caseId/versions/:versionId/lanes/:lane/qc-run',
    {
      config: { auth: { kind: 'action', action: 'lane.approve', target: 'lane' } },
      schema: {
        params: LaneQcParams,
        body: LaneQcRunRequestSchema,
        response: { 200: LaneQcRunResponseSchema },
      },
    },
    async (request) => {
      if (
        !isUuid(request.params.versionId) ||
        request.body.expectedVersion.versionId !== request.params.versionId
      ) {
        throw new NotFoundError('version');
      }
      const outcome = await runAndPersistLaneQc(
        {
          db: deps.db,
          ...(deps.now === undefined ? {} : { now: deps.now }),
          ...(deps.qc === undefined ? {} : deps.qc),
          emitter: deps.emitter,
          ...(deps.errors === undefined ? {} : { errors: deps.errors }),
        },
        {
          caseId: request.params.caseId,
          versionId: request.params.versionId,
          lane: request.params.lane,
          correlationId: request.id,
        },
      );
      if (outcome.status === 'unavailable') {
        return {
          runId: outcome.runId,
          status: 'unavailable' as const,
          reason: outcome.reason,
          findings: [],
        };
      }
      return {
        runId: outcome.runId,
        status: 'completed' as const,
        findings: outcome.findings,
      };
    },
  );
}
