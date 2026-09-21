import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixtureTableInvalid, createFixtureIdentityProvider, type FixtureIdentity } from './fixture.js';

const table: FixtureIdentity[] = [
  {
    fixtureUserId: 'fx-user-owner-cm',
    subjectId: 'fixture:fx-user-owner-cm',
    displayName: 'ณัฐพร ส. (Nattaporn S.)',
    email: 'owner.cm@rai-desk.example',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
  },
  {
    fixtureUserId: 'fx-user-dpo-spoc-hr',
    subjectId: 'fixture:fx-user-dpo-spoc-hr',
    displayName: 'Rattanaporn C.',
    email: 'dpo.spoc.hr@rai-desk.example',
    roles: [
      { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
      { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
    ],
  },
];

test('resolves a fixture user to its Principal with every (role, scope) pair; the dual-role identity keeps both', () => {
  const provider = createFixtureIdentityProvider(table);
  assert.equal(provider.mode, 'fixture');
  const owner = provider.resolve('fx-user-owner-cm');
  assert.deepEqual(owner, {
    subjectId: 'fixture:fx-user-owner-cm',
    displayName: 'ณัฐพร ส. (Nattaporn S.)',
    email: 'owner.cm@rai-desk.example',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
  });
  const dual = provider.resolve('fx-user-dpo-spoc-hr');
  assert.equal(dual?.roles.length, 2);
  assert.deepEqual(
    dual?.roles.map((r) => r.role),
    ['dpo', 'bu_spoc'],
  );
  assert.equal(provider.resolve('fx-user-nobody'), undefined);
  assert.deepEqual(
    provider.listUsers().map((u) => u.fixtureUserId),
    ['fx-user-owner-cm', 'fx-user-dpo-spoc-hr'],
  );
});

test('a resolved principal is a copy: mutating it does not change the table', () => {
  const provider = createFixtureIdentityProvider(table);
  const p = provider.resolve('fx-user-owner-cm');
  p?.roles.push({ role: 'admin', scope: { kind: 'all_cases' } });
  assert.equal(provider.resolve('fx-user-owner-cm')?.roles.length, 1);
});

test('the W0-03 section 2.3 invariants are enforced at construction', () => {
  const bad = (patch: Partial<FixtureIdentity>, extra?: FixtureIdentity) =>
    createFixtureIdentityProvider([{ ...table[0]!, ...patch }, ...(extra === undefined ? [] : [extra])]);
  assert.throws(() => bad({ roles: [] }), FixtureTableInvalid);
  assert.throws(() => bad({ subjectId: 'google:123' }), /issuer-qualified/);
  assert.throws(() => bad({ email: 'Owner.CM@rai-desk.example' }), /lower-cased/);
  assert.throws(() => bad({ displayName: '  ' }), /display name/);
  assert.throws(() => bad({}, { ...table[0]! }), /duplicate fixture user id/);
  assert.throws(
    () =>
      bad({
        roles: [
          { role: 'owner', scope: { kind: 'own_cases' } },
          { role: 'owner', scope: { kind: 'own_cases' } },
        ],
      }),
    /repeats/,
  );
});
