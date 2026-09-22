# Operator desk-health UI specification

## Dependency and contract boundary

Consume the final W3-07a `DeskHealthReport` from `@rai/shared/schemas/observability` as defined by parent-supplied commit `d931cea`; its export from `schemas/observability` and re-export from `schemas/queue` are confirmed. The committed JSON schemas are authoritative. Parent authorized the local UI contract/consumer sequence on base `9980c7e`; prerequisite merge and independent review remain parent delivery gates. The proposed `GET /api/operator/desk-health` is 200 for Admin, 401 without a session, 403 for every non-Admin role. W3-07a owns route, `operator.view` authorization, bounded queries and serialization. W3-07b cannot infer server authorization from a role-shaped browser object.

No new HTTP response field is needed for this planned page. Optional values stay optional: no digest lastRun means no recorded run, no retry timestamp means not scheduled, unavailable-QC reason `unknown` stays unknown, missing breach count is not zero. Arrays are bounded recent records (up to 100), not full-history totals; no fabricated pagination or truncation certainty. Error counters are since process start, not durable history. If exact totals, pagination or polling are later requested, return to the shared-contract owner first.

## Page and data mapping

Four primary sections preserve W0-10 order. Use a manual Refresh button; no automatic polling in this slice. Status always has localized text. Dates use the existing Asia/Bangkok Gregorian formatter, including Thai `th-TH-u-ca-gregory`.

| Section | Authoritative fields and presentation |
|---|---|
| Readiness | `generatedAt`, `readiness.checkedAt/status`, identity mode/status/loopback and safe reason; DB/migrations/blob, mail sink kind/status, QC kind/status, build commit/schema version. Display API status without recomputing readiness. Disabled QC is distinct from unavailable. |
| Failed mail and pending retries | `failedMail`: notification/event, optional case/version/lane, Admin-only recipient, attempts/status, safe lastErrorCode, optional nextAttemptAt, terminal failureCategory. Queued attempts 1–3 are pending failures, not terminal; failed attempt 4 is terminal. No invented retry date or retry/send action. |
| QC operations | `unavailableQc`: run, optional owning lane, trigger, reason, requestedAt; supplementary `lateQc`: late-result/run IDs, trigger/optional lane, recordedAt, result status and refusedFindingCount. Late completed results were refused after closure, not applied findings or successful workflow changes. |
| SLA digest | `slaDigest.lastRun` optional; run/day/start/optional finish, status, optional breach count, notification IDs and safe error; `recentFailures`: stage/code/time. Running remains running after a crash unless API reports otherwise. No inferred completion or execution control. |

Render `errorCounters` as a supplementary status list with localized code, count and lastAt. Correlation IDs on mail/QC/digest records are selectable, labelled read-only fields; do not invent one for aggregate counters/readiness. Use canonical case/version route helpers for rows with IDs; omit links for digest rows without a case. Links carry no recipient, token or error data and still pass normal server case authorization. Do not render arbitrary JSON, stack traces, document contents or finding evidence.

## Access, loading and error states

RequireSession preserves sign-in returnTo. Navigation is visible only to a principal with an Admin grant; a direct non-Admin visit shows the localized forbidden state and never requests or renders report contents. This UI guard supplements, never proves, the server's operator.view policy. A 403 returned to an apparent Admin is authoritative and clears content. A 401 clears the session/report and invokes the existing expiry path.

Keep report state local to the page and keyed to the signed-in principal/session; never persist it in browser storage, URL, logs or a shared cache. Clear rows before refresh and on session changes; generation-token cleanup ignores late responses, including an old Admin response after sign-out or role change. Rendering checks the current Admin session as well as request generation, preventing one-frame stale recipient display. Loading uses role=status/aria-busy; failure uses the existing safe localized error component and manual retry. Network/5xx/malformed response states never masquerade as an empty report. Empty arrays receive section-specific neutral messages.

Use headings, semantic tables or labelled responsive rows, visible focus and natural tab order. Read-only correlation fields support keyboard select/copy without a new clipboard permission. Refresh/retry is keyboard operable; no focus stealing after every refresh. Show Thai and English keys with identical placeholders; identifiers and permitted Admin recipient values are data, not translation keys.

## Rehearsal and acceptance

There is no operator endpoint in the current API substitute. Do not add one inside this UI ticket. For isolated rehearsal use Playwright interception of only `/api/operator/desk-health`, serving schema-checked synthetic reports/errors/delayed responses; reuse the existing substitute session/identity harness. Keep interception exclusively in test files, never application fallback data. Assert the intended route was intercepted so a 404 cannot silently become a pass.

Rehearsal demonstrates rendering, role gating, session isolation, accessibility and error handling only; it does not establish endpoint authorization, persistence, correlation provenance, OBS-09/10/12/17 or A06. W3-INT runs the actual server without report interception, creates terminal failed mail through the retry workflow and unavailable QC through the synthetic runner, then proves each appears once with the persisted/log correlation IDs. Direct API 401 and every non-Admin 403, owner page forbidden, Admin page content, restart evidence where required and keyboard/axe at 1440/834/390 remain real-server gates.
