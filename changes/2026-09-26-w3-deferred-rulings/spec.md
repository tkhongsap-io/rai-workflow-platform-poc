# Specification

Done when:

1. `docs/product/decisions.md` carries the row "W3 deferred rulings" with each ruling, approver Ta, date 2026-09-26, channel and affected documents.
2. W0-07 3.4 step 6 and the 3.9 test obligation say a closed-by-send-back version is refused, matching `loadOpenSubmittedTarget` in `rai-web/server/src/qc/orchestrator.ts` (item 2). No other contract text changes here; items 8 and 10-12 change W0-02 and W3-03 in their own ticket PRs.
3. GitHub issues exist, labelled `package:W3` and `status:ready`, for: 5 (`scopedCases`), 7 (`BLOB_TMP_MAX_AGE_HOURS` minimum), 8 (display names: contract PR then UI), 10 (conflicted reviewer mail and page note), 11 (per-lane defect count), 12 (send-back link), and the status name. Items 3, 6 and 9 need no ticket.
4. The hardening review's section 5 is not rewritten (it is a dated record); DEVLOG, CHANGELOG and the lead board point here.
