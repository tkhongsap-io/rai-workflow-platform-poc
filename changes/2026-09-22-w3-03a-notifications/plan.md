# W3-03a plan

Recorded before code.

1. Read contracts and existing outbox writers; claim only W3-03a on Lane B.
2. Commit the additive shared locale-key contract and documented boundary separately, before consumer implementation.
3. Implement notifications-only composition, database loading, recipient checks, safe links and single initial sink attempt; minimal app/start wiring invokes after committed successful responses and startup, with bounded shutdown. Do not edit workflow modules or add retries/digest.
4. Unit-test contents, locales, unsafe input and recipient rules. Integration-test real transactional outbox visibility/rollback, three events, failure isolation, replay/concurrency and auth for followed links. Use a dedicated Compose project and unused loopback port, never busy 54351/54362.
5. Run applicable repository/product checks, record exact evidence and limitations, inspect scope and commit locally. Parent handles independent review, full validation, prerequisite merges and PR.

## Bounded PR size exception

Parent requested this exception before PR creation. Consumer commit `36dcee9` adds approximately 1,147 lines (about 464 implementation lines, with the remainder principally tests and documentation). Keep this as one cohesive committed-event composition and initial-dispatch flow: recipient authorization, provenance loading, safe rendering, local delivery and documented wiring are verified together. Retain the integration and browser tests with the implementation so rollback, authorization, concurrency and post-commit delivery evidence stays reviewable in the same change. The shared locale contract remains a separate prerequisite. This exception does not expand scope to digest, retries, migrations or observability schema. Independent review will assess the size and cohesion; it is not an acceptance waiver.
