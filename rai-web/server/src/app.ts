// buildApp(deps): the Fastify instance used by main.ts and by tests without listen (W0-02 section 1). W1-00 wired
// the substrate: the W0-10 correlation id (server-minted request id, X-Correlation-Id response header, request
// context), the allow-list logger, and the one error handler that maps a ContractError to the W0-06 8.2 envelope
// and everything else to internal_error. W1-01 adds the cookie parser, the authorization middleware (authz/, the
// only place scope is enforced) and the sign-in surface (identity/routes.ts); a schema validation failure maps to
// 422 invalid_input with field paths (W0-06 8.2). Routes arrive with W1-02 onwards and declare `config.auth`;
// W1-02 registers the case routes (cases/routes.ts) when `cases` deps are given; W1-04 the pack draft routes
// (pack/routes.ts) when `pack` deps are given; W1-05 the submit and version routes (versions/routes.ts) when
// `versions` deps are given. W1-INT registers the SPA (static.ts: web/dist, helmet headers, history fallback)
// when `static` is given; the API routes and the JSON not-found handler are unchanged by it.

import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { createDrain, type Drain } from './shutdown.js';
import { InvalidInputError, isContractError, internalErrorResponse } from '@rai/shared/errors';
import type { CorrelationId } from '@rai/shared/ids';
import type { AppConfig } from './config.js';
import { registerArtifactRoutes, type ArtifactRouteDeps } from './artifacts/routes.js';
import { registerAuthorization, type ScopeFactsSource } from './authz/middleware.js';
import { registerCaseRoutes, type CaseRouteDeps } from './cases/routes.js';
import { registerQueueRoutes } from './queue/routes.js';
import { registerPackRoutes, type PackRouteDeps } from './pack/routes.js';
import { registerVersionRoutes, type VersionRouteDeps } from './versions/routes.js';
import { registerDecideRoutes, type DecideRouteDeps } from './workflow/routes.js';
import { registerFindingsRoutes, type FindingsRouteDeps } from './findings/routes.js';
import { staticPlugin, type StaticOptions } from './static.js';
import type { FixtureIdentityProvider } from './identity/fixture.js';
import { registerAuthRoutes } from './identity/routes.js';
import { cookieNames, type SessionStore } from './identity/session.js';
import type { IdentityAdapter } from './identity/types.js';
import { mintCorrelationId, runWithContext, maybeContext } from './observability/context.js';
import { createEmitter, loggerOptions, type Emitter } from './observability/log.js';
import type { ErrorCategory } from '@rai/shared/schemas/observability';
import { createErrorCapture, type ErrorCapture } from './observability/errors.js';
import {
  registerHealthRoutes,
  registerOperatorRoutes,
  type ObservabilityDeps,
} from './observability/routes.js';

export interface IdentityDeps {
  adapter: IdentityAdapter; // started (start() succeeded) before buildApp is called
  sessionStore: SessionStore;
  facts: ScopeFactsSource;
  fixtureProvider?: FixtureIdentityProvider; // fixture mode only
  now?: () => Date;
}

export interface AppDeps {
  observability?: ObservabilityDeps;
  config: Pick<AppConfig, 'nodeEnv' | 'log' | 'trustProxy' | 'publicBaseUrl'>;
  /** Absent only in substrate-level tests that register no route; main.ts always passes it. */
  identity?: IdentityDeps;
  /** W1-02: the case routes' dependencies (database, configured BUs, subject directory). Needs `identity`. */
  cases?: Omit<CaseRouteDeps, 'emitter'>;
  /** The blob store, database and W0-08 limits for the W1-03 artifact routes; needs `identity`. */
  artifacts?: Omit<ArtifactRouteDeps, 'emitter'>;
  /** W1-04: the pack draft routes' dependencies (database, pack limit, the W0-07 upload hook). Needs `identity`. */
  pack?: Omit<PackRouteDeps, 'emitter'>;
  /** W1-05: the submit and version-navigation routes' dependencies (database). Needs `identity`.
   * `nodeEnv` is taken from `config` when the routes are registered (never from process.env in versions/). */
  versions?: Omit<VersionRouteDeps, 'nodeEnv'>;
  /** W2-02: lane approve / send-back. Needs `identity`. */
  decide?: DecideRouteDeps;
  /** W2-05: findings disposition + lane QC run. Needs `identity`. */
  findings?: Omit<FindingsRouteDeps, 'emitter'>;
  /** W1-INT: the built SPA to serve from web/dist (static.ts); absent when there is no web build (API only). */
  static?: StaticOptions;
  /** Test seam: where the pino lines go instead of stdout, so a suite can assert on emitted events. */
  logStream?: NodeJS.WritableStream;
}

export interface App {
  errors: ErrorCapture;
  fastify: FastifyInstance;
  emitter: Emitter;
  /** W0-04 graceful shutdown (shutdown.ts): the bounded close start.ts and main.ts run instead of `fastify.close()`. */
  drain: Drain;
}

/**
 * Fastify's ajv failure → the W0-06 8.2 invalid_input envelope: field paths only, never values. `required` names
 * the missing key; `additionalProperties` names the unknown key (W0-02 7.3: any key outside CaseWritableFields on
 * PATCH is 422, so the Ajv default `removeAdditional: true`, which would strip it silently, is turned off below).
 */
function validationToInvalidInput(error: FastifyError): InvalidInputError {
  const fields = (error.validation ?? []).map((v) => {
    const path = `${error.validationContext ?? 'body'}${v.instancePath.replaceAll('/', '.')}`;
    const params = v.params as { missingProperty?: string; additionalProperty?: string };
    switch (v.keyword) {
      case 'required':
        return { path: `${path}.${params.missingProperty}`, messageKey: 'validation.required' as const };
      case 'additionalProperties':
        return {
          path: `${path}.${params.additionalProperty}`,
          messageKey: 'validation.unknown_field' as const,
        };
      default:
        return { path, messageKey: 'validation.not_in_configured_list' as const };
    }
  });
  return new InvalidInputError(fields);
}

export function buildApp(deps: AppDeps): App {
  const fastify = Fastify({
    logger:
      deps.logStream === undefined
        ? loggerOptions(deps.config.log)
        : { ...(loggerOptions(deps.config.log) as object), stream: deps.logStream },
    genReqId: () => mintCorrelationId(), // the request id IS the correlation id; a client header is never read
    requestIdHeader: false,
    trustProxy: deps.config.trustProxy,
    logController: new LogController({ disableRequestLogging: true }), // one request.completed line per request (W0-10 3.4), emitted by W3-07's hook
    ajv: { customOptions: { removeAdditional: false } }, // a key an `additionalProperties: false` shape does not list is 422, never stripped
  });
  const emitter = createEmitter(fastify.log, { strict: deps.config.nodeEnv === 'test' });
  const errors = createErrorCapture(emitter);
  const requestErrors = new WeakMap<object, ErrorCategory>();
  const drain = createDrain(fastify); // first hook: every accepted request is counted (shutdown.ts)

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

  fastify.addHook('onResponse', (request, reply, done) => {
    if (
      request.routeOptions.url === '/healthz' ||
      (request.routeOptions.config.observability?.staticAsset === true && reply.statusCode < 400)
    ) {
      done();
      return;
    }
    const context = maybeContext();
    const errorCode = requestErrors.get(request);
    emitter.log(
      'request.completed',
      {
        method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)
          ? request.method
          : 'OTHER',
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        ...(errorCode === undefined ? {} : { errorCode }),
        durationMs: Math.max(0, performance.now() - (context?.startedAt ?? performance.now())),
      },
      reply.statusCode >= 500
        ? 'error'
        : errorCode === 'forbidden' || errorCode === 'unsafe_upload'
          ? 'warn'
          : 'info',
    );
    done();
  });

  fastify.setErrorHandler((error, request, reply) => {
    const correlationId = request.id as CorrelationId;
    if (isContractError(error) && error.code !== 'mail_delivery_failed' && error.code !== 'qc_unavailable') {
      requestErrors.set(request, errors.http(error, request.routeOptions.url).category);
      void reply.status(error.status).send(error.toResponse(correlationId));
      return;
    }
    if ((error as FastifyError).validation !== undefined) {
      const invalid = validationToInvalidInput(error as FastifyError);
      requestErrors.set(request, errors.http(invalid, request.routeOptions.url).category);
      void reply.status(invalid.status).send(invalid.toResponse(correlationId));
      return;
    }
    // W0-06 section 8: Fastify's own body replies are mapped: malformed or empty JSON and an unsupported media
    // type are 422 invalid_input (the content-type parser errors, FST_ERR_CTP_*); nothing else is contract-shaped.
    const code = (error as FastifyError).code;
    if (typeof code === 'string' && code.startsWith('FST_ERR_CTP_')) {
      const invalid = new InvalidInputError([{ path: 'body', messageKey: 'validation.required' }]);
      requestErrors.set(request, errors.http(invalid, request.routeOptions.url).category);
      void reply.status(invalid.status).send(invalid.toResponse(correlationId));
      return;
    }
    requestErrors.set(request, errors.internal(error, request.routeOptions.url).category);
    void reply.status(500).send(internalErrorResponse(correlationId));
  });

  fastify.setNotFoundHandler((request, reply) => {
    requestErrors.set(request, errors.notFound().category);
    void reply.status(404).send({
      error: { code: 'not_found', messageKey: 'error.not_found', correlationId: request.id },
    });
  });

  // W1-INT: the SPA plugin loads first so helmet's headers are inherited by every route scope below (a hook a
  // plugin adds to the root is copied into the children created after it). Its `/*` fallback never shadows an
  // API route: find-my-way prefers the static and parametric routes whatever the registration order.
  if (deps.static !== undefined) void fastify.register(staticPlugin(deps.static));

  const observability = deps.observability;
  if (observability !== undefined) registerHealthRoutes(fastify, () => observability.readiness(), emitter);

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
    if (deps.observability !== undefined) registerOperatorRoutes(fastify, deps.observability, errors);
    const caseDeps = deps.cases;
    if (caseDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerCaseRoutes(instance, { ...caseDeps, emitter });
        registerQueueRoutes(instance, { db: caseDeps.db });
        done();
      });
    }
    if (deps.artifacts !== undefined) registerArtifactRoutes(fastify, { ...deps.artifacts, emitter });
    const packDeps = deps.pack;
    if (packDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerPackRoutes(instance, { ...packDeps, emitter, errors });
        done();
      });
    }
    const versionDeps = deps.versions;
    if (versionDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerVersionRoutes(instance, { ...versionDeps, nodeEnv: deps.config.nodeEnv });
        done();
      });
    }
    const decideDeps = deps.decide;
    if (decideDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerDecideRoutes(instance, decideDeps);
        done();
      });
    }
    const findingsDeps = deps.findings;
    if (findingsDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerFindingsRoutes(instance, { ...findingsDeps, emitter, errors });
        done();
      });
    }
  }

  return { fastify, emitter, errors, drain };
}
