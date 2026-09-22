// W1-13: the in-memory API substitute (W0-02 section 1: `fixtures/src/substitutes/api/`; section 7: every W1
// shape; W0-05 section 6 "Substitute (W1-13)"). `createApiSubstitute()` returns a transport-agnostic `handle`
// that runs the W0-06 section 4 order on every request — session (401) → authorization (403) → existence (404)
// → validation (422) → idempotency → expected version (409) → apply — and answers with the W0-06 8.2 envelope.
//
// Authorization is not re-implemented: the substitute calls W1-01's `authorizeRequest`, which calls the W1-00
// policy rows and `authorize`, so a request the matrix denies gets the same 403 (and the same 404 for an
// all_cases holder) from the substitute as from the real server, and the substitute never adds a row of its own.
// The SPA never sees any of this logic: it only receives the responses (W0-05 "UI convenience": never authority).
//
// Dev and test only. This module references SUBSTITUTE_MARKER so `npm run check:substitute-absent` proves it
// is absent from web/dist and server/dist; a substitute run is never acceptance evidence (W0-02 section 8.1).

import { randomUUID } from 'node:crypto';
import { authorizeRequest, type AuthzResult, type RouteAuth } from '@rai/server/authz/middleware';
import type { CaseScopeFacts } from '@rai/server/authz/policy';
import { buildLogLine, type Emitter } from '@rai/server/observability/log';
import { isContractError, internalErrorResponse } from '@rai/shared/errors';
import type { CorrelationId } from '@rai/shared/ids';
import type { Principal } from '@rai/shared/schemas/auth';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
import { SubstituteStore } from './store.js';
import {
  SESSION_COOKIE,
  baseHeaders,
  error,
  fromContractError,
  parseCookies,
  routeNotFound,
  splitUrl,
} from './support.js';
import type {
  ApiSubstituteOptions,
  SubstituteRequest,
  SubstituteResponse,
  SubstituteSession,
} from './types.js';
import { authRoutes } from './routes-auth.js';
import { caseRoutes } from './routes-cases.js';
import { artifactRoutes } from './routes-artifacts.js';
import { packRoutes } from './routes-pack.js';
import { versionRoutes } from './routes-versions.js';
import { reviewRoutes } from './routes-review.js';
import { queueRoutes } from './routes-queue.js';

export interface ResolvedOptions {
  now: () => Date;
  uploadMaxFileBytes: number;
  uploadMaxPackBytes: number;
  sessionAbsoluteHours: number;
  qcTimeoutMs: number;
}

export interface RouteContext {
  store: SubstituteStore;
  options: ResolvedOptions;
  correlationId: CorrelationId;
  request: SubstituteRequest;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  session?: SubstituteSession;
  principal?: Principal;
  authz?: AuthzResult;
  emitter: Emitter;
}

export interface RouteDefinition {
  method: string;
  /** Path template with `:name` parameters, matched whole: '/api/cases/:caseId/versions/:versionId'. */
  path: string;
  auth: RouteAuth;
  handler: (ctx: RouteContext) => SubstituteResponse | Promise<SubstituteResponse>;
}

export interface ApiSubstitute {
  /** Answers one request; never throws (an unexpected failure is the 500 `internal_error` envelope). */
  handle(request: SubstituteRequest): Promise<SubstituteResponse>;
  /** Rebuilds the fixture state and forgets every session, upload, version and idempotency record. */
  reset(): void;
  readonly store: SubstituteStore;
  readonly marker: typeof SUBSTITUTE_MARKER;
}

// The marker literal is spelled out here on purpose: a tsc-compiled copy of this module carries the string itself,
// not only an import of it, so `check-substitute-absent` trips on an unbundled leak into server/dist as well.
if ((SUBSTITUTE_MARKER as string) !== 'RAI_DESK_SUBSTITUTE_MARKER')
  throw new Error('substitute marker mismatch');

const DEFAULTS: ResolvedOptions = {
  now: () => new Date(),
  uploadMaxFileBytes: 26_214_400, // .env.example UPLOAD_MAX_FILE_BYTES (W0-08 section 3)
  uploadMaxPackBytes: 157_286_400, // UPLOAD_MAX_PACK_BYTES
  sessionAbsoluteHours: 12, // RAI_SESSION_ABSOLUTE_HOURS
  qcTimeoutMs: 10_000, // server QC_TIMEOUT_MS
};

interface CompiledRoute extends RouteDefinition {
  pattern: RegExp;
  names: string[];
}

function compile(route: RouteDefinition): CompiledRoute {
  const names: string[] = [];
  const source = route.path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { ...route, pattern: new RegExp(`^${source}/?$`), names };
}

/** The route table, specific paths before parametric ones so `/versions/latest` never binds `:versionId`. */
export function routeTable(): RouteDefinition[] {
  return [
    ...authRoutes(),
    ...caseRoutes(),
    ...queueRoutes(),
    ...artifactRoutes(),
    ...packRoutes(),
    ...versionRoutes(),
    ...reviewRoutes(),
  ];
}

export function createApiSubstitute(options: ApiSubstituteOptions = {}): ApiSubstitute {
  const resolved: ResolvedOptions = { ...DEFAULTS, ...definedOnly(options) };
  const store = new SubstituteStore();
  const routes = routeTable().map(compile);

  // The W0-10 allow-list emitter over an in-memory sink: lines are kept for tests, never written anywhere.
  const emitter: Emitter = {
    log(event, fields, level) {
      const line = buildLogLine(
        event,
        fields,
        level === undefined
          ? { strict: false, now: resolved.now() }
          : { strict: false, level, now: resolved.now() },
      );
      store.logLines.push({ event, fields: { ...(fields as Record<string, unknown>) } });
      return line;
    },
  };

  // The pre-authorization read (W0-05 middleware): three columns by case id, or by artifact id through the case.
  const facts = {
    byCaseId(caseId: string): Promise<CaseScopeFacts | undefined> {
      const stored = store.cases.get(caseId);
      return Promise.resolve(
        stored === undefined
          ? undefined
          : {
              caseId: stored.caseId,
              ownerSubjectId: stored.fields.businessOwner,
              businessUnitId: stored.fields.businessUnitId,
            },
      );
    },
    byArtifactId(artifactId: string): Promise<CaseScopeFacts | undefined> {
      const artifact = store.artifacts.get(artifactId);
      return artifact === undefined ? Promise.resolve(undefined) : this.byCaseId(artifact.ref.caseId);
    },
  };

  function liveSession(request: SubstituteRequest): SubstituteSession | undefined {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token === undefined || token === '') return undefined;
    const session = store.sessions.get(token);
    if (session === undefined || session.revoked) return undefined;
    if (session.expiresAt.getTime() <= resolved.now().getTime()) return undefined;
    return session;
  }

  async function handle(request: SubstituteRequest): Promise<SubstituteResponse> {
    const correlationId = randomUUID() as CorrelationId; // always server-minted; a client header is never read
    try {
      const { path, query } = splitUrl(request.url);
      const method = request.method.toUpperCase();
      let matched: CompiledRoute | undefined;
      let params: Record<string, string> = {};
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = route.pattern.exec(path);
        if (m === null) continue;
        matched = route;
        params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(m[i + 1] ?? '')]));
        break;
      }
      if (matched === undefined) return routeNotFound(correlationId);

      const ctx: RouteContext = {
        store,
        options: resolved,
        correlationId,
        request,
        path,
        query,
        params,
        emitter,
      };

      // 1. Session (401 before anything else, W0-06 step 1).
      const session = liveSession(request);
      if (session !== undefined) {
        ctx.session = session;
        ctx.principal = session.principal;
      }
      if (matched.auth.kind !== 'public' && ctx.principal === undefined)
        return error('unauthenticated', correlationId, 401);

      // 2-3. Authorization then existence, through the one helper the real server uses (W0-05 section 6).
      if (matched.auth.kind === 'action' && ctx.principal !== undefined) {
        const ids: { caseId?: string; artifactId?: string; lane?: string } = {};
        if (params.caseId !== undefined) ids.caseId = params.caseId;
        if (params.artifactId !== undefined) ids.artifactId = params.artifactId;
        if (params.lane !== undefined) ids.lane = params.lane;
        ctx.authz = await authorizeRequest({ facts, emitter }, ctx.principal, matched.auth, ids);
      }

      // 4-7. Validation, idempotency, expected version and apply belong to the route.
      return await matched.handler(ctx);
    } catch (err) {
      if (isContractError(err)) return fromContractError(err, correlationId);
      return {
        status: 500,
        headers: { ...baseHeaders(correlationId), 'content-type': 'application/json; charset=utf-8' },
        body: new TextEncoder().encode(JSON.stringify(internalErrorResponse(correlationId))),
      };
    }
  }

  return {
    handle,
    reset: () => store.reset(),
    store,
    marker: SUBSTITUTE_MARKER,
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
