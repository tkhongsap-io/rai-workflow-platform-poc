// W6-02 (W6 plan sections 2.1 and 3, Q12): the `desk_controls` configuration body, registered in shared so the seed
// and Admin can publish it. Three switches, all booleans, nothing else; W6-17 reads it per request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import {
  CONFIGURATION_BODY_SCHEMAS,
  CONFIGURATION_KINDS,
  DeskControlsBodySchema,
  type ConfigurationBodies,
} from './cases.js';

test('desk_controls is a configuration kind with a registered body schema', () => {
  assert.ok((CONFIGURATION_KINDS as readonly string[]).includes('desk_controls'));
  assert.equal(CONFIGURATION_BODY_SCHEMAS.desk_controls, DeskControlsBodySchema);
});

test('the body is exactly three booleans', () => {
  const off: ConfigurationBodies['desk_controls'] = {
    writesFrozen: false,
    mailPaused: false,
    qcPaused: false,
  };
  assert.ok(Value.Check(DeskControlsBodySchema, off));
  assert.ok(Value.Check(DeskControlsBodySchema, { writesFrozen: true, mailPaused: true, qcPaused: false }));
  for (const bad of [
    {},
    { writesFrozen: false, mailPaused: false },
    { writesFrozen: 'no', mailPaused: false, qcPaused: false },
    { writesFrozen: false, mailPaused: false, qcPaused: false, extra: true },
    [],
    null,
  ])
    assert.equal(Value.Check(DeskControlsBodySchema, bad), false, JSON.stringify(bad));
});
