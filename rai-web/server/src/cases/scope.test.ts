// W0-05 "Query scope": the predicate is a function of the actor's case.view grants only. Owner → own subject; SPOC →
// its BU keys (several grants → several keys); reviewer and Admin → no filter; the dual-role identity → no filter
// (its DPO all_cases grant covers everything); a principal with no case.view row → FALSE. Rendered SQL never
// mentions the descriptive business_unit column.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Actor } from '../authz/policy.js';
import { caseInScope, caseScopeSpec, caseScopeWhere } from './scope.js';

const dialect = new PgDialect();
const render = (actor: Actor) => dialect.sqlToQuery(caseScopeWhere(actor));

const owner: Actor = {
  subjectId: 'fixture:fx-user-owner-cm',
  roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
};
const spoc: Actor = {
  subjectId: 'fixture:fx-user-spoc-cm',
  roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
};
const twoBus: Actor = {
  subjectId: 'fixture:spoc-two',
  roles: [
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
  ],
};
const dpo: Actor = {
  subjectId: 'fixture:fx-user-dpo',
  roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }],
};
const admin: Actor = {
  subjectId: 'fixture:fx-user-admin',
  roles: [{ role: 'admin', scope: { kind: 'all_cases' } }],
};
const dual: Actor = {
  subjectId: 'fixture:fx-user-dpo-spoc-hr',
  roles: [
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
  ],
};
const nobody: Actor = { subjectId: 'fixture:nobody', roles: [] };

test('owner → own subject only; SPOC → its BU keys; both grants → OR of the two', () => {
  assert.deepEqual(caseScopeSpec(owner), {
    kind: 'filter',
    ownerSubjectIds: [owner.subjectId],
    businessUnitIds: [],
  });
  assert.deepEqual(caseScopeSpec(spoc), { kind: 'filter', ownerSubjectIds: [], businessUnitIds: ['CM'] });
  assert.deepEqual(caseScopeSpec(twoBus), {
    kind: 'filter',
    ownerSubjectIds: [],
    businessUnitIds: ['CM', 'HR'],
  });
  const mixed: Actor = { subjectId: 'fixture:mixed', roles: [...owner.roles, ...spoc.roles] };
  assert.deepEqual(caseScopeSpec(mixed), {
    kind: 'filter',
    ownerSubjectIds: ['fixture:mixed'],
    businessUnitIds: ['CM'],
  });
  const q = render(mixed);
  assert.match(q.sql, /"case"\."owner_subject_id" in \(\$1\)/);
  assert.match(q.sql, /"case"\."business_unit_id" in \(\$2\)/);
  assert.match(q.sql, / or /);
  assert.deepEqual(q.params, ['fixture:mixed', 'CM']);
});

test('reviewers, Admin and the dual-role identity get no case filter (TRUE); no grant with a case.view row gets FALSE', () => {
  for (const actor of [dpo, admin, dual]) {
    assert.deepEqual(caseScopeSpec(actor), { kind: 'all' });
    assert.equal(render(actor).sql, 'TRUE');
  }
  assert.deepEqual(caseScopeSpec(nobody), { kind: 'none' });
  assert.equal(render(nobody).sql, 'FALSE');
});

test('the rendered clause never reads the descriptive business_unit text column', () => {
  for (const actor of [owner, spoc, twoBus, dual]) {
    assert.doesNotMatch(render(actor).sql, /"business_unit"[^_]/);
    assert.doesNotMatch(render(actor).sql, /business_owner/);
  }
});

test('caseInScope applies the same rule to a single row', () => {
  const cm = { ownerSubjectId: owner.subjectId, businessUnitId: 'CM' };
  const hr = { ownerSubjectId: 'fixture:someone', businessUnitId: 'HR' };
  assert.equal(caseInScope(owner, cm), true);
  assert.equal(caseInScope(owner, hr), false);
  assert.equal(caseInScope(spoc, cm), true);
  assert.equal(caseInScope(spoc, hr), false);
  assert.equal(caseInScope(dpo, hr), true);
  assert.equal(caseInScope(nobody, cm), false);
});
