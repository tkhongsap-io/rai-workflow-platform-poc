// W0-03 section 9.2: the AD group-to-role mapping's resolver (section 4.3). The body schema moved to
// `@rai/shared/schemas/identity-mapping` in W6-11 (W6 plan section 6) and is re-exported here, so no import breaks; it
// is the `group_role_mapping` configuration kind (body literal `identity.group_role_mapping`), read once at start
// through the injected `groupMappingSource`. Nothing in this repository contains a real group id. Resolution reads the
// token's `groups` claim only; an overage indicator is refused, never looked up.

import type { RoleScope } from '@rai/shared/schemas/auth';
import { type GroupRoleMapping } from '@rai/shared/schemas/identity-mapping';
import { SignInRefused, type RoleResolver, type VerifiedLogin } from './types.js';

export {
  GroupRoleMappingSchema,
  isGroupRoleMapping,
  type GroupRoleMapping,
} from '@rai/shared/schemas/identity-mapping';

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
