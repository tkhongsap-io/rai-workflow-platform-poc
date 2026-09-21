# Review: W0-06 — workflow transition and error contract

2026-09-21. Ticket W0-06 (issue #11), branch `codex/w0-06-workflow-error-contract`, worktree `/Users/tkhongsap/github/rai-wt/W0-06`. Owner type: Human review required (tech lead). Implementer self-review; independent reviewer agents run before merge per the D03 amendment.

## Intent and plan

Write the W0-06 interface spec that the W0 technical contract names: states and events with preconditions, postconditions and audit events; the D02 lane mapping as a versioned constant recorded on each submitted version; D05 transition rules (resubmission reopens all lanes, concurrent send-backs merge, disposition authority, no self-approval); the owning-lane assignment rule for single-lane slots with the shared/pack-level rule left as the review-leads refinement; expected-version checks with refresh guidance; the seven error types with the HTTP codes ADR-0003 chose, confirmed here with `not_found`. Make it concrete for the D04 stack. Touch only the new document and this record.

## What landed

- `docs/engineering/workflow-transition-and-error-contract.md` (new, ~9,200 words). Sections: scope and consumers (W0-02 to W0-10, W1-00 to W3-08); state model with entity fields the workflow needs from W0-04, version states, derived lane states and the derived case status vocabulary (`draft`, `in_review`, `sent_back`, `awaiting_disposition`, `ready_for_launch`); the `LANE_MAPPING_V1` constant (AI/COE 1+5, DPO 2-5, IT/Security 5-8, slot 9 no gate) with the rule that it is code, not Admin configuration, is recorded on every submitted version and is frozen by a unit test; the events create, save draft, submit, approve, send back, resubmit, disposition (five kinds; owner proposes `fixed`, owning lane confirms) and Ready (a system transition evaluated in the approving or dispositioning transaction), each with actor, checks in a fixed order, postconditions, audit event name and error cases; the W0-04 status projections and when they are written; notification outbox rows on committed events only; the after-Ready rule; `ExpectedVersion` and the stale reasons per action, with the one deliberate asymmetry that a send-back is not stale when a successor draft exists (D05 merge); idempotency-key rules; the Ready predicate with four conditions rechecked under the Case row lock; the owning-lane rule for single-lane slots and for approve-attempt `unavailable` runs, and an explicitly open table for slot 5, slot 9, pack-level, upload/submit `unavailable` and disposition carry-forward with labelled options and no default; the error contract (eight codes with HTTP status, TypeScript envelope, stale-version details with `guidanceKey`, `current` reference and `refreshPath`, behavioural guarantees per type, the 403/404 open item for W0-05, initial Thai/English locale strings); Postgres and Drizzle transaction, lock, immutability trigger and constraint mechanics; the audit event list; a test map by consumer ticket and layer; open items; references.
- `changes/2026-09-21-w0-06/review.md`: this record.

Not edited, on purpose: `docs/product/source-spec.md` (frozen; hash verified below), `docs/product/decisions.md` (agents never record decisions; the section 7.3 refinement is recorded by the review leads and Ta), `adr/README.md` (no ADR written or changed), `docs/architecture/README.md` and `TESTING.md` (W0-02 only), the ticket row status (issue #11 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step, as for W0-01). Sibling W0 specs written in parallel are named by path, not hyperlinked, so the link audit stays clean until they merge; W0-09 can add the links at exit.

## Decisions carried as written, none made

- D02 (lane mapping, constant not configuration), D05 (full re-review, merge of concurrent send-backs, disposition authority, no self-approval), D06 (retry/dedup policy referenced, no seventh role), D11 (`stage_context` frozen on the version), D12 (every message and status is a locale key, Thai default), D04 (stack), W0-04 fields (projection timing only; vocabulary left to W0-04).
- D07-D10 untouched. Two places where the source is silent are recorded as open items with options, not defaults: the owning lane for shared/pack-level/unavailable findings (review leads, before W2-05) and reopening after Ready (Ta, not before W4). Slice-1 behaviour for disposition carry-forward is stated as provisional and listed in the same open table.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped (demo suite; the frozen-source test is among them) |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link audit over the new document | 15 links, 0 broken |

No product suite exists yet (the application skeleton arrives with W1-00 under the W0-02 layout), so `npm test`, lint, typecheck, Playwright and Postgres do not apply to this ticket; no container was started.

## Done-when check (W0-06 section of the W0 contract and the exit checklist)

- [x] States and events: create, save draft, submit, approve, send back, resubmit, disposition, Ready, each with preconditions, postconditions and audit event (sections 4, 9.4).
- [x] Lane mapping as a versioned constant in code, recorded on each submitted version, AI/COE 1 and 5 (D02), DPO 2-5, IT/Security 5-8, not an Admin configuration revision (section 3).
- [x] D05 transition rules: resubmission reopens all lanes (4.6), concurrent send-backs merge into one successor draft (4.5, 5.2, 9.3), disposition authority and no self-approval as in W0-05 (4.4, 4.7, 6).
- [x] Owning-lane rule for single-lane slots recorded (7.1); slot 5, slot 9, pack-level and QC-unavailable rules marked as the review-leads refinement with options and no silent default (7.3); Admin never dispositions, no seventh role (7).
- [x] Expected-version checks: stale action returns `stale_version` with refresh guidance and changes nothing (5, 8.2, 8.3).
- [x] Seven error types with a user message (locale key) and an HTTP code each; `not_found` confirmed as the eighth code from ADR-0003 (8.1, 8.5).
- [x] Stack-concrete (Fastify, Drizzle, Postgres, node:test, Playwright) with stack-neutral rules (4, 9, 10).
- [x] Cross-linked to W0 siblings by ticket ID and to the W1-W3 tickets that consume each section (1, 10).
- [x] Frozen source spec unchanged; D07-D10 untouched.

## Limitations

- W2-05 stays blocked for its slot-5 and pack-level test cases until the section 7.3 refinement is recorded; the document says so and lists what W1-10 and W2-05 may do meanwhile.
- The lock-wait/request-timeout budget (5 s) and the idempotency-record expiry (24 h) are stated as proposals for W0-09 and W0-04 to confirm.
