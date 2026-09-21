// W0-03 section 6.1 / W0-02 section 7.2: the sign-in surface. `/auth/*` and the two `/api/session*` routes, with
// exactly the methods, bodies and status codes W0-02 records. The fixture routes are mounted only when the adapter
// runs in fixture mode; in every other mode they do not exist (404 not_found from the app's not-found handler).
// Every response body is the W0-06 8.2 envelope or a W0-02 7.2 shape; refused sign-ins share one body per code.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ContractError, ForbiddenError, InvalidInputError, UnauthenticatedError } from '@rai/shared/errors';
import {
  FixtureSignInRequestSchema,
  FixtureUsersResponseSchema,
  SessionInfoSchema,
  SessionLocaleRequestSchema,
  SignInRequestSchema,
  SignInResponseSchema,
  type IdentityMode,
  type Principal,
  type SessionInfo,
} from '@rai/shared/schemas/auth';
import type { Emitter } from '../observability/log.js';
import type { FixtureIdentityProvider } from './fixture.js';
import { cookieNames, type SessionRecord, type SessionStore } from './session.js';
import { SignInRefused, type IdentityAdapter, type SignInTransaction } from './types.js';
import { TRANSACTION_TTL_MS } from './oidc.js';

export interface AuthRouteDeps {
  adapter: IdentityAdapter;
  sessionStore: SessionStore;
  publicBaseUrl: URL;
  emitter: Emitter;
  fixtureProvider?: FixtureIdentityProvider; // fixture mode only
  now?: () => Date;
}

/** W0-02 7.2: an unknown fixture user is 404 not_found with the plain envelope (a fixture user is not a W0-06 resource). */
class FixtureUserUnknownError extends ContractError<'not_found'> {
  readonly code = 'not_found' as const;
  constructor() {
    super();
  }
}

const RETURN_TO = /^\/(?!\/)[^\s]*$/; // a same-origin absolute path: starts with one '/', never '//' or a scheme

export function isSameOriginPath(value: string): boolean {
  return RETURN_TO.test(value) && !value.includes('\\');
}

export function sessionInfo(session: SessionRecord): SessionInfo {
  return {
    principal: session.principal,
    identityMode: session.identityMode,
    expiresAt: session.expiresAt.toISOString(),
    locale: session.locale,
  };
}

function issuerKeyOf(mode: IdentityMode): string {
  switch (mode) {
    case 'local-google':
      return 'google';
    case 'fixture':
      return 'fixture';
    case 'network':
      return 'oidc';
    case 'production':
      return 'entra';
  }
}

export function registerAuthRoutes(fastify: FastifyInstance, deps: AuthRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const now = deps.now ?? (() => new Date());
  const names = cookieNames(deps.publicBaseUrl);
  const mode = deps.adapter.mode;
  const cookieBase = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: names.secure };

  async function establishSession(
    request: FastifyRequest,
    reply: FastifyReply,
    principal: Principal,
  ): Promise<SessionRecord> {
    const { session, token } = await deps.sessionStore.create({
      principal,
      identityMode: mode,
      absoluteHours: deps.adapter.sessionPolicy().absoluteHours,
      correlationId: request.id,
      now: now(),
    });
    void reply.setCookie(names.session, token, { ...cookieBase, expires: session.expiresAt });
    deps.emitter.log('auth.signin.succeeded', {
      identityMode: mode,
      actorSubjectId: principal.subjectId,
      roles: principal.roles.map((r) => r.role),
    });
    return session;
  }

  // GET /api/session → SessionInfo (200) or 401 (the middleware answers before the handler runs).
  app.get(
    '/api/session',
    { config: { auth: { kind: 'session' } }, schema: { response: { 200: SessionInfoSchema } } },
    (request) => {
      if (request.session === undefined) throw new UnauthenticatedError();
      return sessionInfo(request.session);
    },
  );

  // POST /api/session/locale { locale } → 204 (D12).
  app.post(
    '/api/session/locale',
    { config: { auth: { kind: 'session' } }, schema: { body: SessionLocaleRequestSchema } },
    async (request, reply) => {
      if (request.session === undefined) throw new UnauthenticatedError();
      await deps.sessionStore.setLocale(request.session.id, request.body.locale);
      return reply.status(204).send();
    },
  );

  // POST /auth/sign-out → 204; 401 without a session; 403 unless Sec-Fetch-Site is same-origin or none.
  app.post('/auth/sign-out', { config: { auth: { kind: 'session' } } }, async (request, reply) => {
    if (request.session === undefined) throw new UnauthenticatedError();
    const site = request.headers['sec-fetch-site'];
    if (site !== 'same-origin' && site !== 'none') throw new ForbiddenError();
    await deps.sessionStore.revoke(request.session.id, request.id, now());
    void reply.clearCookie(names.session, cookieBase);
    return reply.status(204).send();
  });

  if (mode === 'fixture') {
    const provider = deps.fixtureProvider;
    if (provider === undefined) throw new Error('fixture mode needs the fixture identity provider');

    // GET /auth/fixture/users → the picker list. Present only in fixture mode; its presence is what the SPA probes.
    app.get(
      '/auth/fixture/users',
      { config: { auth: { kind: 'public' } }, schema: { response: { 200: FixtureUsersResponseSchema } } },
      () => ({ users: provider.listUsers() }),
    );

    // POST /auth/fixture/sign-in { fixtureUserId } → 200 SessionInfo + cookie; unknown id → 404 not_found.
    app.post(
      '/auth/fixture/sign-in',
      {
        config: { auth: { kind: 'public' } },
        schema: { body: FixtureSignInRequestSchema, response: { 200: SessionInfoSchema } },
      },
      async (request, reply) => {
        const principal = provider.resolve(request.body.fixtureUserId);
        if (principal === undefined) throw new FixtureUserUnknownError();
        const session = await establishSession(request, reply, principal);
        return sessionInfo(session);
      },
    );
    return;
  }

  const verifier = deps.adapter.verifier;
  if (verifier === undefined) throw new Error(`mode ${mode} has no login verifier`);
  const callbackUrl = new URL('/auth/callback', deps.publicBaseUrl); // derived; not a variable (section 4.1)

  // POST /auth/sign-in { returnTo? } → 200 { redirectUrl }; stores the transaction in a 10-minute cookie.
  app.post(
    '/auth/sign-in',
    {
      config: { auth: { kind: 'public' } },
      schema: { body: SignInRequestSchema, response: { 200: SignInResponseSchema } },
    },
    async (request, reply) => {
      const returnTo = request.body.returnTo;
      if (returnTo !== undefined && !isSameOriginPath(returnTo))
        throw new InvalidInputError([{ path: 'returnTo', messageKey: 'validation.not_in_configured_list' }]);
      const { redirectTo, transaction } = await verifier.beginSignIn(
        returnTo === undefined ? { callbackUrl } : { callbackUrl, returnTo },
      );
      void reply.setCookie(names.transaction, JSON.stringify(transaction), {
        ...cookieBase,
        maxAge: TRANSACTION_TTL_MS / 1000,
      });
      return { redirectUrl: redirectTo.toString() };
    },
  );

  // GET /auth/callback?code&state → 303 to returnTo or '/', or 401 / 403 with no partial session.
  app.get('/auth/callback', { config: { auth: { kind: 'public' } } }, async (request, reply) => {
    const raw = request.cookies[names.transaction];
    void reply.clearCookie(names.transaction, cookieBase);
    let transaction: SignInTransaction | undefined;
    if (typeof raw === 'string' && raw !== '') {
      try {
        transaction = JSON.parse(raw) as SignInTransaction;
      } catch {
        transaction = undefined;
      }
    }
    const current = new URL(request.url, deps.publicBaseUrl);
    let principal: Principal;
    let subject: string | undefined;
    try {
      if (transaction === undefined || typeof transaction.state !== 'string')
        throw new SignInRefused('unauthenticated', 'transaction_missing');
      const login = await verifier.completeSignIn({ callbackUrl: current, transaction });
      subject = login.subject;
      principal = await deps.adapter.resolvePrincipal(login);
    } catch (err) {
      if (!(err instanceof SignInRefused)) throw err;
      deps.emitter.log('auth.signin.failed', { identityMode: mode, reason: err.reason });
      await deps.sessionStore.recordSignInRefused({
        identityMode: mode,
        reason: err.reason,
        issuerKey: issuerKeyOf(mode),
        subject: err.subject ?? subject,
        correlationId: request.id,
      });
      throw err.errorType === 'forbidden' ? new ForbiddenError() : new UnauthenticatedError();
    }
    await establishSession(request, reply, principal);
    const returnTo = transaction.returnTo;
    return reply.redirect(returnTo !== undefined && isSameOriginPath(returnTo) ? returnTo : '/', 303);
  });
}
