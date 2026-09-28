// W6-11 (W6 plan section 6): the AD group-to-role mapping body lives in shared and is registered for the
// `group_role_mapping` kind. Shape unchanged from W0-03 9.2. Synthetic values only: the all-zero tenant and
// `fx-group-*` IDs; nothing here is a real tenant or group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { CONFIGURATION_BODY_SCHEMAS, type ConfigurationBodies } from './cases.js';
import { GroupRoleMappingSchema, isGroupRoleMapping, type GroupRoleMapping } from './identity-mapping.js';

const SYNTHETIC: GroupRoleMapping = {
  kind: 'identity.group_role_mapping',
  version: 1,
  tenantId: '00000000-0000-0000-0000-000000000000',
  rules: [
    { groupObjectId: 'fx-group-owner', role: 'owner' },
    { groupObjectId: 'fx-group-spoc-cm', role: 'bu_spoc', businessUnit: 'CM' },
    { groupObjectId: 'fx-group-dpo', role: 'dpo' },
    { groupObjectId: 'fx-group-admin', role: 'admin' },
  ],
};

test('group_role_mapping is registered with the moved schema, and the body type is the mapping', () => {
  assert.equal(CONFIGURATION_BODY_SCHEMAS.group_role_mapping, GroupRoleMappingSchema);
  const body: ConfigurationBodies['group_role_mapping'] = SYNTHETIC;
  assert.ok(Value.Check(CONFIGURATION_BODY_SCHEMAS.group_role_mapping, body));
});

test('a synthetic mapping is valid; wrong literals, missing fields and unknown roles are not', () => {
  assert.equal(isGroupRoleMapping(SYNTHETIC), true);
  assert.equal(isGroupRoleMapping({ ...SYNTHETIC, rules: [] }), true); // no rule: nobody resolves (S12 starts)
  for (const invalid of [
    {},
    { ...SYNTHETIC, kind: 'group_role_mapping' },
    { ...SYNTHETIC, version: 2 },
    { ...SYNTHETIC, tenantId: '' },
    { ...SYNTHETIC, rules: [{ groupObjectId: 'fx-group-x', role: 'superuser' }] },
    { ...SYNTHETIC, rules: [{ groupObjectId: 'fx-group-x', role: 'bu_spoc' }] },
    { ...SYNTHETIC, rules: [{ groupObjectId: '', role: 'dpo' }] },
  ])
    assert.equal(isGroupRoleMapping(invalid), false, JSON.stringify(invalid));
});
