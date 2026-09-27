// buildApp(deps): the Fastify instance main.ts runs and tests inject into without listening (W0-02 section 1).
// Every request gets a server-minted correlation id (W0-10), the allow-list logger and one error handler that maps
// a ContractError to the W0-06 8.2 envelope and everything else to internal_error. The authorization middleware
// (authz/) is the only place scope is enforced, and every route must declare `config.auth`. Each route group is
// registered only when its deps are given; the SPA (static.ts) leaves the API routes and the JSON 404 unchanged.

import { registerDailyDigest } from './notifications/digest-runtime.js';
import type { DigestDeps } from './notifications/digest.js';
import { createNotifications, type NotificationDeps } from './notifications/service.js';
import { registerNotifications } from './notifications/runtime.js';
import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { createDrain, type Drain } from './shutdown.js';
import { InvalidInputError, isContractError, internalErrorResponse } from '@rai/shared/errors';
import type { CorrelationId } from '@rai/shared/ids';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { registerArtifactRoutes, type ArtifactRouteDeps } from './artifacts/routes.js';
import { registerAuthorization, type ScopeFactsSource } from './authz/middleware.js';
import { registerCaseRoutes, type CaseRouteDeps } from './cases/routes.js';
import { registerQueueRoutes } from './queue/routes.js';
import { registerDashboardRoutes } from './dashboard/routes.js';
import { registerPackRoutes, type PackRouteDeps } from './pack/routes.js';
import { registerVersionRoutes, type VersionRouteDeps } from './versions/routes.js';
import { createSubmitTrigger } from './qc/submit-trigger.js';
import { createUploadTrigger } from './pack/qc-trigger.js';
import type { QcOrchestratorDeps } from './qc/orchestrator.js';
import { registerDecideRoutes, type DecideRouteDeps } from './workflow/routes.js';
import { registerFindingsRoutes, type FindingsRouteDeps } from './findings/routes.js';
import { staticPlugin, type StaticOptions } from './static.js';
import type { FixtureIdentityProvider } from './identity/fixture.js';
import { registerAuthRoutes, type SubjectProfileHook } from './identity/routes.js';
import { cookieNames, type SessionStore } from './identity/session.js';
import type { IdentityAdapter } from './identity/types.js';
import { maybeContext, mintCorrelationId, runWithContext } from './observability/context.js';
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
  /** W7-06: told about every committed subject profile; W7-07 binds the mail recipient directory's refresh. */
  profiles?: SubjectProfileHook;
}

/** What buildApp injects into every route group, so no group can hold a different database or clock. */
type Injected = 'db' | 'now' | 'emitter' | 'errors';
type QcBinding = Pick<QcOrchestratorDeps, 'runner' | 'timeoutMs'>;

export interface AppDeps {
  /** The database every route group reads. Absent only in substrate tests that register no such group. */
  db?: Db;
  /** The one application clock; defaults to the wall clock. */
  now?: () => Date;
  observability?: Omit<ObservabilityDeps, 'db'>;
  /** Local daily producer; uses the same drain and single notification dispatcher. */
  digest?: Omit<DigestDeps, Injected>;
  /** The single post-commit mail dispatcher for case mail, digest mail and retries. */
  notifications?: Omit<NotificationDeps, Injected>;
  config: Pick<AppConfig, 'nodeEnv' | 'log' | 'trustProxy' | 'publicBaseUrl'>;
  /** Absent only in substrate-level tests that register no route; main.ts always passes it. */
  identity?: IdentityDeps;
  /** The case routes' dependencies (configured BUs, subject directory). Needs `identity`. */
  cases?: Omit<CaseRouteDeps, Injected>;
  /** The blob store and W0-08 limits for the artifact routes. Needs `identity`. */
  artifacts?: Omit<ArtifactRouteDeps, Injected>;
  /**
   * The pack draft routes' dependencies (pack limit, the W0-07 upload hook). `qc` binds the upload-triggered QC run
   * (W4-04), tracked by the drain like the submit trigger; without it `uploadTrigger` (default: no-op) is the hook.
   * Needs `identity`.
   */
  pack?: Omit<PackRouteDeps, 'drain' | Injected> & { qc?: QcBinding };
  /** The submit and version-navigation routes; `qc` binds the submit-triggered QC run. Needs `identity`. */
  versions?: Omit<VersionRouteDeps, 'afterSubmit' | Injected> & { qc?: QcBinding };
  /** Lane approve / send-back. Needs `identity`. */
  decide?: Omit<DecideRouteDeps, Injected>;
  /** Findings disposition and the lane QC run. Needs `identity`. */
  findings?: Omit<FindingsRouteDeps, 'qc' | Injected> & { qc?: QcBinding };
  /** The built SPA to serve from web/dist (static.ts); absent when there is no web build (API only). */
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
  const now = deps.now ?? (() => new Date());
  const dbAndClock = (): { db: Db; now: () => Date } => {
    if (deps.db === undefined) throw new Error('buildApp: a route group needs deps.db');
    return { db: deps.db, now };
  };
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
    const errorCode = requestErrors.get(request);
    const actor = maybeContext()?.actor;
    emitter.log(
      'request.completed',
      {
        method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)
          ? request.method
          : 'OTHER',
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(actor === undefined
          ? {}
          : {
              actorSubjectId: actor.subjectId,
              ...(actor.roles.length === 1 ? { actorRole: actor.roles[0] } : {}),
            }),
        durationMs: reply.elapsedTime, // Fastify freezes this at response finish, before onResponse hooks.
      },
      reply.statusCode >= 500
        ? 'error'
        : errorCode === 'forbidden' || errorCode === 'unsafe_upload'
          ? 'warn'
          : 'info',
    );
    done();
  });

  // Completion logging must precede hooks that await background delivery.
  if (deps.digest !== undefined)
    registerDailyDigest(fastify, { ...deps.digest, ...dbAndClock(), emitter }, drain, (error) => {
      errors.internal(error);
    });
  if (deps.notifications !== undefined)
    registerNotifications(
      fastify,
      createNotifications({ ...deps.notifications, ...dbAndClock(), emitter, errors }),
      emitter,
      drain,
      errors,
    );

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
  if (observability !== undefined) {
    registerHealthRoutes(fastify, () => observability.readiness(), emitter);
    // W0-04: business routes fail closed on an unapplied migration; the reader's 5 s cache keeps this off the DB.
    fastify.addHook('onRequest', async (request, reply) => {
      const route = request.routeOptions.url;
      if (route === '/healthz' || route === '/readyz') return;
      if ((await observability.readiness()).store.migrations === 'pending')
        return reply.code(503).send(internalErrorResponse(request.id));
    });
  }

  if (deps.identity !== undefined) {
    const identity = deps.identity;
    void fastify.register(cookie); // parses and sets the cookie; nothing is signed (W0-03 6.3)
    registerAuthorization(fastify, {
      sessionStore: identity.sessionStore,
      sessionPolicy: () => identity.adapter.sessionPolicy(),
      sessionCookieName: cookieNames(deps.config.publicBaseUrl).session,
      facts: identity.facts,
      emitter,
      now,
    });
    void fastify.register((instance, _opts, done) => {
      registerAuthRoutes(instance, {
        adapter: identity.adapter,
        sessionStore: identity.sessionStore,
        publicBaseUrl: deps.config.publicBaseUrl,
        emitter,
        ...(identity.fixtureProvider === undefined ? {} : { fixtureProvider: identity.fixtureProvider }),
        ...(identity.profiles === undefined ? {} : { profiles: identity.profiles }),
        errors,
        now,
      });
      done();
    });
    if (deps.observability !== undefined)
      registerOperatorRoutes(fastify, { ...deps.observability, db: dbAndClock().db }, errors);
    const caseDeps = deps.cases;
    if (caseDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerCaseRoutes(instance, { ...caseDeps, ...dbAndClock(), emitter });
        registerQueueRoutes(instance, dbAndClock());
        registerDashboardRoutes(instance, dbAndClock());
        done();
      });
    }
    if (deps.artifacts !== undefined)
      registerArtifactRoutes(fastify, { ...deps.artifacts, ...dbAndClock(), emitter });
    const packDeps = deps.pack;
    if (packDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        const { qc, ...routeDeps } = packDeps;
        registerPackRoutes(instance, {
          ...routeDeps,
          ...dbAndClock(),
          emitter,
          errors,
          drain,
          ...(qc === undefined
            ? {}
            : { uploadTrigger: createUploadTrigger({ ...qc, ...dbAndClock(), emitter, errors }) }),
        });
        done();
      });
    }
    const versionDeps = deps.versions;
    if (versionDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        const { qc, ...routeDeps } = versionDeps;
        registerVersionRoutes(instance, {
          ...routeDeps,
          ...dbAndClock(),
          emitter, // W5-05: the risk.proposal.* lines
          errors, // W5-05: a risk engine error
          ...(qc === undefined
            ? {}
            : { afterSubmit: createSubmitTrigger({ ...qc, ...dbAndClock(), emitter, errors }, drain) }),
        });
        done();
      });
    }
    const decideDeps = deps.decide;
    if (decideDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerDecideRoutes(instance, { ...decideDeps, ...dbAndClock() });
        done();
      });
    }
    const findingsDeps = deps.findings;
    if (findingsDeps !== undefined) {
      void fastify.register((instance, _opts, done) => {
        registerFindingsRoutes(instance, { ...findingsDeps, ...dbAndClock(), emitter, errors });
        done();
      });
    }
  }

  return { fastify, emitter, errors, drain };
}
