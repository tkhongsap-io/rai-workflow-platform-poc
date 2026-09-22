import type { FastifyInstance } from 'fastify';
import {
  ReadinessReportSchema,
  DeskHealthReportSchema,
  type ReadinessReport,
} from '@rai/shared/schemas/observability';
import type { Db } from '../db/client.js';
import { PROCESS_ID } from './context.js';
import type { ErrorCapture } from './errors.js';
import type { Emitter } from './log.js';
import { readDeskHealth } from './operator.js';

export interface ObservabilityDeps {
  readiness(): Promise<ReadinessReport>;
  db: Db;
}
export function registerHealthRoutes(
  app: FastifyInstance,
  read: ObservabilityDeps['readiness'],
  emitter: Emitter,
): void {
  app.get('/healthz', { config: { auth: { kind: 'public' } } }, () => ({
    status: 'alive',
    processId: PROCESS_ID,
  }));
  app.get(
    '/readyz',
    {
      config: { auth: { kind: 'public' } },
      schema: { response: { 200: ReadinessReportSchema, 503: ReadinessReportSchema } },
    },
    async (_request, reply) => {
      const report = await read();
      emitter.log('health.readiness', { status: report.status, report });
      return reply.code(report.status === 'ready' ? 200 : 503).send(report);
    },
  );
}
export function registerOperatorRoutes(
  app: FastifyInstance,
  deps: ObservabilityDeps,
  errors: ErrorCapture,
): void {
  app.get(
    '/api/operator/desk-health',
    {
      config: { auth: { kind: 'action', action: 'operator.view', target: 'none' } },
      schema: { response: { 200: DeskHealthReportSchema } },
    },
    async () => readDeskHealth(deps.db, await deps.readiness(), errors.counters()),
  );
}
