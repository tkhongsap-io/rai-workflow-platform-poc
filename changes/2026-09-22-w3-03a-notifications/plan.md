# W3-03a plan

Recorded before code.

1. Read contracts and existing outbox writers; claim only W3-03a on Lane B.
2. Commit the additive shared locale-key contract and documented boundary separately, before consumer implementation.
3. Implement notifications-only composition, database loading, recipient checks, safe links and single initial sink attempt; minimal app/start wiring invokes after committed successful responses and startup, with bounded shutdown. Do not edit workflow modules or add retries/digest.
4. Unit-test contents, locales, unsafe input and recipient rules. Integration-test real transactional outbox visibility/rollback, three events, failure isolation, replay/concurrency and auth for followed links. Use a dedicated Compose project and unused loopback port, never busy 54351/54362.
5. Run applicable repository/product checks, record exact evidence and limitations, inspect scope and commit locally. Parent handles independent review, full validation, prerequisite merges and PR.
