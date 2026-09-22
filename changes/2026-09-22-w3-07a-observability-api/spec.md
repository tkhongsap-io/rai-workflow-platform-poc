# Runtime contract

Consume the shared readiness, operator and safe-error schemas from d931cea without widening them. Existing W0-10 and the prerequisite reconciliation govern behavior. Readiness must reflect actual dependency probes; liveness remains independent of them. Operator data requires operator.view and contains bounded projections, never provider errors or document contents. Correlation is minted server-side and retained through persisted work; replay does not create duplicate diagnostic events.

Ordinary notification provenance remains mandatory audit provenance. Digest provenance belongs to the coordinated W3-03b contract and persisted linkage. W3-07a observes those implementations without replacing them. No real QC, new finding authority, external mail or production configuration is introduced.

## Runtime safety reconciliation

HTTP capture classifies the six reachable synchronous contract failures (401/403/404/409/422), plus the internal 500 fallback; no synchronous QC endpoint is introduced. The typed job helper records `qc_unavailable` with classification 503 or terminal `mail_delivery_failed` with classification 502, without sending an HTTP response and without emitting a second domain failure event. Missing or invalid safe job fields fall back to sanitized internal error, never guessed notification identity, attempts or provider cause. The notification-runtime unexpected catch must use internal-error capture; actual fourth-attempt delivery failure uses the typed job helper after persistence.

The shared schema's canonical input surfaces replace illustrative nested field paths; detailed request paths stay in HTTP validation responses. Internal errors retain only relative module coordinates present in the local source/build inventory. Neither error name/message nor function names, external frames, provider codes or absolute paths are retained. Stack hashes are over sanitized frames. The operator response exposes nine bounded category aggregates since process start, as specified by DeskHealthReport; per-stack correlation is available through stackHash on the log event, not a new API field.

Store probes compare ordered migration hashes, not just counts, and never apply migrations. A missing journal means pending; a changed or ahead journal means unknown. Read-only short-lived connections have bounded connection/query/statement lifetimes and are closed at the deadline; blob checks use stat/access without creating files. Readiness calls coalesce and cache for five seconds. Configured mail uses W3-04 ConfiguredMailSink.health(); configured QC uses probe(), because its health() method is a setter. Neither dependency is constructed by observability.

### Independent review corrections

Health routes bypass session resolution even when the caller supplies a cookie: liveness is independent of the session store and readiness reports probe failures as 503. Other public/session/action routes retain their existing identity behavior. Per W0-10 section 3.3, health.readiness emits the first observed status and subsequent status changes, not every poll; request.completed remains per readiness request.
