// W7-09 (W7 plan section 7): the sign-in screen's state. The fixture picker when GET /auth/fixture/users answers;
// after its 404 the provider button, labelled from GET /auth/sign-in-method. An inconsistent or failed answer is
// shown as an error, never guessed into a Google or organisation button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FixtureUsersResponse, SignInMethodResponse } from '@rai/shared/schemas/auth';
import { t } from '@rai/shared/locales/keys';
import { InvalidResponseError } from '../../api/client.js';
import { PROVIDER_COPY, loadSignInPicker, type SignInPickerSource } from './sign-in.view-model.js';

const users: FixtureUsersResponse = {
  users: [
    {
      fixtureUserId: 'fx-user-admin',
      displayName: 'Desk Admin (fixture)',
      roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
    },
  ],
};

function source(
  fixtureUsers: FixtureUsersResponse | null | Error,
  method: SignInMethodResponse | Error,
): SignInPickerSource & { methodReads: number } {
  const state = { methodReads: 0 };
  return {
    getFixtureUsers: () =>
      fixtureUsers instanceof Error ? Promise.reject(fixtureUsers) : Promise.resolve(fixtureUsers),
    getSignInMethod: () => {
      state.methodReads += 1;
      return method instanceof Error ? Promise.reject(method) : Promise.resolve(method);
    },
    get methodReads() {
      return state.methodReads;
    },
  };
}

test('W7-09: fixture users present → the picker, and the method is never read', async () => {
  const s = source(users, { method: 'fixture' });
  assert.deepEqual(await loadSignInPicker(s), { kind: 'fixture', users: users.users });
  assert.equal(s.methodReads, 0);
});

test('W7-09: after the fixture-users 404 the method labels the provider: google or organization', async () => {
  for (const method of ['google', 'organization'] as const) {
    const s = source(null, { method });
    assert.deepEqual(await loadSignInPicker(s), { kind: 'provider', method });
    assert.equal(s.methodReads, 1);
  }
});

test('W7-09: "fixture" after the fixture-users 404 is inconsistent and fails; so does a failed read', async () => {
  const inconsistent = await loadSignInPicker(source(null, { method: 'fixture' }));
  assert.equal(inconsistent.kind, 'failed');
  assert.ok(inconsistent.kind === 'failed' && inconsistent.error instanceof InvalidResponseError);

  const boom = new Error('network');
  assert.deepEqual(await loadSignInPicker(source(null, boom)), { kind: 'failed', error: boom });
  assert.deepEqual(await loadSignInPicker(source(boom, { method: 'google' })), {
    kind: 'failed',
    error: boom,
  });
});

test('W7-09: the provider copy names the Google keys and the new organisation keys, th and en', () => {
  assert.deepEqual(PROVIDER_COPY, {
    google: { button: 'auth.sign_in_with_google', note: 'sign_in.google_note' },
    organization: { button: 'auth.sign_in_with_organization', note: 'sign_in.organization_note' },
  });
  for (const locale of ['th', 'en'] as const) {
    for (const copy of Object.values(PROVIDER_COPY)) {
      assert.notEqual(t(locale, copy.button), copy.button, `${locale} ${copy.button}`);
      assert.notEqual(t(locale, copy.note), copy.note, `${locale} ${copy.note}`);
    }
    // The organisation copy never says Google.
    assert.doesNotMatch(t(locale, PROVIDER_COPY.organization.button), /google/i);
    assert.doesNotMatch(t(locale, PROVIDER_COPY.organization.note), /google/i);
  }
});
