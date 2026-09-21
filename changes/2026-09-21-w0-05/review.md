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

Not edited, on purpose: `docs/product/decisions.md` (no decision recorded; D05, D06, W0-04 fields carried as written; D07-D10 untouched), `docs/product/source-spec.md` (frozen; hash unchanged), `adr/0003-stack-and-deployment-boundary.md` (its W0-05 open-item checkbox is outside this ticket's files; W0-09 ticks it at the exit review), `adr/README.md` (nothing to change: W0-05 produces an interface spec, not an ADR), `docs/architecture/README.md` and `TESTING.md` (W0-02 only), the ticket row status (issue #10 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step). Sibling W0 specs are linked through their W0-contract section anchors because their `docs/engineering/` files are on parallel branches.

## Fix round 2 (review findings on PR #58)

One blocking finding: three matrix rows with a stated scope had no obligation in section 7, so the behaviour could break without a failing test. Lane-open recipients (3.3, and the Done-when clause "lane-open, send-back and Ready recipients follow case-view scope") were missing from T28, which named send-back and Ready only; `operator.view` (3.2, Admin only) and `config.publish` (3.2, whose Rule cell says the row exists so W1-00 can test that nobody else has it) were missing from T14. Changes, both in the section 7 table and nothing else:

- T28 now covers lane-open, send-back and Ready recipients: lane-open expects every holder of that lane's reviewer role and no other subject; send-back and Ready expect owner-a only; links carry no token (W3-03, A05).
- T14 now covers `config.read_revisions`, `config.publish`, `audit.read` and `operator.view`: admin 200, every other role 403 `role` (W1-00 for the config and audit rows, W3-07 for the operator view; A01, A11).

No obligation was removed or weakened; numbering is unchanged.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped (rerun after fix round 2: 22 pass, 0 fail) |
| `git diff --check` (after `git add -N` of the new files) | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the new document (script in the PR description) | 36 links, 0 broken (fix round 1; 30 before). Rerun after fix round 2 with a fresh script: 35 relative links, 0 broken; no link was changed |

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
