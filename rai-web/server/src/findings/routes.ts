// W2-05 routes: lane QC run (persist single-lane defects) and disposition append.
// Disposition maps body.kind → finding.* action and authorizes the finding target after body validation
// (W0-05: "resolves the body's kind to its action before authorize runs").

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@rai/shared/errors';
import { LANES, type Lane } from '@rai/shared/constants';
import {
  DispositionRequestSchema,
  DispositionResponseSchema,
  LaneQcRunRequestSchema,
  LaneQcRunResponseSchema,
  LaneSchema,
  type DispositionKind,
} from '@rai/shared/schemas/review';
import { actorOf } from '../authz/middleware.js';
import { authorize, type Action, type CaseScopeFacts } from '../authz/policy.js';
import type { Emitter } from '../observability/log.js';
import { IDEMPOTENCY_HEADER, requireIdempotencyKey } from '../cases/idempotency.js';
import { createScopeFactsSource } from '../authz/facts.js';
import { runAndPersistLaneQc, type QcOrchestratorDeps } from '../qc/orchestrator.js';
import { owningLaneOf, readFindingForCase } from './repository.js';
import { recordDisposition, type DispositionServiceDeps } from './service.js';

export interface FindingsRouteDeps extends DispositionServiceDeps {
  emitter: Emitter;
  /** Injected QcRunner for lane QC; absent → qc-run returns unavailable:not_configured with nothing stored. */
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

export function registerFindingsRoutes(fastify: FastifyInstance, deps: FindingsRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const facts = createScopeFactsSource(deps.db);

  function authorizeFinding(
    request: FastifyRequest,
    action: Action,
    caseFacts: CaseScopeFacts,
    owningLane: Lane,
  ) {
    const principal = request.principal;
    if (principal === undefined) throw new UnauthenticatedError();
    const actor = actorOf(principal);
    const decision = authorize(actor, action, {
      kind: 'finding',
      facts: caseFacts,
      owningLane,
    });
    if (!decision.allow) {
      deps.emitter.log('authz.denied', {
        action,
        targetType: 'finding',
        targetId: caseFacts.caseId,
        actorSubjectId: actor.subjectId,
        actorRole: actor.roles.map((r) => r.role).join(','),
        reason: decision.reason,
      });
      throw new ForbiddenError();
    }
    return decision;
  }

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
      const principal = request.principal;
      if (principal === undefined) throw new UnauthenticatedError();
      const key = requireIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);

      // Body schema already validated kind; map to action before authorize (W0-05).
      const action = KIND_TO_ACTION[request.body.kind];

      const caseFacts = await facts.byCaseId(request.params.caseId);
      if (caseFacts === undefined) {
        // Unresolved: authorize with unresolved using propose_fixed as role probe then 404/403.
        const probe = authorize(actorOf(principal), action, { kind: 'unresolved' });
        if (!probe.allow) {
          deps.emitter.log('authz.denied', {
            action,
            targetType: 'finding',
            targetId: request.params.caseId,
            actorSubjectId: principal.subjectId,
            actorRole: principal.roles.map((r) => r.role).join(','),
            reason: probe.reason,
          });
          throw new ForbiddenError();
        }
        throw new NotFoundError('case');
      }

      const finding = await readFindingForCase(deps.db, request.params.caseId, request.params.findingId);
      if (finding === undefined) {
        const probe = authorize(actorOf(principal), action, {
          kind: 'finding',
          facts: caseFacts,
          owningLane: 'ai_coe',
        });
        if (!probe.allow) {
          deps.emitter.log('authz.denied', {
            action,
            targetType: 'finding',
            targetId: request.params.caseId,
            actorSubjectId: principal.subjectId,
            actorRole: principal.roles.map((r) => r.role).join(','),
            reason: probe.reason,
          });
          throw new ForbiddenError();
        }
        throw new NotFoundError('finding');
      }

      const decision = authorizeFinding(request, action, caseFacts, owningLaneOf(finding));
      const result = await recordDisposition(
        deps,
        { actor: principal, role: decision.via.role, correlationId: request.id },
        request.params.caseId,
        request.params.findingId,
        request.body,
        key,
      );
      return reply.status(201).send(result.body);
    },
  );

  // POST …/lanes/:lane/qc-run — version.view scope; persists storeable defects when a runner is injected.
  app.post(
    '/api/cases/:caseId/versions/:versionId/lanes/:lane/qc-run',
    {
      config: { auth: { kind: 'action', action: 'version.view', target: 'case' } },
      schema: {
        params: LaneQcParams,
        body: LaneQcRunRequestSchema,
        response: { 200: LaneQcRunResponseSchema },
      },
    },
    async (request) => {
      if (request.body.expectedVersion.versionId !== request.params.versionId) {
        throw new NotFoundError('version');
      }
      if (deps.qc === undefined) {
        return {
          runId: null,
          status: 'unavailable' as const,
          reason: 'not_configured' as const,
          findings: [],
        };
      }
      const outcome = await runAndPersistLaneQc(
        { db: deps.db, ...deps.qc },
        {
          caseId: request.params.caseId,
          versionId: request.params.versionId,
          lane: request.params.lane,
          correlationId: request.id,
        },
      );
      if (outcome.status === 'unavailable') {
        return {
          runId: null,
          status: 'unavailable' as const,
          reason: outcome.reason as 'timeout' | 'runner_error' | 'not_configured' | 'artifact_unreadable',
          findings: [],
        };
      }
      if (outcome.status === 'completed') {
        return {
          runId: outcome.runId,
          status: 'completed' as const,
          findings: outcome.findings.map((f) => ({
            findingId: f.findingId,
            ruleId: f.ruleId,
            slot: f.slot as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null,
            severity: f.severity as 'high' | 'medium' | 'low' | 'info',
            owningLane: f.owningLane,
            messageKey: f.messageKey,
          })),
        };
      }
      return { runId: null, status: 'unavailable' as const, reason: 'runner_error' as const, findings: [] };
    },
  );

  void LANES;
}
