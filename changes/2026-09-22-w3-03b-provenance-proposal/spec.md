# W3-03b shared mail provenance specification

`CommittedEvent` remains unchanged. `CaseMailEvent` narrows it to lane_opened/sent_back/ready_for_launch and forbids job provenance. `CommittedDigestEvent` instead requires the W3-07a DigestJobProvenance, a Bangkok digest day, correlation and persisted enqueue timestamp; case/version/versionNumber/lane are null and auditEventId is forbidden. DeliveryRequest.event and buildDedupKey accept the discriminated union.

Both sinks reject missing/malformed/cross-variant provenance before dedup or recording. Digest provenance is checked with the existing W3-07a schema through a shared mail helper, preserving the sink import allow-list. Event/provenance day and correlation match; day is a real Gregorian calendar date, not just a regex match. The recipient basis is operator_recipients. Existing synthetic-domain, link, size and dedup behavior remains. File text uses job-run/day headers for digest and audit-ID headers for ordinary mail.

The sink validates shape, not database authority. A well-shaped UUID is not evidence that its row exists. The future DB loader must join persisted notification/link/run, verify event/day/recipient/correlation, then compose. It must not accept caller-provided provenance or fabricate business audit IDs. No DB loader is implemented or certified here.

Daily identity remains event/day/lane/recipient, never jobRunId; retries retain the original row/job correlation. Producer policy for the later consumer: Bangkok day frozen from run start, configured recipients only, empty breaches complete count 0 with no email, duplicate-only runs own no new notification IDs, atomic outbox/link creation under 07a's deferred constraint. W3-04 remains the single delivery dispatcher.
