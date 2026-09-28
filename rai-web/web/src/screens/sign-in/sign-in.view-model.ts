// W7-09 (W7 plan section 7): the sign-in screen's state, outside React. GET /auth/fixture/users answering 200 means
// the fixture picker; its 404 means a provider button, labelled from GET /auth/sign-in-method (Google in
// `local-google`, the organisation in `network` and `production`). A server that answers the 404 and then says
// `fixture` is inconsistent: that is shown as an error, never guessed into a button.

import type { FixtureUsersResponse, RoleScope, SignInMethodResponse } from '@rai/shared/schemas/auth';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { InvalidResponseError } from '../../api/client.js';
import type { Translate } from '../../i18n/locale-provider.js';

export type ProviderMethod = 'google' | 'organization';

export type PickerState =
  | { kind: 'loading' }
  | { kind: 'fixture'; users: FixtureUsersResponse['users'] }
  | { kind: 'provider'; method: ProviderMethod }
  | { kind: 'failed'; error: unknown };

/** The provider button's label and the note above it, per method (D12: locale keys only). */
export const PROVIDER_COPY: Readonly<Record<ProviderMethod, { button: LocaleKey; note: LocaleKey }>> =
  Object.freeze({
    google: { button: 'auth.sign_in_with_google', note: 'sign_in.google_note' },
    organization: { button: 'auth.sign_in_with_organization', note: 'sign_in.organization_note' },
  });

export interface SignInPickerSource {
  getFixtureUsers(): Promise<FixtureUsersResponse | null>;
  getSignInMethod(): Promise<SignInMethodResponse>;
}

export async function loadSignInPicker(source: SignInPickerSource): Promise<PickerState> {
  try {
    const users = await source.getFixtureUsers();
    if (users !== null) return { kind: 'fixture', users: users.users };
    const { method } = await source.getSignInMethod();
    if (method === 'fixture') return { kind: 'failed', error: new InvalidResponseError() };
    return { kind: 'provider', method };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

const ROLE_KEY: Readonly<Record<RoleScope['role'], LocaleKey>> = Object.freeze({
  owner: 'role.owner',
  bu_spoc: 'role.bu_spoc',
  ai_coe: 'role.ai_coe',
  dpo: 'role.dpo',
  it_security: 'role.it_security',
  admin: 'role.admin',
});

/** "DPO, BU SPOC (HR)": the (role, scope) pairs the server listed, rendered for the picker only. */
export function describeRoles(t: Translate, roles: readonly RoleScope[]): string {
  return roles
    .map((r) =>
      r.scope.kind === 'business_unit'
        ? `${t(ROLE_KEY[r.role])} (${r.scope.businessUnit})`
        : t(ROLE_KEY[r.role]),
    )
    .join(', ');
}
