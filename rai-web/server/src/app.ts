// buildApp(deps): the Fastify instance used by main.ts and by tests without listen (W0-02 section 1). W1-00 wired
// the substrate: the W0-10 correlation id (server-minted request id, X-Correlation-Id response header, request
// context), the allow-list logger, and the one error handler that maps a ContractError to the W0-06 8.2 envelope
// and everything else to internal_error. W1-01 adds the cookie parser, the authorization middleware (authz/, the
// only place scope is enforced) and the sign-in surface (identity/routes.ts); a schema validation failure maps to
// 422 invalid_input with field paths (W0-06 8.2). Routes arrive with W1-02 onwards and declare `config.auth`.

import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { InvalidInputError, isContractError, internalErrorResponse } from '@rai/shared/errors';
import type { CorrelationId } from '@rai/shared/ids';
import type { AppConfig } from './config.js';
import { registerAuthorization, type ScopeFactsSource } from './authz/middleware.js';
import type { FixtureIdentityProvider } from './identity/fixture.js';
import { registerAuthRoutes } from './identity/routes.js';
import { cookieNames, type SessionStore } from './identity/session.js';
import type { IdentityAdapter } from './identity/types.js';
import { mintCorrelationId, runWithContext } from './observability/context.js';
import { createEmitter, loggerOptions, type Emitter } from './observability/log.js';

export interface IdentityDeps {
  adapter: IdentityAdapter; // started (start() succeeded) before buildApp is called
  sessionStore: SessionStore;
  facts: ScopeFactsSource;
  fixtureProvider?: FixtureIdentityProvider; // fixture mode only
  now?: () => Date;
}

export interface AppDeps {
  config: Pick<AppConfig, 'nodeEnv' | 'log' | 'trustProxy' | 'publicBaseUrl'>;
  /** Absent only in substrate-level tests that register no route; main.ts always passes it. */
  identity?: IdentityDeps;
}

export interface App {
  fastify: FastifyInstance;
  emitter: Emitter;
}

/** Fastify's ajv failure → the W0-06 8.2 invalid_input envelope: field paths only, never values. */
function validationToInvalidInput(error: FastifyError): InvalidInputError {
  const fields = (error.validation ?? []).map((v) => {
    const path = `${error.validationContext ?? 'body'}${v.instancePath.replaceAll('/', '.')}`;
    const missing =
      v.keyword === 'required' ? (v.params as { missingProperty?: string }).missingProperty : undefined;
    return {
      path: missing === undefined ? path : `${path}.${missing}`,
      messageKey: v.keyword === 'required' ? 'validation.required' : 'validation.not_in_configured_list',
    };
  });
  return new InvalidInputError(fields);
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
    if ((error as FastifyError).validation !== undefined) {
      const invalid = validationToInvalidInput(error as FastifyError);
      void reply.status(invalid.status).send(invalid.toResponse(correlationId));
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

  if (deps.identity !== undefined) {
    const identity = deps.identity;
    void fastify.register(cookie); // parses and sets the cookie; nothing is signed (W0-03 6.3)
    registerAuthorization(fastify, {
      sessionStore: identity.sessionStore,
      sessionPolicy: () => identity.adapter.sessionPolicy(),
      sessionCookieName: cookieNames(deps.config.publicBaseUrl).session,
      facts: identity.facts,
      emitter,
      ...(identity.now === undefined ? {} : { now: identity.now }),
    });
    void fastify.register((instance, _opts, done) => {
      registerAuthRoutes(instance, {
        adapter: identity.adapter,
        sessionStore: identity.sessionStore,
        publicBaseUrl: deps.config.publicBaseUrl,
        emitter,
        ...(identity.fixtureProvider === undefined ? {} : { fixtureProvider: identity.fixtureProvider }),
        ...(identity.now === undefined ? {} : { now: identity.now }),
      });
      done();
    });
  }

  return { fastify, emitter };
}
