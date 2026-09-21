// W0-02 section 7.2 sign-in shapes (W0-03 owns identity behaviour; this spelling is authoritative for the
// identifiers W0-05 compares). Types are inferred from the TypeBox schemas so the server validates with the
// same definition the SPA and the W1-13 substitute read.

import { Type, type Static } from 'typebox';
import type { SubjectId } from '../ids.js';

export const ROLES = ['owner', 'bu_spoc', 'ai_coe', 'dpo', 'it_security', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type { Lane } from '../constants.js'; // one definition: constants.ts (W0-06 section 3)

/** Fixture and production BU identifiers are opaque strings; the value list is configuration (W6). */
export type BusinessUnitId = string;

export const RoleScopeSchema = Type.Union([
  Type.Object({ role: Type.Literal('owner'), scope: Type.Object({ kind: Type.Literal('own_cases') }) }),
  Type.Object({
    role: Type.Literal('bu_spoc'),
    scope: Type.Object({ kind: Type.Literal('business_unit'), businessUnit: Type.String({ minLength: 1 }) }),
  }),
  Type.Object({
    role: Type.Literal('ai_coe'),
    scope: Type.Object({ kind: Type.Literal('all_cases'), lane: Type.Literal('ai_coe') }),
  }),
  Type.Object({
    role: Type.Literal('dpo'),
    scope: Type.Object({ kind: Type.Literal('all_cases'), lane: Type.Literal('dpo') }),
  }),
  Type.Object({
    role: Type.Literal('it_security'),
    scope: Type.Object({ kind: Type.Literal('all_cases'), lane: Type.Literal('it_security') }),
  }),
  Type.Object({ role: Type.Literal('admin'), scope: Type.Object({ kind: Type.Literal('all_cases') }) }),
]);

export type RoleScope = Static<typeof RoleScopeSchema>;
export type ScopeKind = RoleScope['scope']['kind']; // 'own_cases' | 'business_unit' | 'all_cases'

export const IDENTITY_MODES = ['fixture', 'local-google', 'network', 'production'] as const;
export type IdentityMode = (typeof IDENTITY_MODES)[number];

export const PrincipalSchema = Type.Object({
  subjectId: Type.String({ minLength: 1 }), // '<issuerKey>:<subject>' (W0-03 section 2.2); never the email
  displayName: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ minLength: 3 }), // lower-cased; display and notification addressing only
  roles: Type.Array(RoleScopeSchema, { minItems: 1 }), // one or more; the dual-role fixture identity has two
});

export interface Principal {
  subjectId: SubjectId;
  displayName: string;
  email: string;
  roles: RoleScope[];
}

export const LocaleSchema = Type.Union([Type.Literal('th'), Type.Literal('en')]);
export type Locale = Static<typeof LocaleSchema>;

export const SessionInfoSchema = Type.Object({
  principal: PrincipalSchema,
  identityMode: Type.Union([
    Type.Literal('fixture'),
    Type.Literal('local-google'),
    Type.Literal('network'),
    Type.Literal('production'),
  ]), // a tuple, not IDENTITY_MODES.map(): a mapped array widens the inferred type to never
  expiresAt: Type.String(),
  locale: LocaleSchema, // the viewer's stored preference; default 'th' (D12)
});
export type SessionInfo = Static<typeof SessionInfoSchema>;

export const SessionLocaleRequestSchema = Type.Object({ locale: LocaleSchema });
export type SessionLocaleRequest = Static<typeof SessionLocaleRequestSchema>;

export const SignInRequestSchema = Type.Object({ returnTo: Type.Optional(Type.String()) }); // path only, same-origin
export type SignInRequest = Static<typeof SignInRequestSchema>;

export const SignInResponseSchema = Type.Object({ redirectUrl: Type.String() });
export type SignInResponse = Static<typeof SignInResponseSchema>;

export const FixtureUsersResponseSchema = Type.Object({
  users: Type.Array(
    Type.Object({
      fixtureUserId: Type.String(),
      displayName: Type.String(),
      roles: Type.Array(RoleScopeSchema),
    }),
  ),
});
export type FixtureUsersResponse = Static<typeof FixtureUsersResponseSchema>;

export const FixtureSignInRequestSchema = Type.Object({ fixtureUserId: Type.String({ minLength: 1 }) });
export type FixtureSignInRequest = Static<typeof FixtureSignInRequestSchema>;
