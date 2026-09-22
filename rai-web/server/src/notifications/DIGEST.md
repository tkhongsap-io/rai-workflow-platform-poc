# Daily digest integration handoff

`createDigestProducer({ db, publicBaseUrl, emitter, now?, locale? })` returns `run(signal?)`, which persists an operator job and committed digest outbox rows. It never invokes a sink. The default query is W3-05; recipients come from the effective configuration, not identity roles. `beforeStage` is a synthetic failure-injection seam. No raw error text is persisted or logged.

`loadCommittedDigestRequest(tx, row, { publicBaseUrl })` returns the existing DeliveryRequest, initially attempt 1. Call from the single dispatcher's own transaction after obtaining a committed notification row. It re-reads persisted proof by ID, and the dispatcher sets the actual attempt. Do not route it through the business-audit case loader or fabricate auditEventId. Old rows missing a valid job/link fail closed.

`createDailyDigestSchedule({ run, signal, track, onError, clock? }).start()` is a startup/local-midnight producer only. Supply the shared drain's signal and task tracker. Stop scheduling through that signal; let active DB work settle before closing the pool, with the existing hard process-exit bound for a stall. onError handles infrastructure refusal before a job can be recorded; it must emit safe fixed fields, not raw exceptions. One scheduler instance per app; calling start twice is idempotent. Restarts are safe through persisted day/recipient uniqueness.

Parent-confirmed composition-root and W3-04 dispatcher wiring remains a separate integration step. No app/start/service/runtime dispatcher file is changed in this consumer commit. The parent owns prerequisite ordering and combined full-suite/browser acceptance. Shared locale additions are mail.sla_breach_digest and mail.sla_breach_digest.body in both languages.
