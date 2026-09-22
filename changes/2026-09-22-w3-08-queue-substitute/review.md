# Review and evidence

W3-08 (#47) implements the scoped queue substitute only. Parent contract PR106 must merge before this consumer PR opens; synthetic tests do not establish real-server A06 acceptance.

Independent reviewer Confucius found mutable-seed SLA dates, prototype-setter bypass of unknown-query validation, and missing state/scope coverage. Fixed by capturing due dates on submit, Object.fromEntries query parsing and tests for frozen-SLA changes, __proto__ rejection, send-back/resubmission, awaiting disposition with fixed_proposed, Ready, combined filters and BU/multi-role scopes.

Independent re-review reported no remaining high-confidence findings; reviewer executed 28 queue/workflow/production-absence tests, all passed. Parent's six focused queue tests and typecheck passed. Initial full run passed 410 unit, 198 integration, 123 real-server browser and 90 substitute browser tests, but final additions require refreshed evidence. Final verify:full runs at /tmp/rai-w3-sub-final-full.log; final acceptance remains pending until it completes and CI passes. Initial lint assertion error was fixed, not waived.

No new product decisions, external delivery, live data or production authorization. No PR or merge yet.
