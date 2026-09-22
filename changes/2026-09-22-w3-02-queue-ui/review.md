# W3-02 local review

## First commit: UI contract

Additive Thai/English queue labels, ROUTES.queue, API_PATHS.queue and typed getQueue(QueueQuery): Promise<QueueResponse>. The shared API schema is unchanged. No screen, router or navigation behavior change in this prerequisite commit.

Node24, own npm ci. Typecheck, focused ESLint and 20 client/route/locale unit tests passed; git diff --check and repository link check passed. Log: /tmp/rai-w3-ui-contract-check.log. This contract subsequently merged as PR #110 (`89f7de9`). W3-08 PR108 must also land before consumer delivery.

## Independent contract review and parent verification

PR #110: independent reviewer Confucius reported no actionable findings on `35f798a`, independently ran all 20 client/route/locale tests and checked whitespace. Parent verification on the isolated contract branch passed `npm run lint`, `npm run typecheck` and all 459 unit tests. Final contract CI passed and PR #110 merged. This is prerequisite-contract evidence only; the consumer and W3-INT are not accepted here.

## Implementation

Implemented separately after contract commit `4f3940b`. Consumer paths: `web/src/screens/queue/` (screen, URL view model and tests, scoped CSS), `web/src/router.tsx`, `web/src/screens/shell/app-shell.tsx`, and `tests/browser/w3-02-queue.substitute.spec.ts`. No locale, API client, shared-schema or route-constant changes in the consumer commit. The implementation did not modify server, fixture or DB behavior. The parent added root-log outcome records during delivery.

Protected `/queue` uses existing cards, badges, form styles, locale provider and date formatting. The design handoff's two-column case grid becomes one column on narrow screens. Current submission and latest version are separate; a draft is explicitly labelled as a draft. Lane states/due dates stay on the current submitted version while a successor draft exists. The screen renders API nextAction text without deriving workflow state or offering approval controls. Finding counts are intentionally absent because the shared queue response has none.

Primary shell navigation and signed-in brand point to `/queue`; `/cases` keeps its original route, navigation link, root/sign-in fallback and post-create destination. Existing `/cases` tests are unchanged. This additive handoff avoids making existing real-server journeys depend on the pending W3-INT queue integration; parent can migrate landing behavior with that integration.

URL search, field selector, status, owner, group and pagination survive reload and browser history; applying filters resets page to one. Counts/options/items are taken from the response, with no browser scope filtering. Invalid, duplicate and unknown URL keys show an explicit error/reset instead of broadening the search. The parser uses a null-prototype record so `__proto__` cannot disappear through the object setter. Selected URL values outside the returned options are echoed only as the user's selected filter, not added to the response population.

Request identity includes URL, actor subject/grants and reload counter. Previous cards/options are hidden while a different request loads; cancelled/superseded responses cannot overwrite the latest result. Session expiry returns through existing sign-in handling. Network/HTTP failures render the existing localized error notice plus Retry.

## Consumer verification

Node 24.21.0, own `npm ci` and node_modules. No database used. Substitute/Vite ports **58789 / 55175**, one worker, three projects (1440 / 834 / 390). Synthetic fixture set `slice1-synthetic@1`; all browser evidence below is substitute-only.

- Full `npm run test:unit`: **418 passed**, zero failures/skips (includes 20 first-commit contract checks and three URL view-model tests).
- `npm run lint`, `npm run typecheck`: passed on the consumer source.
- `npm run build`, `npm run check:substitute-absent`: passed; 471 built files scanned, zero substitute markers.
- `node --test scripts/*.test.mjs tests/*.test.mjs`: **40 passed**.
- Link check: 157 Markdown files, 694 relative links, zero broken; frozen source hash unchanged; `git diff --check` passed.
- Focused queue browser run before the final version-label/complete-state additions: **24 passed**. Final full UI run: **117 passed** in 1.5 minutes (90 unchanged W1/W2 tests + 27 queue tests). Queue axe checks reported zero critical and zero serious violations across all three widths.

The nine queue browser scenarios cover Thai/English cards and navigation; URL filters/pages/back/forward/reload and empty/error reset; independent expected owner/BU/reviewer/dual-role/empty scope IDs, direct API counts/options/search negatives and BU pagination; signed-out queue/card deep links and copied HR case denial to CM SPOC; submitted and successor versions/frozen due-date rendering; keyboard-only filter/open with visible focus; deferred loading, network failure, retry and expired sessions; delayed old-response suppression; and actual substitute approvals/dispositions leading to awaiting_disposition and ready_for_launch. Axe checks cover Thai and English, empty/loading/error/forbidden and workflow states at all widths. Backend authorization and SQL isolation are not proved by this suite.

Visual review: inspected desktop cards and the phone successor view; fixed the draft/submission wording found in the first screenshots. Final desktop and phone screenshots were inspected after the correction. Screenshots are retained under `rai-web/test-results/substitute/`; the HTML report and axe attachments are under `rai-web/playwright-report/substitute/`. No browser artifacts are committed.

Logs: `/tmp/rai-w3-ui-contract-check.log`, `/tmp/rai-w3-ui-unit.log`, `/tmp/rai-w3-ui-lint.log`, `/tmp/rai-w3-ui-typecheck.log`, `/tmp/rai-w3-ui-build.log`, `/tmp/rai-w3-ui-browser-full.log`, `/tmp/rai-w3-ui-repo.log`.

## Handoff boundary

The contract prerequisite (#110) and W3-08 (#108) are merged. Consumer delivery still requires final PR verification; parent owns independent review, PRs and merge gates. No push, PR, merge or external publication performed here. Real-server wiring, integration/browser evidence and acceptance belong to W3-INT; no production permission is claimed.

## Independent review P2: reset unapplied filters

The reviewer reproduced an unapplied search surviving Reset on bare `/queue`: clearing an already-empty URL did not change the filter component key, so local drafts survived. Reset now explicitly restores search/status/owner/group to empty, searchBy to all, and page size to 25 before clearing the URL. The regression changes all six controls without applying, clicks Reset, checks every restored control, then applies and verifies the API request has only default searchBy/page/pageSize and all expected scoped cards return.

Validation on Node 24.21.0 with isolated substitute ports 58789/55175 and no database: focused queue browser **30 passed**; full substitute browser **120 passed** (90 existing + 30 queue), including the new regression at 1440/834/390; full unit **418 passed**, no failures/skips; lint and typecheck passed. Repository link check (157 files/694 links), frozen-source check and git diff --check passed. Logs: `/tmp/rai-w3-ui-reset-focused.log`, `/tmp/rai-w3-ui-reset-browser-full.log`, `/tmp/rai-w3-ui-reset-unit.log`, `/tmp/rai-w3-ui-reset-lint.log`, `/tmp/rai-w3-ui-reset-typecheck.log`.

The own plan records the reviewer-recommended, user-authorized bounded engineering exception before consumer PR: keep the cohesive queue flow and its browser/unit tests together. No shared contract change, push, PR, merge, root log edit or digest implementation. Digest preparation is paused. These remain synthetic substitute results, not A06 real acceptance; W3-INT retains real-server verification and acceptance.

## Re-review P2: empty-state Reset shares the form reset

The first fix covered only the form button. The empty-state button still cleared only the URL, leaving unapplied drafts on bare `/queue` for `fx-user-owner-cm-2`. All Reset entry points now call the parent handler: clear URL and increment a reset counter in the filter form key. The form remount restores every draft from default query values even when the URL is unchanged; the separate form-only reset implementation is removed.

The new empty-owner regression edits search, search field and page size, uses the empty-state Reset, asserts all six default controls, then applies and verifies only default query values are sent and no cards appear. The existing populated-owner form Reset regression remains intact. Both run at 1440/834/390.

Node 24.21.0, no DB, substitute ports 58789/55175: focused queue **33 passed**, full substitute browser **123 passed** (90 existing + 33 queue), full unit **418 passed** with zero failures/skips; lint and typecheck passed. Relative links (157 files/694 links), frozen-source check and git diff --check passed. Logs: `/tmp/rai-w3-ui-reset-all-focused.log`, `/tmp/rai-w3-ui-reset-all-browser-full.log`, `/tmp/rai-w3-ui-reset-all-unit.log`, `/tmp/rai-w3-ui-reset-all-lint.log`, `/tmp/rai-w3-ui-reset-all-typecheck.log`.

The accepted bounded size exception remains unchanged. Local fix only: no push, PR, rebase, shared contract changes or digest work. Substitute results do not establish A06 real acceptance; parent owns re-review and delivery gates, and W3-INT owns real-server evidence.

## Parent delivery review

Carver independently reviewed the final implementation at `778bece` and reported no remaining high-confidence findings after both Reset fixes. Six browser regressions (both Reset paths at all widths) and three URL unit tests independently passed. The parent rebased the consumer onto the reviewed W3-08 branch, preserving PR #110's contract-review record. Application and test source are unchanged by this rebase. Final combined verification and PR CI remain delivery gates; W3-INT acceptance remains separate.

## Combined full verification and keyboard harness correction

The first combined run passed unit/integration checks but failed one existing tablet keyboard journey: entering the new-case form began before RouteFocus settled, so input shifted into the wrong fields and submission correctly returned validation failure. Both real/substitute mirrors now wait for main focus and explicitly assert the first named input is focused. No keyboard, visible-focus, submission or created-card assertion was removed; no sleep/retry/skip or programmatic focus was added. Carver independently reviewed this correction clean. Fifteen repeated real-server runs (five per width) passed.

Final `npm run verify:full` exited 0: lint, typecheck, 470 unit, 205 integration, 123 real-server browser and 123 substitute browser tests, build and substitute-absence. Logs: `/tmp/rai-w3-ui-keyboard-regression.log` and `/tmp/rai-w3-ui-fixed-full.log`. The prerequisite PRs #108 and #110 are merged. These full regressions protect existing server behavior; the dedicated combined W3 journey remains W3-INT. Final PR CI is still required.
