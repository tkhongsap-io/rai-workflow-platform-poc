// W6-02 (W6 plan section 3): the db kind list (the CHECK's source) and the shared kind list (read by the freeze, the
// route kind list and the 404 kind check) change together; they may never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_BODY_SCHEMAS, CONFIGURATION_KINDS as SHARED_KINDS } from '@rai/shared/schemas/cases';
import { CONFIGURATION_KINDS as DB_KINDS } from './configuration-revision.js';

test('the shared and db configuration kind lists are equal, in the same order', () => {
  assert.deepEqual([...DB_KINDS], [...SHARED_KINDS]);
});

test('desk_controls is a registered kind in both lists, with a body schema (W6-02, Q12)', () => {
  assert.ok((DB_KINDS as readonly string[]).includes('desk_controls'));
  assert.ok(Object.hasOwn(CONFIGURATION_BODY_SCHEMAS, 'desk_controls'));
});
