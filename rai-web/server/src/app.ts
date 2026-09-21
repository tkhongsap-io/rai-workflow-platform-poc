// buildApp(deps): the Fastify instance used by main.ts and by tests without listen (W0-02 section 1). W1-00 wires
// the substrate only: the W0-10 correlation id (server-minted request id, X-Correlation-Id response header, request
// context), the allow-list logger, and the one error handler that maps a ContractError to the W0-06 8.2 envelope
// and everything else to internal_error. No route exists yet: W1-01 adds the first.

import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { isContractError, internalErrorResponse } from '@rai/shared/errors';
import type { CorrelationId } from '@rai/shared/ids';
import type { AppConfig } from './config.js';
import { mintCorrelationId, runWithContext } from './observability/context.js';
import { createEmitter, loggerOptions, type Emitter } from './observability/log.js';

export interface AppDeps {
  config: Pick<AppConfig, 'nodeEnv' | 'log' | 'trustProxy'>;
}

export interface App {
  fastify: FastifyInstance;
  emitter: Emitter;
}

export function buildApp(deps: AppDeps): App {
  const fastify = Fastify({
    logger: loggerOptions(deps.config.log),
    genReqId: () => mintCorrelationId(), // the request id IS the correlation id; a client header is never read
    requestIdHeader: false,
    trustProxy: deps.config.trustProxy,
    logController: new LogController({ disableRequestLogging: true }), // one request.completed line per request (W0-10 3.4), emitted by W3-07's hook
  });
  const emitter = createEmitter(fastify.log, { strict: deps.config.nodeEnv === 'test' });

  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header('X-Correlation-Id', request.id);
    void reply.header('Cache-Control', 'no-store');
    const route = request.routeOptions?.url;
    void runWithContext(
      route === undefined
        ? { correlationId: request.id, startedAt: performance.now() }
        : { correlationId: request.id, startedAt: performance.now(), route },
      () => {
        done();
        return Promise.resolve();
      },
    );
  });

  fastify.setErrorHandler((error, request, reply) => {
    const correlationId = request.id as CorrelationId;
    if (isContractError(error)) {
      void reply.status(error.status).send(error.toResponse(correlationId));
      return;
    }
    request.log.error({ err: { name: (error as Error).name, message: 'redacted' } }, 'internal_error');
    void reply.status(500).send(internalErrorResponse(correlationId));
  });

  fastify.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'not_found', messageKey: 'error.not_found', correlationId: request.id },
    });
  });

  return { fastify, emitter };
}
