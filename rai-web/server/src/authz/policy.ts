// W0-05 section 6 "Policy module (W1-00)": the matrix lives as data (POLICY_ROWS) and one pure function decides.
// Deny by default: access exists only where a row exists; an unknown role or action is a programming error and
// throws (never a 403). Scope is enforced only here (W0-02 section 1.1); routes declare the action they need and
// the W1-01b middleware calls `authorize`. W1-00 ships the view / list / create-edit-submit / download / config /
// audit rows; the W2-02 contract PR adds lane.*, case.resubmit and finding.* with the D05 rules; W3-01/W3-03 add
// queue.* and operator.view; W6-01 adds qc.recheck and dashboard.view. Adding a row is a contract change and its own PR.

import {
  ROLES,
  type Lane,
  type Principal,
  type Role,
  type RoleScope,
  type ScopeKind,
} from '@rai/shared/schemas/auth';
import type { CaseId, SubjectId } from '@rai/shared/ids';

export const ACTIONS = [
  // W1-00 rows (case.create is authorized against facts taken from the body; case.list is a scoped query)
  'case.view',
  'case.list',
  'case.create',
  'case.edit_draft',
  'case.submit',
  'artifact.upload',
  'artifact.download',
  'version.view',
  'history.view',
  'config.read_effective',
  'config.read_revisions',
  'config.publish',
  'audit.read',
  // W2-02 contract PR rows (D05); identifiers exist so a route can name them, rows arrive with that PR
  'lane.approve',
  'lane.send_back',
  'case.resubmit',
  'finding.propose_fixed',
  'finding.mark_fixed',
  'finding.confirm_fixed',
  'finding.waive',
  'finding.mark_na',
  // W3 rows
  'queue.search',
  'queue.count',
  'operator.view',
  // W6-01 rows (W6 plan section 4.1)
  'qc.recheck',
  'dashboard.view',
] as const;
export type Action = (typeof ACTIONS)[number];

export type ScopeRule = ScopeKind; // 'own_cases' | 'business_unit' | 'all_cases'

export interface PolicyRow {
  action: Action;
  role: Role;
  scope: ScopeRule; // which of the actor's scopes may cover the target
  laneRule?: 'own_lane' | 'owning_lane'; // lane.* and finding.* rows only
  excludeOwnerOrSpoc?: true; // D05 self-exclusion rows only
}

/** Scope facts come from the Case entity only (W0-04 owner_subject_id, business_unit_id), or from the body on create. */
export interface CaseScopeFacts {
  caseId?: CaseId; // undefined only on case.create
  ownerSubjectId: SubjectId;
  businessUnitId: string;
}

export type Target =
  | { kind: 'none' } // case.list, queue.*, config.*, audit.read, operator.view, dashboard.view, and the role-only first call of case.create
  | { kind: 'case'; facts: CaseScopeFacts } // view, edit, submit, download, version, history, qc.recheck, create (facts from the body)
  | { kind: 'lane'; facts: CaseScopeFacts; lane: Lane } // lane.approve, lane.send_back
  | { kind: 'finding'; facts: CaseScopeFacts; owningLane: Lane } // finding.*; owningLane is W0-04 qc_finding.owning_lane
  | { kind: 'unresolved' }; // :caseId / :artifactId resolved to no row: role and scope steps only

export type DenyReason = 'role' | 'scope' | 'lane' | 'self_approval';

export type Decision =
  { allow: true; via: PolicyRow } | { allow: false; code: 'forbidden'; reason: DenyReason };

export type Actor = Pick<Principal, 'subjectId' | 'roles'>;

const VIEW_ROLES: ReadonlyArray<[Role, ScopeRule]> = [
  ['owner', 'own_cases'],
  ['bu_spoc', 'business_unit'],
  ['ai_coe', 'all_cases'],
  ['dpo', 'all_cases'],
  ['it_security', 'all_cases'],
  ['admin', 'all_cases'],
];
const WRITE_ROLES: ReadonlyArray<[Role, ScopeRule]> = [
  ['owner', 'own_cases'],
  ['bu_spoc', 'business_unit'],
];
const ADMIN_ONLY: ReadonlyArray<[Role, ScopeRule]> = [['admin', 'all_cases']];

function rows(action: Action, pairs: ReadonlyArray<[Role, ScopeRule]>): PolicyRow[] {
  return pairs.map(([role, scope]) => ({ action, role, scope }));
}

/**
 * The W0-05 matrix rows W1-00 owns (sections 3.1 and 3.2). Everything not listed is denied.
 * Ready for launch and the four projection writes are not actions of any actor and have no row (W0-05 sections 3.2, 5).
 */
const REVIEWER_LANES: ReadonlyArray<[Role, Lane]> = [
  ['ai_coe', 'ai_coe'],
  ['dpo', 'dpo'],
  ['it_security', 'it_security'],
];

/** W2-02 D05: own-lane decision with no self-approval (owner or BU SPOC on the case). */
function laneDecisionRows(action: 'lane.approve' | 'lane.send_back'): PolicyRow[] {
  return REVIEWER_LANES.map(([role]) => ({
    action,
    role,
    scope: 'all_cases' as const,
    laneRule: 'own_lane' as const,
    excludeOwnerOrSpoc: true as const,
  }));
}

/** W2-02 D05: owning-lane disposition; provisional self-exclusion (W0-05 section 8). */
function owningLaneFindingRows(
  action: 'finding.mark_fixed' | 'finding.confirm_fixed' | 'finding.waive' | 'finding.mark_na',
): PolicyRow[] {
  return REVIEWER_LANES.map(([role]) => ({
    action,
    role,
    scope: 'all_cases' as const,
    laneRule: 'owning_lane' as const,
    excludeOwnerOrSpoc: true as const,
  }));
}

export const POLICY_ROWS: readonly PolicyRow[] = Object.freeze([
  ...rows('case.view', VIEW_ROLES), // View case, files, history: Own / BU / All / All / All / All
  ...rows('case.list', VIEW_ROLES), // scoped query; scope enforced by caseScopeWhere (W1-02)
  ...rows('case.create', WRITE_ROLES), // target: the case the body describes
  ...rows('case.edit_draft', WRITE_ROLES), // stored facts, then post-edit facts when a scope field changes
  ...rows('case.submit', WRITE_ROLES),
  ...rows('artifact.upload', WRITE_ROLES), // part of "create, edit draft, submit"
  ...rows('artifact.download', VIEW_ROLES), // follows case-view scope of the owning case
  ...rows('version.view', VIEW_ROLES), // never hidden from an in-scope actor (A07)
  ...rows('history.view', VIEW_ROLES),
  ...rows('config.read_effective', VIEW_ROLES), // value lists a screen needs; not operator_recipients
  ...rows('config.read_revisions', ADMIN_ONLY), // D06: operator_recipients holds addresses; Admin only
  ...rows('config.publish', ADMIN_ONLY), // W6-04: save and discard draft, publish, restore (W6 plan section 4.1)
  ...rows('operator.view', ADMIN_ONLY), // W3-07a: existing W0-05 T14/W0-10 Admin-only operator contract
  ...rows('audit.read', ADMIN_ONLY), // W0-04: Admin (the slice-1 operator audience, W0-05 section 8)
  // W2-02 contract: D05 lane decision, resubmit, disposition authority (W2-05 consumes finding.*)
  ...laneDecisionRows('lane.approve'),
  ...laneDecisionRows('lane.send_back'),
  ...rows('case.resubmit', WRITE_ROLES),
  ...rows('finding.propose_fixed', WRITE_ROLES),
  ...owningLaneFindingRows('finding.mark_fixed'),
  ...owningLaneFindingRows('finding.confirm_fixed'),
  ...owningLaneFindingRows('finding.waive'),
  ...owningLaneFindingRows('finding.mark_na'),
  // W6-01 (W6 plan section 4.1, Q11 and Q13; provisional agent-team rulings under Ta's delegation of 2026-09-27)
  ...rows('qc.recheck', ADMIN_ONLY), // target: the case; an explicit recheck exists because configuration changed
  ...rows('dashboard.view', VIEW_ROLES), // target none; every count is scoped in SQL by caseScopeWhere
]);

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);
const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS);

export class PolicyProgrammingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyProgrammingError';
  }
}

function assertKnownRole(role: string): asserts role is Role {
  if (!ROLE_SET.has(role)) throw new PolicyProgrammingError(`unknown role: ${role}`);
}

function assertKnownAction(action: string): asserts action is Action {
  if (!ACTION_SET.has(action)) throw new PolicyProgrammingError(`unknown action: ${action}`);
}

for (const row of POLICY_ROWS) {
  assertKnownRole(row.role);
  assertKnownAction(row.action);
}

/** W0-05 "Scope predicate": whether one grant covers the target's case facts. */
function grantCovers(actor: Actor, grant: RoleScope, target: Exclude<Target, { kind: 'none' }>): boolean {
  if (target.kind === 'unresolved') return grant.scope.kind === 'all_cases';
  switch (grant.scope.kind) {
    case 'own_cases':
      return target.facts.ownerSubjectId === actor.subjectId;
    case 'business_unit':
      return target.facts.businessUnitId === grant.scope.businessUnit;
    case 'all_cases':
      return true;
  }
}

/** D05 self-exclusion: the actor is owner of the case, or BU SPOC of the case's business unit. */
export function isOwnerOrSpocOnCase(actor: Actor, facts: CaseScopeFacts): boolean {
  return actor.roles.some(
    (grant) =>
      (grant.role === 'owner' && facts.ownerSubjectId === actor.subjectId) ||
      (grant.role === 'bu_spoc' && grant.scope.businessUnit === facts.businessUnitId),
  );
}

const REASON_RANK: Record<DenyReason, number> = { role: 0, scope: 1, lane: 2, self_approval: 3 };

/**
 * Pure evaluation of `rowsToUse` (W0-05 section 6). Evaluation order per row: role → scope → lane → self-exclusion;
 * the first row that allows wins; otherwise the denial reason is the most specific one reached.
 */
export function evaluate(
  rowsToUse: readonly PolicyRow[],
  actor: Actor,
  action: string,
  target: Target,
): Decision {
  assertKnownAction(action);
  for (const grant of actor.roles) assertKnownRole(grant.role);

  let reason: DenyReason = 'role';
  const reach = (r: DenyReason): void => {
    if (REASON_RANK[r] > REASON_RANK[reason]) reason = r;
  };

  for (const row of rowsToUse) {
    if (row.action !== action) continue;
    const grants = actor.roles.filter((g) => g.role === row.role && g.scope.kind === row.scope);
    if (grants.length === 0) continue; // role step: no grant for this row

    if (target.kind === 'none') return { allow: true, via: row }; // role rows only; scope applied by the scoped query

    for (const grant of grants) {
      if (!grantCovers(actor, grant, target)) {
        reach('scope');
        continue;
      }
      if (target.kind === 'unresolved') return { allow: true, via: row }; // role and scope steps only

      if (row.laneRule !== undefined) {
        const actorLane =
          grant.scope.kind === 'all_cases' && 'lane' in grant.scope ? grant.scope.lane : undefined;
        const targetLane =
          row.laneRule === 'own_lane' && target.kind === 'lane'
            ? target.lane
            : row.laneRule === 'owning_lane' && target.kind === 'finding'
              ? target.owningLane
              : undefined;
        if (actorLane === undefined || targetLane === undefined || actorLane !== targetLane) {
          reach('lane');
          continue;
        }
      }
      if (row.excludeOwnerOrSpoc === true && isOwnerOrSpocOnCase(actor, target.facts)) {
        reach('self_approval');
        continue;
      }
      return { allow: true, via: row };
    }
  }
  return { allow: false, code: 'forbidden', reason };
}

/** The one decision function the middleware calls. Pure: no I/O, no clock. */
export function authorize(actor: Actor, action: Action, target: Target): Decision {
  return evaluate(POLICY_ROWS, actor, action, target);
}

/** Rows for one action (for `allowedActions` computation and operator documentation). */
export function rowsForAction(action: Action): PolicyRow[] {
  return POLICY_ROWS.filter((row) => row.action === action);
}
