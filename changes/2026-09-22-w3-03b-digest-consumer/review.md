# W3-03b independent consumer module review

Implemented on codex/w3-03b-digest-consumer from fadc39e, in /tmp/rai-w3-digest-consumer. Plan preceded code. Producer, committed-row loader and standalone schedule adapter are implemented; live app/start and W3-04 dispatcher wiring is deliberately pending parent interface confirmation. No claim of complete end-to-end W3 acceptance.

## Changed paths and behavior

- server/src/notifications/digest.ts: operational job lifecycle, real W3-05 query, effective configured recipients, immutable render snapshot, per-recipient atomic outbox/link insert, exact-constraint duplicate handling, safe failure logs, SQL-backed loader. No sink call or retry engine.
- digest-runtime.ts and its tests: tracked startup/local-midnight producer, cancellation, no overlap, immediate new-day catch-up after a run crossing midnight.
- DIGEST.md: concrete dispatcher/composition-root handoff.
- shared/src/locales/{th,en}.json: only the two additive digest subject/body keys. No reordering of unrelated keys.
- tests/integration/w3-03b-digest.test.ts: real DB proof and both local sinks; own change packet and scoped board claim.

Job breachCount counts overdue lane entries; mail count counts distinct cases. Each lane reference gets its own link index to comply with the existing sink's one-reference-per-link rule. Snapshots over 500 entries/64KiB fail at render rather than drop data. A failure after earlier recipient commits may leave valid linked notifications on a failed run; IDs/provenance are preserved and those rows remain dispatchable. Ordinary events and audit requirements are unchanged.

## Validation

Node24.21.0. Dedicated Compose project rai-w3-digest-consumer, loopback54367. No use of busy54363/54366. Synthetic fixtures only.

- npm ci passed without dependency/lockfile change.
- Typecheck passed.
- Full unit suite: 472 passed (including three new scheduler regressions).
- Focused real Postgres digest suite: 15 passed. Covers empty0/no email, Thai/English, real overdue selection, both sinks and retry identity, concurrent/restarted same-day dedup, next day, cross-midnight identity, query/render/enqueue failure logs/correlation, configured recipients, missing/forged caller proof, invalid persisted configuration/day/due/recipient proof, and SQL correlation/orphan rollback.
- Full integration: 221 total, 220 passed, 1 opt-in migration-upgrade test skipped, 0 failed (121.7s). No migration changed here; skip is not claimed as passing.
- Full ESLint/Prettier/CSS passed.
- Build passed; 499 server output files scanned, zero substitute markers.

Early regressions caught a renderer giving several lane entries the same link index (fixed to the existing sink contract) and tests reading log stage outside the existing fields envelope (fixed assertion). Final results above supersede those failures. Logs: /tmp/rai-w3-digest-consumer-{unit,integration,full-integration,lint,build}.log.

No browser run: no live app binding or UI change in this commit. Parent must approve the proposed loader dispatch seam, then coordinate binding to final W3-04 and bounded drain, rebase onto merged prerequisites and validate startup-to-outbox-to-dispatch/browser behavior. The independently reviewed provenance contract remains a prerequisite, including the parent's caseEvent refinement in 03a. No changes to dispatcher files or other worktrees, migrations, observability schemas, root logs, external transport, push or PR.

Repository checks: 40 tests passed; 170 Markdown files / 705 links / zero broken; frozen source hash matched; git diff --check passed. The dedicated 54367 DB is left running and idle for independent review. No running test process remains.
