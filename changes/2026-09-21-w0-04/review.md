# Review: W0-04 — persistence and artifact-store spec

2026-09-21. Ticket W0-04 (issue #9), branch `codex/w0-04-persistence-spec`, worktree `/Users/tkhongsap/github/rai-wt/W0-04`. Implementer self-review; human review required (HRR) before W1-00 starts, per the W0 contract owner type.

## What landed

- `docs/engineering/persistence-and-artifact-store.md`: the W0-04 interface spec, concrete for ADR-0003 (Postgres 16, Drizzle, Fastify, node:test, Playwright) with the boundaries kept stack-neutral in intent. Covers every clause of the W0-04 section of the W0 technical contract: the nine entities plus `artifact` metadata and `idempotency_key` as column tables with constraints; the register row "W0-04 fields" implemented as written (desk-local `vendor_involved`/`model_type`; the four inherited status fields as workflow-written projections with a value table, the writing transaction for each, and three enforcement layers: request shape, repository, database trigger gated by `SET LOCAL rai.workflow_write`); immutability per table with triggers plus a three-role grant split (`rai_owner`, `rai_app`, `rai_operator`); the blob store interface, content-hash key layout, atomic write path, upload and download flow with RFC 5987 filenames for Thai; one transaction per business action with a per-case row lock, the recipe for create, edit, upload, submit, decide, concurrent send-back, resubmit, disposition, Ready and configuration publish, and idempotency-key storage and replay rules; the restart-proof recipe; the six audit-log rules each with mechanism and test; forward-only migrations as an explicit operator step with a per-file rollback-expectation header, the no-rewrite rule enforced by the same triggers, and the two migration tests (fixture store, restored backup); retention and deletion as three options for D08 (redaction event, blob key destruction, case-field tombstone), audit versus business retention, draft and failed-upload cleanup, key custody left open; TypeScript interfaces including the shared Ready-predicate SQL; the persistence error classes mapped to the ADR-0003 codes; unit/integration/browser substitutes and a clause-to-ticket test map; the environment variables and commands handed to W0-02; open items routed to W0-02, W0-05, W0-06, W0-08, D08, D10 and W5.
- `adr/README.md`: the reserved ADR-0005 row now links the spec's "Retention and deletion" section as its input at the D08 gate.

Not edited, on purpose: `docs/product/decisions.md` (agents never record decisions; D07-D10 stay open), `docs/product/source-spec.md` (frozen), `docs/architecture/README.md` and `TESTING.md` (W0-02 only), other W0 specs being written in parallel, the ticket row status (issue #9 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step). Where this spec needs a name W0-02 owns (variables, commands, migrations path, `Idempotency-Key` header) it says so and yields to W0-02 if W0-02 merges first.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --cached --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the two touched files | 50 links, 0 broken |

No product suite exists yet (the skeleton arrives with W1-00), so `npm test`, lint, typecheck, Playwright and Postgres do not apply to this ticket; no container was started.

## Done-when check (W0-04 section and W0 exit checklist)

- [x] Entities: Case, pack version, artifact slot, lane decision, QC run/finding, disposition event, notification, configuration revision, audit event (plus artifact metadata and idempotency key).
- [x] Desk-local Case fields and the four status projections recorded exactly as the register row states; enforcement and the W1-02 rejection test named.
- [x] Immutability: submitted versions and artifact references never updated; corrections create a new version; findings never overwritten; dispositions append; mechanism per table.
- [x] Artifacts: private, content-hash keyed; filename, media type, size, uploader, time recorded; downloads through authorization only.
- [x] Transactions: atomic operations (submit, decide, send back, resubmit, Ready, and the rest) and idempotency-key storage.
- [x] Restart proof recipe for the W1 exit evidence.
- [x] Audit log: append-only with no DAL update/delete path, same transaction, correlation ID, references only, read scope via the W0-05 check.
- [x] Schema evolution: versioned, forward-only, explicit step, tested against fixture store and restored backup, no rewrite of frozen rows (copy forward), rollback expectation per migration.
- [x] Retention and deletion as options for D08, not a choice; audit vs business retention; drafts and failed uploads; key custody open.
- [x] Interface, error contract and test substitute (W0 contract rule for W0-03/04/07/10).
- [x] Cross-linked to the consuming ticket IDs and the sibling W0 specs by ticket and contract anchor.
- [x] D07-D10 untouched; frozen source spec unchanged; no real data, credentials or endpoints.

## Fix round 1 (PR #61 review)

Two blocking findings, both in `docs/engineering/persistence-and-artifact-store.md`:

1. **Notification dedup collapsed two lanes' send-backs.** `notification.lane` was stored as `'-'` for `send_back`, so `UNIQUE (event, version_id, lane, recipient)` made the second concurrent send-back (W2-03) a `UniqueViolation` → 409, contradicting D05, A07 and the no-duplicate-on-retry rule. Fix: `lane` now carries the deciding lane for `send_back` (and the opened lane for `lane_open`), matching the D06 identity (event, version, lane, recipient); `'-'` is reserved for `ready` and `sla_breach_digest`. The W2-02 and W2-03 recipes and the W2-03 test-map row (two `send_back` rows, one per lane, no `UniqueViolation`) were updated.
2. **Cross-case artifact reference.** The `artifact` table allowed slot rows "across versions or cases" to reference one artifact row while `artifact.case_id` binds download authorization to the uploading case, so an attached cross-case slot would be un-downloadable and would leak the other case's filename and size through the slot listing. Fix: sharing is now "across versions of the same case"; `VersionWriteRepository.updateDraftSlot` must load the artifact row and reject an `artifact_id` whose `case_id` differs from the version's case with the new `ArtifactCaseMismatch` error (422 `invalid_input`, field `artifactId`, key `error.artifact_case_mismatch`), tested in W1-04 (new test-map row); an optional database backing (`UNIQUE (artifact.id, case_id)` plus a composite FK from a denormalised `artifact_slot.case_id`) is named for W1-04.

Checks after the fix (same shell): `node --test tests/*.test.mjs` → 22 pass, 0 fail; `git diff --check` clean; relative-link and anchor audit over the spec → 46 links, 0 broken; `docs/product/source-spec.md` untouched.
