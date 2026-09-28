// W7-09 (W7 plan section 6): the sign-in method a server announces follows its identity mode, and the answer carries
// the method only: `network` and `production` are both "the organisation's sign-in" to the viewer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { IDENTITY_MODES, SIGN_IN_METHODS, SignInMethodResponseSchema, signInMethodOf } from './auth.js';

test('W7-09: signInMethodOf maps every identity mode; network and production are the organisation', () => {
  assert.deepEqual(
    IDENTITY_MODES.map((mode) => [mode, signInMethodOf(mode)]),
    [
      ['fixture', 'fixture'],
      ['local-google', 'google'],
      ['network', 'organization'],
      ['production', 'organization'],
    ],
  );
  assert.deepEqual([...SIGN_IN_METHODS], ['fixture', 'google', 'organization']);
});

test('W7-09: the response schema holds exactly one known method and nothing else', () => {
  for (const method of SIGN_IN_METHODS)
    assert.ok(Value.Check(SignInMethodResponseSchema, { method }), method);
  assert.equal(Value.Check(SignInMethodResponseSchema, { method: 'entra' }), false);
  assert.equal(Value.Check(SignInMethodResponseSchema, {}), false);
  assert.equal(
    Value.Check(SignInMethodResponseSchema, {
      method: 'organization',
      issuer: 'https://issuer.example.test',
    }),
    false,
  );
});
