// W0-03 section 4.4 / 7: the fixture identity provider, the W0-03 test substitute. No provider, no password: a
// test-only route (W1-01a) names one of the fixture users and this module resolves it to a Principal with its
// (role, scope) pairs, the dual-role identity keeping both. The user table itself lives in @rai/fixtures
// (data/users.ts); this module receives it as an input so the server never imports the fixtures package and a
// production build cannot contain the identities. Mounted only when RAI_IDENTITY_MODE=fixture, which config.ts
// accepts only under NODE_ENV=test on a loopback bind (S13, S14).

import type { Principal, RoleScope } from '@rai/shared/schemas/auth';

export const FIXTURE_ISSUER = 'fixture' as const;

export interface FixtureIdentity {
  fixtureUserId: string;
  subjectId: string;
  displayName: string;
  email: string;
  roles: readonly RoleScope[];
}

export interface FixtureUserSummary {
  fixtureUserId: string;
  displayName: string;
  roles: RoleScope[];
}

export interface FixtureIdentityProvider {
  readonly mode: 'fixture';
  /** The picker list for the test sign-in screen (W0-02 7.2 GET /auth/fixture/users). */
  listUsers(): FixtureUserSummary[];
  /** The Principal for one fixture user id, or undefined (→ 404 not_found on the sign-in route). */
  resolve(fixtureUserId: string): Principal | undefined;
}

export class FixtureTableInvalid extends Error {
  constructor(message: string) {
    super(`fixture identity table invalid: ${message}`);
    this.name = 'FixtureTableInvalid';
  }
}

/** Builds the provider from the fixture table, enforcing the W0-03 section 2.3 invariants once at construction. */
export function createFixtureIdentityProvider(users: readonly FixtureIdentity[]): FixtureIdentityProvider {
  const byId = new Map<string, FixtureIdentity>();
  const subjects = new Set<string>();
  for (const user of users) {
    if (byId.has(user.fixtureUserId))
      throw new FixtureTableInvalid(`duplicate fixture user id ${user.fixtureUserId}`);
    if (subjects.has(user.subjectId)) throw new FixtureTableInvalid(`duplicate subject ${user.subjectId}`);
    if (user.subjectId !== `${FIXTURE_ISSUER}:${user.fixtureUserId}`)
      throw new FixtureTableInvalid(`subject of ${user.fixtureUserId} is not issuer-qualified`);
    if (user.roles.length === 0)
      throw new FixtureTableInvalid(`${user.fixtureUserId} has no (role, scope) pair`);
    if (user.email !== user.email.toLowerCase() || !user.email.includes('@'))
      throw new FixtureTableInvalid(`${user.fixtureUserId} email is not a lower-cased address`);
    if (user.displayName.trim().length === 0)
      throw new FixtureTableInvalid(`${user.fixtureUserId} has no display name`);
    const pairKeys = user.roles.map((r) => JSON.stringify(r));
    if (new Set(pairKeys).size !== pairKeys.length)
      throw new FixtureTableInvalid(`${user.fixtureUserId} repeats a (role, scope) pair`);
    byId.set(user.fixtureUserId, user);
    subjects.add(user.subjectId);
  }
  return {
    mode: 'fixture',
    listUsers: () =>
      [...byId.values()].map((u) => ({
        fixtureUserId: u.fixtureUserId,
        displayName: u.displayName,
        roles: [...u.roles],
      })),
    resolve: (fixtureUserId) => {
      const user = byId.get(fixtureUserId);
      if (user === undefined) return undefined;
      return {
        subjectId: user.subjectId,
        displayName: user.displayName.trim().slice(0, 200),
        email: user.email,
        roles: user.roles.map((r) => structuredClone(r)), // a fresh copy: the adapter never drops a role (invariant 5)
      };
    },
  };
}
