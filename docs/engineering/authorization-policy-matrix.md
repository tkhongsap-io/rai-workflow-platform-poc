# Authorization policy matrix (W0-05)

Status: W0 interface spec, written for the stack recorded in [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04). Ticket W0-05 ([issue #10](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/10)), lane Lead, human review required. Proves A01 and A09 once W1-01, W2-02 and W3-01 implement it. Nothing here is implemented yet.

This document derives one table of role × action × scope from the [PRD](../../PRD.md) "Users and authority", the frozen [source spec](../product/source-spec.md) "Roles and access", the [data contract](../product/data-contract.md) "Access and retention" and the recorded rules D05, D06 and "W0-04 fields" in the [decision register](../product/decisions.md). It records no decision of its own: every D05 row is carried as written, D07-D10 stay open, and every place where this spec had to pick an engineering default is marked as such in [Resolutions and items for review](#8-resolutions-and-items-for-review).

Consumers: **W1-00** (policy module holding the view, create-edit-submit and download rows as data), **W1-01** (the authorization middleware, the only place scope is enforced), **W1-02**, **W1-03**, **W1-13** (substitute returns the same denials), **W2-02** (adds the D05 disposition and self-approval rows to the policy module as its contract PR), **W2-05**, **W2-06**, **W3-01** (queue query), **W3-03** (notification recipients), **W3-07** (operator view), and the exit tickets W1-08, W2-08, W3-06 that run the negative tests in [Test obligations](#7-test-obligations).

Sibling W0 specs: [W0-03 identity adapter](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) (produces the actor this spec evaluates), [W0-04 persistence](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec) (owner/BU columns, audit-log readers), [W0-06 workflow and error contract](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract) (preconditions this spec's checks precede; owning-lane assignment), [W0-07 QC and mail](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink) (recipients and the no-authority rule for QC), [W0-10 observability](../delivery/w0-technical-contract.md#w0-10--observability-contract-for-the-desk-runtime) (denials are logged with the correlation ID). Each lands as its own `docs/engineering/` file on its own branch; the links above point at the contract sections that define them.

## 1. Principles

1. **Server-side, every time.** Every read, list, count, search, filter option, download, deep link and write is authorized in the Fastify API before any data is fetched or any bytes are streamed (A01). The React SPA holds no permission logic; the demo's role switcher and client-side checks are never ported ([design-to-build map](../delivery/design-to-build-map.md)).
2. **Deny by default.** Access exists only where this matrix has a row. The policy module rejects an unknown role, an unknown action and an actor with no `(role, scope)` pair; a route that declares no action fails at server start, not at request time (W1-00 "nothing grants access without a policy row").
3. **Role gives the action; scope gives the cases.** A role names what an actor may do; the scope attached to that role by the identity adapter (W0-03) names which cases it applies to. Both are checked on every request, in that order.
4. **Lane authority is per lane, never implicit.** A reviewer decides only the lane their role maps to. Admin has no lane authority and never inherits one (PRD, source spec Admin row).
5. **D05 is carried as written.** Full re-review after resubmission and the merge of concurrent send-backs are W0-06 rules; this spec carries the two D05 authority rules: waived and N/A are recorded by the finding's owning lane, the owner may propose "fixed" which the owning lane confirms; and no one who is owner or BU SPOC on a case may approve a lane on that case.
6. **AI and mail have no authority.** QC (W0-07) and the notification boundary are not roles; nothing they return or deliver grants access, approves or transitions. A deep link is a URL and nothing more: sign-in and scope are checked when it is opened (A05).
7. **Denials are attributable.** Each denial writes a structured log line with the correlation ID (W0-10) and, for a denied write, an audit event of kind `authorization.denied` in the same request; the log and the audit carry the true reason even where the response body is deliberately terse.

## 2. Vocabulary

### Roles

Six roles, identifiers fixed here for the shared package (`rai-web/shared`, path per W0-02) and the fixture identity provider (W1-00). No seventh role (D06).

| Identifier | Role | Default scope kind |
|---|---|---|
| `owner` | Use-case owner | `own` |
| `bu_spoc` | BU SPOC | `bu` (one or more business units) |
| `reviewer_aicoe` | AI/COE reviewer | `all` |
| `reviewer_dpo` | DPO reviewer | `all` |
| `reviewer_itsec` | IT/Security reviewer | `all` |
| `admin` | Admin | `all` |

The three reviewer roles map to lanes `aicoe`, `dpo`, `itsec`. Slot-to-lane mapping (AI/COE 1+5 per D02, DPO 2-5, IT/Security 5-8) is the W0-06 versioned constant recorded on each submitted version; this spec never reads slots, only the lane recorded on a decision or on a finding's `owning_lane`.

### Actor

The identity adapter (W0-03) returns the actor; the policy module evaluates it and nothing else. One subject may hold several pairs (the W0-03 dual-role fixture identity: a lane reviewer who is also BU SPOC of one fixture BU).

```ts
type Role = 'owner' | 'bu_spoc' | 'reviewer_aicoe' | 'reviewer_dpo' | 'reviewer_itsec' | 'admin';
type Lane = 'aicoe' | 'dpo' | 'itsec';

type Scope =
  | { kind: 'own' }                          // cases whose owner is this subject
  | { kind: 'bu'; businessUnit: string }     // cases in this business unit
  | { kind: 'all' };                         // every case

type Actor = {
  subjectId: string;        // stable ID from the identity adapter, never the email
  grants: ReadonlyArray<{ role: Role; scope: Scope }>;
};
```

Scope facts come from the Case entity only: the case's owner subject reference and its `business_unit` (W0-04 names the columns). The inherited text fields `business_owner` and `technical_owner` are registry names for display and search; they are never used to decide access.

```ts
type CaseScopeFacts = {
  caseId: string;
  ownerSubjectId: string;
  businessUnit: string;
};
```

### Scope predicate

`inScope(actor, role, facts)` is true when at least one of the actor's grants for `role` covers the case:

| Scope kind | Covers the case when |
|---|---|
| `own` | `facts.ownerSubjectId === actor.subjectId` |
| `bu` | `facts.businessUnit === scope.businessUnit` |
| `all` | always |

`isOwnerOrSpocOnCase(actor, facts)` is true when the actor holds `owner` with the case in `own` scope, or `bu_spoc` with the case's BU in scope. This predicate is the D05 self-exclusion and is evaluated against the case, not against the actor's role list alone: a DPO reviewer who is SPOC of BU "Retail" is excluded on Retail cases and unrestricted elsewhere.

### Actions

Action identifiers are the unit of authorization. Every Fastify route declares exactly one; W1-00 seeds the first group, W2-02 adds the second, W3-01/W3-03 the third.

```ts
type Action =
  // W1-00 rows
  | 'case.view' | 'case.list' | 'case.create' | 'case.edit_draft' | 'case.submit'
  | 'artifact.upload' | 'artifact.download' | 'version.view' | 'history.view'
  | 'config.read_effective' | 'config.read_revisions' | 'config.publish' | 'audit.read'
  // W2-02 contract PR rows (D05)
  | 'lane.approve' | 'lane.send_back' | 'case.resubmit'
  | 'finding.propose_fixed' | 'finding.confirm_fixed' | 'finding.waive' | 'finding.mark_na'
  // W3 rows
  | 'queue.search' | 'queue.count' | 'operator.view';
```

## 3. The matrix

Cell values: **Own** = cases in the actor's `own` scope; **BU** = cases in a `bu` scope the actor holds; **All** = every case; **Own lane** = only decisions or findings whose lane equals the actor's reviewer lane; **—** = no row, denied. A cell marked with a rule ID is conditioned by that rule in addition to scope.

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
| Search results (`queue.search`) | Own | BU | All | All | All | All | Follows case-view scope: every search key (`source_record_id`, status, owner, `use_case_group`, all) is filtered by the actor's scope predicate before matching (A06) |
| Counts, pagination and filter options (`queue.count`) | Own | BU | All | All | All | All | Computed over the scoped set only; an out-of-scope user's counts and filter options equal those of a user with no such cases (A06) |
| Deep link into a case, version, finding or file | Own | BU | All | All | All | All | The link carries only opaque IDs; opening it runs sign-in then `case.view` on the referenced case. No token in a link grants scope (A05) |
| File download (`artifact.download`) | Own | BU | All | All | All | All | Follows case-view scope of the case the artifact belongs to; bytes stream only after the check; a direct blob path is never routable (W1-03) |
| Upload an artifact into a draft (`artifact.upload`) | Own | BU | — | — | — | — | Part of "create, edit draft, submit"; the target is the case that owns the draft; safety checks (W0-08) run after the decision and before the blob store accepts bytes |
| Old versions (`version.view`, `history.view`) | Own | BU | All | All | All | All | Same scope as the case; versions are never hidden from an in-scope actor (A07) |
| QC evidence and findings on a version | Own | BU | All | All | All | All | Reading findings follows case-view scope; disposition authority is the separate row below |
| Resubmit a successor draft (`case.resubmit`) | Own | BU | — | — | — | — | Same actor set as submit; the actor is recorded on the audit event, the case owner is unchanged (W1-INT SPOC-on-behalf test) |
| Propose "fixed" (`finding.propose_fixed`) | Own | BU | — | — | — | — | D05: a proposal, not a disposition; it stays proposed until the owning lane confirms |
| Confirm "fixed", waive with reason, N/A with reason | — | — | Owning lane | Owning lane | Owning lane | — | D05: only the lane equal to the finding's `owning_lane` (assigned by the W0-06 rule); the owning lane may also record "fixed" directly without a proposal |
| Send back a lane on a case where the actor is owner or BU SPOC | — | — | Never | Never | Never | — | D05 names approval; the W2-02 Done-when applies the same exclusion to send-back. Carried here as the stricter reading inside D05; see [Resolutions](#8-resolutions-and-items-for-review) |
| Disposition (confirm/waive/N/A) a finding on a case where the actor is owner or BU SPOC | — | — | Denied (provisional) | Denied (provisional) | Denied (provisional) | — | Not named by D05; this spec defaults to deny because a waiver is approval-shaped. Review leads may refine before W2-05; see [Resolutions](#8-resolutions-and-items-for-review) |
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
| Lane opens | Every subject holding the reviewer role for that lane | Case-view scope (`all` for reviewers, so all of them) | Source spec notifications, contract W0-05 |
| Send-back | The case owner | Case-view scope (`own` on the case) | Source spec: "Owner". BU SPOC is not a source-spec recipient; adding one is a product change, not made here |
| Ready for launch | The case owner | Case-view scope | Source spec: "Owner" |
| SLA breach digest | The addresses in the `operator_recipients` configuration value | **No role and no case scope**: the recipients come from Admin configuration (D06), not from a role; the digest lists cases past SLA with links, and each link still requires sign-in and `case.view` when opened (A05) | D06; W3-03, W3-05 |

The D05 self-exclusion does not remove a reviewer from the lane-open recipient set: they remain in view scope and see the case in their queue with the decision controls disabled and the reason shown. Whether such a reviewer should be omitted from the mail is listed for the review leads, not decided here.

## 4. Out-of-scope references: 403, with non-guessable identifiers

ADR-0003 left to this spec whether an out-of-scope case reference answers 403 `forbidden` (the W1 contract) or 404 `not_found` to hide that the case exists. **This spec keeps 403**, on the following condition, and asks the human reviewer of this PR to confirm it:

- Case, version, artifact and finding identifiers used in routes, API bodies and deep links are opaque and non-guessable (random UUID or equivalent, never sequential; W0-04 fixes the column type). The display identifier `registry_id` and the inherited `source_record_id` appear in bodies and in search, never as a route key.
- With non-enumerable IDs, the only way an out-of-scope caller holds an ID is having been given it (for example a forwarded mail link), in which case the existence of the case is already known to them and a 403 discloses nothing further. The threat-model row is "owner reads another BU's case", which 403 prevents; existence disclosure by enumeration is prevented by the ID rule, not by the status code.
- The 403 body carries only `code`, the locale key and the correlation ID (ADR-0003 error table). It never carries the case name, BU, owner or any field.
- 404 `not_found` is returned only when the ID does not resolve at all. The server performs the lookup and the scope check in one place so that both paths cost the same and log the same shape (W0-10).

If the ID rule cannot be kept (for example a later decision to key routes on `registry_id`), the answer flips to 404 for out-of-scope reads and this section is rewritten; that is a contract change and its own PR.

Error mapping used throughout, taken from ADR-0003 and confirmed by W0-06:

| Situation | HTTP | `code` | `reason` (403 only) |
|---|---|---|---|
| No or invalid session | 401 | `unauthenticated` | — |
| Actor's roles hold no row for the action | 403 | `forbidden` | `role` |
| Row exists, case outside every matching scope | 403 | `forbidden` | `scope` |
| Reviewer acts on a lane that is not theirs, or on a finding whose `owning_lane` is not theirs | 403 | `forbidden` | `lane` |
| D05 self-exclusion (owner or BU SPOC on the case) | 403 | `forbidden` | `self_approval` |
| Admin attempts a lane decision or a disposition | 403 | `forbidden` | `role` |
| ID does not exist | 404 | `not_found` | — |
| Body contains one of the four projected status fields | 422 | `invalid_input` | — |

`reason` is a sub-code with its own locale key (`error.forbidden.role`, `error.forbidden.scope`, `error.forbidden.lane`, `error.forbidden.self_approval`; D12 Thai default) so the UI can explain a disabled control without deciding anything itself. `scope` reveals no more than the status code already does under the ID rule above.

## 5. W0-04 fields projection rule

The four inherited status fields are read-only projections written only by the workflow (register row "W0-04 fields", Ta, 2026-09-21):

| Field | Written when | By |
|---|---|---|
| `privacy_status` | DPO lane approval commits | The W2-02 decision transaction |
| `security_status` | IT/Security lane approval commits | The W2-02 decision transaction |
| `rai_status` | AI/COE lane approval commits | The W2-02 decision transaction |
| `ai_readiness_status` | Ready for launch commits | The W2-06 transition transaction |

Authorization consequences:

- There is **no action** in this matrix that writes any of the four; no role has a row, including Admin. The request/response shapes for `case.create`, `case.edit_draft`, `case.submit` and `case.resubmit` (W0-02 W1 interface shapes) do not contain these fields; a body that carries one is rejected with 422 `invalid_input` and the locale key `error.invalid_input.projected_field`, before any policy or scope evaluation. This is the W1-02 Done-when "a write to any of them that the rule forbids is rejected".
- The projection is written in the **same transaction** as the lane-decision or Ready audit event and derives its value from that event; it is never a second record of a decision (L8). Readers treat the lane-decision entity and the Ready transition as the only authority; the four fields exist so the desk can show the registry names the source spec inherits.
- Because the writer is the workflow and not an actor, the fields need no row here; the test obligation is negative only (see below).

## 6. Enforcement in the stack

Stack-specific placement, keeping the intent stack-neutral: one policy function, evaluated by one middleware, before any data access.

### Policy module (W1-00, `rai-web/server`, path per W0-02)

- The matrix lives as **data**: an array of `PolicyRow` exported from one module and covered by a table-driven test. Rows are the source of truth for the UI's `allowedActions` (below), for the tests and for the operator documentation; no route re-implements a check.

```ts
type ScopeRule = 'own' | 'bu' | 'all';

type PolicyRow = {
  action: Action;
  role: Role;
  scope: ScopeRule;                       // which of the actor's scopes may cover the target
  laneRule?: 'own_lane' | 'owning_lane';  // lane.* and finding.* rows only
  excludeOwnerOrSpoc?: true;              // D05 self-exclusion rows only
};

type Target =
  | { kind: 'none' }                                            // case.create, case.list, queue.*, config.*
  | { kind: 'case'; facts: CaseScopeFacts }                     // view, edit, submit, download, version, history
  | { kind: 'lane'; facts: CaseScopeFacts; lane: Lane }         // lane.approve, lane.send_back
  | { kind: 'finding'; facts: CaseScopeFacts; owningLane: Lane }; // finding.*

type Decision =
  | { allow: true; via: PolicyRow }
  | { allow: false; code: 'forbidden'; reason: 'role' | 'scope' | 'lane' | 'self_approval' };

function authorize(actor: Actor, action: Action, target: Target): Decision;
```

- `authorize` is pure: no I/O, no clock. It throws on an unknown `Action` or `Role` (a programming error surfaced by tests, never a 403) and denies when the actor has no grant matching a row. Evaluation order per row: role → scope → lane → self-exclusion; the first row that allows wins; if no row allows, the denial reason is the most specific one reached (`self_approval` over `lane` over `scope` over `role`) so the UI can explain it.
- W1-00 ships the rows for `case.*` (view, list, create, edit_draft, submit), `artifact.*`, `version.view`, `history.view`, `config.*` and `audit.read`. **W2-02's contract PR** adds `lane.*`, `case.resubmit` and `finding.*` with the D05 rules; **W3-01/W3-03** add `queue.*`, `operator.view` and the recipient resolver. Adding a row is a contract change and its own PR (team and roles, "shared interface contract").

### Middleware (W1-01, Fastify)

- Every route declares `{ action, target }` in its route config; a Fastify `onRoute` hook rejects a route without one at startup. A global `preHandler` hook resolves the session to an `Actor` (401 if none), loads the target's `CaseScopeFacts` by opaque ID (404 if absent), calls `authorize`, and replies 403 with the reason on deny. Handlers run only after allow and receive the `Decision` on the request for the audit event.
- Loading `CaseScopeFacts` is the only pre-authorization read and it reads three columns; the handler's own queries run after the decision. The facts lookup and the check are one helper so the 403 and 404 paths cannot diverge.
- The audit event of a denied write (`authorization.denied`, with the true reason and the correlation ID) is written in the same request; denied reads are logged, not audited, to keep the audit trail to state changes (W0-04).

### Query scope (W1-02, W3-01, Drizzle)

- List, search and count queries never take the actor's role list as a hint; they take a `caseScopeWhere(actor)` predicate built from the actor's grants for `case.view` (`own` → `owner_subject_id = $subject`; `bu` → `business_unit IN (...)`; `all` → no filter) and apply it before any other filter, `LIMIT` or `COUNT`. Filter-option lists (owners, groups, statuses shown in the queue) are computed from the same scoped query (A06).
- There is one such helper in the server; a query that touches the cases table without it is caught by a test that lists every Drizzle query builder call site (W3-01 Done-when "pagination never leaks a case").

### Downloads and deep links (W1-03, W3-03)

- Artifact routes are `/cases/:caseId/versions/:versionId/artifacts/:artifactId` (exact shape per W0-02); the target is the case, so `artifact.download` follows `case.view` scope. The blob store is not served statically; bytes stream from the handler after the decision with `Cache-Control: no-store`.
- A deep link is `<origin>/cases/:caseId[...]` with opaque IDs and no token. Opening it without a session yields the sign-in flow and then the same `case.view` check (W3-02 "a deep link into a card requires sign-in"; A05 "recipient cannot gain access from link alone").

### UI convenience (W0-02 shapes, W1-13, Lane B)

- Read responses for a case, a version and a finding may carry `allowedActions: Action[]`, computed by the same `authorize` function on the server. The SPA renders controls from it and shows the `reason` locale key when a control is disabled. This is a convenience, never authority: the server re-evaluates on every action, and Lane B tests assert that a forced call still returns 403 (W1-06/W1-07 "no client-side check decides access").

### Substitute (W1-13)

- The dev/test substitute imports the same policy rows and `authorize` from the shared module, so a request the matrix denies returns the same 403 and reason from the substitute as from the real server. It never adds a row of its own.

## 7. Test obligations

Fixture identities come from W1-00 (six single-role users and the W0-03 dual-role identity: a lane reviewer, lane L, who is also BU SPOC of fixture BU B2); fixture cases from W1-09 (at least one case owned by `owner-a` in BU B1, one case in BU B2). Names below are placeholders; W1-00 records the actual identifiers each evidence file cites.

| # | Actor | Action | Target | Expected | Ticket | Proves |
|---|---|---|---|---|---|---|
| T1 | no session | `case.view` | any case | 401 `unauthenticated` | W1-01 | A01 |
| T2 | `owner-a` | `case.view` | own case (B1) | 200 | W1-02 | A01 |
| T3 | `owner-b` (another owner, B1) | `case.view` | owner-a's case | 403 `scope`; body carries no case field | W1-02 | A01 |
| T4 | `spoc-b1` | `case.view`, `case.edit_draft`, `case.submit` | owner-a's case (B1) | 200; submit audit event actor = spoc-b1, case owner unchanged | W1-02, W1-INT | A01, A02 |
| T5 | `spoc-b1` | `case.view` | case in B2 | 403 `scope` | W1-02 | A01 |
| T6 | `reviewer-dpo` | `case.view`, `version.view`, `history.view` | any case, any version | 200 | W1-02, W1-05 | A01, A07 |
| T7 | `reviewer-dpo` | `case.edit_draft` | any case | 403 `role` | W1-02 | A01 |
| T8 | `owner-b` | `artifact.download` | artifact on owner-a's case | 403 `scope`; no bytes | W1-03 | A01 |
| T9 | no session | direct blob path / artifact URL | any | 401; blob directory not routable | W1-03 | A01 |
| T10 | any actor | `case.create` / `case.edit_draft` with `privacy_status` in body | — | 422 `invalid_input` `projected_field` | W1-02 | W0-04 fields |
| T11 | `admin` | `config.read_revisions`, `audit.read` | — | 200; every other role 403 `role` | W1-00 | A01, A11 |
| T12 | any role | unknown action / policy row lookup for unknown role | — | `authorize` throws; no route reachable | W1-00 | A01 |
| T13 | `reviewer-dpo` | `lane.approve` | lane `dpo` on a case where reviewer-dpo is neither owner nor SPOC | 200 | W2-02 | A09 |
| T14 | `reviewer-dpo` | `lane.approve` | lane `itsec` | 403 `lane` | W2-02 | A09 |
| T15 | `admin` | `lane.approve`, `lane.send_back` | any lane | 403 `role` | W2-02 | A01, A09 |
| T16 | dual-role (lane L + SPOC B2) | `lane.approve`, `lane.send_back` | lane L on a case in B2 | 403 `self_approval` | W2-02 | A09 (D05) |
| T17 | dual-role | `lane.approve` | lane L on a case in B1 | 200 | W2-02 | A09 |
| T18 | `owner-a` | `finding.propose_fixed` | finding on own case | 200, state proposed | W2-05 | A09 |
| T19 | `owner-a` | `finding.waive`, `finding.mark_na`, `finding.confirm_fixed` | finding on own case | 403 `role` | W2-05 | A09 |
| T20 | `reviewer-dpo` | `finding.waive` | finding with `owning_lane = itsec` (single-lane, slot-5 and pack-level cases) | 403 `lane` | W2-05 | A09 |
| T21 | `reviewer-dpo` | `finding.confirm_fixed` | proposal on a finding with `owning_lane = dpo` | 200; disposition attributed to reviewer-dpo | W2-05 | A09 |
| T22 | dual-role | `finding.waive` | finding owned by lane L on a case in B2 | 403 `self_approval` (provisional default) | W2-05 | A09 |
| T23 | any actor | set Ready by request | — | no route exists; predicate runs only inside W2-06 | W2-06 | A09 |
| T24 | `owner-a`, `spoc-b1`, `owner-b` | `queue.search`, `queue.count` | each key | results, counts and filter options equal the scoped set; owner-b sees zero of owner-a's cases and identical counts to a user with no cases | W3-01 | A06 |
| T25 | mail sink | send-back and Ready recipients | case owned by owner-a | recipient = owner-a only; link has no token | W3-03 | A05 |
| T26 | mail sink | breach digest | — | recipients = `operator_recipients` seed; link without session yields 401 | W3-03 | A05 |
| T27 | any denied write | audit | — | `authorization.denied` event with reason and correlation ID; denied read logged, not audited | W1-01, W3-07 | A11 |

The negative tests call the API directly, never through the UI (ADR-0003 risk table); the exit tickets W1-08, W2-08 and W3-06 record their output.

## 8. Resolutions and items for review

Engineering defaults this spec had to set, each inside the recorded rules and each open to the named reviewer:

| Item | Default in this spec | Who confirms | When |
|---|---|---|---|
| 403 vs 404 for out-of-scope references (ADR-0003 open item) | 403 `forbidden`, conditioned on non-guessable route identifiers ([Section 4](#4-out-of-scope-references-403-with-non-guessable-identifiers)) | Tech lead on this PR; W0-06 records `not_found` as the eighth code | W0 exit (W0-09) |
| D05 self-exclusion applied to send-back as well as approval | Applied (the W2-02 Done-when already says so; stricter is inside D05) | Review leads | Before W2-02 |
| Dispositions by a reviewer who is owner or SPOC on the case | Denied, provisional (approval-shaped authority) | Review leads, within D05 | Before W2-05 |
| Lane-open mail to a self-excluded reviewer | Sent (follows case-view scope as the contract says); they cannot act | Review leads / operator | Before W3-03 |
| In-app operator audience for audit read and the operator view | Admin only in slice 1; the operator is not a role (D06). Whether the operator holds Admin or a distinct group mapping is D10 / W6 | IT/Security + Ta at D10 | Before networked test |

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
