# Review: W0-09 — verification commands, performance budgets and W0 exit review

2026-09-21. Ticket W0-09 (issue #14), branch `codex/w0-09-w0-exit-review`, worktree `/Users/tkhongsap/github/rai-wt/W0-09`. Lane Lead, owner type Human; written by the delegated ticket flow for Ta's review. Proves: W0 exit. The full record, including the cross-spec consistency read and every fix applied, is [changes/2026-09-21-w0-exit/review.md](../2026-09-21-w0-exit/review.md); this file lists what the ticket touched and the commands it ran.

## What landed

- `changes/2026-09-21-w0-exit/review.md` (new): the W0 exit record (documents and link audit, 67 consistency rows across the ten W0 documents, 62 fixes applied, the owning document named for each, TESTING check, performance targets, W0-08 policy presented for Ta's acceptance, exit checklist with evidence, recorded decisions carried, stop condition, commands, open items, tracker actions).
- `docs/engineering/performance-targets.md` (new): workload and latency targets and the time budgets the specs assigned to W0-09, marked targets, not measurements.
- `docs/delivery/w0-technical-contract.md`: status line, the W0-09 section's record path, and the exit checklist ticked with evidence.
- `BUILD_PLAN.md`: status table cells for W0 ("Exit recorded 2026-09-21") and M1 ("Ready (W1 issues status:ready)").
- `TESTING.md` "Product build (W0-W3)": confirmed present; updated only where the reconciled W0-02 section 3 changed (no session-secret step, `RAI_IDENTITY_*` names, the added commands, the fixture-set citation).
- `adr/0003-stack-and-deployment-boundary.md`: the three open items W0-02 and W0-05 resolved are ticked with pointers.
- The eight W0 engineering documents: reconciliation edits, each marked "W0-09:" in place (list in the exit review, section 2).

Not edited: `docs/product/source-spec.md` (frozen), `docs/product/decisions.md` (no decision recorded; D07-D10 open), `demo/`, `docs/board`, DEVLOG, CHANGELOG, `docs/delivery/README.md`.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0). No Postgres: document ticket.

| Command | Result |
|---|---|
| link and anchor audit script over the 16 W0 documents (text in the exit review, section 9) | `Documents checked: 16/16; relative links: 428; broken: 0; missing documents: 0`, exit 0 (426 before the review fix round 1 added two links) |
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches `docs/sources.md` |

No product suite exists yet (`rai-web/` arrives with W1-00), so `npm test`, lint, typecheck and Playwright do not apply, and no runtime success is claimed for the TESTING product-build commands.

## Done-when check (W0 contract, W0-09 section)

- [x] W0-02 commands present in TESTING.md "Product build (W0-W3)"; verified, not run.
- [x] Performance budgets recorded as targets, not measurements (`docs/engineering/performance-targets.md`); the workload numbers are a ticket-flow proposal pending Ta's and the operator's confirmation (exit review, section 10).
- [x] Exit review recorded (`changes/2026-09-21-w0-exit/review.md`), the W0 exit checklist ticked with evidence, BUILD_PLAN status cells updated, W1 issues relabelled and the epics updated (exit review, section 11).

## Limitations

See the exit review, section 10: the W0-08 upload policy and the workload numbers are pending Ta's (and, for the workload, the operator's) confirmation; Ta's confirmation of the UI quality bar and the lead's confirmation of the sub-ticket split remain due; the eighth fixture identity and the fifth fixture case were added to satisfy cross-spec references and are listed for Ta; the identity variables keep W0-03's `RAI_` prefix beside W0-02's unprefixed names.
