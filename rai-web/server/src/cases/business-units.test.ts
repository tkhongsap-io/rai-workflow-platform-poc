import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoleScope } from '@rai/shared/schemas/auth';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from './business-units.js';

test('the configured BU list is the distinct set of business_unit grants, in first-seen order; other grants contribute nothing', () => {
  const grants: RoleScope[] = [
    { role: 'owner', scope: { kind: 'own_cases' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
  ];
  assert.deepEqual(businessUnitsFromGrants(grants), ['CM', 'HR']);
  const directory = createBusinessUnitDirectory(businessUnitsFromGrants(grants));
  assert.deepEqual([...directory.list()], ['CM', 'HR']);
  assert.equal(directory.has('CM'), true);
  assert.equal(directory.has('cm'), false);
  assert.equal(directory.has('Consumer Mobile'), false); // the descriptive text is never a key
  assert.equal(createBusinessUnitDirectory([]).has('CM'), false);
});
