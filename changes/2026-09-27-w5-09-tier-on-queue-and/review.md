# Review: tier on queue and case list (W5-09, #239)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 9 (W5-09 row), section 6 (the `QueueItem`/`CaseSummary` row) and section 7 ("Queue and case list", placeholder banner, the substitute paragraph); the plan wins over issue #239. Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)". D07 stays open for AI/COE: the tier comes from the labelled SYNTHETIC PLACEHOLDER rubric. Synthetic data only; no network call, no model, no deploy. No migration, no substitute edit, no policy row.

## Change

- **Shared** (`rai-web/shared/src/schemas/cases.ts`): `CaseSummary` gains `riskTier?: RiskTier | null`, optional as section 6 declares (the frozen substitute's `caseSummary()` and `routes-queue.ts` typecheck unchanged). `QueueItem extends CaseSummary`, so it inherits it.
- **Server**: `listCases` (`server/src/cases/repository.ts`) and `readQueue` (`server/src/queue/repository.ts`) always serve `riskTier` from `case.risk_tier` (a CHECK-bound tier or null). The queue reads it from the scoped `visible` sub-select it already selects `case.*` from: one column, no change to scope, drill-down, filters, counts, options or pages.
- **Web**:
  - `web/src/screens/cases/case-list.view-model.ts`: `RISK_TIER_TONE` (the pack editor preview's tones: High danger, Medium warn, Low ok, Unknown muted), `riskTierChipOf` (absent or null → no chip; a tier → its `risk.tier.*` key and tone, reusing W5-07's `RISK_TIER_KEY`), `showsPlaceholderBanner`, and `CaseRowModel.riskTier`.
  - `web/src/screens/cases/risk-tier-chip.tsx` (new): `RiskTierFact`, a "Proposed risk tier" `dt`/`dd` fact with a `Badge` (text plus glyph plus tone) and `data-risk-tier`, rendered only when there is a tier.
  - `screens/queue/queue-screen.tsx` and `screens/cases/case-list-screen.tsx`: the fact on each card, and W5-07's `PlaceholderRubricBanner` (`role="note"`) once above the list when any card on the page shows a tier.
  - Locale key `risk.list.tier` (th and en); the tier labels reuse W5-07's `risk.tier.*`.
- **Docs**: W0-02 section 7.3 dated W5-09 amendment (`docs/engineering/implementation-plan-w1-w3.md`).

## Tests

- New integration `rai-web/tests/integration/w5-09-risk-tier-lists.test.ts` (4 tests, real Postgres, fixture app): before any submit every item on both lists carries the `riskTier` key with null (owner, BU SPOC, AI/COE, Admin); after a High submit the case reads `high` on both lists for all four, equal to the case read, and every other case stays null; an unanswered submit reads `unknown` (never low); each of the four stored values is served as is on both lists, the queue's `total`, `statusCounts` and `filterOptions` are unchanged, and an owner of no fixture case still sees none of them (scope unchanged).
- Unit (`web/src/screens/cases/case-list.view-model.test.ts`, 3 new; `web/src/screens/queue/view-model.test.ts`, 1 new): chip label and tone per tier, four distinct tones, th/en keys present; no chip for absent (substitute shape) and null; the banner rule; a `QueueItem` without the key shows no chip and no banner.
- New browser `rai-web/tests/browser/w5-09-risk-tier-lists.spec.ts` (server build, three widths): no chip and no banner before any submit; after a High submit (answers saved through the draft PUT, then submitted), the reviewer's queue and case list show exactly one chip, on RAI-2000-0001, with "Proposed risk tier" and "High" text, and the placeholder banner once; Thai and English; status elements have text; axe with no critical or serious violation; no horizontal scroll.
- No existing test changed. `w3-01-queue` (integration) and `w3-int-02-queue` (browser) pass unchanged: the queue is still scoped.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **Where the banner goes on a list.** Section 7 shows the placeholder banner "wherever rubric text or a tier appears". A list shows it once above the cards, only when at least one card on the page shows a tier, rather than once per card (seven repeated notes on a page would bury the cards). A page with no tier shows no banner.
- **The list passes `provenance: 'synthetic_placeholder'` without reading the rubric.** The lists do not call the rubric read: a card's tier was computed from the rubric its version froze, not the one in force today, and the W5 schema admits no other provenance (R-2), so the value is fixed until a D07 schema change, which would revisit this line.
- **Chip labels come from `risk.tier.*`, not the rubric's `tierLabels`.** Same reason: no rubric read per list; the placeholder's labels are the same words. The version view (W5-08) shows the frozen rubric's labels.
- **The chip is a "Proposed risk tier" fact in the card's facts list**, not a second badge in the card head beside the case status, so the tier is never mistaken for the workflow status and its text says it is a proposal.
- **Shared view model and component live under `screens/cases/`** (the plan's file list), and the queue imports them, as it already imports `pageCount` from there. The tone map is a copy of the pack editor's private `TIER_TONE` (same values) so this ticket does not edit `risk-questionnaire.tsx`, which W5-08 works beside.
- **Integration test setup writes `case.risk_tier` directly** inside a transaction with `setWorkflowWrite` (the W0-04 projection gate), only to prove each of the four stored values is served as is; the High and Unknown cases go through a real submit.
- **Local `.env` only**: `RAI_PG_TOOLS=docker-compose:rai-risk` (this lane's compose project, for the W7-01/W7-02 backup tests). `.env` is not committed.

## Commands and results

Worktree `/tmp/rai-w5-09-tier-on-queue-and`, Postgres project `rai-risk` on 55383, `rai-web/.env` from `.env.example` with the ports rewritten (8821/8822/8823/5193, `OBS_MIGRATION_ADMIN_URL` on 55383). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w5-09-tier-on-queue-and-logs/`. No port collision in this run.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w5-09-risk-tier-lists.test.ts` before the code | 4 fail: items do not carry `riskTier` |
| RED: `NODE_ENV=test node --import tsx --conditions=rai-source --test web/src/screens/cases/case-list.view-model.test.ts web/src/screens/queue/view-model.test.ts` before the code | 2 files fail: `riskTierChipOf` not exported |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture npx playwright test -c tests/browser/playwright.config.ts w5-09` before the code (unit tests set aside so the web build compiles; the path filter did not narrow, so the whole suite ran) | 217 passed, 3 failed: the W5-09 spec at all three widths (no `[data-risk-tier]` chip; the save and submit steps passed) |
| GREEN: the integration command | first 3/4 (the direct `risk_tier` write hit `rai.projection_write_forbidden`; setup moved inside a `setWorkflowWrite` transaction, no assertion changed), then 4/4 |
| GREEN: the unit command | first 14/15 (`risk.list.tier` missing), then with the locale keys 19/19 (with the locale tests) |
| GREEN: `npx playwright test -c tests/browser/playwright.config.ts --grep "W5-09"` | 3 passed |
| `npm ci` | exit 0 |
| `npm run lint` | first run exit 1 (Prettier on the new unit tests; formatted, no content change), then exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 1065 pass, 0 fail |
| `npm run test:integration` | exit 0, 465 pass, 0 fail, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 939 files scanned, 0 with the marker |
| `npm run test:browser:server` | exit 0, 220 passed |
| `npm run test:browser:substitute` | exit 0, 48 passed (substitute unchanged; no chip since its items omit the key) |
| `node scripts/check-links.mjs` (root) | exit 0; 480 Markdown files, 1331 relative links, 0 broken |
| `git diff --check` (root) | exit 0 |

## Review verdicts

To be recorded by the independent reviewers on the PR head.
