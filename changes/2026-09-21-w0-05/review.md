# Review: W0-05 — authorization policy matrix

2026-09-21. Ticket W0-05 (issue #10), branch `codex/w0-05-authorization-matrix`, worktree `/Users/tkhongsap/github/rai-wt/W0-05`. Implementer self-review; human review required (tech lead) and independent reviewer agents before merge per the D03 amendment.

## What landed

- `docs/engineering/authorization-policy-matrix.md`: the role × action × scope matrix for the stack recorded in ADR-0003. Carries the six W0-contract rows unchanged, then adds the rows the contract asks for: search results, counts/pagination/filter options, deep links, file download (all following case-view scope), plus old versions, QC evidence, upload, resubmit, propose-fixed, confirm/waive/N/A by the owning lane (D05), configuration read/revisions/publish, audit read, operator view, Ready (no actor), and the W0-04-fields projection rule (the four status fields are written only by the workflow in the decision/Ready transaction; no role has a write row; a body carrying one is 422 `invalid_input`). Notification recipients: lane-open, send-back and Ready follow case-view scope; SLA-breach digest recipients come from the D06 `operator_recipients` configuration and are not a role. Defines role, lane, scope, actor and action identifiers and the `authorize(actor, action, target)` shape in TypeScript notation for the W1-00 policy module (matrix as data, deny by default, unknown role/action throws), the Fastify `preHandler` placement (W1-01), the single Drizzle scope predicate for list/search/count (W1-02, W3-01), download and deep-link handling (W1-03, W3-03), the `allowedActions` UI convenience and the W1-13 substitute rule. Resolves the ADR-0003 open item on out-of-scope references: 403 `forbidden`, conditioned on non-guessable route identifiers, with the reasoning against the threat model and a flip condition. Lists 30 negative/positive test obligations mapped to tickets and A-IDs, including the D05 dual-role self-approval case.
- Engineering defaults set inside the recorded rules and listed visibly for the named reviewers (section 8): 403 vs 404; self-exclusion applied to send-back (as the W2-02 Done-when already states); dispositions by a self-excluded reviewer denied provisionally; lane-open mail still sent to a self-excluded reviewer; in-app operator audience = Admin in slice 1 (operator is not a role, D06; D10/W6 decide the mapping).
- `changes/2026-09-21-w0-05/review.md`: this record.

## Fix round 1 (review findings on PR #58)

Both blocking findings pointed at the same gap: `case.create` was declared with a `{ kind: 'none' }` target, so the "Create, edit draft, submit: Own / BU" cell was never evaluated on create, and `case.list` was in the action union without a matrix row or a test obligation. Changes:

- `case.create` now has a `case` target whose `CaseScopeFacts` come from the validated body (new "Create target" subsection in section 2, referenced by the 3.2 row, the error table, the `Target` union and the W1-01 middleware paragraph): `businessUnit` from the body's required `business_unit`; for the `owner` role the server sets `ownerSubjectId = actor.subjectId` and a body naming another owner is 403 `scope`; for `bu_spoc` the body's BU must be in a `bu` grant (else 403 `scope`) and the SPOC may name the owner within that BU (PRD: "acts on owner's behalf"), recorded as audit actor with the named owner as case owner. An unresolvable owner is 422 `invalid_input` before policy evaluation. A denied create writes no case and audits `authorization.denied`.
- New 3.2 rows: "Create a case (`case.create`)" and "List cases (`case.list`)" (Own / BU / All / All / All / All, same `caseScopeWhere` predicate as `queue.search`); the `{ kind: 'none' }` target is now documented as role-check-only with scope enforced by that predicate.
- Section 7 gains T6 (spoc-b1 creates in B2 -> 403 `scope`), T7 (owner-a names owner-b -> 403 `scope`; spoc-b1 in B1 naming owner-a -> 201, owner = owner-a, audit actor = spoc-b1) and T8 (owner-b's and spoc-b1's `case.list` omit out-of-scope cases); former T6-T27 renumbered T9-T30. No obligation was removed or weakened.
- Section 8 gains one item for the reviewers: the W0-02 create shape must carry the optional `owner_subject_id` this rule reads.

Not edited, on purpose: `docs/product/decisions.md` (no decision recorded; D05, D06, W0-04 fields carried as written; D07-D10 untouched), `docs/product/source-spec.md` (frozen; hash unchanged), `adr/0003-stack-and-deployment-boundary.md` (its W0-05 open-item checkbox is outside this ticket's files; W0-09 ticks it at the exit review), `adr/README.md` (nothing to change: W0-05 produces an interface spec, not an ADR), `docs/architecture/README.md` and `TESTING.md` (W0-02 only), the ticket row status (issue #10 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step). Sibling W0 specs were linked through their W0-contract section anchors while their `docs/engineering/` files were on parallel branches; fix round 4 repointed the merged ones.

## Fix round 2 (review findings on PR #58)

One blocking finding: three matrix rows with a stated scope had no obligation in section 7, so the behaviour could break without a failing test. Lane-open recipients (3.3, and the Done-when clause "lane-open, send-back and Ready recipients follow case-view scope") were missing from T28, which named send-back and Ready only; `operator.view` (3.2, Admin only) and `config.publish` (3.2, whose Rule cell says the row exists so W1-00 can test that nobody else has it) were missing from T14. Changes, both in the section 7 table and nothing else:

- T28 now covers lane-open, send-back and Ready recipients: lane-open expects every holder of that lane's reviewer role and no other subject; send-back and Ready expect owner-a only; links carry no token (W3-03, A05).
- T14 now covers `config.read_revisions`, `config.publish`, `audit.read` and `operator.view`: admin 200, every other role 403 `role` (W1-00 for the config and audit rows, W3-07 for the operator view; A01, A11).

No obligation was removed or weakened; numbering is unchanged.

## Fix round 3 (review findings on PR #58)

One blocking finding, same class as fix round 2: two 3.2 write actions with a stated Own / BU / — scope, `artifact.upload` and `case.resubmit`, appeared in no section 7 row, so an authenticated out-of-scope actor uploading into another owner's draft or resubmitting another owner's case was a stated denial that W1-08/W2-08/W3-06 would never exercise. Changes, in the section 7 table and nothing else:

- T10 now covers `case.edit_draft`, `artifact.upload` and `case.resubmit` for `reviewer-dpo` on any case: 403 `role` (W1-02, W1-03, W2-04; A01).
- T11 now covers three `owner-b` writes against owner-a: `artifact.download` (403 `scope`, no bytes, as before), `artifact.upload` into owner-a's draft (403 `scope`, no bytes stored, `authorization.denied` audited; W1-03) and `case.resubmit` on owner-a's case (403 `scope`, no N+1 draft created; W2-04). A01.

No obligation was removed or weakened; numbering is unchanged. Sweep after the change: every identifier in the `Action` union appears in a section 7 row except `config.read_effective`, whose 3.2 row is Yes for every role (no stated denial to exercise; its `operator_recipients` exclusion is a field projection covered by the W3-07 seed, not an authorization row).

## Fix round 4 (review findings on PR #58, after W0-02/W0-04/W0-06/W0-10 merged)

One blocking finding: section 2 fixed role, lane and scope identifiers (`reviewer_aicoe`/`reviewer_dpo`/`reviewer_itsec`, lanes `aicoe`/`dpo`/`itsec`, scope kinds `own`/`bu`/`all`) that contradicted the sibling specs merged to main after this branch was cut. W0-02 section 7.2 fixes `Role = 'owner'|'bu_spoc'|'ai_coe'|'dpo'|'it_security'|'admin'`, `Lane = 'ai_coe'|'dpo'|'it_security'` and scope kinds `own_cases`/`business_unit`/`all_cases`; W0-04 stores `qc_finding.owning_lane` with the same lane values and keys SPOC scope on `business_unit_id = ANY($bus)`, not the descriptive `business_unit` text; and W0-02 section 7.3 carries `businessOwner: SubjectId` on the create shape, not an optional `owner_subject_id`. Changes, all in `docs/engineering/authorization-policy-matrix.md`:

- Branch rebased onto `origin/main` (32e16ee) so the merged sibling files exist in the tree; the sibling-spec paragraph now links W0-02, W0-04, W0-06 and W0-10 at their `docs/engineering/` files and anchors, and states that a merged sibling's identifiers are used verbatim. W0-03 and W0-07 still link to the contract sections (not merged).
- Section 2 roles table and the TypeScript block now reproduce the W0-02 `Role`, `Lane` and `RoleScope` types by reference (W0-02 is authoritative; matrix headings and the Own/BU/All cell shorthands are declared prose for `own_cases`/`business_unit`/`all_cases`). `Actor` is `Pick<Principal, 'subjectId' | 'roles'>`.
- `CaseScopeFacts` is `{ caseId?, ownerSubjectId (W0-04 owner_subject_id), businessUnitId (W0-04 business_unit_id) }`; the scope predicate table, `isOwnerOrSpocOnCase`, the 3.2 create row, the 3.3 recipient scopes, `ScopeRule`, the `finding` target comment and the Drizzle predicate (`business_unit_id = ANY($bus)`, aligned with W0-04's `scopedCases(tx, actor)`) use these names. The descriptive `business_unit` and `business_owner` columns are named explicitly as never used for access.
- The create-target subsection reads the owner from W0-02 `businessOwner: SubjectId` (stored as `owner_subject_id`) and the BU key from the W0-02 `businessUnit` field, and no longer asserts a field W0-02 does not carry. The section 8 create-target row is rewritten to match, and three reconciliation items are added for the W0-02/W0-04 owners rather than decided here: which body field feeds `business_unit_id` versus the `business_unit` text; whether the shape needs a display-name field for `business_owner`; and a second owner fixture in BU `CM` (`owner-b`) that the W0-02 section 8.3 list lacks.
- Section 7 placeholders are mapped to the W0-02 section 8.3 fixture identifiers in a table (`fx-user-owner-cm`, `fx-user-spoc-cm`, `fx-user-dpo`, `fx-user-admin`, `fx-user-dpo-spoc-hr`, BUs `CM`/`HR`); T6, T7, T13, T17 and T23 use the W0-02 field and lane spellings (`businessUnit`, `businessOwner`, `privacyStatus`, `it_security`).
- Principle 7 names the W0-10 log event `authz.denied` next to the audit event kind `authorization.denied`.

No matrix row, rule or test obligation was removed or weakened; T1-T30 numbering is unchanged. The fix-round-1 note above about an "optional `owner_subject_id`" in the W0-02 shape is superseded by this round.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped (rerun after fix round 2: 22 pass, 0 fail; after fix round 3: 22 pass, 0 fail; after fix round 4 on the rebased branch: 22 pass, 0 fail) |
| `git diff --check` (after `git add -N` of the new files) | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the new document (script in the PR description) | 36 links, 0 broken (fix round 1; 30 before). Rerun after fix round 2 with a fresh script: 35 relative links, 0 broken; no link was changed. Rerun after fix round 4 (sibling links repointed at the merged `docs/engineering/` files, anchors checked against those files): 47 relative links, 0 broken |

No product suite exists yet (the application skeleton arrives with W1-00 under the layout W0-02 assigns), so `npm test`, lint, typecheck and Playwright do not apply to this ticket.

## Done-when check (W0 contract, W0-05 section and exit checklist)

- [x] Table of role × action × scope derived from the PRD, the source spec and the recorded D05 rules; the six contract rows carried unchanged.
- [x] Rows added: search results, counts, deep links and file download following case-view scope.
- [x] Notification recipients: lane-open, send-back and Ready follow case-view scope; SLA-breach digest recipients come from the D06 operator-recipient configuration and are not a role.
- [x] W0-04-fields projection rule: the four status fields are written only by the workflow; no role has a write row.
- [x] Recorded D05 and D06 rules carried as written; D07-D10 left open; no decision recorded by this ticket.
- [x] Stack-concrete for ADR-0003 (Fastify hook placement, Drizzle scope predicate, shared-package types, node:test/Playwright obligations) with the boundary stack-neutral in intent.
- [x] Cross-linked to the sibling W0 specs and to the consuming tickets (W1-00, W1-01, W1-02, W1-03, W1-13, W2-02, W2-05, W2-06, W3-01, W3-03, W3-07, exit tickets).
- [x] Stop condition: no unrestricted network login (identity is W0-03's; this spec only consumes the actor), no external-register writes (no action touches TPM/VRO/AI Reporting Tool).
