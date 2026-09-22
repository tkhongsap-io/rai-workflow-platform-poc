# W1-11 promotion specification

The authority is [W0-07 sections 4.2–4.8](../../docs/engineering/qc-boundary-and-mail-sink.md), [W0-02](../../docs/engineering/implementation-plan-w1-w3.md), and [W1-11](../../docs/delivery/slice-1-work-breakdown.md). ADR-0003 remains the stack boundary; D06 and D12 retain deduplication and Thai-safe subjects.

Memory and file sinks consume the current shared DeliveryRequest and MailSink interfaces, preserve committed-event identity, validate synthetic recipients and safe links, expose forced failure controls and delivery receipts, and preserve file deduplication after restart. No network transport. Existing shared dedup/types and fixture exports remain authoritative. Consumer wiring, outbox transactions, retry scheduling and notification templates belong to W3-03/W3-04, not this promotion.

Done when: scoped files are promoted, current interface checks and W1-11 unit obligations pass, repository checks and product validation are recorded with honest limitations, and a local commit is available for independent review. Synthetic unit success is not W3 acceptance.
