# W3-07b prerequisite and consumer evidence

## Scope and dependency

Parent accepted the operator UI plan under #48 and authorized a separate local locale/routes/client prerequisite commit, followed by a separate consumer commit. Planning began on `89f7de9`; the work is now based on supplied combined contract head `9980c7e` (validated W3-07a `d931cea` plus main `a2392c9`). Planning documents were retained. The append-only Lane B conflict was resolved by keeping both W3-03a and W3-07b claims. No shared schema or server implementation was copied from a dirty worktree.

The committed W3-07a JSON schemas are authoritative. No response-schema extension is needed. Queued mail permits omitted nextAttemptAt; terminal mail requires four attempts and failureCategory. Missing optional digest values stay missing. These are contract semantics, not proof of a live operator endpoint.

## Implemented prerequisite

- 145 paired Thai/English operator locale keys, covering the planned fields, states, missing-data labels and every report enum. Existing lane/common keys are reused. Placeholder parity is tested.
- Exhaustive typed label maps in web/src/i18n/operator-labels.ts. Tests discover string literals in DeskHealthReportSchema and verify their labels; stored mail event ready has desk-completion copy distinct from service readiness.
- Additive ROUTES.operatorDeskHealth and API_PATHS.operatorDeskHealth; getDeskHealth(): Promise<DeskHealthReport> validates successful payloads against the committed schema. InvalidResponseError retains only a fixed safe message/key, never report contents. Absent values remain absent; no derived readiness, scheduling, scope, cache or permission decision.
- Tests cover canonical same-origin GET, optional states, terminal failures/digest provenance, 401/403 correlation, malformed schemas/oversized arrays and HTTP/network failures.

No page, router registration, navigation, API/substitute handler, new dependency, migration, permission, polling, database or external write. UI guard/session isolation is consumer work, not claimed by this commit. No API handler probe.

## Verification on the final prerequisite source

Node 24.21.0; own npm ci with the existing lockfile, no dependency version changes. Initial typecheck caught the stored ready event vocabulary mismatch; fixed with separate event labels. A missing test import during that correction was fixed before final checks; no check was waived.

| Check | Result |
|---|---|
| npm run typecheck | Passed |
| npm run lint | ESLint, Prettier and CSS checks passed |
| Focused client/routes/operator-labels/locales | 30 passed, 0 failed |
| npm run test:unit | 483 passed, 0 failed |
| npm run build | Passed; no screen activation |
| npm run check:substitute-absent | 487 files scanned, zero markers |
| Root node --test scripts/*.test.mjs tests/*.test.mjs | 40 passed |
| Documentation links | 177 Markdown files, 716 relative links, zero broken |
| Frozen-source hash | Matched docs/sources.md |
| git diff --check | Passed |

Logs: /tmp/rai-w3-07b-contract-{typecheck,lint,unit,focused,build,repo}.log. No database, integration or browser tests ran for this prerequisite. Independent review and final-head CI remain parent delivery gates; no OBS-17, API-consumer or M3 acceptance is claimed.

## Separate consumer handoff

Report the first local commit before consumer implementation. Parent controls prerequisite review/PR/merge. The subsequent consumer implements Admin-only presentation, immediate render guards plus session/request-generation invalidation (no one-frame stale Admin data), manual refresh and safe typed report rendering. Use only Playwright-controlled interception for isolated rehearsal; never add a fixture endpoint or app fallback. Reserved browser resources: 60788, substitute 60789, web 60175. No DB for UI rehearsal.

Real OBS-17 remains W3-INT against the actual W3-07a endpoint, actual failed-mail/unavailable-QC records and matching persisted/log correlation IDs, server authorization and three-width keyboard/axe proof. Contract/intercepted tests cannot replace it. No push, PR or merge by this worker.

## PR-size handoff

The local prerequisite is larger than the W0-02 working rule of about 600 changed lines: bilingual exhaustive enum copy, typed maps, boundary tests and the previously accepted planning documents account for the diff. The parent recorded a bounded size exception in plan.md before publication, retaining matching catalogues, exhaustive mappings and client-boundary proof together. This local commit is the requested reviewable handoff, not authorization to publish it.


## Separate consumer — local implementation

Parent received `ede6cc2` and approved the bounded prerequisite size exception in its isolated publication worktree. That exception applies to the prerequisite only. Parent then authorized this separate consumer; the earlier prerequisite-only scope and verification above remain historical evidence.

Implemented Admin-only navigation and `/operator/desk-health` behind RequireSession. The page renders the validated DTO's readiness, mail, QC/late QC, digest and counter fields with the committed locale maps and Bangkok Gregorian formatter. Missing run/count/time, zero count, queued unscheduled mail and terminal failure stay distinct. Read-only labelled correlation fields and canonical case/version links carry no recipient in URLs. No business-state derivation, new permission, API handler, substitute endpoint, automatic refresh, database or external action.

Report visibility is checked during render against the current Admin session object and request generation. Session replacement, role loss, sign-out and manual refresh hide previous data immediately; effect cleanup rejects obsolete responses. The browser-only harness checks the first committed DOM in a layout effect, before passive effects, including same-subject Admin-to-owner and logout transitions. It also releases an old Admin request while the owner is active. HTTP 401 uses the existing session-revocation flow; 403/network/5xx/malformed responses show safe errors without retaining visible report data.

Development verification caught and fixed Refresh focus loss during loading (focusable aria-disabled control with guarded activation), and the correlation input grid's intrinsic minimum width at 390px. Early rehearsal setup failures were corrected: exact fixture IDs, Strict Mode initial request counts, and consistent Vite-transformed React imports in the test-only harness. No check was waived. Shared locales/maps/routes/client are byte-identical to the prerequisite.

### Consumer verification

Node 24.21.0, isolated worktree, substitute 60789/web 60175; no DB or integration run.

| Check | Result |
|---|---|
| Typecheck / lint | Passed, including ESLint, Prettier and CSS |
| Unit suite | 485 passed, zero failed |
| Operator browser rehearsal | 48 passed: 16 scenarios at 1440/834/390 |
| Keyboard / axe / layout | Refresh, retry, correlation selection and version link; both locales; zero critical/serious axe findings; no horizontal page overflow |
| Production build / substitute absence | Passed; 487 scanned files, zero markers; existing large-chunk advisory remains |
| Root unit checks | 40 passed |
| Documentation / frozen source / whitespace | 177 Markdown files, 716 links, zero broken; source hash matches; diff check passed |

Rehearsal covers all seven non-Admin fixture identities including the dual-role identity, absent/zero/unscheduled values, localized statuses, 401/403/500/network/invalid-schema/invalid-JSON recovery, first-commit data clearance and obsolete delivery. Synthetic recipient data does not appear in console, browser storage or URL. No server authorization, actual failure persistence/correlation provenance, OBS17 or acceptance is inferred. Logs: `/tmp/rai-w3-07b-consumer-{lint,typecheck,unit,browser,build,repo}.log`.

No root delivery logs changed (parent owns them). No push/PR/merge. Before consumer publication, parent must verify both the shared UI contract and W3-07a API dependency readiness, obtain independent review, and resolve the consumer's own >600-line PR scope through an explicit exception or publication split; the prerequisite exception is not inherited. The consumer implementation remains a separate local commit as requested. Real API acceptance remains W3-INT.

## Independent review and current-main preparation

Independent review of 8b8e94b against ede6cc2 was clean; the reviewer reran 2 unit and all 48 three-width browser rehearsal tests. The consumer was rebased onto merged prerequisite main 848f89e. Router conflict resolution retains both QueueScreen and DeskHealthScreen, and the change records retain both accepted scope histories. Final rebase verification is pending. The draft PR does not close issue #48 or claim real-server OBS17.
