# W3-03a review

## Independent contract review and parent verification

PR #111: independent reviewer Carver reported no high-confidence findings on `50a319c`, rendered all six body templates through `t()`, verified bilingual parameter parity and source-table content, and checked whitespace. Parent verification passed `npm run lint`, `npm run typecheck` and all 457 unit tests. Contract PR #111 passed final CI and merged as `e5bee77`. Composer behavior, digest and retries are separate consumer work.

## Result and prerequisites

Implemented the approved composer/templates split of issue #44 on `codex/w3-03a-notifications` in `/tmp/rai-w3-notifications`. Started at `44c5517`, then rebased onto the parent-requested mail promotion merge `5fe59ad`. The rebase preserved main's queue contract documentation; no queue implementation is copied or changed. Mail promotion history is not duplicated.

Shared locale contract is separate commit `ec25131` (previously `c577b86` before rebase): three additive body keys, existing subject/persisted template keys retained. This prerequisite merged in PR #111 (`e5bee77`); the consumer branch was subsequently rebased onto main `a2392c9`. no further shared mail, HTTP, authorization or persistence contract changes are needed. No migration, dependency or external delivery added. The parent records the consumer outcome in root CHANGELOG and DEVLOG.

## Implemented scope

- `server/src/notifications/compose.ts`: event-specific recipient selection with existing case.view authorization, reserved synthetic domains only; Thai default and bilingual shared t() templates; canonical sign-in-required version links; lane label, case name, recorded defect count, frozen Bangkok SLA date; send-back feedback capped at 500 code units; Ready copy describes desk completion, not production permission.
- `service.ts`: independent committed-outbox read, real audit event match, submitted version/decision validation, latest stored session locale. Initial attempt under a notification row lock; only the four permitted delivery columns change. Attempts already recorded and digest rows are excluded. Missing audit, unsafe link or unauthorized recipient cannot reach the sink. No case/workflow lock, timer, retry loop, lease or backoff sleep.
- `runtime.ts`, minimal `app.ts` / `start.ts` wiring: dynamic W1-11 sink binding in fixture mode, first attempt after successful POST response, initial committed backlog at startup, active-hook drain before database close. Memory/file only. Non-fixture identity receives no synthetic mail recipient directory. Local sink failure cannot alter the committed workflow or returned success.
- W0-10 existing events: mail.enqueued after committed-row validation, then mail.sent or mail.attempt_failed with the original correlation ID and safe fields; no address, dedup key, body or URL. Initial infrastructure failure uses error.captured, with no raw error text. No observability schema change.
- Unit, real-Postgres and actual built-server browser tests; module README documents composition, wiring and the W3-04 replacement boundary.

## Validation

Node 24.21.0. Synthetic fixture set `slice1-synthetic@1 7c80ccd43663`. Database: dedicated Compose project `rai-w3-notifications`, volume `rai-w3-notifications_pgdata`, loopback port **54363**. Busy 54351/54362 and other checkouts untouched. Browser harness uses 8793 plus an OS-assigned loopback port for its own built file-sink server. Commands run from rai-web except repository checks. After verification, only the dedicated Compose project and its volume were removed; browser servers stopped.

| Check | Result |
|---|---|
| npm ci | Passed, existing lockfile, no dependency change |
| npm run typecheck | Passed including the exported loader and new tests |
| Focused locales + composer node:test | 13 passed (3 shared locale tests, 10 composer tests) |
| npm run test:unit | 467 passed, 0 failed |
| Focused W3-03a integration | 15 passed, 0 failed, including exported-loader read-only behavior |
| npm run test:integration | 212 passed, 0 failed, 106.4 seconds; before the final read-only loader export and its extra test. The subsequent focused 15-test run validates that additive change; no dispatcher behavior changed. |
| npm run lint | ESLint, Prettier and CSS checks passed; final browser assertion formatting checked afterward |
| npm run build + npm run check:substitute-absent | Passed, 487 output files scanned, zero substitute markers; browser harness rebuilds the final source |
| Built-server Playwright w3-03a-mail-links | 3 passed, 8.7 seconds; desktop 1440, tablet 834, phone 390 |
| Root node --test scripts/*.test.mjs tests/*.test.mjs | 40 passed |
| Root link / frozen-source checks | 158 Markdown files, 703 links, zero broken; frozen source hash matched |
| git diff --check | Passed |

Logs: `/tmp/rai-w3-notifications-{typecheck,unit-focused,unit,integration-focused,integration,lint,build,browser,repo}.log`. Initial integration test corrections matched existing 204 locale update and actual fixture ID; the first browser run proved sign-in/forbidden/authorized access but failed its final locator because it expected the draft heading on a frozen version. The corrected assertion checks the actual case heading. No product behavior was changed to satisfy these test corrections.

Integration evidence covers all three actual workflow events, one lane message per eligible recipient, owner-only send-back/Ready, Thai and English, safe logs with matching correlation ID, rollback after the first outbox insert, an uncommitted row on another connection, concurrent workers, startup recovery, automatic hook delivery, safe missing-audit/recipient/link rejection, unchanged Ready despite sink failure, no retry, and digest exclusion. Browser evidence follows the URL read from the file sink: no session reaches sign-in, wrong owner receives forbidden, authorized reviewer sees the frozen case; Thai subject persists in both JSON and text files. No browser substitute is used.

## W3-04 / W3-07 handoff

Exported `loadCommittedCaseRequest(tx, row, { identities, publicBaseUrl })` and `NotificationRow` are reusable by the single future dispatcher. The caller reads the committed row in its own transaction; never pass a workflow transaction. Loader has no status/delivery/log side effects. Returned request initially has attempt 1; W3-04 sets its actual attempt. W3-04 replaces the initial service/hooks rather than adding a parallel runner. Parent's SKIP LOCKED / four committed results / crash-accounting choice belongs there; this initial path uses a notification-row lock and sink dedup, without leases or migrations.

Failure stays queued with attempts=1, safe last_error_code and next_attempt_at=NULL. No historical failure timestamp exists: W3-04 schedules legacy initial failures conservatively from recovery time, not created_at. A sink invocation before database commit can replay after a crash; file sink dedup persists, memory sink does not survive process restart. No exactly-once claim.

Digest rows and typed operator-job provenance remain W3-03b/W3-07 work. The three case events always require their real business audit row. No fabricated audit ID, digest implementation, job-run migration or retry policy is introduced here. Operator delivery shapes remain W3-07's ownership.

Self-review only; parent owns independent review, prerequisite merge, consumer PR, final full-suite/CI and package acceptance. Local commit only; no push, PR creation or merge by this agent.

## Independent-review correction evidence

Parent baseline full suite on `36dcee9` completed exit 0 (`/tmp/rai-w3-notifications-final-full.log`); historical evidence only, not acceptance of these fixes. Review found onClose could wait forever after POST 200 and request count zero, plus Thai due dates used Buddhist years.

Fixed with tracked background tasks and cancellation in the existing drain. Shutdown rejects at its deadline if a sink is still active; main.ts already exits 1 on close rejection. The DB pool-close line is not reached on rejection. No transaction race releases the lock: cancellation waits for sink settlement, then rolls back; a sink acceptance before rollback may replay as already documented. New tasks and subsequent rows stop. Thai dates explicitly use Gregorian calendar, with Thai text/year 2026 asserted.

Focused composer/runtime/shutdown: 16 passed. Real Postgres notification suite: 16 passed, including SKIP LOCKED proof that an aborted but active sink retains its notification lock, rollback leaves attempts=0, and live-sink replay deduplicates. Full unit suite: 469 passed. Typecheck and full ESLint/Prettier/CSS checks passed; the final runtime-only rerun passed both tests. These runs used the parent-released 54363 database; no Compose lifecycle changes. Parent will rerun final full suite and independent review on the fix commit. W3-03b planning remains paused.

## Parent final verification and independent re-review

Confucius re-reviewed `4aa19a3` after both fixes, independently ran 16 composer/runtime/shutdown tests and reported no remaining actionable findings. Parent `npm run verify:full` on that implementation exited 0: lint, typecheck, 469 unit, 214 integration, 126 real-server browser and 90 substitute browser tests, build and production substitute-absence. Log: `/tmp/rai-w3-notifications-fixed-full.log`. Rebase onto current main retained the independent contract record and existing queue wiring. Final combined-head CI remains required before merge; this does not claim digest, retries or M3 acceptance.
