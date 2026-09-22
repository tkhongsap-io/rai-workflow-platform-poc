# Server acceptance

Follow the shared QueueQuerySchema/QueueResponse unchanged. Reuse case.list authorization and caseScopeWhere. SQL applies scope before counts, distinct options, filters and pagination. Facets describe the unfiltered visible population; totals describe filtered matches. Search trims and NFC-normalizes, escapes literal %, _ and backslash, and uses case-insensitive substring matching including Thai business_owner separately from owner_subject_id.

Derive all five statuses using W0-06 precedence and latest disposition events (fixed_proposed remains unresolved). Stable updatedAt/caseId descending order. Return current submitted lanes and W3-05 frozen dates even with a successor draft; latestVersionNumber prefers the draft. nextAction is descriptive, never permission. All component reads share one repeatable-read, read-only transaction.

Authority: W0-05 authorization-policy-matrix, W0-06 workflow-transition-and-error-contract, ADR-0003, delivery W3-01 / issue #42 and the shared contract. Raise any contract problem to parent; do not change it.
