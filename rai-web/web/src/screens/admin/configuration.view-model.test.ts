// W6-05: presentation helpers of the Admin configuration screens. Access stays the server's (a 403 is rendered as
// sent); these only name things and check the change note before a request is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_KINDS } from '@rai/shared/schemas/cases';
import { CONFIGURATION_VALUES_OWNERS } from '@rai/shared/schemas/configuration-admin';
import { isLocaleKey } from '@rai/shared/locales/keys';
import { changeNoteOf, kindLabelKey, ownerLabelKey } from './configuration.view-model.js';

test('every configuration kind and values owner has a label key in the catalogue', () => {
  for (const kind of CONFIGURATION_KINDS) {
    const key = kindLabelKey(kind);
    assert.ok(key !== undefined && isLocaleKey(key), kind);
  }
  for (const owner of CONFIGURATION_VALUES_OWNERS) assert.ok(isLocaleKey(ownerLabelKey(owner)), owner);
  assert.equal(kindLabelKey('lane_mapping'), undefined); // never a kind (D02); the server answers 404
  assert.equal(kindLabelKey('toString'), undefined);
});

test('a change note is 1-500 characters after trimming; otherwise it is refused before any request', () => {
  assert.equal(changeNoteOf('  Back to the seed  '), 'Back to the seed');
  assert.equal(changeNoteOf(''), undefined);
  assert.equal(changeNoteOf('   \n '), undefined);
  assert.equal(changeNoteOf('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(changeNoteOf('x'.repeat(501)), undefined);
});
