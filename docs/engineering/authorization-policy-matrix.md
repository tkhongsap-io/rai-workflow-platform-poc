# Authorization policy matrix (W0-05)

Status: W0 interface spec, written for the stack recorded in [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04); reconciled with the sibling specs at the W0 exit review ([W0-09](../../changes/2026-09-21-w0-exit/review.md), 2026-09-21; each applied change is marked "W0-09:"). Ticket W0-05 ([issue #10](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/10)), lane Lead, human review required. Proves A01 and A09 once W1-01, W2-02 and W3-01 implement it. Nothing here is implemented yet.

This document derives one table of role × action × scope from the [PRD](../../PRD.md) "Users and authority", the frozen [source spec](../product/source-spec.md) "Roles and access", the [data contract](../product/data-contract.md) "Access and retention" and the recorded rules D05, D06 and "W0-04 fields" in the [decision register](../product/decisions.md). It records no decision of its own: every D05 row is carried as written, D07-D10 stay open, and every place where this spec had to pick an engineering default is marked as such in [Resolutions and items for review](#8-resolutions-and-items-for-review).

Consumers: **W1-00** (policy module holding the view, create-edit-submit and download rows as data), **W1-01** (the authorization middleware, the only place scope is enforced), **W1-02**, **W1-03**, **W1-13** (substitute returns the same denials), **W2-02** (adds the D05 disposition and self-approval rows to the policy module as its contract PR), **W2-05**, **W2-06**, **W3-01** (queue query), **W3-03** (notification recipients), **W3-07** (operator view), and the exit tickets W1-08, W2-08, W3-06 that run the negative tests in [Test obligations](#7-test-obligations).

Sibling W0 specs: [W0-02 implementation plan](implementation-plan-w1-w3.md) (section 7.2 fixes the `Role`, `Lane` and `RoleScope` identifiers this spec uses; section 7.3 the create shape; section 8.3 the fixture identities), [W0-03 identity adapter](identity-adapter.md) (produces the actor this spec evaluates; its section 7 holds the fixture identities, including the second owner added at W0 exit), [W0-04 persistence](persistence-and-artifact-store.md) (`owner_subject_id` and `business_unit_id` scope columns on [`case`](persistence-and-artifact-store.md#case), the scope predicate under [Interfaces](persistence-and-artifact-store.md#interfaces), audit-log readers), [W0-06 workflow and error contract](workflow-transition-and-error-contract.md) (preconditions this spec's checks precede; the [section 4](workflow-transition-and-error-contract.md#4-events) check order session → authorization → existence that the middleware in [Section 6](#middleware-w1-01-fastify) realises; [owning-lane assignment](workflow-transition-and-error-contract.md#7-owning-lane-assignment)), [W0-07 QC and mail](qc-boundary-and-mail-sink.md) (recipients and the no-authority rule for QC), [W0-10 observability](observability-contract.md) (a 403 is logged as `authz.denied` with the [section 3.3](observability-contract.md#33-event-catalogue) fields and the [section 3.2](observability-contract.md#32-line-schema) envelope's correlation ID; a 401 is the `unauthenticated` capture of [section 6.1](observability-contract.md#61-category-map)). Every sibling is merged; each link points at its `docs/engineering/` file and that file's identifiers are used here verbatim.

## 1. Principles

1. **Server-side, every time.** Every read, list, count, search, filter option, download, deep link and write is authorized in the Fastify API before any data is fetched or any bytes are streamed (A01). The React SPA holds no permission logic; the demo's role switcher and client-side checks are never ported ([design-to-build map](../delivery/design-to-build-map.md)).
2. **Deny by default.** Access exists only where this matrix has a row. The policy module rejects an unknown role, an unknown action and an actor with no `(role, scope)` pair; a route that declares no action fails at server start, not at request time (W1-00 "nothing grants access without a policy row").
3. **Role gives the action; scope gives the cases.** A role names what an actor may do; the scope attached to that role by the identity adapter (W0-03) names which cases it applies to. Both are checked on every request, in that order.
4. **Lane authority is per lane, never implicit.** A reviewer decides only the lane their role maps to. Admin has no lane authority and never inherits one (PRD, source spec Admin row).
5. **D05 is carried as written.** Full re-review after resubmission and the merge of concurrent send-backs are W0-06 rules; this spec carries the two D05 authority rules: waived and N/A are recorded by the finding's owning lane, the owner may propose "fixed" which the owning lane confirms; and no one who is owner or BU SPOC on a case may approve a lane on that case.
6. **AI and mail have no authority.** QC (W0-07) and the notification boundary are not roles; nothing they return or deliver grants access, approves or transitions. A deep link is a URL and nothing more: sign-in and scope are checked when it is opened (A05).
7. **Denials are attributable, never audited.** Each 403, read or write, emits one structured log line `authz.denied` from the policy module, carrying exactly the [W0-10 section 3.3](observability-contract.md#33-event-catalogue) fields (`action`, `targetType`, `targetId?`, `actorSubjectId`, `actorRole`) and the correlation ID of the [W0-10 section 3.2](observability-contract.md#32-line-schema) envelope; the `reason` of the `Decision` ([Section 6](#6-enforcement-in-the-stack)) is on that line as the registered W0-10 3.3 field `reason` (W0-09 registered it on the request in [Resolutions](#8-resolutions-and-items-for-review)). A 401 is logged by the W0-10 `unauthenticated` capture ([section 6.1](observability-contract.md#61-category-map): info level, `route` only), not by the policy module, which never runs without an actor. In both cases no audit row is written and no state changes ([W0-06 section 8](workflow-transition-and-error-contract.md#8-error-contract): an audit row on a denial would let an attacker fill the audit log, and the W0-06 9.4 catalogue has no denial event). The response body stays the terse W0-06 8.2 envelope ([Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers)); the `Decision` and the log line, not the body, hold the true reason.

## 2. Vocabulary

### Roles

Six roles. The identifiers are the ones [W0-02 section 7.2](implementation-plan-w1-w3.md#72-sign-in-w0-03-served-by-w1-01a-consumed-by-w1-07) fixes for the shared package (`rai-web/shared/src/schemas/auth.ts`: `Role`, `Lane`, `RoleScope`); W0-02 is authoritative for the spelling and this spec uses it verbatim so that a `finding.*` check can compare the actor's lane with the W0-04 `qc_finding.owning_lane` column directly. No seventh role (D06).

| Identifier (W0-02 `Role`) | Role | Scope kind (W0-02 `RoleScope`) | Lane (W0-02 `Lane`) |
|---|---|---|---|
| `owner` | Use-case owner | `own_cases` | — |
| `bu_spoc` | BU SPOC | `business_unit` (one grant per business unit; a subject may hold several) | — |
| `ai_coe` | AI/COE reviewer | `all_cases` | `ai_coe` |
| `dpo` | DPO reviewer | `all_cases` | `dpo` |
| `it_security` | IT/Security reviewer | `all_cases` | `it_security` |
| `admin` | Admin | `all_cases` | — (never lane authority) |

The three reviewer roles carry their lane in the `RoleScope` (`{ kind: 'all_cases'; lane: 'dpo' }`), and the lane identifiers equal the values W0-04 stores in `qc_finding.owning_lane` and `lane_decision.lane` and W0-06 uses in its `Lane` type (`'ai_coe' | 'dpo' | 'it_security'`). The matrix headings "AI/COE", "DPO", "IT/Sec" and the cell shorthands **Own**, **BU**, **All** in [Section 3](#3-the-matrix) are prose for `ai_coe`, `dpo`, `it_security` and `own_cases`, `business_unit`, `all_cases`; no other identifier set exists. Slot-to-lane mapping (AI/COE 1+5 per D02, DPO 2-5, IT/Security 5-8) is the W0-06 versioned constant recorded on each submitted version; this spec never reads slots, only the lane recorded on a decision or on a finding's `owning_lane`.

### Actor

The identity adapter (W0-03) returns the actor; the policy module evaluates it and nothing else. One subject may hold several grants (the W0-03 dual-role fixture identity `fx-user-dpo-spoc-hr`, W0-02 section 8.3: a DPO reviewer who is also BU SPOC of fixture BU `HR`).

```ts
// Types imported from rai-web/shared/src/schemas/auth.ts (W0-02 section 7.2), reproduced for reading only:
type Role = 'owner' | 'bu_spoc' | 'ai_coe' | 'dpo' | 'it_security' | 'admin';
type Lane = 'ai_coe' | 'dpo' | 'it_security';

type RoleScope =
  | { role: 'owner';       scope: { kind: 'own_cases' } }                        // cases whose owner_subject_id is this subject
  | { role: 'bu_spoc';     scope: { kind: 'business_unit'; businessUnit: string } } // cases whose business_unit_id equals businessUnit
  | { role: 'ai_coe';      scope: { kind: 'all_cases'; lane: 'ai_coe' } }
  | { role: 'dpo';         scope: { kind: 'all_cases'; lane: 'dpo' } }
  | { role: 'it_security'; scope: { kind: 'all_cases'; lane: 'it_security' } }
  | { role: 'admin';       scope: { kind: 'all_cases' } };

// The actor this spec evaluates is the W0-02 Principal's identity and grants; displayName and email are never read by policy.
type Actor = Pick<Principal, 'subjectId' | 'roles'>;   // subjectId: SubjectId (opaque, never the email); roles: RoleScope[]
```

Scope facts come from the Case entity only, from the two columns W0-04 declares as scope columns on [`case`](persistence-and-artifact-store.md#case): `owner_subject_id` ("scope for the Owner role") and `business_unit_id` ("scope for the BU SPOC role"; a key from the W1-09 fixture BU list in slice 1). The one action with no stored case yet, `case.create`, takes the same facts from the validated request body (the case that would exist; see [Create target](#create-target-casecreate)). The one action that can rewrite the two scope columns, `case.edit_draft`, is evaluated against the stored facts and, when the body carries `businessOwner` or `businessUnitId`, against the post-edit facts as well (see [Edit target](#edit-target-caseedit_draft)). The inherited descriptive text columns `business_unit`, `business_owner` and `technical_owner` (W0-04 `case` row "Inherited descriptive fields") are registry values for display and search; they are never used to decide access. Note that the W0-02 shape field `businessOwner` is a `SubjectId` and is the value stored in `owner_subject_id`; it is not the descriptive `business_owner` text (see [Resolutions](#8-resolutions-and-items-for-review)).

```ts
type CaseScopeFacts = {
  caseId?: CaseId;           // undefined only on case.create (the case does not exist yet); set for every other target
  ownerSubjectId: SubjectId; // W0-04 case.owner_subject_id
  businessUnitId: string;    // W0-04 case.business_unit_id
};
```

### Create target (`case.create`)

A create has no stored case to load facts from, so the facts are built from the validated body and the actor before `authorize` runs; the same `inScope` predicate then applies unchanged:

- `businessUnitId` = the BU key the case will be stored under (W0-04 `business_unit_id`), taken from the W0-02 `CaseCreateRequest` field `businessUnitId` (section 7.3; W0-09 added it to the shape on this spec's request, beside the descriptive `businessUnit` text). For `bu_spoc` it must equal the `businessUnit` of one of the actor's `business_unit` grants, or the request is 403 `scope` (W0-02 section 7.3 route table: "bu_spoc names a `businessUnitId` outside its grants"). An unknown key is 422 `invalid_input`; the fact compared is always `business_unit_id`, never the descriptive text.
- `ownerSubjectId` = the body's `businessOwner` (W0-02 section 7.3: `businessOwner: SubjectId`, "defaults to the actor for role owner; a BU SPOC may name an owner in its BU"), which the create transaction stores in W0-04 `owner_subject_id` ("the creator, or the owner named by a BU SPOC creating on an owner's behalf"). For the `owner` role the server sets it to `actor.subjectId`; a body whose `businessOwner` names a different subject is 403 `scope` (W0-02 route table: "owner names a `businessOwner` other than itself"; the case would be outside the actor's `own_cases` scope). For `bu_spoc`, who "acts on the owner's behalf" (PRD "Users and authority"), `businessOwner` names the owner subject within the BU (absent, it defaults to the actor); the SPOC is recorded as the audit actor and the named owner as the case owner (the W1-INT SPOC-on-behalf test). A named subject that does not resolve, like a projected status field in the body ([Section 5](#5-w0-04-fields-projection-rule)), is 422 `invalid_input` at the W0-06 validation step, which for `case.create` runs after the role step and before the scope step ([Middleware](#middleware-w1-01-fastify)): a reviewer or Admin sending such a body is 403 `role`, never 422.
- The facts are evaluated before any row is written; a denied create writes no case and emits `authz.denied` (W0-10 section 3.3 fields, correlation ID from the 3.2 envelope; the `Decision.reason` is `scope`); no audit row, no state change (W0-06 section 8, principle 7).

### Edit target (`case.edit_draft`)

W0-02 section 7.3 `CaseUpdateRequest.fields` is `Partial<CaseWritableFields>`, which includes `businessOwner` and `businessUnitId`, the two values stored in the W0-04 scope columns `owner_subject_id` ("changes only through a W0-05-permitted action, which writes an audit event") and `business_unit_id`. A PATCH that carries either is a scope-changing write, so `case.edit_draft` is evaluated twice with the same `inScope` predicate, and both evaluations must allow (engineering default (b) in [Resolutions](#8-resolutions-and-items-for-review); the alternative, making the two fields immutable after create, would narrow the W0-02 shape and is not chosen here):

- **Stored facts first.** `CaseScopeFacts` are loaded by `caseId` as for every other case target; an actor outside the stored case's scope is 403 `scope` regardless of the body (T11).
- **Post-edit facts second.** When `fields.businessOwner` or `fields.businessUnitId` is present, the middleware builds the facts the case would have after the write (`ownerSubjectId` = `fields.businessOwner` ?? stored `owner_subject_id`; `businessUnitId` = `fields.businessUnitId` ?? stored `business_unit_id`) and calls `authorize` on them with the same row. The [Create target](#create-target-casecreate) rules therefore apply unchanged: for the `owner` role `businessOwner` must remain `actor.subjectId` (an owner cannot transfer a case out of `own_cases`; `businessUnit` is unconstrained for an owner, as on create, because `own_cases` covers the case whatever its BU); for `bu_spoc` the resulting `business_unit_id` must be in one of the actor's `business_unit` grants, and the SPOC may name a `businessOwner` within that BU. A resulting case outside the actor's scope is 403 `scope`; the middleware emits `authz.denied` (W0-10 section 3.3 fields, correlation ID from the 3.2 envelope); no audit row, no state change (W0-06 section 8).
- **Audit.** The `draft.saved` audit event (W0-06 4.2 and 9.4; W0-09 replaced the earlier `case.updated` name) for a write that changes either column carries the old and the new `owner_subject_id` and `business_unit_id` in `before_ref` / `after_ref` (the W0-04 rule that a scope change writes an audit event). Neither field may be written by any other action.
- A `businessOwner` that does not resolve to a subject, a `businessUnitId` that is not a configured BU key, or a projected status field in the body ([Section 5](#5-w0-04-fields-projection-rule)) is 422 `invalid_input` at the W0-06 step-4 validation, which runs after the stored-facts authorization (W0-06 step 2) and before the post-edit evaluation, which needs the validated body: an actor outside the stored case's scope gets 403 `scope` whatever the body carries (T11), and only an actor allowed on the stored case reaches the 422 (T13).

### Scope predicate

`inScope(actor, role, facts)` is true when at least one of the actor's `roles` entries for `role` covers the case:

| Scope kind (W0-02) | Covers the case when |
|---|---|
| `own_cases` | `facts.ownerSubjectId === actor.subjectId` |
| `business_unit` | `facts.businessUnitId === scope.businessUnit` |
| `all_cases` | always |

When the route's `:caseId` resolves to no `case` row there are no facts to compare, and the middleware evaluates the action with the `{ kind: 'unresolved' }` target ([Section 6](#policy-module-w1-00-rai-webserver-path-per-w0-02)): `own_cases` and `business_unit` never cover an unresolved reference (there is no owner or BU to match, so it is out of scope), `all_cases` always does. This is what makes the [Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers) 403/404 rule a pure function of the actor's grants: an actor whose matching grants are `own_cases` / `business_unit` only is denied with `scope` whether or not the case exists; an actor holding an `all_cases` row for the action is allowed, and only then does the middleware answer 404.

`isOwnerOrSpocOnCase(actor, facts)` is true when the actor holds `owner` with the case in `own_cases` scope (`facts.ownerSubjectId === actor.subjectId`), or `bu_spoc` with the case's `business_unit_id` in a `business_unit` grant. This predicate is the D05 self-exclusion and is evaluated against the case, not against the actor's role list alone: the fixture `fx-user-dpo-spoc-hr` (DPO reviewer and SPOC of BU `HR`) is excluded on `HR` cases and unrestricted elsewhere. Both branches carry a test obligation: the SPOC branch through the fixture identity (T19, T20, T25) and the owner branch through a synthesised actor in the table-driven unit test (T34), since no W0-02 section 8.3 fixture holds `owner` beside a reviewer grant.

### Actions

Action identifiers are the unit of authorization. Every Fastify route declares exactly one; W1-00 seeds the first group, W2-02 adds the second, W3-01/W3-03 the third. The five `finding.*` disposition actions map one-to-one onto the [W0-06 section 4.8](workflow-transition-and-error-contract.md#48-disposition-kinds) disposition kinds: `finding.propose_fixed` records `fixed_proposed`, `finding.mark_fixed` records `fixed` (the owning lane directly, no proposal), `finding.confirm_fixed` records `fixed_confirmed`, `finding.waive` records `waived`, `finding.mark_na` records `not_applicable`. The W2-05 disposition route resolves the body's `kind` to its action before `authorize` runs, so under deny by default a kind with no action, and an action with no row, is refused. That `fixed_confirmed` requires a pending `fixed_proposed` is the W0-06 4.7 precondition (step 6, `invalid_input`), not an authorization rule.

```ts
type Action =
  // W1-00 rows (case.create is authorized against facts taken from the body; case.list is a scoped query)
  | 'case.view' | 'case.list' | 'case.create' | 'case.edit_draft' | 'case.submit'
  | 'artifact.upload' | 'artifact.download' | 'version.view' | 'history.view'
  | 'config.read_effective' | 'config.read_revisions' | 'config.publish' | 'audit.read'
  // W2-02 contract PR rows (D05)
  | 'lane.approve' | 'lane.send_back' | 'case.resubmit'
  | 'finding.propose_fixed' | 'finding.mark_fixed' | 'finding.confirm_fixed' | 'finding.waive' | 'finding.mark_na'
  // W3 rows
  | 'queue.search' | 'queue.count' | 'operator.view';
```

## 3. The matrix

Cell values: **Own** = cases in the actor's `own_cases` scope; **BU** = cases whose `business_unit_id` is in a `business_unit` grant the actor holds; **All** = every case (`all_cases`); **Own lane** = only decisions or findings whose lane equals the `lane` of the actor's reviewer grant; **—** = no row, denied. A cell marked with a rule ID is conditioned by that rule in addition to scope.

### 3.1 Contract rows (carried from the W0 technical contract, unchanged)

| Action | Owner | BU SPOC | AI/COE | DPO | IT/Sec | Admin |
|---|---|---|---|---|---|---|
| View case, files, history | Own | BU | All | All | All | All |
| Create, edit draft, submit | Own | BU | — | — | — | — |
| Approve or send back a lane | — | — | Own lane | Own lane | Own lane | — (never implicit) |
| Disposition a finding | Propose "fixed" only | Propose "fixed" only | Own lane's findings | Own lane's findings | Own lane's findings | — |
| Approve a lane on a case where the actor is owner or BU SPOC | — | — | Never (D05) | Never (D05) | Never (D05) | — |
| Edit configuration | — | — | — | — | — | Yes (W6) |

### 3.2 Rows added by this spec

| Action | Owner | BU SPOC | AI/COE | DPO | IT/Sec | Admin | Rule |
|---|---|---|---|---|---|---|---|
| Create a case (`case.create`) | Own | BU | — | — | — | — | The "create" part of the contract row, made evaluable: the target is the case the body describes ([Create target](#create-target-casecreate)). Owner: the body's `businessOwner` is the actor, or 403 `scope`. BU SPOC: the case's `business_unit_id` is in a `business_unit` grant, or 403 `scope`; the SPOC may name the owner (`businessOwner`) within that BU |
| Edit a draft's case fields (`case.edit_draft`) | Own | BU | — | — | — | — | The "edit draft" part of the contract row, made evaluable for the two scope fields: the stored case must be in scope, and when the body carries `businessOwner` or `businessUnitId` the post-edit case must be in scope too ([Edit target](#edit-target-caseedit_draft)). Owner: `businessOwner` stays the actor, or 403 `scope`. BU SPOC: the resulting `business_unit_id` is in a `business_unit` grant, or 403 `scope`; the SPOC may name the owner within that BU. `draft.saved` records old and new scope values |
| List cases (`case.list`) | Own | BU | All | All | All | All | The W1-02 list the W1-07 case list consumes; same predicate as `queue.search` (`caseScopeWhere(actor)` from the actor's `case.view` grants, [Section 6](#query-scope-w1-02-w3-01-drizzle)); an out-of-scope case is absent, never present-but-hidden. `queue.search` and `queue.count` (W3-01) extend this row with keys and counts and add nothing to its scope |
| Search results (`queue.search`) | Own | BU | All | All | All | All | Follows case-view scope: every search key (`source_record_id`, status, owner, `use_case_group`, all) is filtered by the actor's scope predicate before matching (A06) |
| Counts, pagination and filter options (`queue.count`) | Own | BU | All | All | All | All | Computed over the scoped set only; an out-of-scope user's counts and filter options equal those of a user with no such cases (A06) |
| Deep link into a case, version, finding or file | Own | BU | All | All | All | All | The link carries only opaque IDs; opening it runs sign-in then `case.view` on the referenced case. No token in a link grants scope (A05) |
| File download (`artifact.download`) | Own | BU | All | All | All | All | Follows case-view scope of the case the artifact belongs to (W0-04 `artifact.case_id`, resolved from the W0-02 7.4 `GET /api/artifacts/{artifactId}` route's `:artifactId`, [Section 6](#downloads-and-deep-links-w1-03-w3-03)); bytes stream only after the check; a direct blob path is never routable (W1-03) |
| Upload an artifact into a draft (`artifact.upload`) | Own | BU | — | — | — | — | Part of "create, edit draft, submit"; the target is the case that owns the draft; safety checks (W0-08) run after the decision and before the blob store accepts bytes |
| Old versions (`version.view`, `history.view`) | Own | BU | All | All | All | All | Same scope as the case; versions are never hidden from an in-scope actor (A07) |
| QC evidence and findings on a version | Own | BU | All | All | All | All | Reading findings follows case-view scope; disposition authority is the separate row below |
| Resubmit a successor draft (`case.resubmit`) | Own | BU | — | — | — | — | Same actor set as submit; the actor is recorded on the audit event, the case owner is unchanged (W1-INT SPOC-on-behalf test) |
| Propose "fixed" (`finding.propose_fixed`) | Own | BU | — | — | — | — | D05: a proposal, not a disposition; it stays proposed until the owning lane confirms |
| Record "fixed" directly (`finding.mark_fixed`), confirm "fixed" (`finding.confirm_fixed`), waive with reason (`finding.waive`), N/A with reason (`finding.mark_na`) | — | — | Owning lane | Owning lane | Owning lane | — | D05: only the lane equal to the finding's `owning_lane` (assigned by the W0-06 rule), one policy row per action with `laneRule: 'owning_lane'`; `finding.mark_fixed` is the W0-06 4.8 kind `fixed` (owning lane directly, no proposal), `finding.confirm_fixed` the kind `fixed_confirmed` (its pending-proposal requirement is the W0-06 4.7 precondition, not authorization) |
| Send back a lane on a case where the actor is owner or BU SPOC | — | — | Never | Never | Never | — | D05 names approval; the W2-02 Done-when applies the same exclusion to send-back. Carried here as the stricter reading inside D05; see [Resolutions](#8-resolutions-and-items-for-review) |
| Disposition (fixed/confirm/waive/N/A) a finding on a case where the actor is owner or BU SPOC | — | — | Denied (provisional) | Denied (provisional) | Denied (provisional) | — | Not named by D05; this spec defaults to deny because a waiver is approval-shaped. Review leads may refine before W2-05; see [Resolutions](#8-resolutions-and-items-for-review) |
| Read effective configuration values a screen needs (`config.read_effective`) | Yes | Yes | Yes | Yes | Yes | Yes | `use_case_group` list, `checklist_template_version` list, SLA values, calendar. Not `operator_recipients` |
| Read configuration revision history and `operator_recipients` (`config.read_revisions`) | — | — | — | — | — | Yes | D06: `operator_recipients` holds addresses; Admin only |
| Publish a configuration revision (`config.publish`) | — | — | — | — | — | Yes (W6) | Slice 1 seeds configuration in W1-00 and exposes no endpoint; the row exists so W1-00 can test that nobody else has it |
| Read the audit log (`audit.read`) | — | — | — | — | — | Yes | W0-04: Admin and the D06 operator audience. The operator is not a role (D06); in slice 1 the audience is Admin. See [Resolutions](#8-resolutions-and-items-for-review) |
| Operator view: failed mail, unavailable QC, breach report (`operator.view`) | — | — | — | — | — | Yes | W0-10 / W3-07; same reasoning as audit read |
| Ready for launch | — | — | — | — | — | — | Not an action of any actor. The W2-06 predicate runs inside the transaction of the last approval or disposition (W0-06). No request can set it |
| Write `privacy_status`, `security_status`, `rai_status`, `ai_readiness_status` | — | — | — | — | — | — | W0-04 fields projection rule; see [Section 5](#5-w0-04-fields-projection-rule) |

### 3.3 Notification recipients (D06; recipients are not authority)

Recipients are resolved on the server, after the business event has committed (W0-07, W3-03), with the same scope predicate as `case.view`; a recipient outside case-view scope for the case is dropped before the mail is queued. The mail carries a deep link, not access.

| Event | Recipient set | Scope check | Source |
|---|---|---|---|
| Lane opens | Every subject holding the reviewer role for that lane | Case-view scope (`all_cases` for reviewers, so all of them) | Source spec notifications, contract W0-05 |
| Send-back | The case owner (`owner_subject_id`) | Case-view scope (`own_cases` on the case) | Source spec: "Owner". BU SPOC is not a source-spec recipient; adding one is a product change, not made here |
| Ready for launch | The case owner | Case-view scope | Source spec: "Owner" |
| SLA breach digest | The addresses in the `operator_recipients` configuration value | **No role and no case scope**: the recipients come from Admin configuration (D06), not from a role; the digest lists cases past SLA with links, and each link still requires sign-in and `case.view` when opened (A05) | D06; W3-03, W3-05 |

The D05 self-exclusion does not remove a reviewer from the lane-open recipient set: they remain in view scope and see the case in their queue with the decision controls disabled (absent from `allowedActions`, [Section 6](#ui-convenience-w0-02-shapes-w1-13-lane-b)); whether the SPA can also show *why* depends on the W0-02 read-shape request in [Resolutions](#8-resolutions-and-items-for-review). Whether such a reviewer should be omitted from the mail is listed for the review leads, not decided here. **Ruled 2026-09-26** (register row "W3 deferred rulings", item 10): a lane reviewer who is BU SPOC on the case gets no lane-opened mail for that lane, and the page says why the panel is absent; the table and T28 change with ticket W3-F2 (#164). A reviewer who is the case owner is not ruled.

## 4. Out-of-scope references: 403, with non-guessable identifiers

ADR-0003 left to this spec whether an out-of-scope case reference answers 403 `forbidden` (the W1 contract) or 404 `not_found` to hide that the case exists. **This spec keeps 403**, on the following condition, and asks the human reviewer of this PR to confirm it:

- Case, version, artifact and finding identifiers used in routes, API bodies and deep links are opaque and non-guessable (random UUID or equivalent, never sequential; W0-04 fixes the column type). The display identifier `registry_id` and the inherited `source_record_id` appear in bodies and in search, never as a route key.
- With non-enumerable IDs, the only way an out-of-scope caller holds an ID is having been given it (for example a forwarded mail link), in which case the existence of the case is already known to them and a 403 discloses nothing further. The threat-model row is "owner reads another BU's case", which 403 prevents; existence disclosure by enumeration is prevented by the ID rule, not by the status code.
- The 403 body is exactly the [W0-06 section 8.2](workflow-transition-and-error-contract.md#82-response-envelope) `forbidden` envelope: `{ error: { code: 'forbidden', messageKey: 'error.forbidden', correlationId } }`, `details` absent (`ErrorDetails['forbidden']` is `never`), one locale key `error.forbidden` (W0-06 8.5). It carries no denial reason, no sub-key, and never the case name, BU, owner or any field.
- An **unresolvable case ID** (the route's `:caseId` resolves to no `case` row) is 404 `not_found` (`details.resource = 'case'`, W0-06 8.2) **only for an actor who holds a row for the action with `all_cases` scope** (the three reviewer roles and Admin, for the actions they have a row for): their scope already covers every case, so existence is the only thing left to answer and the 404 discloses nothing they could not read anyway. For an actor whose matching grants are `own_cases` / `business_unit` only (owner, BU SPOC), an unresolvable ID is evaluated as out of scope ([Scope predicate](#scope-predicate): neither kind covers an unresolved reference) and answers 403 with the same W0-06 8.2 envelope (`Decision.reason` `scope`, one `authz.denied` line as for any 403). Such a caller therefore gets 403 whether or not the case exists, exactly as W0-06 section 4 ("authorization is decided before existence so that an out-of-scope caller learns nothing") and 8.4 state, and cannot tell "exists" from "does not exist" by status code; this is the W0-06 8.3 rule "`not_found` only for an in-scope reference" made evaluable, with `all_cases` putting every ID, existing or not, in scope. A version, finding or artifact ID that does not resolve under a case the actor has been authorized for is 404 with the matching `resource` for every such actor (an in-scope reference, W0-06 8.3). The W0-02 7.4 download routes `GET /api/artifacts/{artifactId}[/meta]` carry no `:caseId`, so an unresolvable `:artifactId` there is the same `{ kind: 'unresolved' }` evaluation as an unresolvable `:caseId`: 403 `scope` for an own/BU-only caller, 404 `not_found` (`details.resource = 'artifact'`) only for an `all_cases` holder ([Downloads and deep links](#downloads-and-deep-links-w1-03-w3-03)); without this, the download route would be an existence oracle for artifacts. The lookup and the check are one helper ([Middleware](#middleware-w1-01-fastify)) so the 403 and 404 paths cost the same and log the same shape (W0-10: the 404 is the [section 6.1](observability-contract.md#61-category-map) `not_found` capture, info level, `route` and `targetType`, never `authz.denied`). T33 exercises both halves.

If the ID rule cannot be kept (for example a later decision to key routes on `registry_id`), the answer flips to 404 for out-of-scope reads and this section is rewritten; that is a contract change and its own PR.

Error mapping used throughout, taken from ADR-0003 and confirmed by W0-06. The `code` column is the body's `error.code` (W0-06 8.1); the `reason` column is **not in the body**: it is the `reason` of the `{ allow: false }` `Decision` returned by the pure `authorize` function ([Section 6](#policy-module-w1-00-rai-webserver-path-per-w0-02)), observable in the W1-00 table-driven unit test and on the `authz.denied` log line (W0-10 3.3 `reason`):

| Situation | HTTP | `code` (body) | `Decision.reason` (403 only; not in the body) |
|---|---|---|---|
| No or invalid session | 401 | `unauthenticated` | — |
| Actor's roles hold no row for the action | 403 | `forbidden` | `role` |
| Row exists, case outside every matching scope (for `case.create`, the case the body describes; for `case.edit_draft`, the stored case or the case the body would produce) | 403 | `forbidden` | `scope` |
| Reviewer acts on a lane that is not theirs, or on a finding whose `owning_lane` is not theirs | 403 | `forbidden` | `lane` |
| D05 self-exclusion (owner or BU SPOC on the case) | 403 | `forbidden` | `self_approval` |
| Admin attempts a lane decision or a disposition | 403 | `forbidden` | `role` |
| Case ID does not resolve and the actor holds an `all_cases` row for the action | 404 | `not_found` (`details.resource = 'case'`) | — |
| Case ID does not resolve and the actor's matching rows are `own_cases` / `business_unit` only | 403 | `forbidden` | `scope` |
| Version, finding or artifact ID does not resolve under a case the actor was authorized for | 404 | `not_found` (`details.resource` names it) | — |
| `:artifactId` on `GET /api/artifacts/{artifactId}` or `/meta` (no `:caseId`, W0-02 7.4) does not resolve and the actor holds an `all_cases` row for `artifact.download` | 404 | `not_found` (`details.resource = 'artifact'`) | — |
| `:artifactId` on `GET /api/artifacts/{artifactId}` or `/meta` does not resolve and the actor's matching rows are `own_cases` / `business_unit` only | 403 | `forbidden` | `scope` |
| Body contains one of the four projected status fields, sent by an actor the matrix allows for the action (W0-06 step 4, after the policy decision; a reviewer or Admin sending it is 403 `role`, an out-of-scope owner or SPOC 403 `scope`) | 422 | `invalid_input` | — |

Throughout this spec, "403 `scope`" (and `role`, `lane`, `self_approval`) abbreviates: HTTP 403 with the W0-06 8.2 `forbidden` envelope **and** `authorize` returning `{ allow: false, code: 'forbidden', reason: 'scope' }`. The four reasons have no locale keys and no body sub-code: the only user message for a 403 is `error.forbidden` (W0-06 8.5). They exist so that the W1-00 unit test can assert *which* rule denied, the `authz.denied` line names it (W0-10 3.3 `reason`, registered at W0 exit), and a future W0-02 read shape can explain a disabled control without the SPA deciding anything itself; that read-shape change is requested, not made, in [Resolutions](#8-resolutions-and-items-for-review). `scope` reveals no more than the status code already does under the ID rule above.

## 5. W0-04 fields projection rule

The four inherited status fields are read-only projections written only by the workflow (register row "W0-04 fields", Ta, 2026-09-21):

| Field | Written when | By |
|---|---|---|
| `privacy_status` | DPO lane decision commits (`approved` on approve, `sent_back` on send-back; reset to `pending` by every submit and resubmit, W0-04 and W0-06 4.10) | The W2-02 decision transaction; the W1-05 / W2-04 submit transaction for the reset |
| `security_status` | IT/Security lane decision commits (same values and reset) | Same |
| `rai_status` | AI/COE lane decision commits (same values and reset) | Same |
| `ai_readiness_status` | Ready for launch commits (`ready`; `not_ready` otherwise) | The W2-06 transition, inside the approving or dispositioning transaction |

Authorization consequences:

- There is **no action** in this matrix that writes any of the four; no role has a row, including Admin. The request/response shapes for `case.create`, `case.edit_draft`, `case.submit` and `case.resubmit` (W0-02 W1 interface shapes) do not contain these fields; a body that carries one is rejected with 422 `invalid_input` and the locale key `error.invalid_input.projected_field` at [W0-06 section 4](workflow-transition-and-error-contract.md#4-events) step 4, after the policy decision (steps 2 and 3, first failure wins): a reviewer or Admin sending such a body is 403 `role` and an out-of-scope owner or SPOC is 403 `scope`, exactly as for any other body, and only an actor the matrix allows for the action reaches the 422 (T10, T11, T13). For `case.create` the scope step alone runs after validation, because its facts come from the body ([Middleware](#middleware-w1-01-fastify)); the role step still precedes the body. This is the W1-02 Done-when "a write to any of them that the rule forbids is rejected".
- The projection is written in the **same transaction** as the lane-decision or Ready audit event and derives its value from that event; it is never a second record of a decision (L8). Readers treat the lane-decision entity and the Ready transition as the only authority; the four fields exist so the desk can show the registry names the source spec inherits.
- Because the writer is the workflow and not an actor, the fields need no row here; the test obligation is negative only (see below).

## 6. Enforcement in the stack

Stack-specific placement, keeping the intent stack-neutral: one policy function, evaluated by one middleware, before any data access.

### Policy module (W1-00, `rai-web/server`, path per W0-02)

- The matrix lives as **data**: an array of `PolicyRow` exported from one module and covered by a table-driven test. Rows are the source of truth for the UI's `allowedActions` (below), for the tests and for the operator documentation; no route re-implements a check.

```ts
type ScopeRule = RoleScope['scope']['kind'];   // 'own_cases' | 'business_unit' | 'all_cases' (W0-02 section 7.2)

type PolicyRow = {
  action: Action;
  role: Role;
  scope: ScopeRule;                       // which of the actor's scopes may cover the target
  laneRule?: 'own_lane' | 'owning_lane';  // lane.* and finding.* rows only
  excludeOwnerOrSpoc?: true;              // D05 self-exclusion rows only
};

type Target =
  | { kind: 'none' }                                            // case.list, queue.*, config.*, audit.read, operator.view, and the
                                                                //   role-only first call of case.create (Middleware): role check here;
                                                                //   scope applied by caseScopeWhere (list, queue.*) or by a second call (create)
  | { kind: 'case'; facts: CaseScopeFacts }                     // view, edit, submit, download, version, history,
                                                                //   case.create with facts built from the body (no caseId), and
                                                                //   case.edit_draft a second time with the post-edit facts
  | { kind: 'lane'; facts: CaseScopeFacts; lane: Lane }         // lane.approve, lane.send_back
  | { kind: 'finding'; facts: CaseScopeFacts; owningLane: Lane }  // finding.*; owningLane is W0-04 qc_finding.owning_lane, same Lane values
  | { kind: 'unresolved' };                                     // any case-keyed action whose :caseId resolved to no row, and artifact.download
                                                                //   whose :artifactId resolved to no artifact row (Downloads and deep links): role and scope
                                                                //   steps only (own_cases / business_unit never cover, all_cases covers);
                                                                //   allow means the middleware answers 404, deny is the ordinary 403 (Section 4)

type Decision =
  | { allow: true; via: PolicyRow }
  | { allow: false; code: 'forbidden'; reason: 'role' | 'scope' | 'lane' | 'self_approval' };

function authorize(actor: Actor, action: Action, target: Target): Decision;
```

- `authorize` is pure: no I/O, no clock. It throws on an unknown `Action` or `Role` (a programming error surfaced by tests, never a 403) and denies when the actor has no grant matching a row. Evaluation order per row: role → scope → lane → self-exclusion; the first row that allows wins; if no row allows, the denial reason is the most specific one reached (`self_approval` over `lane` over `scope` over `role`). For a `{ kind: 'unresolved' }` target only the role and scope steps run (there is no lane, owner or BU to compare; those steps apply once the target exists): the scope step treats `own_cases` and `business_unit` as not covering and `all_cases` as covering, so the reason is `role` or `scope` and an allow carries the `all_cases` row in `via`. `reason` is asserted by the W1-00 table-driven unit test on the `Decision` value; it is never serialised into the 403 body (W0-06 8.2).
- For a `{ kind: 'none' }` target `authorize` checks the role rows only; the scope column of a list or queue row is enforced by the `caseScopeWhere(actor)` predicate (below) that the handler must use, and the W1-02 and W3-01 tests assert the resulting absence. Every other action, `case.create` included, is evaluated against `CaseScopeFacts`.
- W1-00 ships the rows for `case.*` (view, list, create, edit_draft, submit), `artifact.*`, `version.view`, `history.view`, `config.*` and `audit.read`. **W2-02's contract PR** adds `lane.*`, `case.resubmit` and `finding.*` with the D05 rules; **W3-01/W3-03** add `queue.*`, `operator.view` and the recipient resolver. Adding a row is a contract change and its own PR (team and roles, "shared interface contract").

### Middleware (W1-01, Fastify)

- Every route declares `{ action, target }` in its route config; a Fastify `onRoute` hook rejects a route without one at startup. A global `preHandler` hook runs the [W0-06 section 4](workflow-transition-and-error-contract.md#4-events) order, **session → authorization → existence**, on every case-scoped route. Every case-scoped route carries `:caseId`, including the W0-02 7.4 upload route `POST /api/cases/{caseId}/artifacts`, except the two W0-02 7.4 download routes `GET /api/artifacts/{artifactId}` and `GET /api/artifacts/{artifactId}/meta`, which carry `:artifactId` alone and reach the case through the W0-04 `artifact.case_id` column ([Downloads and deep links](#downloads-and-deep-links-w1-03-w3-03)). The hook: (1) resolves the session to an `Actor` (401 if none); (2) loads `CaseScopeFacts` by the route's opaque `:caseId`, or for the download routes by `:artifactId` joined through `artifact.case_id` to the case in the same single read (a three-column read that answers nothing by itself), and calls `authorize` with `{ kind: 'case' | 'lane' | 'finding', facts, ... }` when the ID resolved and with `{ kind: 'unresolved' }` when it did not (an unresolvable `:artifactId` on a download route is unresolved in the same sense as an unresolvable `:caseId`); a deny is 403 with exactly the W0-06 8.2 `forbidden` envelope (`code`, `messageKey: 'error.forbidden'`, `correlationId`; no `details`, no reason, no sub-key), returned whether or not the case exists; (3) only after an allow, an unresolved `:caseId` is 404 `not_found` with `details.resource = 'case'` and an unresolved download-route `:artifactId` is 404 with `details.resource = 'artifact'`, either of which by the [Scope predicate](#scope-predicate) can only reach an actor holding an `all_cases` row for the action, and a `:versionId`, `:findingId` or `:artifactId` that does not resolve under the authorized case is 404 with the matching `resource` (W0-06 8.3, in-scope reference). Steps 4-7 of W0-06 section 4 (validation, idempotency, expected version, apply) belong to the handler and run only after allow, so a 422 (a projected status field, an unresolvable owner or BU, any shape error) can only reach an actor the policy allowed: a reviewer or Admin is 403 `role` and an out-of-scope owner or SPOC 403 `scope` whatever the body carries (T10, T11). This order is the W0-06 one and confirms its 8.4 statement that an out-of-scope caller gets 403 whether or not the case exists; the request to the W0-06 owner to close the 8.4 open item against this section is in [Resolutions](#8-resolutions-and-items-for-review). For `case.create` there is no ID to load and the scope facts come from the body, so the hook runs in three steps: (a) the **role step** first, `authorize(actor, 'case.create', { kind: 'none' })`, which needs no body and denies a reviewer or Admin with 403 `role` before the body is read (an allow here authorizes nothing by itself); (b) **body validation**, 422 on a projected field or an unresolvable owner or BU; (c) the **scope step** on the validated body, building the facts from the body and the actor as [Create target](#create-target-casecreate) states and calling `authorize(actor, 'case.create', { kind: 'case', facts })`, whose deny is 403 `scope`. This is the one place where validation precedes the scope step, and only because the scope facts do not exist until the body is valid; the handler never sees a body whose owner or BU it has not been authorized for. For `case.edit_draft` the hook first authorizes against the stored facts (role and scope, before validation, as for every other case-keyed route) and then, if the validated body carries `businessOwner` or `businessUnitId`, builds the post-edit facts as [Edit target](#edit-target-caseedit_draft) states and calls `authorize` a second time; a deny on either evaluation is the 403 and nothing is written. Handlers run only after allow and receive the `Decision` on the request for the audit event.
- Loading `CaseScopeFacts` is the only pre-authorization read and it reads three columns; the handler's own queries run after the decision. The facts lookup, the `authorize` call and the 404 answer for an allowed-but-unresolved ID are one helper so the 403 and 404 paths cannot diverge, cost the same, and log the same shape; no route decides 403 versus 404 on its own.
- A 403, read or write, emits `authz.denied` from the same hook that replies 403, with the W0-10 section 3.3 fields (`action`, `targetType`, `targetId?`, `actorSubjectId`, `actorRole`) and the correlation ID from the W0-10 section 3.2 envelope; the `Decision.reason` is the line's `reason` field (W0-10 3.3, registered at W0 exit). A 401 never reaches this hook's `authorize` call: it is the W0-10 6.1 `unauthenticated` capture (info, `route`), and no `authz.denied` is emitted for it. No audit row is written and no state changes in either case (W0-06 section 8). The audit log records state changes only (W0-04), so the log line, not an audit event, is the record of a denial.

### Query scope (W1-02, W3-01, Drizzle)

- List, search and count queries never take the actor's role list as a hint; they take a `caseScopeWhere(actor)` predicate built from the actor's grants for `case.view` (`own_cases` → `owner_subject_id = $subject`; `business_unit` → `business_unit_id = ANY($bus)` where `$bus` is the list of `businessUnit` values from the actor's `business_unit` grants; `all_cases` → no filter) and apply it before any other filter, `LIMIT` or `COUNT`. This is the predicate W0-04 states under [Interfaces](persistence-and-artifact-store.md#interfaces) and wraps in its `scopedCases(tx, actor)` sub-select helper; `caseScopeWhere` is that helper's `WHERE` clause and W1-02 ships them as one module. Never `business_unit` (the descriptive text column). Filter-option lists (owners, groups, statuses shown in the queue) are computed from the same scoped query (A06).
- There is one such helper in the server; a query that touches the cases table without it is caught by a test that lists every Drizzle query builder call site (W3-01 Done-when "pagination never leaks a case").

### Downloads and deep links (W1-03, W3-03)

- Artifact routes are the [W0-02 section 7.4](implementation-plan-w1-w3.md#74-artifact-upload-and-download-w1-03ab-consumed-by-w1-06) ones, verbatim: upload `POST /api/cases/{caseId}/artifacts` (`artifact.upload`, keyed by `:caseId` like every other case-keyed route) and download `GET /api/artifacts/{artifactId}` and `GET /api/artifacts/{artifactId}/meta` (`artifact.download`, keyed by `:artifactId` alone, no `:caseId`). For the two download routes the target is still the case: the [Middleware](#middleware-w1-01-fastify) helper resolves `:artifactId` → the W0-04 [`artifact.case_id`](persistence-and-artifact-store.md#artifact) column ("the case the upload was authorised against") → that case's `CaseScopeFacts` in one joined read before `authorize`, so `artifact.download` follows `case.view` scope of the owning case. An `:artifactId` that resolves to no `artifact` row is evaluated with `{ kind: 'unresolved' }` exactly like an unresolvable `:caseId` ([Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers)): 403 `scope` for an actor whose grants are `own_cases` / `business_unit` only, 404 `not_found` with `details.resource = 'artifact'` only for an `all_cases` holder; otherwise an own/BU-only caller probing `GET /api/artifacts/{artifactId}` could tell an existing out-of-scope artifact (403) from a non-existent one (404), an existence oracle the case-keyed routes do not have. (The W0-04 upload-and-download prose says "inside a case URL"; the W0-02 7.4 route table is the route authority and `artifact.case_id` is the column the helper joins on.) The blob store is not served statically; bytes stream from the handler after the decision with `Cache-Control: no-store`.
- A deep link is `<origin>/cases/:caseId[...]` with opaque IDs and no token. Opening it without a session yields the sign-in flow and then the same `case.view` check (W3-02 "a deep link into a card requires sign-in"; A05 "recipient cannot gain access from link alone").

### UI convenience (W0-02 shapes, W1-13, Lane B)

- Read responses for a case, a version and a finding may carry `allowedActions: Action[]`, computed by the same `authorize` function on the server. The SPA renders controls from it: an action absent from the list is disabled, with the one locale key `error.forbidden` as its explanation. No per-reason key exists in W0-06 8.5, and the W0-02 read shapes do not carry `allowedActions` today; if Lane B needs a per-action reason (for example to show a self-excluded reviewer why a lane control is disabled, [Section 3.3](#33-notification-recipients-d06-recipients-are-not-authority)), the field and its keys are a W0-02 read-shape request listed in [Resolutions](#8-resolutions-and-items-for-review), not something this spec adds. This is a convenience, never authority: the server re-evaluates on every action, and Lane B tests assert that a forced call still returns 403 (W1-06/W1-07 "no client-side check decides access").

### Substitute (W1-13)

- The dev/test substitute imports the same policy rows and `authorize` from the shared module, so a request the matrix denies returns the same 403 envelope, and the same `Decision`, from the substitute as from the real server. It never adds a row of its own.

## 7. Test obligations

Fixture identities come from W1-00 following the W0-02 section 8.3 convention (six single-role users and the W0-03 dual-role identity); fixture cases from W1-09. Names below are placeholders that map onto the W0-02 names as follows; W1-00 and W1-09 record the actual identifiers each evidence file cites:

| Placeholder | W0-02 section 8.3 identifier | Notes |
|---|---|---|
| `owner-a` | `fx-user-owner-cm` (role `owner`) | owns at least one case in BU `CM` |
| `owner-b` | `fx-user-owner-cm-2` (role `owner`) | W0-09: added to W0-03 section 7 and W0-02 section 8.3 on this spec's request; owns no fixture case |
| `spoc-b1` | `fx-user-spoc-cm` (role `bu_spoc`, grant `businessUnit: 'CM'`) | |
| `reviewer-dpo` | `fx-user-dpo` (role `dpo`, lane `dpo`) | any single-lane reviewer serves; `dpo` is used so the dual-role identity's lane matches |
| `admin` | `fx-user-admin` | |
| dual-role, lane L + SPOC B2 | `fx-user-dpo-spoc-hr` (grants `dpo`/`all_cases` and `bu_spoc`/`business_unit: 'HR'`) | L = `dpo`, B2 = `HR` |
| B1, B2 | `business_unit_id` values `CM`, `HR` | `fx-case-hr-dualrole` is the B2 case |

How an Expected cell's `reason` (`403 role` / `scope` / `lane` / `self_approval`) is observed: the HTTP response carries only the W0-06 8.2 `forbidden` envelope, so the reason is asserted on the `Decision` returned by the pure `authorize` function in the W1-00 table-driven unit test (W1-00 covers every row's actor × action × target below at that level), and at the API level on the `authz.denied` log line's `reason` field (registered in W0-10 3.3 at W0 exit); an API-level row asserts status 403, `code: 'forbidden'`, no `details`, and one `authz.denied` line with the W0-10 3.3 fields, `reason` and the envelope's `correlationId`. "401" rows assert `code: 'unauthenticated'` and the W0-10 6.1 `unauthenticated` capture, never `authz.denied`.

| # | Actor | Action | Target | Expected | Ticket | Proves |
|---|---|---|---|---|---|---|
| T1 | no session | `case.view` | any case | 401 `unauthenticated` | W1-01 | A01 |
| T2 | `owner-a` | `case.view` | own case (B1) | 200 | W1-02 | A01 |
| T3 | `owner-b` (another owner, B1) | `case.view`, `version.view`, `history.view`, deep link | owner-a's case, its versions, its findings and history | 403 `scope` on each; body carries no case field | W1-02, W1-05 | A01, A05 |
| T4 | `spoc-b1` | `case.view`, `case.edit_draft`, `case.submit` | owner-a's case (B1) | 200; submit audit event actor = spoc-b1, case owner unchanged | W1-02, W1-INT | A01, A02 |
| T5 | `spoc-b1` | `case.view` | case in B2 | 403 `scope` | W1-02 | A01 |
| T6 | `spoc-b1` | `case.create` | body whose `businessUnitId` is B2 | 403 `scope`; no case row written; one `authz.denied` line (W0-10 3.3 fields, envelope `correlationId`), zero audit rows | W1-02 | A01 |
| T7 | `owner-a` | `case.create` | body with `businessOwner = owner-b` | 403 `scope`; no case row written. Same body from `spoc-b1` with BU B1 and `businessOwner = owner-a`: 201, `owner_subject_id` = owner-a, audit actor = spoc-b1 | W1-02, W1-INT | A01, A02 |
| T8 | `owner-b`, `spoc-b1` | `case.list` | — | owner-b's list omits owner-a's case; spoc-b1's list holds B1 cases only and no B2 case; both queries go through `caseScopeWhere` | W1-02 | A01 |
| T9 | `reviewer-dpo` | `case.view`, `version.view`, `history.view` | any case, any version | 200 | W1-02, W1-05 | A01, A07 |
| T10 | `reviewer-dpo`, `admin` | `case.create`, `case.edit_draft`, `case.submit`, `artifact.upload`, `case.resubmit` | create: a valid body, and the same body with `privacyStatus` added; edit: any draft, with and without `privacyStatus` in the body; every other action: any case | 403 `role` for both actors on every action and on every body variant (the role step needs no body, so a body carrying a projected field is still 403 `role`, never 422; [Section 5](#5-w0-04-fields-projection-rule)); no case, draft, artifact or N+1 draft written | W1-02, W1-03, W1-05, W2-04 | A01 |
| T11 | `owner-b` | `case.edit_draft`, `case.submit`, `artifact.download`, `artifact.upload`, `case.resubmit` | owner-a's draft (edit, with and without `privacyStatus` in the body; submit; upload); artifact on owner-a's case (`GET /api/artifacts/{artifactId}`); owner-a's case | edit: 403 `scope` on both bodies (the stored-facts authorization precedes validation, so the projected field is never reached; [Section 5](#5-w0-04-fields-projection-rule)), no field written, `caseRevision` unchanged; submit: 403 `scope`, no version submitted; download: 403 `scope`, no bytes; upload: 403 `scope`, no bytes stored; resubmit: 403 `scope`, no N+1 draft created; every denial emits one `authz.denied` line (W0-10 3.3 fields, envelope `correlationId`) and writes zero audit rows | W1-02, W1-03, W1-05, W2-04 | A01 |
| T12 | no session | direct blob path / artifact URL | any | 401; blob directory not routable | W1-03 | A01 |
| T13 | `owner-a`, `spoc-b1` | `case.create` / `case.edit_draft` with `privacyStatus` in the body | owner-a: a create body that would otherwise be allowed (`businessOwner` = owner-a) and own draft (B1); spoc-b1: a create body with `businessUnitId = B1` and a B1 draft | 422 `invalid_input` `projected_field` for both actors on both actions (the policy allowed the action; W0-06 step 4 rejects the body); no case or field written, no `authz.denied` line (a 422 is not a denial). The same bodies from `reviewer-dpo` / `admin` are 403 `role` (T10) and owner-b's PATCH on owner-a's draft is 403 `scope` (T11) | W1-02 | W0-04 fields |
| T14 | `admin` | `config.read_revisions`, `config.publish`, `audit.read`, `operator.view` | — | admin 200; every other role 403 `role` | W1-00, W3-07 | A01, A11 |
| T15 | any role | unknown action / policy row lookup for unknown role | — | `authorize` throws; no route reachable | W1-00 | A01 |
| T16 | `reviewer-dpo` | `lane.approve` | lane `dpo` on a case where reviewer-dpo is neither owner nor SPOC | 200 | W2-02 | A09 |
| T17 | `reviewer-dpo` | `lane.approve`, `lane.send_back` | lane `it_security` | 403 `lane`; no decision row written | W2-02 | A09 |
| T18 | `admin` | `lane.approve`, `lane.send_back`, `finding.propose_fixed`, `finding.mark_fixed`, `finding.confirm_fixed`, `finding.waive`, `finding.mark_na` | any lane; any finding, whatever its `owning_lane` | 403 `role` on every action; no decision or disposition row written | W2-02, W2-05 | A01, A09 |
| T19 | dual-role (lane L + SPOC B2) | `lane.approve`, `lane.send_back` | lane L on a case in B2 | 403 `self_approval` | W2-02 | A09 (D05) |
| T20 | dual-role | `lane.approve` | lane L on a case in B1 | 200 | W2-02 | A09 |
| T21 | `owner-a` | `finding.propose_fixed` | finding on own case | 200, state proposed | W2-05 | A09 |
| T22 | `owner-a`, `spoc-b1`, `reviewer-dpo` | owner-a and spoc-b1: `lane.approve`, `lane.send_back`, `finding.mark_fixed`, `finding.waive`, `finding.mark_na`, `finding.confirm_fixed`; reviewer-dpo: `finding.propose_fixed` | lane `dpo` on owner-a's case (B1); finding on owner-a's case (`owning_lane = dpo`) | 403 `role` for every pair (the role has no row: owner and SPOC never decide a lane or disposition; a reviewer never proposes); no decision or disposition row written | W2-02, W2-05 | A09 |
| T23 | `reviewer-dpo` | `finding.mark_fixed`, `finding.waive`, `finding.mark_na`, `finding.confirm_fixed` | finding with `owning_lane = it_security` (single-lane, slot-5 and pack-level cases); for `confirm_fixed`, one carrying an owner proposal; for `mark_fixed`, one carrying none | 403 `lane` on each of the four actions (each `laneRule: 'owning_lane'` row is exercised, not only waive); finding state unchanged, no disposition event written, one `authz.denied` line per denial (W0-10 3.3 fields, envelope `correlationId`), zero audit rows | W2-05 | A09 |
| T24 | `reviewer-dpo` | `finding.confirm_fixed`, `finding.mark_fixed` | confirm: proposal on a finding with `owning_lane = dpo`; mark fixed: a finding with `owning_lane = dpo` carrying no proposal | 200 on both; `fixed_confirmed` and `fixed` events attributed to reviewer-dpo (W0-06 4.8) | W2-05 | A09 |
| T25 | dual-role | `finding.mark_fixed`, `finding.waive`, `finding.mark_na`, `finding.confirm_fixed` | finding on `fx-case-hr-dualrole` (B2) with `owning_lane = L` (`dpo`); for `confirm_fixed`, one carrying an owner proposal; for `mark_fixed`, one carrying none | 403 `self_approval` (provisional default) on each of the four actions (each `excludeOwnerOrSpoc` disposition row is exercised, not only waive); finding state unchanged, no disposition event written, one `authz.denied` line per denial, zero audit rows. Positive counterpart: the same four actions by the dual-role identity on a B1 finding with `owning_lane = L`: 200 | W2-05 | A09 |
| T26 | any actor | set Ready by request | — | no route exists; predicate runs only inside W2-06 | W2-06 | A09 |
| T27 | `owner-a`, `spoc-b1`, `owner-b` | `queue.search`, `queue.count` | each key | results, counts and filter options equal the scoped set; owner-b sees zero of owner-a's cases and identical counts to a user with no cases | W3-01 | A06 |
| T28 | mail sink | lane-open, send-back and Ready recipients | case owned by owner-a | lane-open: every holder of that lane's reviewer role and no other subject; send-back/Ready: owner-a only; links carry no token | W3-03 | A05 |
| T29 | mail sink | breach digest | — | recipients = `operator_recipients` seed; link without session yields 401 | W3-03 | A05 |
| T30 | any denied request (read and write) | denial logging | — | any 403: exactly one `authz.denied` line (W0-10 section 3.3 fields: `action`, `targetType`, `targetId?`, `actorSubjectId`, `actorRole`) whose `correlationId` equals the envelope's; `reason` on that line (registered in W0-10 3.3 at W0 exit). Any 401: the W0-10 6.1 `unauthenticated` capture / `request.completed` with `errorCode: unauthenticated`, and no `authz.denied` line. Zero audit rows in both cases (W0-06 section 8) | W1-01, W3-07 | A11 |
| T31 | `owner-a`, `spoc-b1` | `case.edit_draft` with a scope field in the body | owner-a: PATCH `businessOwner = owner-b` on own case (B1); spoc-b1: PATCH `businessUnitId = B2` on a B1 case | 403 `scope` for both; `owner_subject_id` and `business_unit_id` unchanged, `caseRevision` unchanged, one `authz.denied` line (W0-10 3.3 fields, envelope `correlationId`), zero audit rows. Positive counterpart: spoc-b1 PATCH `businessOwner = owner-b` on a B1 case: 200, `owner_subject_id` = owner-b, `draft.saved` carries old and new owner, audit actor = spoc-b1 | W1-02 | A01 |
| T32 | `owner-b`, `spoc-b1` | `finding.propose_fixed` | owner-b: a finding on owner-a's case (B1); spoc-b1: a finding on a B2 case (`fx-case-hr-dualrole`) | 403 `scope` for both (the role has the row; the case is outside `own_cases` / the `business_unit` grant); finding state unchanged, no disposition event written, one `authz.denied` line (W0-10 3.3 fields, envelope `correlationId`), zero audit rows | W2-05 | A01, A09 |
| T33 | `owner-b`, `spoc-b1`, `reviewer-dpo`, `admin` | `case.view`, `artifact.download`, `artifact.upload` | (i) a freshly generated random UUID that resolves to no case, as `:caseId` of `GET /api/cases/{caseId}` (`case.view`); (ii) a freshly generated random UUID that resolves to no artifact, as `:artifactId` of `GET /api/artifacts/{artifactId}` and `GET /api/artifacts/{artifactId}/meta` (`artifact.download`, W0-02 7.4); (iii) the random case UUID as `:caseId` of `POST /api/cases/{caseId}/artifacts` with a valid `file` part (`artifact.upload`) | owner-b and spoc-b1: 403 `scope` on (i), (ii) and (iii), W0-06 8.2 `forbidden` envelope with no `details`, one `authz.denied` line per request (W0-10 3.3 fields, `targetId` = the requested ID, envelope `correlationId`), byte-for-byte the same body shape as T3 / T11 (existing out-of-scope case or artifact), so existing and non-existent cannot be told apart on either key; reviewer-dpo and admin: 404 `not_found` with `details.resource = 'case'` on (i) and `details.resource = 'artifact'` on (ii), the W0-10 6.1 `not_found` capture (info, `route`, `targetType`) and **no** `authz.denied` line, and on (iii) 403 `role` (they hold no `artifact.upload` row, so the role step denies before existence is answered; no 404 for a non-existent case on an action they cannot perform); zero audit rows, no bytes streamed or stored for all four ([Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers) unresolvable-ID rule, [Downloads and deep links](#downloads-and-deep-links-w1-03-w3-03)) | W1-01, W1-02, W1-03 | A01 |
| T34 | synthesised actor in the table-driven `authorize` unit test (no fixture identity needed): `{ subjectId: S, roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }, { role: 'owner', scope: { kind: 'own_cases' } }] }` | `lane.approve`, `lane.send_back`, `finding.mark_fixed`, `finding.waive`, `finding.mark_na`, `finding.confirm_fixed` | lane `dpo` / finding with `owningLane = 'dpo'` on `CaseScopeFacts` whose `ownerSubjectId === S` (a BU the actor holds no SPOC grant for); then the same targets on facts whose `ownerSubjectId` is another subject | own case: `{ allow: false, code: 'forbidden', reason: 'self_approval' }` on all six actions (lane rows by D05, disposition rows by the provisional default), which exercises the **owner branch** of `isOwnerOrSpocOnCase` that no fixture identity reaches (T19/T20/T25 cover the SPOC branch); other case: `{ allow: true, via: <the dpo row> }` on all six | W1-00 (table-driven test; the rows and cases land with the W2-02 contract PR), W2-02 | A09 (D05: "no one who is owner ... may approve") |

The negative tests call the API directly, never through the UI (ADR-0003 risk table); the exit tickets W1-08, W2-08 and W3-06 record their output.

## 8. Resolutions and items for review

Engineering defaults this spec had to set, each inside the recorded rules and each open to the named reviewer:

| Item | Default in this spec | Who confirms | When |
|---|---|---|---|
| 403 vs 404 for out-of-scope references (ADR-0003 open item) | 403 `forbidden`, conditioned on non-guessable route identifiers ([Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers)). Unresolvable case ID: 404 `not_found` only for an actor holding an `all_cases` row for the action; 403 `scope` for an actor whose matching grants are `own_cases` / `business_unit` only, so an out-of-scope caller gets 403 whether or not the case exists (W0-06 section 4 / 8.4 kept as merged; `{ kind: 'unresolved' }` target, one helper, T33). The same rule covers the W0-02 7.4 download routes keyed by `:artifactId` alone (404 `details.resource = 'artifact'` only for an `all_cases` holder), so `GET /api/artifacts/{artifactId}` is not an existence oracle. The alternative, 404 for every authenticated caller, was not chosen because it would let an out-of-scope owner or SPOC distinguish "exists" (403) from "does not exist" (404) and would need W0-06 section 4 / 8.3 / 8.4 rewritten | Tech lead on this PR; W0-06 records `not_found` as the eighth code. W0-09: carried into W0-06 sections 4, 8.3 and 8.4 and W0-02 7.1 on 2026-09-21 | W0 exit (W0-09): done |
| Request to W0-06: close the 403/404 open item against this spec | W0-06 section 4 step 2 still reads "`forbidden` (or `not_found`, per the W0-05 open item in section 8.4)", step 3 reads "exist in the actor's scope", 8.3 "Not found" says the choice is open and 8.4 defers to W0-05. With the rule above recorded, the W0-06 owner amends in their own PR: step 2 → `forbidden` only; step 3 → `not_found`, where "in the actor's scope" is defined by this spec's [Scope predicate](#scope-predicate) (covered by an `all_cases` row, or resolved and covered by an `own_cases` / `business_unit` grant); 8.3 and 8.4 → point at Section 4 of this spec as the recorded choice and drop "(current)" / "until then". No observable W0-06 behaviour changes (403 whether or not the case exists for an out-of-scope caller); the [Middleware](#middleware-w1-01-fastify) realises steps 2 and 3 as one helper. W0-09 applied the amendment to W0-06 on 2026-09-21 | W0-06 owner; tech lead | Done at W0 exit |
| D05 self-exclusion applied to send-back as well as approval | Applied (the W2-02 Done-when already says so; stricter is inside D05) | Review leads | Before W2-02 |
| Dispositions by a reviewer who is owner or SPOC on the case | Denied, provisional (approval-shaped authority) | Review leads, within D05 | Before W2-05 |
| Lane-open mail to a self-excluded reviewer | Sent (follows case-view scope as the contract says); they cannot act | Review leads / operator | Before W3-03 |
| In-app operator audience for audit read and the operator view | Admin only in slice 1; the operator is not a role (D06). Whether the operator holds Admin or a distinct group mapping is D10 / W6 | IT/Security + Ta at D10 | Before networked test |
| Create-case target built from the body | `case.create` is authorized against `CaseScopeFacts` taken from the validated W0-02 `CaseCreateRequest` (section 7.3): `businessOwner: SubjectId` → `ownerSubjectId` (stored as W0-04 `owner_subject_id`; for the `owner` role it must be the actor) and `businessUnit` → `businessUnitId` (W0-04 `business_unit_id`). No field is added to the W0-02 shape by this spec; W1-02 tests T6-T8 | Tech lead on this PR | Before W1-02 |
| Scope fields on `case.edit_draft` | Default (b): `businessOwner` and `businessUnitId` stay writable through the W0-02 `Partial<CaseWritableFields>` PATCH body, and the middleware evaluates the post-edit `CaseScopeFacts` with the same `inScope` predicate as the create target (owner: `businessOwner` must remain the actor; `bu_spoc`: resulting `business_unit_id` must be in a grant); `draft.saved` carries old and new scope values ([Edit target](#edit-target-caseedit_draft), T31). The alternative (a), immutable after create with 422 `invalid_input` like the projected fields, was not chosen because it narrows the W0-02 shape; if the tech lead prefers (a), the W0-02 owner must remove the two fields from `CaseUpdateRequest.fields` and this spec's T31 flips to 422 | Tech lead on this PR; W0-02 owner only if (a) is chosen | Before W1-02 |
| Reconciliation request to W0-02 / W0-04: BU key vs BU text | W0-02 `CaseWritableFields` carried one `businessUnit: string` (1..100 chars); W0-04 `case` stores both `business_unit` (inherited descriptive text) and `business_unit_id` (scope key). W0-09 resolved it on 2026-09-21: W0-02 7.3 now carries `businessUnitId` (the key, validated against the configured BU list, 422 when unknown) beside `businessUnit` (text), and W0-04 records the mapping; this spec compares `business_unit_id` only and W1-02 never derives the key from free text | W0-02 owner, W0-04 owner, tech lead | Done at W0 exit |
| Reconciliation request to W0-02 / W0-04: owner subject vs owner name | W0-02 `businessOwner` is a `SubjectId` and maps to W0-04 `owner_subject_id`; W0-04 also stores `business_owner` as descriptive text. W0-09 resolved it on 2026-09-21: the server writes `business_owner` from the owner subject's display name at create and at every owner change (W0-04 `case` table note); no extra shape field. Access never reads `business_owner` | W0-02 owner, W0-04 owner | Done at W0 exit |
| Contract-change request to W0-10: `reason` on `authz.denied` | This spec's `Decision.reason` (`role` / `scope` / `lane` / `self_approval`) is the value W1-08, W2-08 and W3-06 need to assert per denial at the API level, but W0-10 section 3.3 lists `action`, `targetType`, `targetId?`, `actorSubjectId`, `actorRole` as the only permitted fields and section 3.2's allow-list drops any other key. W0-09 registered `reason` (`'role' | 'scope' | 'lane' | 'self_approval'`) on `authz.denied` in W0-10 section 3.3 on 2026-09-21; API-level rows assert it (T30) | W0-10 owner; tech lead | Done at W0 exit |
| Read-shape request to W0-02: per-action reason beside `allowedActions` | W0-06 8.5 has one 403 key (`error.forbidden`) and the W0-02 read shapes carry no `allowedActions` yet. If Lane B wants a disabled control to say *why* (self-excluded reviewer, wrong lane), W0-02 would add `allowedActions: Action[]` and an optional per-action reason to the case, version and finding read shapes, with locale keys under a namespace W0-02 names. This spec neither adds the field nor the keys; the four reasons stay `Decision`-level and log-level ([Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers)) | W0-02 owner; Lane B | Before W1-06 / W2-07 |
| Second owner fixture in the same BU | T3, T7, T8, T11, T27, T31, T32 and T33 need an `owner` user in BU `CM` other than `fx-user-owner-cm` (`owner-b`). W0-09 added `fx-user-owner-cm-2` (owns no fixture case) to W0-03 section 7, W0-02 section 8.3 and W0-08 section 8.2 on 2026-09-21; W1-00 ships it in `users.ts` | W1-00, W0-03 owner | Done at W0 exit |

Not decided here and not to be decided by implementation: the owning-lane assignment for slot 5, slot 9, pack-level and QC-unavailable findings (W0-06 refinement item for the review leads); AD group-to-role mapping (W6, W8, D10); anything in D07-D10.

## References

- [Decision register](../product/decisions.md): D05, D06, D12, W0-04 fields
- [W0 technical contract](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix): W0-05 section and the rows this file adds
- [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md): stack, error codes, the 403/404 open item
- [Source spec](../product/source-spec.md) "Roles and access", "Notifications" (frozen; hash in [sources](../sources.md))
- [PRD](../../PRD.md) "Users and authority"; [workflow](../product/workflow.md); [data contract](../product/data-contract.md) "Access and retention"
- [Acceptance](../acceptance.md): A01, A05, A06, A07, A09, A11
- [Threat model](../security/threat-model.md)
- [Slice-1 work breakdown](../delivery/slice-1-work-breakdown.md): W1-00, W1-01, W1-02, W1-03, W1-13, W2-02, W2-05, W2-06, W3-01, W3-03, W3-07
- [Design-to-build map](../delivery/design-to-build-map.md): client-side permissions are simulation only
