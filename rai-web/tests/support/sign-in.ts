// Fixture sign-in for the integration layer (W0-02 sections 7.2 and 8.1; Lane C, W1-12). Calls the API the way a
// browser would, through `app.inject()`, so a test never fabricates a session: `POST /auth/fixture/sign-in` is
// served by W1-01a in `fixture` mode only, and this helper fails loudly when the route answers anything but 200.

import type { FastifyInstance } from 'fastify';
import type { SessionInfo } from '@rai/shared/schemas/auth';

export const FIXTURE_SIGN_IN_PATH = '/auth/fixture/sign-in';
export const FIXTURE_USERS_PATH = '/auth/fixture/users';

export interface FixtureSession {
  /** The `Cookie` request header value that carries this session (name=value only). */
  cookie: string;
  session: SessionInfo;
}

export class FixtureSignInError extends Error {
  constructor(
    readonly fixtureUserId: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`fixture sign-in for ${fixtureUserId} answered ${status} at ${FIXTURE_SIGN_IN_PATH}: ${body}`);
    this.name = 'FixtureSignInError';
  }
}

/** Signs in one W0-03 fixture identity and returns the cookie to send on later requests. */
export async function signInAsFixture(
  fastify: FastifyInstance,
  fixtureUserId: string,
): Promise<FixtureSession> {
  const response = await fastify.inject({
    method: 'POST',
    url: FIXTURE_SIGN_IN_PATH,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    payload: { fixtureUserId },
  });
  if (response.statusCode !== 200)
    throw new FixtureSignInError(fixtureUserId, response.statusCode, response.body);
  const cookie = firstCookie(response.headers['set-cookie']);
  if (cookie === undefined) throw new FixtureSignInError(fixtureUserId, response.statusCode, 'no Set-Cookie');
  return { cookie, session: response.json<SessionInfo>() };
}

/** The request headers a signed-in test sends: the session cookie and the same-origin fetch metadata. */
export function asUser(session: Pick<FixtureSession, 'cookie'>): Record<string, string> {
  return { cookie: session.cookie, 'sec-fetch-site': 'same-origin' };
}

/** Reduces a Set-Cookie header (string or array) to the first `name=value` pair. */
export function firstCookie(header: string | string[] | undefined): string | undefined {
  const first = Array.isArray(header) ? header[0] : header;
  if (first === undefined) return undefined;
  const pair = first.split(';', 1)[0]?.trim();
  return pair === undefined || pair === '' ? undefined : pair;
}
