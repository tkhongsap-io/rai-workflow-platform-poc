import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoleScope } from '@rai/shared/schemas/auth';
import {
  laneOpenRecipientsForCase,
  laneReviewerSpocUnits,
  laneOpenRecipientsFromIdentities,
} from './open-lanes.js';

const dpo: RoleScope = { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } };
const spocHr: RoleScope = { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } };
const users = [
  { email: 'dpo@x.example', roles: [dpo] },
  { email: 'dual@x.example', roles: [dpo, spocHr] },
];

test('W3-F2: a lane reviewer who is BU SPOC of the case BU gets no lane-opened mail for that case (ruling item 10)', () => {
  const all = laneOpenRecipientsFromIdentities(users);
  const spocUnits = laneReviewerSpocUnits(users);
  assert.deepEqual(laneOpenRecipientsForCase(all, spocUnits, 'HR').dpo, ['dpo@x.example']);
  // On a case of another BU the same reviewer may decide, so still gets the mail (W0-05 T20).
  assert.deepEqual(laneOpenRecipientsForCase(all, spocUnits, 'CM').dpo, ['dpo@x.example', 'dual@x.example']);
});

test('W3-F2: without the SPOC map nobody is excluded', () => {
  const all = laneOpenRecipientsFromIdentities(users);
  assert.deepEqual(laneOpenRecipientsForCase(all, undefined, 'HR'), all);
});
