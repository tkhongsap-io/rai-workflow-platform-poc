// W2-05 routes: lane QC run (persist single-lane defects) and disposition append.
// Disposition maps body.kind → finding.* action and authorizes the finding target after body validation
// (W0-05: "resolves the body's kind to its action before authorize runs").
// Lane QC uses lane.approve + target:lane (owning-lane reviewer only), same ownership gate as lane.approve.

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
  VersionFindingsResponseSchema,
  type DispositionKind,
} from '@rai/shared/schemas/review';
import { actorOf } from '../authz/middleware.js';
import { authorize, type Action, type CaseScopeFacts } from '../authz/policy.js';
import type { Emitter } from '../observability/log.js';
import { IDEMPOTENCY_HEADER, requireIdempotencyKey } from '../cases/idempotency.js';
import { createScopeFactsSource } from '../authz/facts.js';
import { readVersionRow } from '../cases/repository.js';
import { runAndPersistLaneQc, type QcOrchestratorDeps } from '../qc/orchestrator.js';
import { listFindingsForVersion, owningLaneOf, readFindingForCase } from './repository.js';
import { recordDisposition, type DispositionServiceDeps } from './service.js';

export interface FindingsRouteDeps extends DispositionServiceDeps {
  emitter: Emitter;
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
      const version = await readVersionRow(deps.db, request.params.versionId);
      if (version === undefined || version.caseId !== request.params.caseId) {
        throw new NotFoundError('version');
      }
      const findings = await listFindingsForVersion(deps.db, request.params.caseId, request.params.versionId);
      return {
        findings: findings.map((f) => ({
          findingId: f.findingId,
          ruleId: f.ruleId,
          slot: f.slot as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null,
          severity: f.severity as 'high' | 'medium' | 'low' | 'info',
          owningLane: f.owningLane,
          messageKey: f.messageKey,
          latestDisposition: f.latestDisposition,
          ...(f.messageParams === undefined ? {} : { messageParams: f.messageParams }),
        })),
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
      if (request.body.expectedVersion.versionId !== request.params.versionId) {
        throw new NotFoundError('version');
      }
      const outcome = await runAndPersistLaneQc(
        {
          db: deps.db,
          ...(deps.now === undefined ? {} : { now: deps.now }),
          ...(deps.qc === undefined ? {} : deps.qc),
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
          reason: outcome.reason as 'timeout' | 'runner_error' | 'not_configured' | 'artifact_unreadable',
          findings: [],
        };
      }
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
          ...(f.messageParams === undefined ? {} : { messageParams: f.messageParams }),
        })),
      };
    },
  );

  void LANES;
}
