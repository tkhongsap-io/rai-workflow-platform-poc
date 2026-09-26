# Intent: case-query scope guard test (W3-F8, #180)

Case owners may see only their own cases and BU-SPOCs only their business unit's cases (A06). The server enforces this in one place: every list, search or count query builds its `WHERE` from `caseScopeWhere(actor)` (`rai-web/server/src/cases/scope.ts`). W0-05 "Query scope" says a test catches a query that touches the cases table without it. That test was never built; the contract reviewer on #175 (W3-F6) found the gap.

Ta's ruling of 2026-09-26 (register row "W3 deferred rulings", item 13): build the guard rather than record it as never built. The goal is that a forgotten scope filter on a new case query fails CI instead of relying on code review. No behaviour changes.
