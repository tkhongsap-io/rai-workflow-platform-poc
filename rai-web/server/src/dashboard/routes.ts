// W6-13 (W6 plan section 8.1): `GET /api/dashboard`, action `dashboard.view` (every signed-in role, W6-01 rows). The
// scope is applied in SQL by the repository; the read takes no parameter. `request.completed` logs it (section 10).
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { actorOf, authorizedActor } from '../authz/middleware.js';
import type { Db } from '../db/client.js';
import { readDashboard } from './repository.js';

/** No query key is accepted: an unknown one is 422 `invalid_input`, never silently ignored. */
const DashboardQuerySchema = Type.Object({}, { additionalProperties: false });

export function registerDashboardRoutes(fastify: FastifyInstance, deps: { db: Db; now: () => Date }): void {
  fastify.withTypeProvider<TypeBoxTypeProvider>().get(
    '/api/dashboard',
    {
      config: { auth: { kind: 'action', action: 'dashboard.view', target: 'none' } },
      schema: { querystring: DashboardQuerySchema },
    },
    (request) => readDashboard(deps.db, actorOf(authorizedActor(request).principal), deps.now()),
  );
}
