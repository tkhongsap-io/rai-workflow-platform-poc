# File-level implementation plan — prepared before code

## Existing patterns and chosen design

Use React/TypeScript, the existing API client request/error envelope, RequireSession, LocaleProvider, ErrorNotice, RouteFocus and `web/src/i18n/format.ts`. Existing router and app-shell own registration/navigation; their case-list/queue behavior remains intact. A page-local fetch lifecycle prevents recipient-bearing report data from surviving session changes. No new dependency or application-wide state layer.

Flow: RequireSession → Admin presentation guard → typed getDeskHealth → validated W3-07a report → four report sections and supplementary counters. API authorization is independent. Manual refresh starts a new request generation; session change/unmount invalidates it. Reuse canonical links and formatting; render only known safe fields.

## Phase 0 — dependency reconciliation (complete for local prerequisite)

Parent supplies the final W3-07a contract commit and its validation record. Diff it against the provisional `44dc9c4` plus dirty snapshot used here, especially queued unscheduled mail, lateQc, nullable/optional digest fields, safe reason unions and final exports. Do not copy uncommitted files. Confirm #48 split/ownership and obtain parent-directed dependency integration; no autonomous merge in this planning pass. W3-07a schema contract alone does not supply a real endpoint.

## Phase 1 — separate prerequisite contract commit, then reviewed prerequisite PR

Only after Phase 0; parent controls publication and merge. Keep this distinct from the consumer commit and merge its PR before any dependent consumer PR.

| File under rai-web | Planned change |
|---|---|
| `shared/src/locales/th.json`, `en.json` | Add `operator.*` labels for title/nav/refresh, four sections plus lateQc/counters, empty/error/unscheduled/no-run states, fields, text statuses and safe enum values; use existing common/lane keys where equivalent. Include process-counter/recent-record limitations and correlation copy label. No personal values in catalogues. |
| `shared/src/locales/locales.test.ts` | Verify both catalogues and interpolation parity for new placeholders; reuse existing catalogue checks. |
| `web/src/routes.ts`, `routes.test.ts` | Add `ROUTES.operatorDeskHealth = /operator/desk-health`; prove additive behavior and safe sign-in returnTo, no router registration yet. |
| `web/src/api/client.ts`, `client.test.ts` | Add `API_PATHS.operatorDeskHealth = /api/operator/desk-health` and `getDeskHealth(): Promise<DeskHealthReport>`, no query/body; retain same-origin credentials and standard 401/403/errors. Validate report against the final shared schema before returning (safe localized response error, no raw payload logging). Test response pass-through, optional states, malformed payload and auth/network failures. |

Needed extension is the locale/routes/client surface above, not a new server schema or fixture endpoint. Enumerate all final enum-to-locale mappings in this prerequisite so the screen commit does not quietly expand shared keys later. If new keys/types prove necessary, publish a follow-up prerequisite before the consumer.

## Phase 2 — consumer implementation, separate commit

| File under rai-web | Planned responsibility |
|---|---|
| `web/src/screens/operator/desk-health.tsx` (new) | Admin guard, request lifecycle, refresh/loading/retry/forbidden and safe report composition. Own local report state and discard obsolete responses. |
| `web/src/screens/operator/desk-health.view-model.ts` and `.test.ts` (new) | Pure exhaustive enum-to-key mapping, optional-value distinctions and principal Admin predicate; no scope/count/readiness calculation. Test queued unscheduled versus terminal, absent lastRun/count, unknown reason and late-QC refused semantics. |
| `web/src/screens/operator/desk-health-sections.tsx` (new) | Readiness, mail, QC (including late results), digest, counters; known fields only, labelled correlation fields and optional canonical case/version links. |
| `web/src/screens/operator/desk-health.css` (new) | Scoped responsive layout with wrapping opaque IDs/recipient data, readable statuses and keyboard focus; no document-wide style rewrite. |
| `web/src/router.tsx` | Register the page behind RequireSession. Do not change default landing or existing routes. |
| `web/src/screens/shell/app-shell.tsx` | Add Admin-only operator navigation. Reconcile with concurrent W3-02 shell changes before committing; preserve queue/case links. |
| `tests/browser/w3-07b-operator.rehearsal.substitute.spec.ts` (new) | Controlled exact-path interception, schema-valid synthetic reports, failure/delay scenarios and explicit rehearsal naming. Use existing substitute config discovery, not new runtime routes. |
| `tests/browser/support/operator-rehearsal.ts` (new, if fixtures are shared) | Test-only factories/interception for report states; no production imports. |

Do not touch server, migrations, fixture package or CI. Do not turn health into a control console. No retry, rerun, send, approve or acknowledge mutation. Parent owns root delivery logs and eventual consumer PR handoff.

## Verification and final integration handoff

- Prerequisite: focused client/routes/locales tests; lint/typecheck; confirm no route/nav behavior is activated; reviewed diff and recorded commit.
- Consumer unit/browser: populated and empty sections, zero versus absent values, long Thai/IDs, 401/403/5xx/network/malformed JSON, manual retry, delayed out-of-order response, Admin→non-Admin/sign-out content clearance, and no recipient-bearing logs/storage/URL. Check every non-Admin fixture role plus dual-role identity. Hidden nav is not API proof.
- At 1440/834/390: keyboard-only refresh/retry/correlation selection/case-link navigation; zero critical axe findings and no page overflow. Both locales and localized text status checked.
- No DB needed for isolated rehearsal. Use dedicated loopback browser ports selected after checking availability; never reuse another worker's servers. Parent coordinates any future DB/port allocation. Do not use occupied 54351/54362/54363/54364/54365.
- Relevant TESTING.md checks: Node24, own dependency install when implementation authorized, lint/typecheck/unit, build and substitute absence, focused rehearsal browser suite, repository link/frozen-source/whitespace checks. Record exact head/results; parent controls full-suite/final CI.
- W3-INT owns `tests/browser/w3-07b-operator.spec.ts` against the real API, with real workflow-generated OBS-09/10 records and matching log IDs, OBS-12 negative roles, OBS-17 Admin/owner behavior and accessibility. No interception on that path. UI-only rehearsals cannot close #48 or M3.

## Parent handoff and pending issues

1. **Contract head (supplied):** `d931cea` inspected; optional-nextAttemptAt re-review and prerequisite merge remain parent gates. Current dirty types are design input only. Confirm the final schema import and report optionality; no need to request a new response field for this page.
2. **UI contract (implemented and verified locally; report commit before consumer):** locale/routes/client prerequisite is based on supplied `9980c7e`; parent arranges independent review, separate prerequisite PR and merge. Consumer delivery follows both prerequisites.
3. **Consumer (implemented locally after parent authorization):** the listed web/tests files implement the page; final verification and independent review are recorded in review.md. Coordinate router/app-shell changes with the W3-02 author so neither navigation entry is lost. This scoped claim does not transfer their work.
4. **Real API and acceptance (pending):** W3-07a runtime, W3-04 terminal failure and W3-03b digest data may land independently. Rehearsal uses controlled report interception until those real sources exist; never substitute a browser fixture for their acceptance. Parent owns final isolated resources, full suite, CI, W3-INT, #48 and M3 closure.
5. **Review continuity:** the separate W3-03a fix re-review at `4aa19a3` was clean; it does not unblock W3-07a types or prove operator UI/API behavior. Keep its verification and acceptance record with W3-03a.

Planning is complete once the documentation checks below are recorded. Waiting for the contract is an implementation gate, not an unresolved design choice or a request to publish anything.

### Committed schema reconciliation — d931cea

Read the parent-supplied commit directly with git show; no API probe or guessed handler. Use `@rai/shared/schemas/observability` for `DeskHealthReportSchema`, `DeskHealthReport` and embedded `ReadinessReport`; queue re-export is confirmed. The committed JSON schemas are authoritative over illustrative prose. Queued failures permit attempts 1–3 and omitted nextAttemptAt (not null); terminal failures require attempts 4 and failureCategory, with no nextAttemptAt. Preserve omitted optional digest timestamps/counts and unavailableQc unknown exactly. Schema tests/rehearsals must cover these union branches without normalizing omission to zero, null or now.

No file-level plan or server-schema extension is needed after this reconciliation. This was the reconciliation decision before code authorization; parent subsequently supplied combined base `9980c7e`, now used for the local prerequisite. Local contract code is now authorized and verified; separate prerequisite delivery and consumer/OBS17 acceptance remain distinct gates.

## Authorized prerequisite implementation — base 9980c7e

Parent accepted the plan and authorized the first local contract commit. Rebased the planning branch onto `9980c7e`; retained both W3-03a and W3-07b Lane B claims when restoring the planning documents. No schema, API handler or permission changes. Reserved browser resources for the later consumer: browser 60788, substitute 60789, web 60175; no database.

The prerequisite additionally places exhaustive enum-to-locale maps in `web/src/i18n/operator-labels.ts` with `operator-labels.test.ts`: records are typed directly from ReadinessReport/DeskHealthReport and tests enumerate the authoritative JSON-schema literals. This completes enum labels before the consumer. Stored mail event `ready` uses desk-completion copy distinct from readiness `ready`. `InvalidResponseError` exposes only a fixed safe message key; the consumer will render it without response contents. Existing screens and API methods keep their behavior. The report is neither cached nor authorized in the client.

Consumer phase must retain the planned immediate render guard as well as request-generation/session invalidation; role changes cannot show stale Admin data for one frame. No app auto-refresh or new permission. No contract test, interception rehearsal or parent schema suite establishes OBS-17/API-consumer acceptance. Report this first commit and await parent sequencing before beginning the consumer.

## Bounded prerequisite size exception

The lead accepts this 864-line prerequisite as one coherent bilingual DTO/client contract: 290 catalogue lines, 134 exhaustive mappings, boundary tests and the accepted planning documents dominate; activation remains in the separate consumer. Keeping matching labels, enum maps and validation tests together avoids publishing a partial operator contract. Independent review and full CI remain mandatory; this is an engineering packaging exception, not runtime/OBS-17 acceptance.

## Authorized consumer implementation

Parent received prerequisite `ede6cc2`, isolated it at `/tmp/rai-w3-operator-contract` for review/publication, and authorized the separate consumer. Shared locale keys/maps, paths and client stay unchanged. The consumer adds the planned page/sections/style/view-model, router registration and Admin navigation, plus controlled browser rehearsals. A browser-only `tests/browser/support/operator-session-harness.js` mounts the actual provider/page through Vite for first-commit DOM inspection; it is never imported by the product or bundled.

The page uses the existing typed maps rather than duplicating enum mapping in its view-model. The view-model owns only presentation access and synchronous session/generation visibility. Manual refresh removes prior rows and preserves keyboard focus with aria-disabled plus an activation guard while loading. No polling, database, endpoint, permission or shared-state changes. Parent still controls dependency readiness, independent review and publication. Real-server OBS17 remains INT work.

## Consumer publication exception

The lead accepts the bounded 897-line consumer: approximately 435 implementation lines form one page, with its session-privacy and accessibility regressions. Independent review recommends keeping those guarantees together. This exception is separate from the prerequisite exception. The PR may open as a draft for CI; merge waits for the real operator API dependency and final review.
