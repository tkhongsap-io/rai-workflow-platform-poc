// W0-03 section 7 fixture identities (W1-00 owns; W0-02 section 8.3 owns the naming convention; W0-08 section 8.2
// reproduces the table). Eight synthetic users: six single-role users, the dual-role identity and the second owner
// W0-05 asked for. Names are invented; `rai-desk.example` is a reserved domain that never resolves. Adding, removing
// or re-roling a user is a change to W0-02 section 8.3, W0-03 section 7 and W0-08 section 8.2 in its own PR.

import type { RoleScope } from '@rai/shared/schemas/auth';

export const FIXTURE_ISSUER_KEY = 'fixture' as const;
export const FIXTURE_EMAIL_DOMAIN = 'rai-desk.example' as const;

export interface FixtureBusinessUnit {
  businessUnitId: string;
  displayName: string;
}

export const FIXTURE_BUSINESS_UNITS: readonly FixtureBusinessUnit[] = Object.freeze([
  { businessUnitId: 'CM', displayName: 'Consumer Mobile' },
  { businessUnitId: 'HR', displayName: 'Human Resources' },
]);

export interface FixtureUser {
  fixtureUserId: string; // fx-user-<role>[-<qualifier>]
  subjectId: `fixture:${string}`; // '<issuerKey>:<subject>' (W0-03 section 2.2)
  displayName: string;
  email: `${string}@${typeof FIXTURE_EMAIL_DOMAIN}`;
  roles: readonly RoleScope[];
}

export const FIXTURE_USERS: readonly FixtureUser[] = Object.freeze([
  {
    fixtureUserId: 'fx-user-owner-cm',
    subjectId: 'fixture:fx-user-owner-cm',
    displayName: 'ณัฐพร ส. (Nattaporn S.)', // Thai script on purpose: proves Thai rendering from the first fixture (D12)
    email: 'owner.cm@rai-desk.example',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }], // owns every W0-08 fixture case
  },
  {
    fixtureUserId: 'fx-user-owner-cm-2',
    subjectId: 'fixture:fx-user-owner-cm-2',
    displayName: 'Prasit W.',
    email: 'owner.cm2@rai-desk.example',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }], // owns no fixture case; the W0-05 "owner-b"
  },
  {
    fixtureUserId: 'fx-user-spoc-cm',
    subjectId: 'fixture:fx-user-spoc-cm',
    displayName: 'Suchada P.',
    email: 'spoc.cm@rai-desk.example',
    roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
  },
  {
    fixtureUserId: 'fx-user-ai-coe',
    subjectId: 'fixture:fx-user-ai-coe',
    displayName: 'Kritsada T.',
    email: 'ai-coe@rai-desk.example',
    roles: [{ role: 'ai_coe', scope: { kind: 'all_cases', lane: 'ai_coe' } }],
  },
  {
    fixtureUserId: 'fx-user-dpo',
    subjectId: 'fixture:fx-user-dpo',
    displayName: 'Pimchanok R.',
    email: 'dpo@rai-desk.example',
    roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }],
  },
  {
    fixtureUserId: 'fx-user-it-security',
    subjectId: 'fixture:fx-user-it-security',
    displayName: 'Wutthichai K.',
    email: 'it-security@rai-desk.example',
    roles: [{ role: 'it_security', scope: { kind: 'all_cases', lane: 'it_security' } }],
  },
  {
    fixtureUserId: 'fx-user-admin',
    subjectId: 'fixture:fx-user-admin',
    displayName: 'Desk Admin (fixture)',
    email: 'admin@rai-desk.example',
    roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
  },
  {
    fixtureUserId: 'fx-user-dpo-spoc-hr',
    subjectId: 'fixture:fx-user-dpo-spoc-hr',
    displayName: 'Rattanaporn C.',
    email: 'dpo.spoc.hr@rai-desk.example',
    // The W0-03 dual-role identity: DPO reviewer and BU SPOC of HR. Under D05 it may never approve the DPO lane on
    // an HR case (W0-05 T19, T25) and may approve it on a CM case (T20). It is a fixture user, not a seventh role.
    roles: [
      { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
      { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
    ],
  },
]);

export const DUAL_ROLE_FIXTURE_USER_ID = 'fx-user-dpo-spoc-hr' as const;

/** The single synthetic operator recipient (W0-08 section 8.2; D06 `operator_recipients` seed). */
export const FIXTURE_OPERATOR_RECIPIENT = 'operator-digest@rai-desk.example' as const;

export function findFixtureUser(fixtureUserId: string): FixtureUser | undefined {
  return FIXTURE_USERS.find((u) => u.fixtureUserId === fixtureUserId);
}
