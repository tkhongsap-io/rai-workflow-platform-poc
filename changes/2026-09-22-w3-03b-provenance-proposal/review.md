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
