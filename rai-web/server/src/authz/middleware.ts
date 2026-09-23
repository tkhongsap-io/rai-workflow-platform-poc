// W0-05 section 6 "Middleware (W1-01, Fastify)": the one place scope is enforced (W0-02 section 1.1). Every route
// declares `config.auth`; an `onRoute` hook rejects a route without one at start-up. The W0-06 section 4 order,
// session → authorization → existence, runs before validation: the session check is an `onRequest` hook (401
// before anything else, including body parsing errors) and the policy check a `preParsing` hook (403 before the
// body is parsed, so before any 422 and before a body-parse error; route params are resolved by then, and a denied
// actor never makes the server parse its payload). Loading CaseScopeFacts is the only pre-authorization read
// (three columns); the facts lookup, the
// `authorize` call and the 404 answer for an allowed-but-unresolved id are one helper so the 403 and 404 paths
// cannot diverge. A deny emits `authz.denied` (W0-10 3.3) and no audit row; a 401 never reaches `authorize`.
// W2-02 adds target `lane` (:caseId + :lane → { kind: 'lane', facts, lane }).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@rai/shared/errors';
import { LANES, type Lane } from '@rai/shared/constants';
import type { Principal } from '@rai/shared/schemas/auth';
import type { SessionRecord, SessionStore } from '../identity/session.js';
import { maybeContext } from '../observability/context.js';
import type { Emitter } from '../observability/log.js';
import {
  authorize,
  type Action,
  type Actor,
  type CaseScopeFacts,
  type Decision,
  type DenyReason,
  type Target,
} from './policy.js';

export type RouteAuth =
  | { kind: 'public' } // no session needed: sign-in surface, health probes
  | { kind: 'session' } // a live session, no policy action: GET /api/session, sign-out, locale
  | { kind: 'action'; action: Action; target: 'none' } // case.list, config.*, audit.read, the role step of case.create
  | { kind: 'action'; action: Action; target: 'case' } // :caseId → CaseScopeFacts
  | { kind: 'action'; action: Action; target: 'artifact' } // :artifactId → artifact.case_id → CaseScopeFacts
  | { kind: 'action'; action: Action; target: 'lane' }; // :caseId + :lane → lane target (W2-02)

export interface AuthzResult {
  decision: Decision & { allow: true };
  facts: CaseScopeFacts | undefined; // undefined for target 'none'
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: RouteAuth;
  }
  interface FastifyRequest {
    session?: SessionRecord;
    principal?: Principal;
    authz?: AuthzResult;
  }
}

/** The pre-authorization read: three columns by case id, or by artifact id through artifact.case_id. */
export interface ScopeFactsSource {
  byCaseId(caseId: string): Promise<CaseScopeFacts | undefined>;
  byArtifactId(artifactId: string): Promise<CaseScopeFacts | undefined>;
}

export interface AuthorizationDeps {
  sessionStore: SessionStore;
  sessionPolicy: () => { idleMinutes: number };
  sessionCookieName: string;
  facts: ScopeFactsSource;
  emitter: Emitter;
  now?: () => Date;
}

export class RouteWithoutAuthDeclaration extends Error {
  constructor(method: string, url: string) {
    super(`route ${method} ${url} declares no config.auth (W0-05 middleware rule)`);
    this.name = 'RouteWithoutAuthDeclaration';
  }
}

/** Minimal RFC 6265 cookie-header parse for the session token only (values are opaque base64url, never quoted). */
export function parseCookieHeader(header: string | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== '' && out[name] === undefined) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANE_SET: ReadonlySet<string> = new Set(LANES);
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function actorOf(principal: Principal): Actor {
  return { subjectId: principal.subjectId, roles: principal.roles };
}

function paramOf(request: FastifyRequest, name: string): string | undefined {
  const params = request.params as Record<string, unknown> | undefined;
  const value = params?.[name];
  return typeof value === 'string' ? value : undefined;
}

function isLane(value: string | undefined): value is Lane {
  return value !== undefined && LANE_SET.has(value);
}

function emitDenied(
  deps: Pick<AuthorizationDeps, 'emitter'>,
  actor: Actor,
  auth: Extract<RouteAuth, { kind: 'action' }> | undefined, // undefined: a session route, no policy action
  targetId: string | undefined,
  reason: DenyReason | 'cross_site',
): never {
  deps.emitter.log('authz.denied', {
    action: auth?.action,
    targetType: auth?.target,
    targetId,
    actorSubjectId: actor.subjectId,
    actorRole: actor.roles.map((r) => r.role).join(','),
    reason,
  });
  throw new ForbiddenError();
}

/**
 * The helper W0-05 names: facts lookup → authorize → 404 only after an allow. Throws ForbiddenError (403, after
 * emitting authz.denied) or NotFoundError (404); returns the decision and facts otherwise.
 */
export async function authorizeRequest(
  deps: Pick<AuthorizationDeps, 'facts' | 'emitter'>,
  principal: Principal,
  auth: Extract<RouteAuth, { kind: 'action' }>,
  ids: { caseId?: string; artifactId?: string; lane?: string },
): Promise<AuthzResult> {
  const actor = actorOf(principal);
  let target: Target;
  let facts: CaseScopeFacts | undefined;
  let targetId: string | undefined;

  if (auth.target === 'none') {
    target = { kind: 'none' };
  } else if (auth.target === 'lane') {
    targetId = ids.caseId;
    if (ids.caseId !== undefined && UUID.test(ids.caseId)) {
      facts = await deps.facts.byCaseId(ids.caseId);
    }
    if (facts === undefined) {
      target = { kind: 'unresolved' };
    } else if (!isLane(ids.lane)) {
      // Unknown :lane: still authorize so Admin → role and a reviewer → lane (params are not a body 422).
      target = { kind: 'lane', facts, lane: 'dpo' };
      const probe = authorize(actor, auth.action, target);
      if (!probe.allow) emitDenied(deps, actor, auth, targetId, probe.reason);
      emitDenied(deps, actor, auth, targetId, 'lane');
    } else {
      target = { kind: 'lane', facts, lane: ids.lane };
    }
  } else {
    const id = auth.target === 'case' ? ids.caseId : ids.artifactId;
    targetId = id;
    if (id !== undefined && UUID.test(id)) {
      facts = auth.target === 'case' ? await deps.facts.byCaseId(id) : await deps.facts.byArtifactId(id);
    }
    target = facts === undefined ? { kind: 'unresolved' } : { kind: 'case', facts };
  }

  const decision = authorize(actor, auth.action, target);
  if (!decision.allow) emitDenied(deps, actor, auth, targetId, decision.reason);
  if (target.kind === 'unresolved') {
    throw new NotFoundError(auth.target === 'artifact' ? 'artifact' : 'case');
  }
  return { decision, facts };
}

/** Registers the onRoute guard and the two global hooks. Call once, before any route, after @fastify/cookie. */
export function registerAuthorization(fastify: FastifyInstance, deps: AuthorizationDeps): void {
  const now = deps.now ?? (() => new Date());

  fastify.addHook('onRoute', (route) => {
    if (route.config?.auth === undefined)
      throw new RouteWithoutAuthDeclaration(String(route.method), route.url);
  });

  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const auth = request.routeOptions.config.auth;
    if (auth === undefined) return; // no route matched: the not-found handler answers
    // W0-10: probes must survive a session-store outage, even with a browser cookie.
    if (
      auth.kind === 'public' &&
      (request.routeOptions.url === '/healthz' || request.routeOptions.url === '/readyz')
    )
      return;
    // @fastify/cookie's own onRequest hook may run after this one (plugins load after root hooks are added).
    const cookies =
      (request.cookies as Record<string, string | undefined> | null) ??
      parseCookieHeader(request.headers.cookie);
    const token = cookies[deps.sessionCookieName];
    if (typeof token === 'string' && token !== '') {
      const session = await deps.sessionStore.resolve(token, deps.sessionPolicy(), now());
      if (session !== undefined) {
        request.session = session;
        request.principal = session.principal;
        const ctx = maybeContext();
        if (ctx !== undefined)
          ctx.actor = { subjectId: session.subjectId, roles: session.principal.roles.map((r) => r.role) };
      }
    }
    if (auth.kind === 'public') return;
    if (request.principal === undefined) throw new UnauthenticatedError(); // 401 before anything else
    // CSRF: SameSite=Lax still sends the cookie on same-site requests (another loopback port, a sibling subdomain),
    // so a write a browser marks as not same-origin is refused here, before its body is read. An absent header is
    // a non-browser client, which carries no ambient cookie.
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none' && !SAFE_METHODS.has(request.method))
      emitDenied(
        deps,
        actorOf(request.principal),
        auth.kind === 'action' ? auth : undefined,
        undefined,
        'cross_site',
      );
  });

  // preParsing, not preValidation: the body is parsed after this hook, so a wrong-role or out-of-scope actor is 403
  // whatever the body carries (unparsable JSON included) and never gets its payload parsed. The payload stream is
  // returned untouched.
  fastify.addHook('preParsing', async (request: FastifyRequest, _reply: FastifyReply, payload) => {
    const auth = request.routeOptions.config.auth;
    if (auth === undefined || auth.kind !== 'action') return payload;
    if (request.principal === undefined) throw new UnauthenticatedError(); // cannot happen after onRequest; belt and braces
    const ids: { caseId?: string; artifactId?: string; lane?: string } = {};
    const caseId = paramOf(request, 'caseId');
    const artifactId = paramOf(request, 'artifactId');
    const lane = paramOf(request, 'lane');
    if (caseId !== undefined) ids.caseId = caseId;
    if (artifactId !== undefined) ids.artifactId = artifactId;
    if (lane !== undefined) ids.lane = lane;
    request.authz = await authorizeRequest(deps, request.principal, auth, ids);
    return payload;
  });
}
