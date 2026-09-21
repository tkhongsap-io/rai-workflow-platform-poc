# Review: W0-05 — authorization policy matrix

2026-09-21. Ticket W0-05 (issue #10), branch `codex/w0-05-authorization-matrix`, worktree `/Users/tkhongsap/github/rai-wt/W0-05`. Implementer self-review; human review required (tech lead) and independent reviewer agents before merge per the D03 amendment.

## What landed

- `docs/engineering/authorization-policy-matrix.md`: the role × action × scope matrix for the stack recorded in ADR-0003. Carries the six W0-contract rows unchanged, then adds the rows the contract asks for: search results, counts/pagination/filter options, deep links, file download (all following case-view scope), plus old versions, QC evidence, upload, resubmit, propose-fixed, confirm/waive/N/A by the owning lane (D05), configuration read/revisions/publish, audit read, operator view, Ready (no actor), and the W0-04-fields projection rule (the four status fields are written only by the workflow in the decision/Ready transaction; no role has a write row; a body carrying one is 422 `invalid_input`). Notification recipients: lane-open, send-back and Ready follow case-view scope; SLA-breach digest recipients come from the D06 `operator_recipients` configuration and are not a role. Defines role, lane, scope, actor and action identifiers and the `authorize(actor, action, target)` shape in TypeScript notation for the W1-00 policy module (matrix as data, deny by default, unknown role/action throws), the Fastify `preHandler` placement (W1-01), the single Drizzle scope predicate for list/search/count (W1-02, W3-01), download and deep-link handling (W1-03, W3-03), the `allowedActions` UI convenience and the W1-13 substitute rule. Resolves the ADR-0003 open item on out-of-scope references: 403 `forbidden`, conditioned on non-guessable route identifiers, with the reasoning against the threat model and a flip condition. Lists 27 negative/positive test obligations mapped to tickets and A-IDs, including the D05 dual-role self-approval case.
- Engineering defaults set inside the recorded rules and listed visibly for the named reviewers (section 8): 403 vs 404; self-exclusion applied to send-back (as the W2-02 Done-when already states); dispositions by a self-excluded reviewer denied provisionally; lane-open mail still sent to a self-excluded reviewer; in-app operator audience = Admin in slice 1 (operator is not a role, D06; D10/W6 decide the mapping).
- `changes/2026-09-21-w0-05/review.md`: this record.

Not edited, on purpose: `docs/product/decisions.md` (no decision recorded; D05, D06, W0-04 fields carried as written; D07-D10 untouched), `docs/product/source-spec.md` (frozen; hash unchanged), `adr/0003-stack-and-deployment-boundary.md` (its W0-05 open-item checkbox is outside this ticket's files; W0-09 ticks it at the exit review), `adr/README.md` (nothing to change: W0-05 produces an interface spec, not an ADR), `docs/architecture/README.md` and `TESTING.md` (W0-02 only), the ticket row status (issue #10 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step). Sibling W0 specs are linked through their W0-contract section anchors because their `docs/engineering/` files are on parallel branches.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` (after `git add -N` of the new files) | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the new document (script in the PR description) | 30 links, 0 broken |

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
