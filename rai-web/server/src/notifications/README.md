# Notifications

Mail leaves the desk only after the business event has committed, and only to the local synthetic sink.

## Outbox

The business transaction writes one `notification` row per recipient. Lane open (on submit), send-back and Ready rows go through `enqueueCaseNotifications` in `outbox.ts`; digest rows come from the digest producer. If the transaction rolls back, no row exists and no mail can follow. Rows start `queued` with `attempts = 0`.

## Dispatcher

`registerNotifications` (`runtime.ts`) runs one single-flight dispatcher over `createNotifications` (`service.ts`). It wakes for a startup pass, on a 250 ms poll, and after each successful POST response. Each wakeup takes at most 25 due rows.

Each attempt runs in the dispatcher's own transaction, never in a workflow transaction:

1. Lock one queued row with `FOR UPDATE SKIP LOCKED`, so concurrent workers never share a row.
2. Compose the mail from committed data with `loadCommittedCaseRequest` or `loadCommittedDigestRequest`. Recipients are checked again against `case.view` plus the event's rule (lane holders, the owner, or the configured operator addresses). A composition failure counts as a failed attempt.
3. Call the sink once.
4. Commit one delivery update. Only `status`, `attempts`, `next_attempt_at` and `last_error_code` change.

Log lines are written only after the commit. A crash before the commit can replay the attempt; the file sink keeps its dedup keys (`buildDedupKey`) across restarts and answers the replay as a duplicate.

## Retries

A row gets at most 4 attempts. After a failure the next attempt waits 1 s, then 5 s, then 25 s, measured from when the failure completed (`retry.ts`). The fourth failure marks the row `failed` and emits one `mail.failed` log line and one `mail_delivery_failed` capture. A delivery failure never changes the committed decision.

## Daily digest

`registerDailyDigest` (`digest-runtime.ts`) runs the producer at startup and at each Bangkok midnight. The producer only enqueues: it records an operator job, snapshots the SLA breaches and writes one outbox row per configured operator address. The `operator_digest_day_recipient_key` index allows one digest per recipient per Bangkok day. The dispatcher sends digest rows like any other row.

## Shutdown

Both runtimes register their tasks with `drain.track` and pass `drain.signal` down. After the abort no new attempt starts. An attempt already waiting on the sink keeps its row lock until the sink settles, then commits the settled result.

## Sink

`start.ts` binds the sink (`sink-memory` or `sink-file`) only in fixture identity mode, and `loadMailSink` returns nothing in production. There is no external mail transport.
