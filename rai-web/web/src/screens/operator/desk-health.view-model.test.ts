import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, RoleScope } from '@rai/shared/schemas/auth';
import {
  canCreateCase,
  isOperatorAdmin,
  visibleOperatorResult,
  type OperatorResult,
} from './desk-health.view-model.js';
function session(roles: RoleScope[]): SessionInfo {
  return {
    principal: {
      subjectId: 'fixture:synthetic',
      displayName: 'Synthetic',
      email: 'synthetic@rai-desk.example',
      roles,
    },
    identityMode: 'fixture',
    locale: 'th',
    expiresAt: '2026-09-23T00:00:00Z',
  };
}
const admin = session([{ role: 'admin', scope: { kind: 'all_cases' } }]);
const owner = session([{ role: 'owner', scope: { kind: 'own_cases' } }]);
test('presentation guard requires explicit Admin, including a dual-role non-Admin', () => {
  assert.equal(isOperatorAdmin(undefined), false);
  assert.equal(isOperatorAdmin(owner), false);
  assert.equal(
    isOperatorAdmin(
      session([
        { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
        { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
      ]),
    ),
    false,
  );
  assert.equal(isOperatorAdmin(admin), true);
});
test('New case is offered to owners and BU SPOCs, including a reviewer who also holds a SPOC grant', () => {
  assert.equal(canCreateCase(owner), true);
  assert.equal(
    canCreateCase(session([{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }])),
    true,
  );
  assert.equal(
    canCreateCase(
      session([
        { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
        { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
      ]),
    ),
    true,
  );
  assert.equal(canCreateCase(admin), false);
  assert.equal(canCreateCase(session([{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }])), false);
});
test('render gate invalidates data immediately for logout, role changes, same-subject session replacement and refresh', () => {
  const old: OperatorResult = {
    session: admin,
    generation: 0,
    kind: 'failed',
    error: new Error('old request'),
  };
  assert.equal(visibleOperatorResult(old, admin, 0), old);
  for (const current of [undefined, owner, structuredClone(admin)])
    assert.equal(visibleOperatorResult(old, current, 0), undefined);
  assert.equal(visibleOperatorResult(old, admin, 1), undefined);
  assert.equal(visibleOperatorResult(undefined, admin, 0), undefined);
});
