# Specification

Source: W5 plan section 9 (the W5-09 row), section 6 (the `QueueItem`/`CaseSummary` row), section 7 ("Queue and case list", placeholder banner, locale keys) and the "Every W5 edit to the in-memory API substitute" paragraph. The plan wins over issue #239.

Done when:

1. **Shared shape.** `CaseSummary` gains `riskTier?: RiskTier | null`, optional (the frozen in-memory substitute builds `CaseSummary` and `QueueItem` literals and must typecheck unchanged). `QueueItem extends CaseSummary`, so it inherits the field.
2. **Server always serves it.**
   - `GET /api/cases` (`server/src/cases/repository.ts` `listCases`): each item carries `riskTier`, the case's `risk_tier` (`high`, `medium`, `low`, `unknown`) or `null`.
   - `GET /api/queue` (`server/src/queue/repository.ts` `readQueue`): the same, read from the scoped `visible` sub-select (one column; scope, filters, counts, options and pages unchanged).
   - A route test asserts the key is present on every item (`null` before any submit or when the proposal is unavailable) and equals the case read's `riskTier`; scope is unchanged (an out-of-scope user still sees neither the case nor its tier).
3. **Web.**
   - A view-model function maps `riskTier` (absent, `null` or a tier) to a chip model: absent and `null` give no chip; each tier gives its `risk.tier.*` label and a tone, so the tier never reads by colour alone and Unknown is never styled as Low.
   - Queue cards (`screens/queue/queue-screen.tsx`) and case-list cards (`screens/cases/case-list-screen.tsx`) render a "Proposed risk tier" fact with the chip when there is one.
   - When any card on the page shows a tier, the list shows the placeholder rubric banner once (`role="note"`, section 7).
   - Locale keys in th and en under `risk.*`.
4. **No filter** (`riskTier` stays refused by the queue query, W6-16), no substitute edit, no migration, no policy row.
5. **Tests**: unit tests on the view models (chip for each tier; none for absent and null; banner rule), integration test on both lists (real Postgres), a browser check that a submitted case's card shows its tier chip and the banner on the server build. Existing `w3-01-queue` tests still pass unchanged (still scoped).
6. **Docs**: W0-02 section 7.3 dated W5-09 amendment (`riskTier` on `CaseSummary` and `QueueItem`).
