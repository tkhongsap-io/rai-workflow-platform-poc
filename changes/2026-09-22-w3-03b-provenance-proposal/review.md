# W3-03b shared provenance prerequisite review

Implemented only the accepted shared contract on `d931cea` in `/tmp/rai-w3-digest-provenance`, branch `codex/w3-03b-provenance-plan`. Plan was preserved through rebase. No migration, schema, consumer, dispatcher, root logs, external transport or dependency changes. Parent owns independent review, PR and merge; consumer remains gated.

## Change and proof boundary

Ordinary CommittedEvent remains byte-unchanged and requires auditEventId. DeliveryRequest.event narrows ordinary kinds through CaseMailEvent, or accepts CommittedDigestEvent with required W3-07a job provenance and no business audit. buildDedupKey takes the same union. Existing shared schema is consumed via a shared mail adapter; fixture sink dependency allow-list is unchanged. Both sinks validate event/provenance consistency, real Gregorian day (including leap years), configured-operator recipient basis and absence of cross-variant audit/job fields before accepting a key. File text records digest job/day rather than an undefined/fabricated audit header. Existing file JSON already carries the typed event.

Sinks cannot prove SQL existence or ownership. Valid-shaped fabricated IDs can only be refused by the future DB loader; this prerequisite neither implements nor claims that proof. Its tests deliberately use synthetic IDs. The later consumer must join notification/link/run, preserve retry provenance, follow 07a deferred constraints, and use the single W3-04 dispatcher. A broad CommittedEvent-typed case composer may need to copy/narrow its kind after excluding digest when integrating this union; 03a is not present on this assigned base and is not edited here. The known 03a digest-exclusion fixture also needs a valid job/link transaction when 07a is combined.

## Validation

Node 24.21.0; npm ci, no lockfile changes.

- Typecheck passed.
- Full unit suite: 469 passed, 0 failed (base 465 plus four both-sink provenance regressions).
- Focused shared mail and all sink tests: 58 passed, 0 failed, including concurrent dedup, file restart, no-external-mail checks, ordinary audit rejection and three valid ordinary event kinds.
- New tests cover valid 2024/2000 leap days, invalid 2026/1900 leap days, impossible month/day, malformed dates, absent/null/wrong/extra provenance, invalid and mismatched identifiers/day/correlation, forbidden digest audit fields, same-day new-job duplicate and next-day acceptance, and file text provenance.
- Full ESLint, Prettier and CSS checks passed.
- Build passed; substitute scan: 487 server output files, zero markers.
- Repository tests: 40 passed. Relative links: 165 Markdown files, 705 checked, zero broken; frozen source hash matched. git diff --check passed.

Logs: `/tmp/rai-w3-digest-contract-{install,focused,unit,lint,build}.log`. Early focused checks caught legacy error-field wording and a direct TypeBox import in the sink. Fixed the wording and moved the schema call behind shared mail; the final focused/full-unit/lint results above supersede those failures. No weakening of the import guard.

No DB or browser tests run: no persistence/runtime consumer changes. 54363 and 54366 remain untouched; 54367 is reserved for the future consumer. Broader combined acceptance and independent contract review remain with the parent. No push or PR.

## Actual consumer compatibility check

Parent requested verification beyond the bare d931cea base. Created disposable detached `/tmp/rai-w3-mail-compat` at published 03a `555ff90`; overlaid fadc39e shared mail/sink paths and the exact d931cea provenance schema prerequisite (no schema edits). Initial typecheck reproduced TS2345/TS2322 at compose.ts's buildDedupKey and returned event: the broad CommittedEvent object does not inherit its property's kind narrowing.

`03a-compat.patch` is the required minimal compatibility diff, tested only in that detached checkout. After the existing digest rejection guard, copy `{ ...event, kind: event.kind }` into caseEvent and use it for key construction and request.event. No assertion/cast, audit relaxation, runtime guard change or loader signature change. Apply this patch when the parent combines the consumer and contract after prerequisite merges; it is not a standalone new composer file on the contract's base.

With the patch, 03a typecheck and all 16 composer/runtime/shutdown tests passed. Then overlaid Parfit's read-only W3-04 notification snapshot (HEAD 84d3db6 plus current runtime/runtime-test edits) in the same detached checkout. W3-04 typecheck and all 24 composer/retry/runtime/shutdown tests passed with the same patch; no additional consumer type diff needed. Its integration test source was also included for typechecking, not DB execution. Runtime snapshot hashes: runtime.ts 740b64210c8c743bdb92cc26c742e062f5cb6a6caf5246b9bae12559932c2450; runtime.test.ts 00d28460fc20143f07a5156217336ae2d0929a3997613e72ebb5b948c73e8160; service.ts 456c9859ef113ddb24dd3c01ef394e8be630fcc5b4bcc9f7ebaedeacb74c6e8c. This is snapshot compatibility evidence, not validation of later Parfit edits or full combined acceptance.

Logs: `/tmp/rai-w3-mail-compat-03a-{before,after,tests}.log`, `/tmp/rai-w3-mail-compat-04{,-tests}.log`. No parent/03a/04 worktree modifications, DB access, push or PR. Original fadc39e typecheck was only for callers present on d931cea; these added checks establish the actual case composer/loader/dispatcher compatibility with the attached refinement.

## Parent delivery and independent review

Heisenberg independently reviewed the original contract diff and reported no findings; 58 focused tests plus invalid-provenance/configuration-basis probes passed. The contract has been rebased onto merged prerequisite PR #112 (`fe65fc1`). The tested ordinary-case narrowing is now implemented in PR #113 at `d349039`; the attached patch is historical compatibility evidence, not an additional change to apply after that PR merges. Final contract CI remains required before merge. Digest production, database authority checks and M3 acceptance remain separate.
