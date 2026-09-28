// W0-03 section 9.2 (moved here from server/src/identity/group-mapping.ts in W6-11, W6 plan section 6): the AD
// group-to-role mapping body, registered as the `group_role_mapping` configuration kind in `cases.ts`. The body
// literal stays `identity.group_role_mapping`. The identity adapter reads the revision in force once at start in
// `network` (`ad` source) and `production` modes; `fixture`, `local-google` and `network` with the allow-list ignore
// it. Shape only: real tenant and group IDs are D10 and W8; nothing in this repository contains one, and the seed and
// the fixtures publish no mapping (`UNSEEDED_KINDS`).

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const GroupRoleMappingSchema = Type.Object({
  kind: Type.Literal('identity.group_role_mapping'),
  version: Type.Literal(1),
  tenantId: Type.String({ minLength: 1 }), // must equal RAI_IDENTITY_ENTRA_TENANT_ID or start-up refuses (S12)
  rules: Type.Array(
    Type.Union([
      Type.Object({ groupObjectId: Type.String({ minLength: 1 }), role: Type.Literal('owner') }),
      Type.Object({
        groupObjectId: Type.String({ minLength: 1 }),
        role: Type.Literal('bu_spoc'),
        businessUnit: Type.String({ minLength: 1 }),
      }),
      Type.Object({
        groupObjectId: Type.String({ minLength: 1 }),
        role: Type.Union([
          Type.Literal('ai_coe'),
          Type.Literal('dpo'),
          Type.Literal('it_security'),
          Type.Literal('admin'),
        ]),
      }),
    ]),
  ),
});
export type GroupRoleMapping = Static<typeof GroupRoleMappingSchema>;

export function isGroupRoleMapping(value: unknown): value is GroupRoleMapping {
  return Value.Check(GroupRoleMappingSchema, value);
}
