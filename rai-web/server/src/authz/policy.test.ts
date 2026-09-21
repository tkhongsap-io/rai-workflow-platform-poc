// W1-00 Done when: the policy module rejects an unknown role; nothing grants access without a policy row
// (table-driven over every role × action in the module). W0-05 test obligations T14, T15, T34 at the unit level.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, type Role, type RoleScope } from '@rai/shared/schemas/auth';
import type { SubjectId } from '@rai/shared/ids';
import {
  ACTIONS,
  POLICY_ROWS,
  PolicyProgrammingError,
  authorize,
  evaluate,
  isOwnerOrSpocOnCase,
  rowsForAction,
  type Action,
  type Actor,
  type CaseScopeFacts,
  type PolicyRow,
  type Target,
} from './policy.js';

const S = 'fixture:actor' as SubjectId;
const OTHER = 'fixture:someone-else' as SubjectId;

function grantFor(role: Role, businessUnit = 'CM'): RoleScope {
  switch (role) {
    case 'owner':
      return { role, scope: { kind: 'own_cases' } };
    case 'bu_spoc':
      return { role, scope: { kind: 'business_unit', businessUnit } };
    case 'ai_coe':
      return { role, scope: { kind: 'all_cases', lane: 'ai_coe' } };
    case 'dpo':
      return { role, scope: { kind: 'all_cases', lane: 'dpo' } };
    case 'it_security':
      return { role, scope: { kind: 'all_cases', lane: 'it_security' } };
    case 'admin':
      return { role, scope: { kind: 'all_cases' } };
  }
}

const actorOf = (...roles: Role[]): Actor => ({ subjectId: S, roles: roles.map((r) => grantFor(r)) });

const inScope: CaseScopeFacts = { caseId: 'c-1', ownerSubjectId: S, businessUnitId: 'CM' };
const outOfScope: CaseScopeFacts = { caseId: 'c-2', ownerSubjectId: OTHER, businessUnitId: 'HR' };

/** The target an action is evaluated against in the table-driven test, with facts every scope kind covers. */
function targetFor(action: Action, facts: CaseScopeFacts): Target {
  switch (action) {
    case 'case.list':
    case 'config.read_effective':
    case 'config.read_revisions':
    case 'config.publish':
    case 'audit.read':
    case 'queue.search':
    case 'queue.count':
    case 'operator.view':
      return { kind: 'none' };
    case 'lane.approve':
    case 'lane.send_back':
      return { kind: 'lane', facts, lane: 'dpo' };
    case 'finding.propose_fixed':
    case 'finding.mark_fixed':
    case 'finding.confirm_fixed':
    case 'finding.waive':
    case 'finding.mark_na':
      return { kind: 'finding', facts, owningLane: 'dpo' };
    default:
      return { kind: 'case', facts };
  }
}

test('every row names a known role and action, and only the W1-00 actions have rows', () => {
  const actionsWithRows = new Set(POLICY_ROWS.map((r) => r.action));
  assert.deepEqual(
    [...actionsWithRows].sort(),
    [
      'artifact.download',
      'artifact.upload',
      'audit.read',
      'case.create',
      'case.edit_draft',
      'case.list',
      'case.submit',
      'case.view',
      'config.publish',
      'config.read_effective',
      'config.read_revisions',
      'history.view',
      'version.view',
    ],
    'lane.*, case.resubmit, finding.* (W2-02) and queue.*, operator.view (W3) have no row yet',
  );
  for (const row of POLICY_ROWS) {
    assert.ok((ROLES as readonly string[]).includes(row.role));
    assert.ok((ACTIONS as readonly string[]).includes(row.action));
    assert.equal(row.laneRule, undefined, 'no W1-00 row carries a lane rule');
    assert.equal(row.excludeOwnerOrSpoc, undefined, 'no W1-00 row carries the D05 exclusion');
  }
  assert.ok(Object.isFrozen(POLICY_ROWS));
});

test('table-driven: for every role × action, access is granted iff a policy row exists (deny by default)', () => {
  let allowed = 0;
  let denied = 0;
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const hasRow = POLICY_ROWS.some((r) => r.action === action && r.role === role);
      const decision = authorize(actorOf(role), action, targetFor(action, inScope));
      assert.equal(decision.allow, hasRow, `${role} × ${action}`);
      if (decision.allow) {
        allowed += 1;
        assert.equal(decision.via.action, action);
        assert.equal(decision.via.role, role);
      } else {
        denied += 1;
        assert.equal(decision.code, 'forbidden');
        assert.equal(decision.reason, 'role', `${role} × ${action} is denied for lack of a row`);
      }
    }
  }
  assert.equal(allowed, POLICY_ROWS.length, 'every row is reachable by exactly one role × action');
  assert.equal(allowed + denied, ACTIONS.length * ROLES.length);
});

test('an actor with no grants is denied every action', () => {
  for (const action of ACTIONS) {
    const decision = authorize({ subjectId: S, roles: [] }, action, targetFor(action, inScope));
    assert.equal(decision.allow, false, action);
  }
});

test('T15: an unknown role or an unknown action throws a programming error, never a 403', () => {
  const stranger: Actor = {
    subjectId: S,
    roles: [{ role: 'operator', scope: { kind: 'all_cases' } } as unknown as RoleScope],
  };
  assert.throws(
    () => authorize(stranger, 'case.view', { kind: 'case', facts: inScope }),
    PolicyProgrammingError,
  );
  assert.throws(
    () => authorize(stranger, 'case.view', { kind: 'case', facts: inScope }),
    /unknown role: operator/,
  );
  assert.throws(
    () => authorize(actorOf('admin'), 'case.delete' as Action, { kind: 'none' }),
    /unknown action: case.delete/,
  );
  assert.throws(() => evaluate([], actorOf('owner'), 'ready.set', { kind: 'none' }), PolicyProgrammingError);
});

test('scope: a row exists but the case is outside every matching scope → forbidden with reason scope', () => {
  for (const role of ['owner', 'bu_spoc'] as const) {
    for (const action of [
      'case.view',
      'case.edit_draft',
      'case.submit',
      'artifact.upload',
      'artifact.download',
      'version.view',
      'history.view',
    ] as const) {
      const decision = authorize(actorOf(role), action, { kind: 'case', facts: outOfScope });
      assert.deepEqual(decision, { allow: false, code: 'forbidden', reason: 'scope' }, `${role} × ${action}`);
    }
  }
  // a bu_spoc with two BU grants is covered by either
  const twoBu: Actor = { subjectId: S, roles: [grantFor('bu_spoc', 'CM'), grantFor('bu_spoc', 'HR')] };
  assert.equal(authorize(twoBu, 'case.view', { kind: 'case', facts: outOfScope }).allow, true);
  // reviewers and admin: all_cases covers everything
  for (const role of ['ai_coe', 'dpo', 'it_security', 'admin'] as const) {
    assert.equal(
      authorize(actorOf(role), 'case.view', { kind: 'case', facts: outOfScope }).allow,
      true,
      role,
    );
  }
});

test('create and edit targets: owner must remain the actor; SPOC must hold the resulting BU (W0-05 create/edit target)', () => {
  const owner = actorOf('owner');
  assert.equal(
    authorize(owner, 'case.create', { kind: 'case', facts: { ownerSubjectId: S, businessUnitId: 'ANY' } })
      .allow,
    true,
  );
  assert.deepEqual(
    authorize(owner, 'case.create', { kind: 'case', facts: { ownerSubjectId: OTHER, businessUnitId: 'CM' } }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'scope',
    },
  );
  const spoc = actorOf('bu_spoc');
  assert.equal(
    authorize(spoc, 'case.create', { kind: 'case', facts: { ownerSubjectId: OTHER, businessUnitId: 'CM' } })
      .allow,
    true,
  );
  assert.equal(
    authorize(spoc, 'case.create', { kind: 'case', facts: { ownerSubjectId: OTHER, businessUnitId: 'HR' } })
      .allow,
    false,
  );
  // the role-only first call of case.create (kind none) denies reviewers and admin before the body is read
  for (const role of ['ai_coe', 'dpo', 'it_security', 'admin'] as const) {
    assert.deepEqual(authorize(actorOf(role), 'case.create', { kind: 'none' }), {
      allow: false,
      code: 'forbidden',
      reason: 'role',
    });
  }
});

test('unresolved target (W0-05 section 4): own/BU-only actors are denied with scope; all_cases holders are allowed (→ 404)', () => {
  for (const role of ['owner', 'bu_spoc'] as const) {
    for (const action of ['case.view', 'artifact.download', 'artifact.upload'] as const) {
      assert.deepEqual(
        authorize(actorOf(role), action, { kind: 'unresolved' }),
        { allow: false, code: 'forbidden', reason: 'scope' },
        `${role} × ${action}`,
      );
    }
  }
  for (const role of ['ai_coe', 'dpo', 'it_security', 'admin'] as const) {
    const view = authorize(actorOf(role), 'case.view', { kind: 'unresolved' });
    assert.equal(view.allow, true);
    assert.equal(view.allow && view.via.scope, 'all_cases');
    assert.equal(authorize(actorOf(role), 'artifact.download', { kind: 'unresolved' }).allow, true);
    // T33 (iii): no upload row for reviewers → role, never 404
    assert.deepEqual(authorize(actorOf(role), 'artifact.upload', { kind: 'unresolved' }), {
      allow: false,
      code: 'forbidden',
      reason: 'role',
    });
  }
});

test('T14: config.read_revisions, config.publish and audit.read are Admin only; config.read_effective is every role', () => {
  for (const action of ['config.read_revisions', 'config.publish', 'audit.read'] as const) {
    assert.equal(authorize(actorOf('admin'), action, { kind: 'none' }).allow, true);
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      assert.deepEqual(
        authorize(actorOf(role), action, { kind: 'none' }),
        { allow: false, code: 'forbidden', reason: 'role' },
        `${role} × ${action}`,
      );
    }
  }
  for (const role of ROLES)
    assert.equal(authorize(actorOf(role), 'config.read_effective', { kind: 'none' }).allow, true, role);
  assert.equal(rowsForAction('audit.read').length, 1);
});

test('the dual-role identity (dpo + bu_spoc HR) reads everything and writes only in HR (W0-03 section 7)', () => {
  const dual: Actor = { subjectId: S, roles: [grantFor('dpo'), grantFor('bu_spoc', 'HR')] };
  const hrCase: CaseScopeFacts = { ownerSubjectId: OTHER, businessUnitId: 'HR' };
  const cmCase: CaseScopeFacts = { ownerSubjectId: OTHER, businessUnitId: 'CM' };
  assert.equal(authorize(dual, 'case.view', { kind: 'case', facts: cmCase }).allow, true);
  assert.equal(authorize(dual, 'case.submit', { kind: 'case', facts: hrCase }).allow, true);
  assert.deepEqual(authorize(dual, 'case.submit', { kind: 'case', facts: cmCase }), {
    allow: false,
    code: 'forbidden',
    reason: 'scope',
  });
  assert.equal(isOwnerOrSpocOnCase(dual, hrCase), true);
  assert.equal(isOwnerOrSpocOnCase(dual, cmCase), false);
  assert.equal(isOwnerOrSpocOnCase(actorOf('owner'), inScope), true);
  assert.equal(isOwnerOrSpocOnCase(actorOf('owner'), outOfScope), false);
});

test('T34 (evaluation logic for the W2-02 rows, exercised with synthesised rows): lane and self-exclusion reasons', () => {
  const w2Rows: PolicyRow[] = [
    {
      action: 'lane.approve',
      role: 'dpo',
      scope: 'all_cases',
      laneRule: 'own_lane',
      excludeOwnerOrSpoc: true,
    },
    {
      action: 'lane.approve',
      role: 'it_security',
      scope: 'all_cases',
      laneRule: 'own_lane',
      excludeOwnerOrSpoc: true,
    },
    {
      action: 'finding.waive',
      role: 'dpo',
      scope: 'all_cases',
      laneRule: 'owning_lane',
      excludeOwnerOrSpoc: true,
    },
  ];
  const reviewerOwner: Actor = { subjectId: S, roles: [grantFor('dpo'), grantFor('owner')] };
  const ownCase: CaseScopeFacts = { ownerSubjectId: S, businessUnitId: 'CM' };
  const otherCase: CaseScopeFacts = { ownerSubjectId: OTHER, businessUnitId: 'CM' };
  // own case: self_approval on the lane and on the finding (owner branch of isOwnerOrSpocOnCase)
  assert.deepEqual(
    evaluate(w2Rows, reviewerOwner, 'lane.approve', { kind: 'lane', facts: ownCase, lane: 'dpo' }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'self_approval',
    },
  );
  assert.deepEqual(
    evaluate(w2Rows, reviewerOwner, 'finding.waive', { kind: 'finding', facts: ownCase, owningLane: 'dpo' }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'self_approval',
    },
  );
  // other case: allowed via the dpo row
  const ok = evaluate(w2Rows, reviewerOwner, 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'dpo' });
  assert.equal(ok.allow, true);
  assert.equal(ok.allow && ok.via.role, 'dpo');
  // wrong lane: reason lane (more specific than role)
  assert.deepEqual(
    evaluate(w2Rows, actorOf('dpo'), 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'it_security' }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'lane',
    },
  );
  assert.deepEqual(
    evaluate(w2Rows, actorOf('dpo'), 'finding.waive', {
      kind: 'finding',
      facts: otherCase,
      owningLane: 'ai_coe',
    }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'lane',
    },
  );
  // admin has no lane row → role
  assert.deepEqual(
    evaluate(w2Rows, actorOf('admin'), 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'dpo' }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'role',
    },
  );
  // the SPOC branch: dpo + bu_spoc HR on an HR case
  const dual: Actor = { subjectId: S, roles: [grantFor('dpo'), grantFor('bu_spoc', 'HR')] };
  assert.deepEqual(
    evaluate(w2Rows, dual, 'lane.approve', {
      kind: 'lane',
      facts: { ownerSubjectId: OTHER, businessUnitId: 'HR' },
      lane: 'dpo',
    }),
    {
      allow: false,
      code: 'forbidden',
      reason: 'self_approval',
    },
  );
  assert.equal(
    evaluate(w2Rows, dual, 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'dpo' }).allow,
    true,
  );
});

test('authorize is pure: the same inputs give the same decision and the actor is not mutated', () => {
  const actor = actorOf('owner');
  const before = JSON.stringify(actor);
  const a = authorize(actor, 'case.view', { kind: 'case', facts: inScope });
  const b = authorize(actor, 'case.view', { kind: 'case', facts: inScope });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(actor), before);
});
