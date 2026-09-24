import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { QueueQuerySchema } from '@rai/shared/schemas/queue';
import { actorOf, authorizedActor } from '../authz/middleware.js';
import type { Db } from '../db/client.js';
import { readQueue } from './repository.js';

export function registerQueueRoutes(fastify: FastifyInstance, deps: { db: Db }): void {
  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    '/api/queue',
    {
      config: { auth: { kind: 'action', action: 'case.list', target: 'none' } },
      schema: { querystring: QueueQuerySchema },
    },
    (request) => readQueue(deps.db, actorOf(authorizedActor(request).principal), request.query),
  );
}
