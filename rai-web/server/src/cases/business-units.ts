// The configured BU keys `businessUnitId` must match (W0-02 7.3: "must be a configured BU key (fixture BUs 'CM',
// 'HR'; W0-03 section 7) or 422 invalid_input"; W0-04 `case.business_unit_id`: "a key from the fixture BU list in
// slice 1; the AD-group mapping arrives at W6/W8"). Slice 1 derives the list from the `business_unit` grants the
// identity adapter can issue (the fixture identities in fixture mode; the local role map in local-google), so the
// keys a SPOC can be granted and the keys a case can be filed under are the same set. Never a free-text value.

import type { RoleScope } from '@rai/shared/schemas/auth';

export interface BusinessUnitDirectory {
  /** The configured keys, in a stable order. */
  list(): readonly string[];
  has(businessUnitId: string): boolean;
}

/** The distinct `businessUnit` values of every `business_unit` grant, in first-seen order. */
export function businessUnitsFromGrants(grants: Iterable<RoleScope>): string[] {
  const seen = new Set<string>();
  for (const grant of grants) {
    if (grant.scope.kind === 'business_unit') seen.add(grant.scope.businessUnit);
  }
  return [...seen];
}

export function createBusinessUnitDirectory(ids: Iterable<string>): BusinessUnitDirectory {
  const set = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && id.trim() !== '') set.add(id);
  }
  const list = Object.freeze([...set]);
  return { list: () => list, has: (id) => set.has(id) };
}
