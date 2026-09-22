# Intent — W3-07a API consumer, issue 48

Implement the existing W0-10 observability API against prerequisite commit d931cea. Owner explicitly authorized this successor on 2026-09-22, including independent implementation while notification dependencies are pending. Worktree: /tmp/rai-w3-observability-api; branch: codex/w3-07a-observability-api. No push or PR before the prerequisite merges and actual notification integration is verified; parent owns review/publication.

Authority: observability-contract.md and the prerequisite successor reconciliation, existing authorization policy, workflow/QC contracts and W0-02 plan. No product scope changes, real QC, new owning-lane rule, production setting or notification implementation. Synthetic-only verification uses reserved DB 54368, HTTP 18788, substitute API 18789 and web 15175.

Done when the runtime implements health/readiness, Admin operator reads, typed safe error capture and correlated QC diagnostics; applicable OBS-01–16 have actual runtime proof, dependency-bound acceptance is explicitly recorded, and focused plus full verification passes on the integrated head. Green module tests alone do not complete OBS acceptance.
