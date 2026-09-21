// W0-03 section 9.2: the AD group-to-role mapping (shape only; values are W6 and W8 under D10) and its resolver
// (section 4.3). The mapping is an Admin-editable configuration revision of kind `identity.group_role_mapping`
// read once at start through the injected `groupMappingSource`; nothing in this repository contains a real group id.
// Resolution reads the token's `groups` claim only; an overage indicator is refused, never looked up.

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { RoleScope } from '@rai/shared/schemas/auth';
import { SignInRefused, type RoleResolver, type VerifiedLogin } from './types.js';

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

function pairFor(rule: GroupRoleMapping['rules'][number]): RoleScope {
  switch (rule.role) {
    case 'owner':
      return { role: 'owner', scope: { kind: 'own_cases' } };
    case 'bu_spoc':
      return { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: rule.businessUnit } };
    case 'ai_coe':
      return { role: 'ai_coe', scope: { kind: 'all_cases', lane: 'ai_coe' } };
    case 'dpo':
      return { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } };
    case 'it_security':
      return { role: 'it_security', scope: { kind: 'all_cases', lane: 'it_security' } };
    case 'admin':
      return { role: 'admin', scope: { kind: 'all_cases' } };
  }
}

/** True when the token signals group overage instead of listing groups (section 4.3). */
export function hasGroupsOverage(claims: Readonly<Record<string, unknown>>): boolean {
  return (
    claims._claim_names !== undefined || claims._claim_sources !== undefined || claims.hasgroups === true
  );
}

export function createGroupMappingResolver(mapping: GroupRoleMapping): RoleResolver {
  const byGroup = new Map<string, RoleScope[]>();
  for (const rule of mapping.rules) {
    const list = byGroup.get(rule.groupObjectId) ?? [];
    list.push(pairFor(rule));
    byGroup.set(rule.groupObjectId, list);
  }
  return {
    resolve(login: VerifiedLogin) {
      if (hasGroupsOverage(login.claims)) throw new SignInRefused('forbidden', 'groups_overage');
      const groups = login.claims.groups;
      if (!Array.isArray(groups)) return Promise.resolve([]);
      const pairs = new Map<string, RoleScope>();
      for (const group of groups) {
        if (typeof group !== 'string') continue; // data, never instructions: unexpected shapes are ignored
        for (const pair of byGroup.get(group) ?? []) pairs.set(JSON.stringify(pair), structuredClone(pair));
      }
      return Promise.resolve([...pairs.values()]);
    },
  };
}
