// W0-05 "Query scope (W1-02, W3-01, Drizzle)" and W0-04 Interfaces: the one scope predicate
// every list, search and count query starts from. It is built from the actor's grants that hold a `case.view`
// policy row (never from the role list as a hint, never from the descriptive `business_unit` text) and applied
// inside the SQL WHERE before any other filter, LIMIT or COUNT, so counts and pages are computed over in-scope
// rows only (A06). `caseScopeWhere` is that predicate; the unused `scopedCases` sub-select was removed (W3-F6).

import { inArray, or, sql, type SQL } from 'drizzle-orm';
import { rowsForAction, type Actor } from '../authz/policy.js';
import { cases } from '../db/schema/case.js';

/** The pure shape of the predicate, so the rule can be unit-tested without SQL. */
export type CaseScopeSpec =
  | { kind: 'all' } // an all_cases grant with a case.view row: no case filter
  | { kind: 'none' } // no grant with a case.view row: nothing is in scope
  | { kind: 'filter'; ownerSubjectIds: string[]; businessUnitIds: string[] }; // own_cases and/or business_unit grants

export function caseScopeSpec(actor: Actor): CaseScopeSpec {
  const viewRows = rowsForAction('case.view');
  const ownerSubjectIds = new Set<string>();
  const businessUnitIds = new Set<string>();
  for (const grant of actor.roles) {
    const row = viewRows.find((r) => r.role === grant.role && r.scope === grant.scope.kind);
    if (row === undefined) continue; // this grant carries no case.view row: it contributes nothing
    switch (grant.scope.kind) {
      case 'all_cases':
        return { kind: 'all' };
      case 'own_cases':
        ownerSubjectIds.add(actor.subjectId);
        break;
      case 'business_unit':
        businessUnitIds.add(grant.scope.businessUnit);
        break;
    }
  }
  if (ownerSubjectIds.size === 0 && businessUnitIds.size === 0) return { kind: 'none' };
  return { kind: 'filter', ownerSubjectIds: [...ownerSubjectIds], businessUnitIds: [...businessUnitIds] };
}

/** The WHERE clause (W0-05): owner → owner_subject_id = $subject; SPOC → business_unit_id = ANY($bus); all → TRUE. */
export function caseScopeWhere(actor: Actor): SQL {
  const spec = caseScopeSpec(actor);
  switch (spec.kind) {
    case 'all':
      return sql`TRUE`;
    case 'none':
      return sql`FALSE`;
    case 'filter': {
      const parts: SQL[] = [];
      if (spec.ownerSubjectIds.length > 0) parts.push(inArray(cases.ownerSubjectId, spec.ownerSubjectIds));
      if (spec.businessUnitIds.length > 0) parts.push(inArray(cases.businessUnitId, spec.businessUnitIds));
      return parts.length === 1 ? parts[0]! : or(...parts)!;
    }
  }
}
