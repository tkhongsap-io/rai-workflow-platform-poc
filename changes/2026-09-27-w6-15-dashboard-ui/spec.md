# Spec: dashboard UI (W6-15, #232)

Source: W6 plan section 8.1 (response shape), 8.2 (drill-down, "every dashboard number is a link … a 0 is plain text"), 9 (routes, navigation, screens, locale keys, accessibility), 13 (browser evidence) and row W6-15. The plan wins over issue #232.

## Route and navigation

- `ROUTES.dashboard = '/dashboard'`, under `RequireSession` in `router.tsx`.
- `app-shell.tsx`: "Dashboard" (`dashboard.title`) is the first link of the primary navigation for every signed-in user. Nothing else in the navigation changes. The root redirect and the brand link are unchanged.

## Data

- `api.getDashboard()` reads `GET /api/dashboard` and checks the body against `DashboardResponseSchema` (`InvalidResponseError` otherwise, as `getDeskHealth` does). The SPA never derives or filters counts (the server scopes them).

## Screen (`web/src/screens/dashboard/`)

- `dashboard-screen.tsx`: `h1` `dashboard.title`, a description, the "as of" instant (`formatDateTime`). Loading status, `ErrorNotice` plus retry on failure, `dashboard.invalid_response` for a malformed body.
- **Empty state** (`dashboard.empty`, with body text) when `cases.total === 0`; no tile is shown then.
- **Tiles**, each a `<section>` with a heading holding one `<table>` with a `<caption>` and `<th scope>` header cells:
  1. **Cases by status**: one row per `CASE_STATUSES` status, plus the total. Link: `/queue?status=<status>`; total: `/queue`.
  2. **Review lanes and SLA**: one row per lane; columns pending, approved, sent back, due soon, past due. Links: `lane=<lane>&laneStatus=pending|approved|sent_back`, `lane=<lane>&sla=due_soon|breached`.
  3. **Open findings**: one row per lane; columns high, medium, low defects and QC unavailable, plus "of which paused" (plain). Links: `findingLane=<lane>&findingSeverity=<s>&findingKind=defect`, `findingLane=<lane>&findingKind=unavailable`. The advisory count is a plain line.
  4. **QC runs, last 30 days**: runs, unavailable runs, paused runs, rechecks; plain numbers (runs are not cases; the queue has no run filter).
  5. **Risk tiers**: `available: false` renders `dashboard.risk.unavailable`; `available: true` renders the tiers as stored (labels are D07's, never translated into approval language) and `notAssessed`, plain numbers (the `riskTier` filter is W6-16's).
  6. **Activity, last eight weeks**: one row per week (week start as a date); submitted, resubmitted, sent back, ready; plain numbers.
- `dashboard.view-model.ts` (pure, unit-tested): `countCell(count, query)` returns `{ kind: 'text' }` for 0 or no query and `{ kind: 'link', to }` otherwise, `to` built by the queue's `queueParams` so the URL parses back through `parseQueueQuery`; the drill-down query of each tile cell; `barPercent(count, max)` (0 to 100, 0 when max is 0).
- A link's accessible name states what it opens (`dashboard.link_label`: count plus row and column), so a screen reader never hears a bare number.
- **Bars**: `aria-hidden` spans whose width comes from the count (status and activity tiles). Numbers are text.
- **Colour**: the past-due column and severity columns are named in words by their headers; no meaning in colour alone.
- `dashboard.css`: the tiles in a responsive grid; tables scroll inside their tile at 390 px, the page never scrolls sideways.

## Locale keys

A contiguous `dashboard.*` block in th and en (`locales.test.ts` parity). Lane, status, projection and severity names reuse the existing `lane.*`, `status.*`, `projection.*`, `finding.severity.*` keys.

## Browser evidence (`tests/browser/w6-15-dashboard.spec.ts`, real server, three widths)

- Per role (owner CM, BU SPOC CM, DPO reviewer, Admin): the dashboard's numbers equal the API's for that identity (read over HTTP by the same browser session); scope differs as the server says.
- Drill-down: activating a lane or finding link lands on `/queue` with the filter in the URL, the "Dashboard filters" section, and a card count equal to the number clicked.
- Empty state for an owner with no case.
- th and en; keyboard (the dashboard link reached from the navigation, a count link activated with Enter, focus on main after navigation); axe with no critical or serious violation at 1440, 834 and 390 px in th and en; no horizontal page scroll.
