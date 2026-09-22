# Plan

Add a scoped GET /api/queue route to the existing in-memory substitute. Reuse authorization, synthetic cases, status and lane decisions. Return contract filters/counts/options/version and due-date shapes. Test scope-negative cases, search, validation, pagination and submitted lane due dates. No application configuration or production code changes. Parent contract PR #106 must merge before this consumer PR opens. Independent reviewer and required verification must pass before merge.
