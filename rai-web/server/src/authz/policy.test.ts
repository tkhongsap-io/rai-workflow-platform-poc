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

/** Lane matching the reviewer role so own_lane / owning_lane rows allow in the table-driven sweep. */
function laneForRole(role: Role): 'ai_coe' | 'dpo' | 'it_security' {
  if (role === 'ai_coe' || role === 'it_security') return role;
  return 'dpo';
}

/** The target an action is evaluated against in the table-driven test, with facts every scope kind covers. */
function targetFor(action: Action, facts: CaseScopeFacts, role: Role = 'dpo'): Target {
  switch (action) {
    case 'case.list':
    case 'config.read_effective':
    case 'config.read_revisions':
    case 'config.publish':
    case 'audit.read':
    case 'queue.search':
    case 'queue.count':
    case 'operator.view':
    case 'dashboard.view': // W6-01: scope applied in SQL by caseScopeWhere
      return { kind: 'none' };
    case 'lane.approve':
    case 'lane.send_back':
      return { kind: 'lane', facts, lane: laneForRole(role) };
    case 'finding.propose_fixed':
    case 'finding.mark_fixed':
    case 'finding.confirm_fixed':
    case 'finding.waive':
    case 'finding.mark_na':
      return { kind: 'finding', facts, owningLane: laneForRole(role) };
    default:
      return { kind: 'case', facts };
  }
}

test('every row names a known role and action; W1-00 plus W2-02 D05 rows are present; W3-07a operator row is present', () => {
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
      'case.resubmit',
      'case.submit',
      'case.view',
      'config.publish',
      'config.read_effective',
      'config.read_revisions',
      'dashboard.view',
      'finding.confirm_fixed',
      'finding.mark_fixed',
      'finding.mark_na',
      'finding.propose_fixed',
      'finding.waive',
      'history.view',
      'lane.approve',
      'lane.send_back',
      'operator.view',
      'qc.recheck',
      'version.view',
    ],
    'queue.* remain without rows; operator.view is Admin-only; W6-01 adds qc.recheck and dashboard.view',
  );
  for (const row of POLICY_ROWS) {
    assert.ok((ROLES as readonly string[]).includes(row.role));
    assert.ok((ACTIONS as readonly string[]).includes(row.action));
  }
  const laneRows = POLICY_ROWS.filter((r) => r.action === 'lane.approve' || r.action === 'lane.send_back');
  assert.equal(laneRows.length, 6);
  for (const row of laneRows) {
    assert.equal(row.laneRule, 'own_lane');
    assert.equal(row.excludeOwnerOrSpoc, true);
  }
  const dispositionRows = POLICY_ROWS.filter((r) =>
    ['finding.mark_fixed', 'finding.confirm_fixed', 'finding.waive', 'finding.mark_na'].includes(r.action),
  );
  assert.equal(dispositionRows.length, 12);
  for (const row of dispositionRows) {
    assert.equal(row.laneRule, 'owning_lane');
    assert.equal(row.excludeOwnerOrSpoc, true);
  }
  assert.ok(Object.isFrozen(POLICY_ROWS));
});

test('table-driven: for every role × action, access is granted iff a policy row exists (deny by default)', () => {
  let allowed = 0;
  let denied = 0;
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const hasRow = POLICY_ROWS.some((r) => r.action === action && r.role === role);
      // inScope: owner/SPOC cover; reviewers are not owner/SPOC grants so excludeOwnerOrSpoc still allows.
      const decision = authorize(actorOf(role), action, targetFor(action, inScope, role));
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

test('T34 / D05: real POLICY_ROWS — lane and disposition self-exclusion (owner branch) and wrong-lane / Admin', () => {
  const reviewerOwner: Actor = { subjectId: S, roles: [grantFor('dpo'), grantFor('owner')] };
  const ownCase: CaseScopeFacts = { ownerSubjectId: S, businessUnitId: 'CM' };
  const otherCase: CaseScopeFacts = { ownerSubjectId: OTHER, businessUnitId: 'CM' };
  for (const action of [
    'lane.approve',
    'lane.send_back',
    'finding.mark_fixed',
    'finding.waive',
    'finding.mark_na',
    'finding.confirm_fixed',
  ] as const) {
    const ownTarget: Target = action.startsWith('lane.')
      ? { kind: 'lane', facts: ownCase, lane: 'dpo' }
      : { kind: 'finding', facts: ownCase, owningLane: 'dpo' };
    assert.deepEqual(
      authorize(reviewerOwner, action, ownTarget),
      { allow: false, code: 'forbidden', reason: 'self_approval' },
      `own case ${action}`,
    );
    const otherTarget: Target = action.startsWith('lane.')
      ? { kind: 'lane', facts: otherCase, lane: 'dpo' }
      : { kind: 'finding', facts: otherCase, owningLane: 'dpo' };
    const ok = authorize(reviewerOwner, action, otherTarget);
    assert.equal(ok.allow, true, `other case ${action}`);
    assert.equal(ok.allow && ok.via.role, 'dpo');
  }
  assert.deepEqual(
    authorize(actorOf('dpo'), 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'it_security' }),
    { allow: false, code: 'forbidden', reason: 'lane' },
  );
  assert.deepEqual(
    authorize(actorOf('dpo'), 'finding.waive', { kind: 'finding', facts: otherCase, owningLane: 'ai_coe' }),
    { allow: false, code: 'forbidden', reason: 'lane' },
  );
  assert.deepEqual(
    authorize(actorOf('admin'), 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'dpo' }),
    { allow: false, code: 'forbidden', reason: 'role' },
  );
  assert.deepEqual(
    authorize(actorOf('admin'), 'lane.send_back', { kind: 'lane', facts: otherCase, lane: 'dpo' }),
    { allow: false, code: 'forbidden', reason: 'role' },
  );
  // dual-role SPOC branch: forbidden on HR, allowed on CM
  const dual: Actor = { subjectId: S, roles: [grantFor('dpo'), grantFor('bu_spoc', 'HR')] };
  assert.deepEqual(
    authorize(dual, 'lane.approve', {
      kind: 'lane',
      facts: { ownerSubjectId: OTHER, businessUnitId: 'HR' },
      lane: 'dpo',
    }),
    { allow: false, code: 'forbidden', reason: 'self_approval' },
  );
  assert.deepEqual(
    authorize(dual, 'lane.send_back', {
      kind: 'lane',
      facts: { ownerSubjectId: OTHER, businessUnitId: 'HR' },
      lane: 'dpo',
    }),
    { allow: false, code: 'forbidden', reason: 'self_approval' },
  );
  assert.equal(authorize(dual, 'lane.approve', { kind: 'lane', facts: otherCase, lane: 'dpo' }).allow, true);
});

test('authorize is pure: the same inputs give the same decision and the actor is not mutated', () => {
  const actor = actorOf('owner');
  const before = JSON.stringify(actor);
  const a = authorize(actor, 'case.view', { kind: 'case', facts: inScope });
  const b = authorize(actor, 'case.view', { kind: 'case', facts: inScope });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(actor), before);
});

test('W3-07a operator.view admits only Admin, including explicit denial of combined non-Admin roles (W0-05 T14)', () => {
  assert.deepEqual(rowsForAction('operator.view'), [
    { action: 'operator.view', role: 'admin', scope: 'all_cases' },
  ]);
  assert.equal(authorize(actorOf('admin'), 'operator.view', { kind: 'none' }).allow, true);
  for (const role of ROLES.filter((role) => role !== 'admin')) {
    assert.equal(authorize(actorOf(role), 'operator.view', { kind: 'none' }).allow, false, role);
  }
  assert.equal(authorize(actorOf('owner', 'dpo'), 'operator.view', { kind: 'none' }).allow, false);
  assert.equal(authorize(actorOf(), 'operator.view', { kind: 'none' }).allow, false);
  assert.equal(
    authorize(actorOf('admin'), 'lane.approve', { kind: 'lane', facts: outOfScope, lane: 'dpo' }).allow,
    false,
  );
});

// W6-01 (W6 plan section 4.1): the W6 rows. qc.recheck is Admin only; dashboard.view is every role, scoped in SQL.

test('W6-01: qc.recheck is Admin only, on a case target; every reviewer role is denied with reason role', () => {
  assert.deepEqual(rowsForAction('qc.recheck'), [
    { action: 'qc.recheck', role: 'admin', scope: 'all_cases' },
  ]);
  for (const facts of [inScope, outOfScope]) {
    const decision = authorize(actorOf('admin'), 'qc.recheck', { kind: 'case', facts });
    assert.equal(decision.allow, true);
    assert.equal(decision.allow && decision.via.role, 'admin');
  }
  for (const role of ROLES.filter((r) => r !== 'admin')) {
    assert.deepEqual(
      authorize(actorOf(role), 'qc.recheck', { kind: 'case', facts: inScope }),
      { allow: false, code: 'forbidden', reason: 'role' },
      role,
    );
  }
  assert.equal(
    authorize(actorOf('ai_coe', 'dpo', 'it_security'), 'qc.recheck', { kind: 'case', facts: inScope }).allow,
    false,
  );
});

test('W6-01: dashboard.view is granted to all six roles through the VIEW_ROLES scopes', () => {
  assert.deepEqual(
    rowsForAction('dashboard.view').map((row) => [row.role, row.scope]),
    [
      ['owner', 'own_cases'],
      ['bu_spoc', 'business_unit'],
      ['ai_coe', 'all_cases'],
      ['dpo', 'all_cases'],
      ['it_security', 'all_cases'],
      ['admin', 'all_cases'],
    ],
  );
  for (const role of ROLES) {
    assert.equal(authorize(actorOf(role), 'dashboard.view', { kind: 'none' }).allow, true, role);
  }
  assert.equal(authorize(actorOf(), 'dashboard.view', { kind: 'none' }).allow, false);
});

test('W6-01 T40 (unit level): every non-Admin role, alone or combined, is denied each Admin configuration action', () => {
  const adminActions = ['config.read_revisions', 'config.publish', 'qc.recheck'] as const;
  const targetOf = (action: (typeof adminActions)[number]): Target =>
    action === 'qc.recheck' ? { kind: 'case', facts: outOfScope } : { kind: 'none' };
  for (const action of adminActions) {
    assert.equal(authorize(actorOf('admin'), action, targetOf(action)).allow, true, action);
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      assert.deepEqual(
        authorize(actorOf(role), action, targetOf(action)),
        { allow: false, code: 'forbidden', reason: 'role' },
        `${role} × ${action}`,
      );
    }
    assert.deepEqual(
      authorize(actorOf('owner', 'bu_spoc', 'ai_coe', 'dpo', 'it_security'), action, targetOf(action)),
      { allow: false, code: 'forbidden', reason: 'role' },
      `combined non-Admin roles × ${action}`,
    );
  }
  // T18: Admin still holds no lane or finding authority.
  const adminActionsHeld = new Set(
    POLICY_ROWS.filter((row) => row.role === 'admin').map((row) => row.action),
  );
  for (const action of adminActionsHeld) {
    assert.equal(action.startsWith('lane.') || action.startsWith('finding.'), false, action);
  }
});
