// W2-02 routes: POST …/lanes/{lane}/approve and …/send-back. Each declares its W0-05 action; middleware
// authorizes the lane target before the body is parsed. Idempotency-Key required (W0-06 5.3).

import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { LANES } from '@rai/shared/constants';
import { NotFoundError } from '@rai/shared/errors';
import {
  ApproveLaneRequestSchema,
  LaneDecisionResponseSchema,
  LaneSchema,
  SendBackLaneRequestSchema,
} from '@rai/shared/schemas/review';
import { IDEMPOTENCY_HEADER, requireIdempotencyKey } from '../cases/idempotency.js';
import { approveLane, sendBackLane, type DecideServiceDeps } from './service.js';

export type DecideRouteDeps = DecideServiceDeps;

const ParamsSchema = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
  lane: LaneSchema,
});

export function registerDecideRoutes(fastify: FastifyInstance, deps: DecideRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/api/cases/:caseId/versions/:versionId/lanes/:lane/approve',
    {
      config: { auth: { kind: 'action', action: 'lane.approve', target: 'lane' } },
      schema: {
        params: ParamsSchema,
        body: ApproveLaneRequestSchema,
        response: { 201: LaneDecisionResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      const decision = request.authz?.decision;
      if (principal === undefined || decision === undefined) throw new NotFoundError('case');
      const key = requireIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);
      const result = await approveLane(
        deps,
        { actor: principal, role: decision.via.role, correlationId: request.id },
        request.params.caseId,
        request.params.versionId,
        request.params.lane,
        request.body,
        key,
      );
      return reply.status(201).send(result.body);
    },
  );

  app.post(
    '/api/cases/:caseId/versions/:versionId/lanes/:lane/send-back',
    {
      config: { auth: { kind: 'action', action: 'lane.send_back', target: 'lane' } },
      schema: {
        params: ParamsSchema,
        body: SendBackLaneRequestSchema,
        response: { 201: LaneDecisionResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal;
      const decision = request.authz?.decision;
      if (principal === undefined || decision === undefined) throw new NotFoundError('case');
      const key = requireIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);
      const result = await sendBackLane(
        deps,
        { actor: principal, role: decision.via.role, correlationId: request.id },
        request.params.caseId,
        request.params.versionId,
        request.params.lane,
        request.body,
        key,
      );
      return reply.status(201).send(result.body);
    },
  );

  // Exhaustiveness: every Lane is a valid :lane param value (keeps the constant wired into the route module).
  void LANES;
}
