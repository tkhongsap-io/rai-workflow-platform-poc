// W0-03 section 7 rule: exactly eight entries, unique ids, unique emails, exactly two owners, only the dual-role
// identity has more than one pair. Every address is at the reserved domain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { PrincipalSchema } from '@rai/shared/schemas/auth';
import {
  DUAL_ROLE_FIXTURE_USER_ID,
  FIXTURE_BUSINESS_UNITS,
  FIXTURE_EMAIL_DOMAIN,
  FIXTURE_OPERATOR_RECIPIENT,
  FIXTURE_USERS,
  findFixtureUser,
} from './users.js';

test('eight fixture users with unique ids, subjects and emails at rai-desk.example', () => {
  assert.equal(FIXTURE_USERS.length, 8);
  assert.equal(new Set(FIXTURE_USERS.map((u) => u.fixtureUserId)).size, 8);
  assert.equal(new Set(FIXTURE_USERS.map((u) => u.subjectId)).size, 8);
  assert.equal(new Set(FIXTURE_USERS.map((u) => u.email)).size, 8);
  for (const u of FIXTURE_USERS) {
    assert.match(u.fixtureUserId, /^fx-user-[a-z0-9-]+$/, u.fixtureUserId);
    assert.equal(u.subjectId, `fixture:${u.fixtureUserId}`);
    assert.ok(u.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`), u.email);
    assert.equal(u.email, u.email.toLowerCase());
    assert.ok(u.displayName.trim().length > 0);
    assert.ok(
      Value.Check(PrincipalSchema, {
        subjectId: u.subjectId,
        displayName: u.displayName,
        email: u.email,
        roles: u.roles,
      }),
      u.fixtureUserId,
    );
  }
  assert.ok(Object.isFrozen(FIXTURE_USERS));
});

test('exactly two owners; only fx-user-dpo-spoc-hr holds more than one (role, scope) pair', () => {
  const owners = FIXTURE_USERS.filter((u) => u.roles.some((r) => r.role === 'owner'));
  assert.deepEqual(
    owners.map((u) => u.fixtureUserId),
    ['fx-user-owner-cm', 'fx-user-owner-cm-2'],
  );
  const multi = FIXTURE_USERS.filter((u) => u.roles.length > 1);
  assert.deepEqual(
    multi.map((u) => u.fixtureUserId),
    [DUAL_ROLE_FIXTURE_USER_ID],
  );
  const dual = findFixtureUser(DUAL_ROLE_FIXTURE_USER_ID);
  assert.deepEqual(dual?.roles, [
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
  ]);
  // no duplicate (role, scope) pair inside any user
  for (const u of FIXTURE_USERS) {
    const keys = u.roles.map((r) => JSON.stringify(r));
    assert.equal(new Set(keys).size, keys.length, u.fixtureUserId);
  }
});

test('one user per source-spec role, the Thai-named owner, the two fixture BUs and the operator recipient', () => {
  const single = (id: string) => findFixtureUser(id)?.roles.map((r) => r.role);
  assert.deepEqual(single('fx-user-spoc-cm'), ['bu_spoc']);
  assert.deepEqual(single('fx-user-ai-coe'), ['ai_coe']);
  assert.deepEqual(single('fx-user-dpo'), ['dpo']);
  assert.deepEqual(single('fx-user-it-security'), ['it_security']);
  assert.deepEqual(single('fx-user-admin'), ['admin']);
  assert.match(
    findFixtureUser('fx-user-owner-cm')?.displayName ?? '',
    /[฀-๿]/,
    'Thai script in the first owner',
  );
  assert.deepEqual(
    FIXTURE_BUSINESS_UNITS.map((b) => b.businessUnitId),
    ['CM', 'HR'],
  );
  assert.equal(FIXTURE_OPERATOR_RECIPIENT, 'operator-digest@rai-desk.example');
  assert.equal(findFixtureUser('fx-user-nobody'), undefined);
});
