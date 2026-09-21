// The configured BU keys `businessUnitId` must match (W0-02 7.3: "must be a configured BU key (fixture BUs 'CM',
// 'HR'; W0-03 section 7) or 422 invalid_input"; W0-04 `case.business_unit_id`: "a key from the fixture BU list in
// slice 1; the AD-group mapping arrives at W6/W8"). Slice 1 takes the list from `FIXTURE_BUSINESS_UNITS` in every
// identity mode (start.ts loads only the keys; the identities stay fixture-mode only) plus the `business_unit`
// grants of the fixture identities, so the keys a fixture SPOC can be granted are always in the set. Never a
// free-text value.

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
