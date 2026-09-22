# Plan and workstream gates

User authorization: 2026-09-22, continue W3, one issue per PR, independently review each PR, fix findings and repeat until clean, then merge.

Order: W3-01 contract and server; W3-08 substitute; W3-02 UI. In parallel prepare W1-11 mail-sink promotion to main, then W3-03a notification composition, W3-03b daily digest, W3-04 retry/dedup; W3-07a operator API and W3-07b UI; W3-INT integration; W3-06 recorded M3 exit. Shared interface changes merge before consumers. Preserve the approved sub-ticket splits and reference their parent issues.

Each implementation PR requires relevant acceptance tests, full prescribed suite and independent reviewer findings resolved. Review the final PR diff once more before merge; check CI, merge, rerun the full prescribed suite on main. Record exact output and remaining limits. Browser substitutes are development aids, never exit evidence. No live recipients, real data, W4-W8 or new product decisions.

This first PR defines query and response shapes, authorization semantics, pagination, derived status, due dates and filter behavior. Add schema validation tests, run repository checks, typecheck and unit tests, obtain independent review, open PR and merge only after gates pass. It intentionally adds no route. The implementation PR must prove scoped counts/options and Thai search with Postgres integration tests.
