// W0-03 section 4.2: the allow-list role resolver (network / allow-list source) and, in the same format, the
// optional local role map of local-google (section 4.1). Matching is on the provider-verified email, lower-cased,
// exact; no wildcards or domains. An invalid document is a start-up refusal (S8), never a runtime default.

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { RoleScopeSchema, type RoleScope } from '@rai/shared/schemas/auth';
import type { RoleResolver, VerifiedLogin } from './types.js';

export const AllowListSchema = Type.Object({
  version: Type.Literal(1),
  entries: Type.Array(
    Type.Object({
      email: Type.String({ minLength: 3, maxLength: 254 }),
      roles: Type.Array(RoleScopeSchema, { minItems: 1 }),
      displayNameOverride: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    }),
  ),
});
export type AllowList = Static<typeof AllowListSchema>;

export class AllowListInvalid extends Error {
  constructor(readonly problems: string[]) {
    super('allow-list document is invalid'); // never the content
    this.name = 'AllowListInvalid';
  }
}

/** Parses and validates an allow-list document (JSON text). Throws AllowListInvalid; the message never quotes an entry. */
export function parseAllowList(text: string): AllowList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AllowListInvalid(['not JSON']);
  }
  if (!Value.Check(AllowListSchema, parsed)) {
    throw new AllowListInvalid([...Value.Errors(AllowListSchema, parsed)].map((e) => e.instancePath || '/'));
  }
  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    const email = entry.email.toLowerCase();
    if (!email.includes('@')) throw new AllowListInvalid(['entry email is not an address']);
    if (seen.has(email)) throw new AllowListInvalid(['duplicate entry']);
    seen.add(email);
    const pairKeys = entry.roles.map((r) => JSON.stringify(r));
    if (new Set(pairKeys).size !== pairKeys.length) throw new AllowListInvalid(['entry repeats a pair']);
  }
  return parsed;
}

export interface AllowListResolver extends RoleResolver {
  /** The display-name override for a listed email, if any. */
  displayNameFor(email: string): string | undefined;
  /** Whether the email is listed (for the local-google default-to-owner rule). */
  has(email: string): boolean;
}

export function createAllowListResolver(list: AllowList): AllowListResolver {
  const byEmail = new Map<string, { roles: readonly RoleScope[]; displayNameOverride?: string }>();
  for (const entry of list.entries) {
    byEmail.set(
      entry.email.toLowerCase(),
      entry.displayNameOverride === undefined
        ? { roles: entry.roles }
        : { roles: entry.roles, displayNameOverride: entry.displayNameOverride },
    );
  }
  return {
    resolve(login: VerifiedLogin) {
      const entry = byEmail.get(login.email.toLowerCase());
      return Promise.resolve(entry === undefined ? [] : entry.roles.map((r) => structuredClone(r)));
    },
    displayNameFor: (email) => byEmail.get(email.toLowerCase())?.displayNameOverride,
    has: (email) => byEmail.has(email.toLowerCase()),
  };
}
