// W1-13: the W0-02 section 7.2 sign-in surface as the real server serves it in `fixture` mode (W1-01a): the two
// `/api/session*` routes, sign-out, the picker list and the fixture sign-in. `POST /auth/sign-in` and
// `GET /auth/callback` do not exist in fixture mode, so the substitute answers 404 for them like the app's
// not-found handler (no route is registered). No password, no provider: the fixture table is the identity.

import { randomBytes } from 'node:crypto';
import { ContractError, ForbiddenError, UnauthenticatedError } from '@rai/shared/errors';
import {
  FixtureSignInRequestSchema,
  SessionLocaleRequestSchema,
  type FixtureSignInRequest,
  type Principal,
  type SessionInfo,
  type SessionLocaleRequest,
} from '@rai/shared/schemas/auth';
import type { RouteContext, RouteDefinition } from './handler.js';
import {
  assertValid,
  clearedSessionCookie,
  json,
  noContent,
  parseJsonBody,
  sessionCookie,
} from './support.js';
import type { SubstituteSession } from './types.js';

/** W0-02 7.2: an unknown fixture user is 404 not_found with the plain envelope (mirrors W1-01's route). */
class FixtureUserUnknownError extends ContractError<'not_found'> {
  readonly code = 'not_found' as const;
  constructor() {
    super();
  }
}

export function sessionInfo(session: SubstituteSession): SessionInfo {
  return {
    principal: session.principal,
    identityMode: 'fixture',
    expiresAt: session.expiresAt.toISOString(),
    locale: session.locale,
  };
}

export function createSession(ctx: RouteContext, principal: Principal): SubstituteSession {
  const now = ctx.options.now();
  const session: SubstituteSession = {
    token: randomBytes(32).toString('base64url'),
    principal,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ctx.options.sessionAbsoluteHours * 60 * 60 * 1000),
    locale: 'th', // D12 default
    revoked: false,
  };
  ctx.store.sessions.set(session.token, session);
  ctx.emitter.log('auth.signin.succeeded', {
    identityMode: 'fixture',
    actorSubjectId: principal.subjectId,
    roles: principal.roles.map((r) => r.role),
  });
  return session;
}

export function authRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/api/session',
      auth: { kind: 'session' },
      handler: (ctx) => {
        if (ctx.session === undefined) throw new UnauthenticatedError();
        return json(200, ctx.correlationId, sessionInfo(ctx.session));
      },
    },
    {
      method: 'POST',
      path: '/api/session/locale',
      auth: { kind: 'session' },
      handler: (ctx) => {
        if (ctx.session === undefined) throw new UnauthenticatedError();
        const body = parseJsonBody(ctx.request);
        assertValid(SessionLocaleRequestSchema, body);
        ctx.session.locale = (body as SessionLocaleRequest).locale;
        return noContent(ctx.correlationId);
      },
    },
    {
      method: 'POST',
      path: '/auth/sign-out',
      auth: { kind: 'session' },
      handler: (ctx) => {
        if (ctx.session === undefined) throw new UnauthenticatedError();
        const site = ctx.request.headers['sec-fetch-site'];
        if (site !== 'same-origin' && site !== 'none') throw new ForbiddenError(); // W0-03 6.1 CSRF rule
        ctx.session.revoked = true;
        return noContent(ctx.correlationId, { 'set-cookie': clearedSessionCookie() });
      },
    },
    {
      method: 'GET',
      path: '/auth/fixture/users',
      auth: { kind: 'public' },
      handler: (ctx) =>
        json(200, ctx.correlationId, {
          users: ctx.store.users.map((u) => ({
            fixtureUserId: u.fixtureUserId,
            displayName: u.displayName,
            roles: [...u.roles],
          })),
        }),
    },
    {
      method: 'POST',
      path: '/auth/fixture/sign-in',
      auth: { kind: 'public' },
      handler: (ctx) => {
        const body = parseJsonBody(ctx.request);
        assertValid(FixtureSignInRequestSchema, body);
        const user = ctx.store.findUser((body as FixtureSignInRequest).fixtureUserId);
        if (user === undefined) throw new FixtureUserUnknownError();
        const principal: Principal = {
          subjectId: user.subjectId,
          displayName: user.displayName,
          email: user.email,
          roles: user.roles.map((r) => structuredClone(r)), // a fresh copy: never drops a role (W0-03 invariant 5)
        };
        const session = createSession(ctx, principal);
        return json(200, ctx.correlationId, sessionInfo(session), {
          'set-cookie': sessionCookie(session.token, session.expiresAt),
        });
      },
    },
  ];
}
